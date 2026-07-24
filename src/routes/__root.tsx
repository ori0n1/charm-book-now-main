import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useEffect } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { Toaster } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { APP_BRAND } from "@/lib/app-brand";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
import appCss from "../styles.css?url";

const SERVICE_WORKER_VERSION = "20260724-visual-update";
const META_PIXEL_ID = "2079568283438502";

const LazyCookieBanner = lazy(() =>
  import("@/components/cookie-banner").then((mod) => ({ default: mod.CookieBanner })),
);

type MetaPixelQueue = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
};

function scheduleIdleTask(task: () => void, timeout = 1800) {
  if (typeof window === "undefined") return () => undefined;
  const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void });
  if (idle.requestIdleCallback) {
    const id = idle.requestIdleCallback(task, { timeout });
    return () => idle.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, timeout);
  return () => window.clearTimeout(id);
}

function loadMetaPixel() {
  const win = window as Window & {
    _fbq?: unknown;
    fbq?: MetaPixelQueue;
  };
  if (win.fbq) return;

  const fbq: MetaPixelQueue = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue?.push(args);
  };
  fbq.queue = [] as unknown[];
  fbq.loaded = true;
  fbq.version = "2.0";
  win.fbq = fbq;
  win._fbq = fbq;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  const firstScript = document.getElementsByTagName("script")[0];
  firstScript?.parentNode?.insertBefore(script, firstScript);

  win.fbq("init", META_PIXEL_ID);
  win.fbq("track", "PageView");
}

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

  useEffect(() => scheduleIdleTask(loadMetaPixel, 1800), []);

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
    let active = true;
    let cleanup: (() => void) | undefined;

    void import("@/integrations/supabase/client").then(({ supabase }) => {
      if (!active) return;
      const refreshSession = () => {
        if (document.visibilityState === "hidden") return;
        void supabase.auth.getSession();
      };

      refreshSession();
      window.addEventListener("focus", refreshSession);
      document.addEventListener("visibilitychange", refreshSession);
      cleanup = () => {
        window.removeEventListener("focus", refreshSession);
        document.removeEventListener("visibilitychange", refreshSession);
      };
    });

    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    let lastUserId: string | null | undefined;
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void import("@/integrations/supabase/client").then(({ supabase }) => {
      if (!active) return;
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_IN" && event !== "SIGNED_OUT") return;
        const uid = session?.user?.id ?? null;
        if (uid === lastUserId) return;
        lastUserId = uid;

        void queryClient.invalidateQueries();
      });
      unsubscribe = () => subscription.unsubscribe();
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
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
        <Suspense fallback={null}>
          <LazyCookieBanner />
        </Suspense>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
