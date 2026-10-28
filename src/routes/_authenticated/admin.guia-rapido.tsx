import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Clock,
  ExternalLink,
  ImageIcon,
  LayoutDashboard,
  Palette,
  Scissors,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/guia-rapido")({
  component: QuickGuidePage,
});

const PRINT_BASE = "/docs/guia-bellza/prints";

type GuideFrame = "standard" | "mobile" | "wide" | "ultrawide";

const guideSteps = [
  {
    title: "Como começar",
    eyebrow: "Primeiro acesso",
    description: "Confirme se o painel abre com o nome do estúdio, a agenda e os atalhos principais.",
    image: `${PRINT_BASE}/inicio-desktop.png`,
    mobileImage: `${PRINT_BASE}/inicio-mobile.png`,
    frame: "standard" as GuideFrame,
    icon: LayoutDashboard,
    href: "/admin",
    actions: ["Veja o resumo do dia.", "Use o menu lateral no computador.", "No telemóvel, use a barra inferior."],
  },
  {
    title: "Configurar o estúdio",
    eyebrow: "Marca",
    description: "Ajuste identidade, contactos e informação pública para deixar a página clara para as clientes.",
    image: `${PRINT_BASE}/marca-desktop.png`,
    frame: "standard" as GuideFrame,
    icon: Palette,
    href: "/admin/marca",
    actions: ["Revise nome, contactos e descrição.", "Adicione imagens reais do espaço.", "Confirme se o link público está correto."],
  },
  {
    title: "Criar serviços",
    eyebrow: "Serviços",
    description: "Cadastre os serviços que podem ser marcados online com duração e preço bem definidos.",
    image: `${PRINT_BASE}/servicos-desktop.png`,
    frame: "standard" as GuideFrame,
    icon: Scissors,
    href: "/admin/servicos",
    actions: ["Crie serviços por categoria.", "Defina preço e duração.", "Mantenha ativos apenas os serviços disponíveis."],
  },
  {
    title: "Cadastrar profissionais",
    eyebrow: "Equipa",
    description: "Adicione as profissionais e associe cada uma aos serviços que realiza no estúdio.",
    image: `${PRINT_BASE}/equipa-desktop.png`,
    frame: "ultrawide" as GuideFrame,
    icon: Users,
    href: "/admin/equipa",
    actions: ["Crie a ficha da profissional.", "Escolha os serviços realizados.", "Mantenha apenas profissionais ativas."],
  },
  {
    title: "Configurar horários",
    eyebrow: "Disponibilidade",
    description: "Defina dias de trabalho, folgas e bloqueios para evitar marcações fora da agenda.",
    image: `${PRINT_BASE}/horarios-desktop.png`,
    frame: "wide" as GuideFrame,
    icon: Clock,
    href: "/admin/horarios",
    actions: ["Escolha a profissional.", "Revise a semana de trabalho.", "Adicione bloqueios quando necessário."],
  },
  {
    title: "Ver marcações",
    eyebrow: "Agenda",
    description: "Acompanhe reservas do dia, próximas marcações, faltas e cancelamentos num só lugar.",
    image: `${PRINT_BASE}/agenda-desktop.png`,
    frame: "standard" as GuideFrame,
    icon: Calendar,
    href: "/admin/agenda",
    actions: ["Use os filtros da agenda.", "Abra uma marcação para ver detalhes.", "Atualize o estado quando necessário."],
  },
  {
    title: "Usar o balcão",
    eyebrow: "Atendimento rápido",
    description: "Registe atendimentos presenciais, encaixes e situações do dia a dia dentro do estúdio.",
    image: `${PRINT_BASE}/balcao-desktop.png`,
    frame: "wide" as GuideFrame,
    icon: CalendarPlus,
    href: "/admin/balcao",
    actions: ["Escolha cliente e serviço.", "Registe atendimentos presenciais.", "Use horários livres para encaixes."],
  },
  {
    title: "Acompanhar clientes",
    eyebrow: "Clientes",
    description: "Consulte clientes atendidas, contactos e histórico ligado às marcações do estúdio.",
    image: `${PRINT_BASE}/clientes-desktop.png`,
    frame: "ultrawide" as GuideFrame,
    icon: UserRound,
    href: "/admin/clientes",
    actions: ["Procure por nome ou telefone.", "Abra o detalhe da cliente.", "Mantenha os contactos atualizados."],
  },
  {
    title: "Testar como cliente",
    eyebrow: "Página pública",
    description: "Abra a página pública, faça uma marcação de teste e confirme se o caminho está simples.",
    image: `${PRINT_BASE}/publica-desktop.png`,
    frame: "standard" as GuideFrame,
    icon: ExternalLink,
    href: "/admin/marca",
    actions: ["Copie o link público.", "Escolha serviço, profissional e horário.", "Confirme se a experiência está clara."],
  },
];

const firstDayChecklist = [
  "Confirmar dados e contactos do estúdio.",
  "Criar os principais serviços com preços corretos.",
  "Adicionar profissionais e ligar serviços.",
  "Configurar horários, folgas e bloqueios.",
  "Fazer uma marcação de teste como cliente.",
  "Abrir a agenda e confirmar se a marcação apareceu.",
];

const flowGroups = [
  { title: "Preparar", range: "01-03", body: "Painel, marca e serviços prontos para receber marcações." },
  { title: "Organizar", range: "04-06", body: "Equipa, horários e agenda alinhados com a operação real." },
  { title: "Atender", range: "07-09", body: "Balcão, clientes e teste público fecham o primeiro ciclo." },
];

const frameClass: Record<GuideFrame, string> = {
  standard: "aspect-[3/2]",
  mobile: "aspect-[9/16] max-h-[34rem]",
  wide: "aspect-[2/1]",
  ultrawide: "aspect-[16/6]",
};

function QuickGuidePage() {
  const featuredStep = guideSteps[0];
  const setupSteps = guideSteps.slice(1, 5);
  const operationSteps = guideSteps.slice(5);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3 pb-3 md:space-y-5">
      <section className="overflow-hidden rounded-[1.15rem] border border-border bg-card shadow-sm md:rounded-[1.35rem]">
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.92fr)]">
          <div className="flex min-h-full flex-col justify-between gap-3 p-4 sm:p-5 lg:p-5 xl:p-6">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Bellza
              </p>
              <div className="mt-2 min-w-0">
                <div className="min-w-0">
                  <h1 className="max-w-[11ch] text-[2.35rem] font-light leading-[0.96] tracking-tight text-foreground sm:max-w-none sm:text-[2.75rem] lg:text-[2.6rem] xl:text-[2.95rem]">
                    Guia Rápido
                  </h1>
                  <p className="mt-2 max-w-[46rem] text-[0.93rem] leading-snug text-muted-foreground sm:text-[0.98rem] lg:max-w-[38rem] xl:max-w-[44rem]">
                    Prepare o painel, organize a agenda e valide a experiência da cliente em poucos passos.
                  </p>
                </div>
                <div className="mt-4 flex w-full min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event("bellza:start-admin-tour"))}
                    className="inline-flex h-10 max-w-full min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-background/75 px-3 text-sm font-semibold leading-none shadow-sm transition hover:-translate-y-0.5 hover:bg-muted"
                  >
                    <span className="whitespace-nowrap">Rever tutorial</span>
                    <Sparkles className="h-4 w-4 shrink-0" />
                  </button>
                  <Link
                    to="/admin/marca"
                    className="inline-flex h-10 max-w-full min-w-0 shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground px-3 text-sm font-semibold leading-none text-background shadow-sm transition hover:-translate-y-0.5 hover:opacity-95"
                  >
                    <span className="whitespace-nowrap">Começar</span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </Link>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {flowGroups.map((group) => (
                <GuideStat key={group.title} title={group.title} value={group.range} body={group.body} />
              ))}
            </div>
          </div>

          <div className="border-t border-border bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(16,185,129,0.11),rgba(14,165,233,0.08))] p-3 lg:border-l lg:border-t-0">
            <GuidePreview step={featuredStep} priority />
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className="rounded-[1.15rem] border border-border bg-card p-4 shadow-sm sm:p-5 md:rounded-[1.25rem]">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Primeiro dia
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight">Lista rápida</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                O essencial para deixar a Bellza pronta sem perder tempo.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {firstDayChecklist.map((item) => (
              <ChecklistItem key={item}>{item}</ChecklistItem>
            ))}
          </div>
        </section>

        <section className="rounded-[1.15rem] border border-border bg-card p-4 shadow-sm sm:p-5 md:rounded-[1.25rem]">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Regra de ouro
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">Teste depois de alterar</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Sempre que alterar serviços, profissionais ou horários, faça uma marcação de teste para confirmar a experiência da cliente.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {["Serviço ativo", "Horário livre", "Reserva visível"].map((item) => (
              <div key={item} className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2">
                <p className="text-sm font-semibold">{item}</p>
              </div>
            ))}
          </div>
        </section>
      </section>

      <GuideSection eyebrow="Configuração" title="Monte a base do estúdio" steps={setupSteps} startIndex={2} />
      <GuideSection eyebrow="Operação" title="Atenda, acompanhe e valide" steps={operationSteps} startIndex={6} />
    </div>
  );
}

function GuideStat({ title, value, body }: { title: string; value: string; body: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
        <p className="shrink-0 text-xs font-semibold text-foreground">{value}</p>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function GuideSection({
  eyebrow,
  title,
  steps,
  startIndex,
}: {
  eyebrow: string;
  title: string;
  steps: typeof guideSteps;
  startIndex: number;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
        </div>
      </div>
      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        {steps.map((step, index) => (
          <GuideStep key={step.title} step={step} index={startIndex + index} />
        ))}
      </div>
    </section>
  );
}

function GuideStep({
  step,
  index,
}: {
  step: (typeof guideSteps)[number];
  index: number;
}) {
  const Icon = step.icon;
  return (
    <article className="grid min-h-full overflow-hidden rounded-[1.15rem] border border-border bg-card shadow-sm md:rounded-[1.25rem]">
      <GuidePreview step={step} />
      <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground text-sm font-black text-background">
            {String(index).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-accent" />
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {step.eyebrow}
              </p>
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">{step.title}</h3>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>

        <div className="grid gap-2">
          {step.actions.map((action) => (
            <ChecklistItem key={action}>{action}</ChecklistItem>
          ))}
        </div>

        <Link
          to={step.href}
          className="mt-auto inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background/75 px-4 text-sm font-semibold transition hover:bg-muted sm:w-fit"
        >
          Abrir esta área
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </article>
  );
}

function GuidePreview({
  step,
  priority = false,
}: {
  step: (typeof guideSteps)[number];
  priority?: boolean;
}) {
  const frame = priority ? "standard" : step.frame;
  return (
    <div className="p-2.5 sm:p-3">
      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-inner shadow-black/5">
        <picture>
          {step.mobileImage && <source srcSet={step.mobileImage} media="(max-width: 640px)" />}
          <img
            src={step.image}
            alt={`Print do painel: ${step.title}`}
            className={`mx-auto h-full w-full bg-muted/20 object-contain ${step.mobileImage ? "max-sm:aspect-[9/16]" : ""} ${frameClass[frame]}`}
            loading={priority ? "eager" : "lazy"}
          />
        </picture>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">Print real do painel Bellza</span>
      </div>
    </div>
  );
}

function ChecklistItem({ children }: { children: string }) {
  return (
    <div className="flex min-w-0 gap-2 rounded-xl bg-muted/30 px-3 py-2 text-sm leading-snug text-muted-foreground">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
