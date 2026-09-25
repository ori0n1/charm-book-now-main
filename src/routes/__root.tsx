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

import { BellzaLogo } from "@/components/bellza-logo";
import { ThemeProvider } from "@/components/theme-provider";
import { APP_BRAND } from "@/lib/app-brand";
import {
  BELLZA_APP_ICON_512,
  BELLZA_APPLE_TOUCH_ICON,
  BELLZA_FAVICON,
} from "@/lib/brand-assets";
import { CRITICAL_PAINT_CSS, PWA_STARTUP_SCRIPT } from "@/lib/pwa-startup";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
import appCss from "../styles.css?url";

const SERVICE_WORKER_VERSION = "20260911-push-pwa-v2";
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
    <div className="public-shell public-site-theme public-landing-theme flex min-h-screen items-center justify-center bg-background px-4">
      <div className="public-card w-full max-w-md p-7 text-center sm:p-9">
        <BellzaLogo variant="icon" tone="light" className="mx-auto size-12" href={null} />
        <p className="public-section-label mt-7">Erro 404</p>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A página que procura não existe ou foi movida.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="public-btn-primary"
          >
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ reset }: { error: Error; reset: () => void }) {
  // Don't expose error details in production
  const router = useRouter();

  return (
    <div className="public-shell public-site-theme public-landing-theme flex min-h-screen items-center justify-center bg-background px-4">
      <div className="public-card w-full max-w-md p-7 text-center sm:p-9">
        <BellzaLogo variant="icon" tone="light" className="mx-auto size-12" href={null} />
        <h1 className="mt-7 text-xl font-semibold tracking-tight text-foreground">
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
            className="public-btn-primary"
          >
            Tentar novamente
          </button>
          <a
            href="/"
            className="public-btn-secondary"
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
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
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
      { property: "og:image", content: BELLZA_APP_ICON_512 },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: APP_BRAND.name },
      { name: "twitter:description", content: APP_BRAND.description },
      { name: "twitter:image", content: BELLZA_APP_ICON_512 },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // NOTE: manifest is injected per-route so studio pages get a studio-specific
      // manifest (name, icon, start_url) while admin/landing get the Bellza one.
      { rel: "icon", href: BELLZA_FAVICON, type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: BELLZA_APPLE_TOUCH_ICON, sizes: "180x180" },
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
        <style dangerouslySetInnerHTML={{ __html: CRITICAL_PAINT_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: PWA_STARTUP_SCRIPT }} />
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
    let retryTimer: number | undefined;

    const start = () => {
      if (hasAuthCredentialInUrl()) {
        retryTimer = window.setTimeout(start, 50);
        return;
      }
      void import("@/integrations/supabase/client").then(async ({ ensureBrowserAuthReady, supabase }) => {
        await ensureBrowserAuthReady();
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
    };
    start();

    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    let lastUserId: string | null | undefined;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: number | undefined;

    const start = () => {
      if (hasAuthCredentialInUrl()) {
        retryTimer = window.setTimeout(start, 50);
        return;
      }
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
    };
    start();

    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
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

function hasAuthCredentialInUrl() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.has("code")) return true;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  return hash.has("access_token") || hash.has("refresh_token");
}
