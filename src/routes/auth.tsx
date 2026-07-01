import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import authHero from "@/assets/auth-hero.jpg";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "IV Doc — Sign in" },
      { name: "description", content: "Sign in or create an IV Doc account." },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "reset";

function AuthPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!auth.loading && auth.user) void navigate({ to: "/process" });
  }, [auth.loading, auth.user, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/process` },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Account created. You can sign in now.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: `${window.location.origin}/auth` },
        );
        if (error) throw error;
        setInfo("Password reset link sent. Check your email.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const heading =
    mode === "signin"
      ? "Welcome back"
      : mode === "signup"
        ? "Create your account"
        : "Reset password";
  const subcopy =
    mode === "signin"
      ? "Use your email and password to access processing history, workspace sessions, and document review tools."
      : mode === "signup"
        ? "Save processing history, configure handoff webhooks, and review documents with your team."
        : "Enter your email and we'll send you a link to reset your password.";

  const cta =
    mode === "signin"
      ? "Sign in"
      : mode === "signup"
        ? "Create account"
        : "Send reset link";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b hairline">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display font-semibold tracking-tight text-lg">
              IV Doc
            </span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Overview
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-6 py-12 lg:py-16">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            {/* Visual panel */}
            <div className="bento-dark relative overflow-hidden p-2 aspect-square max-w-xl">
              <img
                src={authHero}
                alt="Documents flowing through a secure neural network"
                width={896}
                height={896}
                className="rounded-[calc(var(--radius-2xl)-6px)] w-full h-full object-cover"
              />
              <div className="absolute left-6 right-6 bottom-6 flex items-center justify-between">
                <div className="chip chip-dark">
                  <ShieldCheck className="h-3.5 w-3.5" /> Protected workspace
                </div>
                <span className="text-[var(--color-mist)]/70 text-xs font-mono">
                  Supabase Auth
                </span>
              </div>
            </div>

            {/* Form panel */}
            <div className="max-w-md w-full">
              <span className="chip">
                <Lock className="h-3.5 w-3.5" /> Secure access
              </span>
              <h1 className="mt-5 text-5xl md:text-6xl font-semibold leading-[0.95] tracking-tight">
                {heading}
              </h1>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                {subcopy}
              </p>

              <form onSubmit={submit} className="bento p-6 mt-8 space-y-5">
                {/* Tabs */}
                <div className="grid grid-cols-3 rounded-xl bg-[var(--color-elevated)] p-1 hairline border">
                  {(["signin", "signup", "reset"] as Mode[]).map((m) => (
                    <button
                      type="button"
                      key={m}
                      onClick={() => {
                        setMode(m);
                        setError(null);
                        setInfo(null);
                      }}
                      className={`text-sm py-2 rounded-lg transition-colors ${
                        mode === m
                          ? "bg-background shadow-sm font-medium"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {m === "signin"
                        ? "Sign in"
                        : m === "signup"
                          ? "Sign up"
                          : "Reset"}
                    </button>
                  ))}
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="text-sm font-medium block mb-1.5"
                  >
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border hairline bg-background pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                    />
                  </div>
                </div>

                {mode !== "reset" && (
                  <div>
                    <label
                      htmlFor="password"
                      className="text-sm font-medium block mb-1.5"
                    >
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        id="password"
                        type={showPw ? "text" : "password"}
                        required
                        minLength={8}
                        autoComplete={
                          mode === "signin" ? "current-password" : "new-password"
                        }
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border hairline bg-background pl-9 pr-10 py-2.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                        aria-label={showPw ? "Hide password" : "Show password"}
                      >
                        {showPw ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-xs text-destructive break-words">
                    {error}
                  </p>
                )}
                {info && (
                  <p className="text-xs text-muted-foreground break-words">
                    {info}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-ink)] text-[var(--color-mist)] px-3 py-3 text-sm font-medium hover:bg-[var(--color-primary)] transition-colors disabled:opacity-50"
                >
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  {cta}
                </button>
              </form>

              <p className="mt-5 text-xs text-muted-foreground text-center">
                Prefer to explore first?{" "}
                <Link
                  to="/process"
                  className="text-foreground underline underline-offset-2 hover:text-[var(--color-primary)]"
                >
                  Continue as demo
                </Link>
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
