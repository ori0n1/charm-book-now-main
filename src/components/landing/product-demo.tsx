import { CalendarCheck } from "lucide-react";
import { SnapCarousel } from "@/components/snap-carousel";

const PRODUCT_IMAGE_BASE = "/landing/product-2026";

const productScreens = {
  overview: {
    src: `${PRODUCT_IMAGE_BASE}/overview-960.webp`,
    responsiveSrc: `${PRODUCT_IMAGE_BASE}/overview-480.webp`,
    alt: "Painel real da conta de demonstração Bellza com resumo da agenda e do espaço",
    badge: "Painel Bellza · Visão geral",
  },
  agenda: {
    src: `${PRODUCT_IMAGE_BASE}/agenda-960.webp`,
    responsiveSrc: `${PRODUCT_IMAGE_BASE}/agenda-480.webp`,
    alt: "Agenda real da conta de demonstração Bellza com equipa, semana e marcações pendentes",
    badge: "Painel Bellza · Agenda",
  },
} as const;

type ProductDemoVariant = keyof typeof productScreens;

const PRODUCT_STORIES = [
  {
    id: "agenda",
    title: "O dia todo sob controlo",
    description: "Equipa, disponibilidade e marcações pendentes numa visão única.",
    image: `${PRODUCT_IMAGE_BASE}/agenda-960.webp`,
    mobileImage: `${PRODUCT_IMAGE_BASE}/agenda-480.webp`,
    width: 960,
    height: 738,
    alt: "Agenda real da conta demo Bellza, preenchida apenas com conteúdo fictício",
  },
  {
    id: "clients",
    title: "Cada cliente com contexto",
    description: "Histórico, serviços e valor sem voltar a procurar em conversas.",
    image: `${PRODUCT_IMAGE_BASE}/clients-960.webp`,
    mobileImage: `${PRODUCT_IMAGE_BASE}/clients-480.webp`,
    width: 960,
    height: 566,
    alt: "Área real de clientes da conta demo Bellza, preenchida apenas com conteúdo fictício",
  },
  {
    id: "finance",
    title: "Receba e acompanhe",
    description: "Pagamentos, taxas e valor líquido apresentados com clareza.",
    image: `${PRODUCT_IMAGE_BASE}/finance-960.webp`,
    mobileImage: `${PRODUCT_IMAGE_BASE}/finance-480.webp`,
    width: 960,
    height: 738,
    alt: "Área financeira real da conta demo Bellza, preenchida apenas com conteúdo fictício",
  },
  {
    id: "notifications",
    title: "Comunique sem ruído",
    description: "Avisos e modelos de mensagem reunidos no mesmo painel.",
    image: `${PRODUCT_IMAGE_BASE}/notifications-960.webp`,
    mobileImage: `${PRODUCT_IMAGE_BASE}/notifications-480.webp`,
    width: 960,
    height: 738,
    alt: "Área real de comunicação da conta demo Bellza, preenchida apenas com conteúdo fictício",
  },
  {
    id: "team",
    title: "A equipa sempre alinhada",
    description: "Acessos, visibilidade e profissionais organizados num só lugar.",
    image: `${PRODUCT_IMAGE_BASE}/team-960.webp`,
    mobileImage: `${PRODUCT_IMAGE_BASE}/team-480.webp`,
    width: 960,
    height: 558,
    alt: "Área real de equipa da conta demo Bellza, preenchida apenas com conteúdo fictício",
  },
] as const;

export function ProductStoryCarousel() {
  return (
    <SnapCarousel
      labels={PRODUCT_STORIES.map((story) => story.title)}
      ariaLabel="Demonstrações reais do produto Bellza"
      variant="content"
      className="mt-7"
    >
      {PRODUCT_STORIES.map((story) => (
        <article key={story.id} data-product-story={story.id} className="public-product-story h-full">
          <div className="public-product-story-image">
            <img
              src={story.image}
              srcSet={`${story.mobileImage} 480w, ${story.image} 960w`}
              sizes="(max-width: 639px) 88vw, (max-width: 1023px) 52vw, 560px"
              alt={story.alt}
              width={story.width}
              height={story.height}
              className="h-full w-full rounded-xl object-contain object-top"
              loading="lazy"
              decoding="async"
            />
          </div>
          <div className="p-4 sm:p-5">
            <p className="text-sm font-semibold tracking-tight sm:text-base">{story.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {story.description}
            </p>
          </div>
        </article>
      ))}
    </SnapCarousel>
  );
}

export function ProductDemo({
  variant = "overview",
  loading = "lazy",
}: {
  variant?: ProductDemoVariant;
  loading?: "eager" | "lazy";
}) {
  const screen = productScreens[variant];

  return (
    <div
      className="public-product-demo public-product-demo-flat"
      aria-label="Demonstração real da Bellza com conteúdo fictício"
    >
      <div className="public-demo-desktop">
        <div className="public-demo-toolbar">
          <span className="size-2 rounded-full bg-[#dca0ad]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#dcc48d]" aria-hidden="true" />
          <span className="size-2 rounded-full bg-[#91b9a7]" aria-hidden="true" />
          <span className="public-demo-address">{screen.badge}</span>
        </div>

        <div className="public-demo-screenshot">
          <img
            src={screen.src}
            srcSet={`${screen.responsiveSrc} 480w, ${screen.src} 960w`}
            sizes="(max-width: 767px) 92vw, 720px"
            alt={screen.alt}
            width={960}
            height={738}
            className="h-full w-full object-contain object-top"
            loading={loading}
            decoding="async"
            fetchPriority={loading === "eager" ? "high" : "auto"}
          />
        </div>
      </div>

      <div className="public-demo-chip public-demo-chip-top">
        <CalendarCheck className="size-4 text-accent" aria-hidden="true" />
        <span>Agenda, clientes e pagamentos ligados</span>
      </div>
    </div>
  );
}
