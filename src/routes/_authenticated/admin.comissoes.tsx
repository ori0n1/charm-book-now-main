import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Scissors, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { computeFinancialSplit, formatEUR } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/comissoes")({
  head: () => ({ meta: [{ title: "Comissões - Painel" }] }),
  component: ComissoesPage,
});

type StudioRow = {
  id: string;
  payment_policy: "pay_in_studio" | "pre_payment";
  accepted_payment_methods: string[];
  deposit_percent: number;
  commission_percent: number;
};

type RuleOverride = {
  id: string;
  name: string;
  commission_percent: number | null;
};

function ComissoesPage() {
  const [studio, setStudio] = useState<StudioRow | null>(null);
  const [staff, setStaff] = useState<RuleOverride[]>([]);
  const [services, setServices] = useState<RuleOverride[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("studio_id").limit(1);
      const studioId = (roles?.[0] as { studio_id: string } | undefined)?.studio_id;
      if (!studioId) return;
      const result = await loadFinancialSettings(studioId);
      if (result.studio) {
        setStudio(result.studio);
      }
      setStaff(result.staff);
      setServices(result.services);
    })();
  }, []);

  const example = useMemo(() => {
    if (!studio) return null;
    return computeFinancialSplit(100, studio.commission_percent, {
      depositPercent: studio.deposit_percent,
      requiresDeposit: studio.payment_policy === "pre_payment",
    });
  }, [studio]);

  async function saveStudio(next: Partial<StudioRow>) {
    if (!studio) return;
    setSaving(true);
    const merged = { ...studio, ...next };
    const payload = {
      payment_policy: merged.payment_policy,
      accepted_payment_methods: merged.accepted_payment_methods,
      deposit_percent: merged.deposit_percent,
      commission_percent: merged.commission_percent,
    };
    const { error } = await supabase.from("studios").update(payload).eq("id", studio.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setStudio(merged);
    toast.success("Alterações guardadas");
  }

  async function saveOverride(
    kind: "staff" | "services",
    row: RuleOverride,
    next: Partial<RuleOverride>,
  ) {
    const merged = { ...row, ...next };
    const { error } = await supabase
      .from(kind)
      .update({ commission_percent: merged.commission_percent })
      .eq("id", row.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    if (kind === "staff") {
      setStaff((current) => current.map((item) => (item.id === row.id ? merged : item)));
    } else {
      setServices((current) => current.map((item) => (item.id === row.id ? merged : item)));
    }

    toast.success("Regra atualizada");
  }

  if (!studio || !example) {
    return <p className="text-sm text-muted-foreground">A carregar...</p>;
  }

  return (
    <div className="space-y-4 xl:mx-auto xl:max-w-[88rem]">
      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="border-b border-border/70 px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="grid size-8 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                  <Scissors className="h-4 w-4" />
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em]">Comissões</span>
              </div>
              <h1 className="mt-2 text-base font-medium tracking-tight md:text-lg">Divisão e regras de comissão</h1>
            </div>
            <span className="rounded-full border border-emerald-700/20 bg-emerald-950/5 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Premium
            </span>
          </div>
        </div>

        <div className="grid gap-6 p-4 md:p-5 xl:grid-cols-[minmax(0,1.15fr)_32rem] xl:items-start">
          <div className="rounded-3xl border border-border/70 bg-background/45 p-4">
            <div>
              <h2 className="text-base font-medium">Divisão entre estúdio e equipa</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                O sinal já faz parte do valor total do serviço. Primeiro calcula-se a parte do estúdio sobre o total, e o restante pertence à profissional.
              </p>
            </div>

            <div className="mt-4">
              <PercentSlider
                label="Percentagem do estúdio"
                value={studio.commission_percent}
                onChange={(value) => setStudio({ ...studio, commission_percent: value })}
                onCommit={(value) => saveStudio({ commission_percent: value })}
                disabled={saving}
              />
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-emerald-700/25 bg-emerald-950/5 p-4 text-xs">
              <p className="font-medium text-foreground">Exemplo num serviço de {formatEUR(100)}</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Line label="Valor total do serviço" value={formatEUR(example.total)} />
                <Line label="Sinal pago online" value={formatEUR(example.deposit)} />
                <Line label="A pagar no estúdio" value={formatEUR(example.remaining)} />
                <Line label="Parte do estúdio" value={formatEUR(example.studio)} strong />
                <Line label="Parte da profissional" value={formatEUR(example.professional)} strong />
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="rounded-3xl border border-border/70 bg-background/45 p-4">
              <OverrideSection
                title="Percentagem por profissional"
                icon={<UserRound className="h-4 w-4" />}
                rows={staff}
                kind="staff"
                studio={studio}
                onSave={saveOverride}
              />
            </div>
            <div className="rounded-3xl border border-border/70 bg-background/45 p-4">
              <OverrideSection
                title="Percentagem por serviço"
                icon={<Scissors className="h-4 w-4" />}
                rows={services}
                kind="services"
                studio={studio}
                onSave={saveOverride}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

async function loadFinancialSettings(studioId: string) {
  const [studioFull, staffFull, serviceFull] = await Promise.all([
    supabase
      .from("studios")
      .select("id,payment_policy,accepted_payment_methods,deposit_percent,commission_percent")
      .eq("id", studioId)
      .maybeSingle(),
    supabase
      .from("staff")
      .select("id,name,commission_percent")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("services")
      .select("id,name,commission_percent")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  return {
    studio: normalizeStudio(studioFull.data),
    staff: (staffFull.data ?? []) as RuleOverride[],
    services: (serviceFull.data ?? []) as RuleOverride[],
  };
}

function normalizeStudio(row: unknown): StudioRow | null {
  const studio = row as Partial<StudioRow> | null;
  if (!studio?.id) return null;
  return {
    id: studio.id,
    payment_policy: studio.payment_policy ?? "pay_in_studio",
    accepted_payment_methods: studio.accepted_payment_methods ?? ["mb_way", "multibanco"],
    deposit_percent: studio.deposit_percent ?? 25,
    commission_percent: studio.commission_percent ?? 50,
  };
}

function PercentSlider(props: {
  label: string;
  value: number;
  min?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-3 text-sm">
        <span>{props.label}</span>
        <span className="font-mono text-sm">{props.value}%</span>
      </span>
      <input
        type="range"
        min={props.min ?? 0}
        max={100}
        step={5}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        onMouseUp={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
        onTouchEnd={(e) => props.onCommit(Number((e.target as HTMLInputElement).value))}
        disabled={props.disabled}
        className="mt-3 w-full"
      />
    </label>
  );
}

function OverrideSection(props: {
  title: string;
  icon: React.ReactNode;
  rows: RuleOverride[];
  kind: "staff" | "services";
  studio: StudioRow;
  onSave: (kind: "staff" | "services", row: RuleOverride, next: Partial<RuleOverride>) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        {props.icon}
        <h2 className="text-base font-medium">{props.title}</h2>
      </div>
      <div className="mt-4 divide-y divide-border">
        {props.rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Sem itens ativos.</p>
        )}
        {props.rows.map((row) => {
          const studioPercent = row.commission_percent ?? props.studio.commission_percent;
          return (
            <div key={row.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="text-sm font-medium">{row.name}</p>
                <p className="text-xs text-muted-foreground">
                  {row.commission_percent == null
                    ? "Usa a percentagem padrão do estúdio"
                    : `Estúdio ${studioPercent}% · equipa ${100 - studioPercent}%`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={row.commission_percent ?? ""}
                  placeholder={`${props.studio.commission_percent}%`}
                  onChange={(e) =>
                    props.onSave(props.kind, row, {
                      commission_percent: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className="h-9 w-24 rounded-xl border border-border bg-background px-2 text-sm"
                />
                <span className="text-xs text-muted-foreground">parte do estúdio</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-mono ${
          strong
            ? "font-semibold text-emerald-700 dark:text-emerald-400"
            : "text-emerald-700/90 dark:text-emerald-400/90"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
