import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { APP_BRAND, CANONICAL_ORIGIN } from "@/lib/app-brand";

const BookingExperience = lazy(() =>
  import("@/components/booking-experience").then((mod) => ({ default: mod.BookingExperience })),
);

function studioNameFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export const Route = createFileRoute("/s/$slug")({
  head: ({ params }) => {
    const studioLabel = studioNameFromSlug(params.slug);
    const canonical = `${CANONICAL_ORIGIN}/s/${params.slug}`;
    const title = `${studioLabel || "Estúdio"} | Marcação online na ${APP_BRAND.name}`;
    const description =
      `Marque online em ${studioLabel || "um estúdio Bellza"}: escolha serviço, profissional e horário disponível com a experiência premium da ${APP_BRAND.name}.`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { name: "robots", content: "index,follow,max-image-preview:large" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: APP_BRAND.name },
        { property: "og:url", content: canonical },
        { property: "og:image", content: `${CANONICAL_ORIGIN}/bellza-logo.png` },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: `${CANONICAL_ORIGIN}/bellza-logo.png` },
        // PWA meta for iOS add-to-home-screen
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      ],
      links: [
        { rel: "canonical", href: canonical },
        // Studio-specific PWA manifest: ensures Chrome/Safari capture the studio's
        // name, icon and start_url BEFORE the beforeinstallprompt event fires.
        { rel: "manifest", href: `/api/public/studio-manifest/${params.slug}` },
      ],
    };
  },
  component: PublicStudioPage,
});

function PublicStudioPage() {
  const { slug } = Route.useParams();
  const [studioId, setStudioId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("studios")
          .select("id")
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();
        if (!active) return;
        if (error) {
          setStudioId(null);
          return;
        }
        setStudioId(data?.id ?? null);
      } catch {
        if (active) setStudioId(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  if (studioId === undefined) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        A carregar estúdio...
      </div>
    );
  }
  if (studioId === null) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">404</p>
          <h1 className="mt-2 text-2xl font-light">Estúdio não encontrado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            O link <span className="font-mono">/s/{slug}</span> não corresponde a nenhum estúdio
            ativo.
          </p>
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={<LoadingStudio />}>
      <BookingExperience studioId={studioId} />
    </Suspense>
  );
}

function LoadingStudio() {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      A carregar estúdio...
    </div>
  );
}
