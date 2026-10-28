import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { BrandLoadingState } from "@/components/brand-loading-state";
import { APP_BRAND, CANONICAL_ORIGIN } from "@/lib/app-brand";
import { BELLZA_APP_ICON_512 } from "@/lib/brand-assets";
import { serializeJsonForHtmlScript } from "@/lib/output-safety";
import { getPublicStudioSeo } from "@/lib/public-studio.functions";

const BookingExperience = lazy(() =>
  import("@/components/booking-experience").then((mod) => ({ default: mod.BookingExperience })),
);

function studioDescription(
  name: string,
  description: string | null,
  tagline: string | null,
  bookingFlowMode: "online" | "request",
) {
  const custom = description?.trim() || tagline?.trim();
  if (custom) return custom.slice(0, 160);
  if (bookingFlowMode === "request") {
    return `Solicite um agendamento em ${name}: indique serviço, data e horário pretendidos e confirme a disponibilidade diretamente com o estúdio.`;
  }
  return `Marque online em ${name}: escolha serviço, profissional e horário disponível com a experiência premium da ${APP_BRAND.name}.`;
}

export const Route = createFileRoute("/s/$slug")({
  loader: async ({ params }) => {
    const studio = await getPublicStudioSeo({ data: { slug: params.slug } });
    if (!studio) throw notFound();
    return studio;
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: `Estúdio | ${APP_BRAND.name}` },
          { name: "robots", content: "noindex,follow" },
        ],
      };
    }
    const studio = loaderData;
    const canonical = `${CANONICAL_ORIGIN}/s/${params.slug}`;
    const title = `${studio.name} | ${studio.bookingFlowMode === "request" ? "Solicitar agendamento" : "Marcação online"} na ${APP_BRAND.name}`;
    const description = studioDescription(studio.name, studio.description, studio.tagline, studio.bookingFlowMode);
    const socialImage = studio.logoUrl || `${CANONICAL_ORIGIN}${BELLZA_APP_ICON_512}`;

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
        { property: "og:image", content: socialImage },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: socialImage },
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
  const studio = Route.useLoaderData();
  const description = studioDescription(studio.name, studio.description, studio.tagline, studio.bookingFlowMode);
  const schema = {
    "@context": "https://schema.org",
    "@type": "BeautySalon",
    name: studio.name,
    description,
    url: `${CANONICAL_ORIGIN}/s/${studio.slug}`,
    ...(studio.logoUrl ? { image: studio.logoUrl } : {}),
    ...(studio.location ? { address: studio.location } : {}),
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonForHtmlScript(schema) }}
      />
      <header className="sr-only">
        <h1>{studio.name} — {studio.bookingFlowMode === "request" ? "solicitação de agendamento" : "marcação online"}</h1>
        <p>{description}</p>
        {studio.location && <p>{studio.location}</p>}
      </header>
      <Suspense fallback={<LoadingStudio />}>
        <BookingExperience studioId={studio.id} />
      </Suspense>
    </main>
  );
}

function LoadingStudio() {
  return (
    <div className="public-shell public-site-theme public-landing-theme min-h-screen bg-background">
      <BrandLoadingState label="A carregar estúdio..." tone="light" fullScreen />
    </div>
  );
}
