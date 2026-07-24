import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Award,
  Check,
  Clock3,
  Copy,
  Gift,
  Link2,
  Share2,
  Users,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { getMyReferralInfo, type ReferralInfo, type ReferralStatus } from "@/lib/referrals.functions";
import { cn } from "@/lib/utils";
import { ExpandableList } from "@/components/ui/expandable-list";

export const Route = createFileRoute("/_authenticated/admin/indicacoes")({
  head: () => ({ meta: [{ title: "Indicações - Painel Bellza" }] }),
  component: IndicacoesPage,
});

function IndicacoesPage() {
  const { studio } = useCurrentStudio();
  const loadInfo = useServerFn(getMyReferralInfo);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["referral-info", studio?.id],
    enabled: !!studio?.id,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => (await loadInfo({ data: { studioId: studio!.id } })) as ReferralInfo,
  });

  if (!studio?.id || isLoading) {
    return (
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-3 py-2 md:gap-4 md:py-5">
        <div className="h-48 animate-pulse rounded-3xl bg-muted/40" />
        <div className="h-32 animate-pulse rounded-3xl bg-muted/40" />
      </div>
    );
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    return (
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-3 py-2 md:gap-4 md:py-5">
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-red-200/60 bg-red-50/60 px-6 py-12 text-center dark:border-red-900/30 dark:bg-red-900/10">
          <span className="grid size-12 place-items-center rounded-2xl bg-red-100 text-red-500 dark:bg-red-900/30">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-red-700 dark:text-red-400">Erro ao carregar indicações</p>
            <p className="mt-1 text-xs text-red-600/70 dark:text-red-500/70">{msg}</p>
          </div>
          <p className="max-w-sm text-xs text-muted-foreground">
            Se acabou de activar esta funcionalidade, certifique-se de que executou a migração SQL no Supabase.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-3 py-2 md:gap-4 md:py-5">
      <HeroSection data={data} />
      <StatsGrid data={data} />
      <div className="grid items-start gap-3 md:gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <HowItWorks />
        <HistorySection data={data} />
      </div>
    </div>
  );
}

// ── Hero section ──────────────────────────────────────────────────────────────

function HeroSection({ data }: { data: ReferralInfo }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.referralUrl);
      setCopied(true);
      toast.success("Link copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Bellza — Gestão para estúdios",
          text: "Experimenta a Bellza gratuitamente. Usa o meu link para criar a tua conta.",
          url: data.referralUrl,
        });
      } catch {
        // user cancelled
      }
    } else {
      await copy();
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="bg-gradient-to-br from-emerald-500/8 via-transparent to-transparent px-5 py-6 md:px-8 md:py-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="grid size-9 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <Gift className="h-4.5 w-4.5" />
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
            Indique e Ganhe
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-light tracking-tight md:text-3xl">
          Convide outros estúdios.<br />
          <span className="font-medium text-emerald-700 dark:text-emerald-400">Ganhe meses Bellza grátis.</span>
        </h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
          Partilhe o seu link único. Cada estúdio que criar conta e mantiver a assinatura ativa
          durante 30 dias gera <strong className="text-foreground">+8,99 € de crédito Bellza</strong> para si —
          aplicado automaticamente na próxima renovação.
        </p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-h-11 flex-1 items-center gap-2 overflow-hidden rounded-2xl border border-border bg-background px-4 py-2.5">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {data.referralUrl}
            </span>
          </div>
          <button
            type="button"
            onClick={copy}
            className={cn(
              "flex h-11 items-center gap-2 rounded-2xl px-5 text-xs font-bold uppercase tracking-wide transition",
              copied
                ? "bg-emerald-600 text-white"
                : "bg-foreground text-background hover:opacity-90"
            )}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar link"}
          </button>
          <button
            type="button"
            onClick={share}
            className="flex h-11 items-center gap-2 rounded-2xl border border-border bg-background px-5 text-xs font-bold uppercase tracking-wide text-muted-foreground transition hover:text-foreground sm:hidden"
          >
            <Share2 className="h-4 w-4" />
            Partilhar
          </button>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground/70">
          Código único: <span className="font-mono font-semibold">{data.referralCode}</span>
        </p>
      </div>
    </section>
  );
}

// ── Stats grid ────────────────────────────────────────────────────────────────

function StatsGrid({ data }: { data: ReferralInfo }) {
  const creditEuros = (data.creditsAvailableCents / 100).toFixed(2).replace(".", ",");
  const creditsLeft = data.creditsLimit - data.creditsApplied - data.creditsAvailable;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard icon={Users} label="Convidados" value={String(data.totalInvited)} color="blue" />
      <StatCard icon={Clock3} label="Em validação" value={String(data.totalPending)} color="amber" />
      <StatCard icon={Award} label="Aprovadas" value={String(data.totalApproved)} color="emerald" />
      <StatCard
        icon={Gift}
        label="Crédito disponível"
        value={data.creditsAvailable > 0 ? `${creditEuros} €` : "0,00 €"}
        color={data.creditsAvailable > 0 ? "emerald" : "muted"}
        note={`Máx. ${data.creditsLimit} créditos${creditsLeft > 0 ? ` · restam ${creditsLeft}` : " (limite atingido)"}`}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  note,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  color: "blue" | "amber" | "emerald" | "muted";
  note?: string;
}) {
  const colors = {
    blue: "bg-blue-500/8 text-blue-600 dark:text-blue-400",
    amber: "bg-amber-500/8 text-amber-600 dark:text-amber-400",
    emerald: "bg-emerald-500/8 text-emerald-600 dark:text-emerald-400",
    muted: "bg-muted/40 text-muted-foreground",
  };
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl", colors[color])}>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-2xl font-light tracking-tight">{value}</p>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        {note && <p className="mt-1 text-[10px] text-muted-foreground/60">{note}</p>}
      </div>
    </div>
  );
}

// ── How it works ──────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      n: 1,
      title: "Partilhe o seu link",
      body: "Envie o link único pelo WhatsApp, email ou redes sociais. Funciona para qualquer tipo de estúdio.",
    },
    {
      n: 2,
      title: "O estúdio cria conta e assina",
      body: "O novo estúdio regista-se gratuitamente e escolhe um plano pago. A indicação fica em validação.",
    },
    {
      n: 3,
      title: "Ganhe crédito automático",
      body: "Após 30 dias de assinatura ativa, ganha 8,99 € de crédito aplicado automaticamente na sua próxima renovação.",
    },
  ];

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="border-b border-border/70 px-5 py-4 md:px-6">
        <h2 className="text-sm font-medium tracking-tight">Como funciona</h2>
      </div>
      <div className="divide-y divide-border/50">
        {steps.map((s) => (
          <div key={s.n} className="flex items-start gap-4 px-5 py-4 md:px-6">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-border bg-muted/40 text-xs font-bold text-muted-foreground">
              {s.n}
            </span>
            <div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-border/60 bg-muted/20 px-5 py-3 md:px-6">
        <p className="text-[11px] text-muted-foreground/80">
          O crédito é interno Bellza e aplica-se automaticamente na renovação. Não é dinheiro, não é transferível e não pode ser levantado.
          Máximo de 6 créditos acumulados (fase inicial). Indicações com cancelamento nos primeiros 30 dias são canceladas.
        </p>
      </div>
    </section>
  );
}

// ── History section ───────────────────────────────────────────────────────────

function HistorySection({ data }: { data: ReferralInfo }) {
  if (!data.history.length) {
    return (
      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="border-b border-border/70 px-5 py-4 md:px-6">
          <h2 className="text-sm font-medium tracking-tight">Histórico de indicações</h2>
        </div>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-muted/40 text-muted-foreground/40">
            <Users className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-muted-foreground">Ainda sem indicações</p>
          <p className="max-w-[22ch] text-xs text-muted-foreground/70">
            Partilhe o seu link e as indicações aparecerão aqui.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="border-b border-border/70 px-5 py-4 md:px-6">
        <h2 className="text-sm font-medium tracking-tight">Histórico de indicações</h2>
      </div>
      <ExpandableList
        items={data.history}
        initialCount={5}
        className="divide-y divide-border/50"
        getKey={(referral) => referral.id}
        moreLabel={(hidden) => `Ver mais ${hidden} indicação${hidden !== 1 ? "ões" : ""}`}
        renderItem={(referral) => <ReferralRow referral={referral} />}
      />
    </section>
  );
}

function ReferralRow({ referral }: { referral: ReferralInfo["history"][number] }) {
  const statusMap: Record<ReferralStatus, { label: string; icon: typeof Check; cls: string }> = {
    pending_validation: {
      label: "Em validação",
      icon: Clock3,
      cls: "text-amber-600 bg-amber-500/10 dark:text-amber-400",
    },
    approved: {
      label: "Aprovada",
      icon: Check,
      cls: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
    },
    rejected: {
      label: "Cancelada",
      icon: XCircle,
      cls: "text-red-600 bg-red-500/10 dark:text-red-400",
    },
  };

  const s = statusMap[referral.status];
  const StatusIcon = s.icon;

  const dateStr = new Date(referral.createdAt).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-4 md:px-6">
      <div className="flex items-center gap-3">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-xl text-xs", s.cls)}>
          <StatusIcon className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-sm font-medium">{s.label}</p>
          <p className="text-[11px] text-muted-foreground">{dateStr}</p>
        </div>
      </div>
      {referral.status === "approved" && (
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          +8,99 € crédito
        </span>
      )}
      {referral.status === "pending_validation" && (
        <span className="text-[11px] text-muted-foreground/70">aguarda 30 dias</span>
      )}
    </div>
  );
}
