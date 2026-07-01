import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import type { Database } from "@/integrations/supabase/types";

const APPROVED_DECISIONS = new Set(["auto_approve", "auto_approved"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const Route = createFileRoute("/api/handoff/$sessionId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const sessionId = params.sessionId;
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.toLowerCase().startsWith("bearer ")) {
          return json({ error: "Missing bearer token" }, 401);
        }

        const url = process.env.SUPABASE_URL!;
        const publishable = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

        const userClient = createClient<Database>(url, publishable, {
          global: { headers: { Authorization: authHeader } },
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const { data: userData, error: userErr } =
          await userClient.auth.getUser();
        if (userErr || !userData.user) {
          return json({ error: "Unauthorized" }, 401);
        }
        const userId = userData.user.id;

        // Load session (RLS scopes to this user)
        const { data: session, error: sessionErr } = await userClient
          .from("processing_sessions")
          .select("*")
          .eq("id", sessionId)
          .maybeSingle();
        if (sessionErr) return json({ error: sessionErr.message }, 500);
        if (!session) return json({ error: "Session not found" }, 404);

        const decision = session.package_decision ?? "";
        if (!APPROVED_DECISIONS.has(decision)) {
          return json(
            {
              error: `Session decision is "${decision}". Only auto-approved sessions can be handed off.`,
            },
            400,
          );
        }

        if (!session.project_id) {
          return json({ error: "Session has no project" }, 400);
        }

        const { data: project, error: projectErr } = await userClient
          .from("projects")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select("id, user_id, webhook_url, webhook_secret" as any)
          .eq("id", session.project_id)
          .maybeSingle();
        if (projectErr) return json({ error: projectErr.message }, 500);
        if (!project) return json({ error: "Forbidden" }, 403);
        if ((project as unknown as { user_id?: string }).user_id !== userId) {
          return json({ error: "Forbidden" }, 403);
        }

        const webhookUrl = (project as unknown as { webhook_url?: string })
          .webhook_url;
        const webhookSecret = (
          project as unknown as { webhook_secret?: string }
        ).webhook_secret;
        if (!webhookUrl) {
          return json(
            { error: "No webhook_url configured for this project" },
            400,
          );
        }

        const { data: docs, error: docsErr } = await userClient
          .from("project_documents")
          .select("*")
          .eq("session_id", sessionId);
        if (docsErr) return json({ error: docsErr.message }, 500);

        const payload = {
          session_id: session.id,
          project_id: session.project_id,
          name: session.name,
          package_decision: decision,
          package_decision_reason: session.package_decision_reason,
          package_validation: session.package_validation,
          package_validation_results: session.package_validation_results,
          documents: docs ?? [],
          delivered_at: new Date().toISOString(),
        };
        const body = JSON.stringify(payload);
        const signature = webhookSecret
          ? createHmac("sha256", webhookSecret).update(body).digest("hex")
          : "";

        const admin = createClient<Database>(url, serviceKey, {
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        let statusCode: number | null = null;
        let success = false;
        let errorMsg: string | null = null;
        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "X-IVDoc-Signature": signature,
              "X-IVDoc-Session": session.id,
            },
            body,
          });
          statusCode = res.status;
          success = res.ok;
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            errorMsg = text.slice(0, 500) || res.statusText;
          }
        } catch (err) {
          errorMsg = err instanceof Error ? err.message : String(err);
        }

        await admin.from("webhook_deliveries").insert({
          project_id: session.project_id,
          session_id: session.id,
          user_id: userId,
          status_code: statusCode,
          success,
          error: errorMsg,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          request_body: payload as any,
        });

        return json({
          ok: success,
          status_code: statusCode,
          error: errorMsg,
        });
      },
    },
  },
});
