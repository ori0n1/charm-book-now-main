import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AUTH_DEBUG_STORAGE_KEY, supabase, supabasePublicConfig } from "@/integrations/supabase/client";

// Esta página só existe em desenvolvimento.
// Em produção é redirecionada para a raiz para não expor informação de ambiente.
export const Route = createFileRoute("/auth/debug")({
  head: () => ({
    meta: [
      { title: "Diagnóstico de autenticação - Bellza" },
      { name: "robots", content: "noindex,nofollow,noarchive" },
    ],
  }),
  beforeLoad() {
    if (import.meta.env.PROD) throw redirect({ to: "/" });
  },
  component: AuthDebugPage,
});

type DebugState = {
  href: string;
  path: string;
  hasCode: boolean;
  hasHash: boolean;
  hashKeys: string[];
  settingsStatus: string;
  sessionStatus: string;
  userId: string | null;
  redirectTo: string;
  oauthUrlStatus: string;
  oauthUrlHost: string | null;
  events: unknown[];
};

function AuthDebugPage() {
  const [state, setState] = useState<DebugState | null>(null);

  useEffect(() => {
    async function load() {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const redirectTo = `${window.location.origin}/auth/callback`;

      let settingsStatus = "pending";
      try {
        const response = await fetch(`${supabasePublicConfig.url}/auth/v1/settings`, {
          headers: { apikey: supabasePublicConfig.publishableKey },
        });
        settingsStatus = `${response.status} ${response.statusText}`;
      } catch (error) {
        settingsStatus = error instanceof Error ? error.message : "settings_failed";
      }

      let sessionStatus = "pending";
      let userId: string | null = null;
      try {
        const { data, error } = await supabase.auth.getSession();
        sessionStatus = error ? error.message : data.session ? "session_present" : "no_session";
        userId = data.session?.user?.id ?? null;
      } catch (error) {
        sessionStatus = error instanceof Error ? error.message : "session_failed";
      }

      let oauthUrlStatus = "pending";
      let oauthUrlHost: string | null = null;
      try {
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo,
            skipBrowserRedirect: true,
            queryParams: {
              access_type: "offline",
              prompt: "select_account",
            },
          },
        });
        oauthUrlStatus = error ? error.message : data.url ? "url_created" : "no_url";
        oauthUrlHost = data.url ? new URL(data.url).host : null;
      } catch (error) {
        oauthUrlStatus = error instanceof Error ? error.message : "oauth_url_failed";
      }

      setState({
        href: window.location.href,
        path: window.location.pathname,
        hasCode: url.searchParams.has("code"),
        hasHash: window.location.hash.length > 0,
        hashKeys: [...hash.keys()],
        settingsStatus,
        sessionStatus,
        userId,
        redirectTo,
        oauthUrlStatus,
        oauthUrlHost,
        events: readEvents(),
      });
    }

    void load();
  }, []);

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold">Auth debug</h1>
        <pre className="mt-6 overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-xs">
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    </main>
  );
}

function readEvents() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_DEBUG_STORAGE_KEY) ?? "[]") as unknown[];
  } catch {
    return [];
  }
}
