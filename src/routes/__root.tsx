import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { Toaster } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { CookieBanner } from "@/components/cookie-banner";
import { ThemeProvider } from "@/components/theme-provider";
import { APP_BRAND } from "@/lib/app-brand";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
import appCss from "../styles.css?url";

const SERVICE_WORKER_VERSION = "20260707-pwa-safe-update";
const META_PIXEL_ID = "2079568283438502";
const META_PIXEL_SCRIPT = `
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');
`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  // Don't expose error details in production
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ocorreu um erro. Pode tentar novamente ou voltar ao início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      },
      { title: `${APP_BRAND.name} | ${APP_BRAND.tagline}` },
      { name: "description", content: APP_BRAND.description },
      { name: "theme-color", content: "#f7f3ed" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: APP_BRAND.shortName },
      { name: "application-name", content: APP_BRAND.shortName },
      { name: "format-detection", content: "telephone=no" },
      { property: "og:title", content: APP_BRAND.name },
      { property: "og:description", content: APP_BRAND.description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: APP_BRAND.name },
      { property: "og:image", content: "/bellza-logo.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: APP_BRAND.name },
      { name: "twitter:description", content: APP_BRAND.description },
      { name: "twitter:image", content: "/bellza-logo.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // NOTE: manifest is injected per-route so studio pages get a studio-specific
      // manifest (name, icon, start_url) while admin/landing get the Bellza one.
      { rel: "icon", href: "/bellza-logo.png", type: "image/png" },
      { rel: "apple-touch-icon", href: "/bellza-logo.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: META_PIXEL_SCRIPT }} />
      </head>
      <body>
        <noscript>
          <img
            alt=""
            height="1"
            width="1"
            style={{ display: "none" }}
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
          />
        </noscript>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      let updateTimer: number | undefined;
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          if (registration.waiting) console.info("[pwa] update waiting for next safe launch", { version: SERVICE_WORKER_VERSION });
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state !== "installed" || !navigator.serviceWorker.controller) return;
              console.info("[pwa] update installed in background", { version: SERVICE_WORKER_VERSION });
            });
          });
          const update = () => void registration.update().catch(() => undefined);
          update();
          updateTimer = window.setInterval(update, 6 * 60 * 60 * 1000);
        })
        .catch(() => undefined);
      return () => {
        if (updateTimer) window.clearInterval(updateTimer);
      };
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const refreshSession = () => {
      if (document.visibilityState === "hidden") return;
      void supabase.auth.getSession();
    };

    refreshSession();
    window.addEventListener("focus", refreshSession);
    document.addEventListener("visibilitychange", refreshSession);
    return () => {
      window.removeEventListener("focus", refreshSession);
      document.removeEventListener("visibilitychange", refreshSession);
    };
  }, []);

  useEffect(() => {
    let lastUserId: string | null | undefined;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
      const uid = session?.user?.id ?? null;
      if (uid === lastUserId) return;
      lastUserId = uid;

      void queryClient.invalidateQueries();
    });
    return () => subscription.unsubscribe();
  }, [queryClient, router]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster
          richColors
          position="top-center"
          offset={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
          mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
          toastOptions={{
            classNames: {
              toast: "bellza-toast-safe-area",
            },
          }}
        />
        <CookieBanner />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
