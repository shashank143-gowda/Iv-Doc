import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, LogIn, LogOut } from "lucide-react";

import { Logo } from "@/components/Logo";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { useAuth } from "@/lib/auth";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function AuthControls() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const signOut = async () => {
    setPending(true);
    setError("");
    try {
      await auth.signOut();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  if (auth.loading) {
    return (
      <span className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking auth
      </span>
    );
  }

  if (auth.user) {
    return (
      <div className="relative">
        <button
          onClick={signOut}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[var(--color-mist)] disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5" />
          )}
          Sign out
        </button>
        {error && (
          <span className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-destructive/30 bg-background p-2 text-xs text-destructive shadow-sm">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => void navigate({ to: "/auth" })}
      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-ink)] px-2.5 py-1.5 text-xs text-[var(--color-mist)] hover:opacity-90"
    >
      <LogIn className="h-3.5 w-3.5" />
      Sign in
    </button>
  );
}

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-background/75 border-b hairline">
      <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo />
          <span className="font-display font-semibold tracking-tight text-lg">
            IV Doc
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <AuthControls />
          <ProfileDropdown />
        </div>
      </div>
    </header>
  );
}
