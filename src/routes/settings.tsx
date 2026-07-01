import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save, Send } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "IV Doc - Project settings" },
      { name: "description", content: "Configure webhook handoff for IV Doc." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.loading && !auth.user) void navigate({ to: "/auth" });
  }, [auth.loading, auth.user, navigate]);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [newSecret, setNewSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.user) return;
    void (async () => {
      const { data } = await supabase
        .from("projects")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select("id, webhook_url" as any)
        .eq("user_id", auth.user!.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (data) {
        const p = data as unknown as {
          id: string;
          webhook_url: string | null;
        };
        setProjectId(p.id);
        setWebhookUrl(p.webhook_url ?? "");
        // Check secret presence without ever pulling its value over the wire.
        const { data: secretProbe } = await supabase
          .from("projects")
          .select("id")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .not("webhook_secret" as any, "is", null)
          .eq("id", p.id)
          .maybeSingle();
        setHasSecret(!!secretProbe);
      }
      const { data: session } = await supabase
        .from("processing_sessions")
        .select("id")
        .eq("user_id", auth.user!.id)
        .eq("package_decision", "auto_approve")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (session) setLastSessionId(session.id);
    })();
  }, [auth.user]);

  const save = async () => {
    if (!projectId) return;
    setSaving(true);
    setStatus(null);
    const patch: Record<string, string | null> = {
      webhook_url: webhookUrl.trim() || null,
    };
    if (newSecret.trim()) patch.webhook_secret = newSecret.trim();
    const { error } = await supabase
      .from("projects")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(patch as any)
      .eq("id", projectId);
    setSaving(false);
    if (error) {
      setStatus(`Save failed: ${error.message}`);
    } else {
      setStatus("Saved.");
      if (newSecret.trim()) setHasSecret(true);
      setNewSecret("");
    }
  };

  const sendTest = async () => {
    if (!lastSessionId) {
      setStatus(
        "No auto-approved session found yet. Process a package first to send a test.",
      );
      return;
    }
    setTesting(true);
    setStatus(null);
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    try {
      const res = await fetch(`/api/handoff/${lastSessionId}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json().catch(() => ({}) as Record<string, unknown>);
      setStatus(
        `Test handoff ${res.status}: ${JSON.stringify(json).slice(0, 240)}`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
    setTesting(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/75 border-b hairline">
        <div className="mx-auto max-w-3xl px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <span className="font-display font-semibold tracking-tight text-lg">
              IV Doc
            </span>
          </Link>
          <Link
            to="/process"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to workspace
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Project settings
          </h1>
          <p className="mt-2 text-muted-foreground">
            Configure the webhook that receives auto-approved packages.
          </p>
        </div>

        {!auth.user ? (
          <div className="bento p-6">
            <p className="text-sm text-muted-foreground">
              Sign in to configure project settings.
            </p>
          </div>
        ) : (
          <section className="bento p-6 space-y-5">
            <div>
              <label
                htmlFor="webhook-url"
                className="text-sm font-medium block mb-1.5"
              >
                Webhook URL
              </label>
              <input
                id="webhook-url"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/ivdoc/handoff"
                className="w-full rounded-lg border hairline bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Auto-approved session payloads are POSTed here.
              </p>
            </div>

            <div>
              <label
                htmlFor="webhook-secret"
                className="text-sm font-medium block mb-1.5"
              >
                Webhook secret{" "}
                {hasSecret && (
                  <span className="text-xs text-muted-foreground font-normal">
                    (a secret is currently set — leave blank to keep it)
                  </span>
                )}
              </label>
              <input
                id="webhook-secret"
                type="password"
                autoComplete="new-password"
                value={newSecret}
                onChange={(e) => setNewSecret(e.target.value)}
                placeholder={hasSecret ? "••••••••" : "Enter a strong shared secret"}
                className="w-full rounded-lg border hairline bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Used to sign each payload with HMAC-SHA256 (header{" "}
                <code>X-IVDoc-Signature</code>). Never shown again after save.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving || !projectId}
                className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-ink)] text-[var(--color-mist)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </button>
              <button
                type="button"
                onClick={sendTest}
                disabled={testing || !webhookUrl}
                className="inline-flex items-center gap-2 rounded-lg border hairline px-3 py-2 text-sm hover:bg-[var(--color-mist)] disabled:opacity-50"
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send test payload
              </button>
            </div>

            {status && (
              <p className="text-xs text-muted-foreground break-words">
                {status}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
