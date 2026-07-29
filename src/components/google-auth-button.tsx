import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { recordAuthDebugEvent, supabase } from "@/integrations/supabase/client";
import { resolveAuthLanding } from "@/lib/auth-landing";
import { syncCurrentSessionAccountType } from "@/lib/auth-context";
import {
  createGoogleNoncePair,
  getGoogleIdentity,
  isIOSStandalonePwa,
  loadGoogleIdentityScript,
} from "@/lib/google-id-token";
import { cn } from "@/lib/utils";

type GoogleAuthButtonProps = {
  mode: "login" | "signup";
  className?: string;
};

export function GoogleAuthButton({ mode, className }: GoogleAuthButtonProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const fallbackTimerRef = useRef<number | null>(null);
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!googleClientId || typeof window === "undefined") return;
    if (isIOSStandalonePwa()) return;
    const clientId = googleClientId;
    let cancelled = false;

    async function initGoogleIdentity() {
      const { rawNonce, hashedNonce } = await createGoogleNoncePair();
      if (cancelled) return;

      const scriptEl = loadGoogleIdentityScript();

      const setup = () => {
        if (cancelled) return;
        const gsi = getGoogleIdentity();
        if (!gsi) {
          window.setTimeout(setup, 200);
          return;
        }

        gsi.initialize({
          client_id: clientId,
          nonce: hashedNonce,
          use_fedcm_for_prompt: true,
          callback: async (response: { credential: string }) => {
            if (fallbackTimerRef.current) {
              window.clearTimeout(fallbackTimerRef.current);
              fallbackTimerRef.current = null;
            }
            setLoading(true);
            const { data, error } = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: response.credential,
              nonce: rawNonce,
            });
            if (error || !data.user?.id) {
              setLoading(false);
              toast.error(error?.message || "Não foi possível continuar com Google.");
              return;
            }
            const landing = await resolveAuthLanding(data.user.id);
            if (landing !== "/onboarding") {
              await syncCurrentSessionAccountType("studio");
            }
            navigate({ to: landing as never, replace: true });
          },
        });

        gsi.prompt();
      };

      if (getGoogleIdentity()) setup();
      else scriptEl.addEventListener("load", setup, { once: true });
    }

    void initGoogleIdentity();
    return () => {
      cancelled = true;
      if (fallbackTimerRef.current) window.clearTimeout(fallbackTimerRef.current);
      try {
        getGoogleIdentity()?.cancel();
      } catch {
        /* noop */
      }
    };
  }, [googleClientId, navigate]);

  async function continueWithGoogle() {
    if (loading) return;
    setLoading(true);

    if (isIOSStandalonePwa()) {
      await continueWithGoogleRedirect();
      return;
    }

    if (googleClientId) {
      const gsi = getGoogleIdentity();
      if (gsi) {
        let fallbackStarted = false;
        gsi.prompt((notification) => {
          const unavailable =
            notification.isNotDisplayed?.() ||
            notification.isSkippedMoment?.() ||
            notification.isDismissedMoment?.();
          if (unavailable && !fallbackStarted) {
            fallbackStarted = true;
            if (fallbackTimerRef.current) {
              window.clearTimeout(fallbackTimerRef.current);
              fallbackTimerRef.current = null;
            }
            void continueWithGoogleRedirect();
          }
        });
        fallbackTimerRef.current = window.setTimeout(() => {
          fallbackTimerRef.current = null;
          setLoading(false);
        }, 5000);
        return;
      }
    }

    await continueWithGoogleRedirect();
  }

  async function continueWithGoogleRedirect() {
    const redirectTo = `${window.location.origin}/auth/callback`;
    recordAuthDebugEvent({ kind: "google_oauth_start", url: redirectTo });

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
          scope: "openid email profile https://www.googleapis.com/auth/user.birthday.read",
        },
      },
    });

    if (error) {
      recordAuthDebugEvent({ kind: "google_oauth_error", message: error.message });
      setLoading(false);
      toast.error(error.message || "Não foi possível continuar com Google.");
    }
  }

  return (
    <button
      type="button"
      onClick={continueWithGoogle}
      disabled={loading}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-border/80 bg-background px-4 text-sm font-medium transition",
        "hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        "disabled:pointer-events-none disabled:opacity-60",
        className,
      )}
    >
      <GoogleIcon className="size-[18px] shrink-0" />
      <span>{loading ? "A abrir Google..." : "Continuar com Google"}</span>
      <span className="sr-only">
        {mode === "signup" ? "Criar conta com Google" : "Entrar com Google"}
      </span>
    </button>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
