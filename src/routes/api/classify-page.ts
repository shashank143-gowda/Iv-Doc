// POST /api/classify-page — classifies a single page image into a doc segment type.
// Used by client-side PDF splitting (src/lib/splitPdf.ts) to detect document
// boundaries inside a multi-document PDF.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  image_base64: z.string().min(1),
  mime_type: z.string().min(1),
});

const ALLOWED = [
  "document_checklist",
  "loan_contract",
  "payment_schedule",
  "account_opening",
  "remittance_form",
  "cash_slip",
  "signature_page",
  "other",
] as const;

const PROMPT =
  "Classify this single page into exactly one of: " +
  ALLOWED.join(", ") +
  ". Reply with only the type, no other text.";

export const Route = createFileRoute("/api/classify-page")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (err) {
          return Response.json(
            { error: "Invalid body", detail: String(err) },
            { status: 400 },
          );
        }
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "OPENAI_API_KEY not configured" },
            { status: 500 },
          );
        }
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            max_tokens: 20,
            temperature: 0,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: PROMPT },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:${body.mime_type};base64,${body.image_base64}`,
                    },
                  },
                ],
              },
            ],
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          return Response.json(
            { error: `OpenAI ${res.status}`, detail: detail.slice(0, 400) },
            { status: 502 },
          );
        }
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const raw = (json.choices?.[0]?.message?.content ?? "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z_]/g, "");
        const type = (ALLOWED as readonly string[]).includes(raw) ? raw : "other";
        return Response.json({ type });
      },
    },
  },
});
