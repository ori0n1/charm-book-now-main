import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/sinal")({
  head: () => ({ meta: [{ title: "Sinal - Painel" }] }),
  component: SinalPage,
});

type StudioRow = {
  id: string;
  payment_policy: "pay_in_studio" | "pre_payment";
  accepted_payment_methods: string[];
  deposit_percent: number;
  commission_percent: number;
};

function SinalPage() {
  const [studio, setStudio] = useState<StudioRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("studio_id").limit(1);
      const studioId = (roles?.[0] as { studio_id: string } | undefined)?.studio_id;
      if (!studioId) return;
      const result = await loadSinalSettings(studioId);
      if (result.studio) setStudio(result.studio);
    })();
  }, []);

  async function saveStudio(next: Partial<StudioRow>) {
    if (!studio) return;
    setSaving(true);
    const merged = { ...studio, ...next };
    const { error } = await supabase
      .from("studios")
      .update({
        payment_policy: merged.payment_policy,
        accepted_payment_methods: merged.accepted_payment_methods,
        deposit_percent: merged.deposit_percent,
        commission_percent: merged.commission_percent,
      })
      .eq("id", studio.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    setStudio(merged);
    toast.success("Guardado.");
  }

  function toggleMethod(m: "mb_way" | "card") {
    if (!studio) return;
    const set = new Set(studio.accepted_payment_methods);
    if (set.has(m)) set.delete(m);
    else set.add(m);
    void saveStudio({ accepted_payment_methods: Array.from(set) });
  }

  if (!studio) return <p className="text-sm text-muted-foreground">A carregar...</p>;

  const requirePayment = studio.payment_policy === "pre_payment";

  return (
    <div className="space-y-4 xl:mx-auto xl:max-w-[88rem]">
      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="border-b border-border/70 px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="grid size-8 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                  <Wallet className="h-4 w-4" />
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em]">Pagamentos</span>
              </div>
              <h1 className="mt-2 text-base font-medium tracking-tight md:text-lg">Sinal online</h1>
            </div>
            <span className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Checkout
            </span>
          </div>
        </div>

        <div className="grid gap-6 p-4 md:p-5 xl:grid-cols-[minmax(0,1.15fr)_32rem] xl:items-start">
          <div className="rounded-3xl border border-border/70 bg-background/45 p-4">
            <h2 className="text-base font-medium">Como a cliente confirma a reserva</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Escolha se a reserva fica marcada sem pagamento ou se precisa de um sinal para guardar
              o horário.
            </p>
            <div className="mt-4 grid gap-3">
              <RuleChoice
                checked={!requirePayment}
                disabled={saving}
                title="Pagar no estúdio"
                description="A cliente confirma a marcação agora e paga tudo presencialmente."
                onChange={() => saveStudio({ payment_policy: "pay_in_studio" })}
              />
              <RuleChoice
                checked={requirePayment}
                disabled={saving}
                title="Pedir sinal online"
                description="A cliente paga uma parte no checkout. O restante fica para o dia do atendimento."
                onChange={() => saveStudio({ payment_policy: "pre_payment" })}
              />
            </div>
          </div>

          {requirePayment && (
            <div className="rounded-3xl border border-border/70 bg-background/45 p-4">
              <h2 className="text-base font-medium">Valor e métodos</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Este valor aparece no checkout como “paga agora”.
              </p>
              <div className="mt-4 grid gap-4">
                <PercentSlider
                  label="Sinal cobrado"
                  value={studio.deposit_percent}
                  min={10}
                  onChange={(value) => setStudio({ ...studio, deposit_percent: value })}
                  onCommit={(value) => saveStudio({ deposit_percent: value })}
                  disabled={saving}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <CheckRow
                    checked={studio.accepted_payment_methods.includes("card")}
                    label="Apple Pay, Google Pay e cartão"
                    onChange={() => toggleMethod("card")}
                    disabled={saving}
                  />
                  <CheckRow
                    checked={studio.accepted_payment_methods.includes("mb_way")}
                    label="MB WAY"
                    onChange={() => toggleMethod("mb_way")}
                    disabled={saving}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

async function loadSinalSettings(studioId: string) {
  const { data } = await supabase
    .from("studios")
    .select("id,payment_policy,accepted_payment_methods,deposit_percent,commission_percent")
    .eq("id", studioId)
    .maybeSingle();

  return { studio: normalizeStudio(data) };
}

function normalizeStudio(row: unknown): StudioRow | null {
  const studio = row as Partial<StudioRow> | null;
  if (!studio?.id) return null;
  return {
    id: studio.id,
    payment_policy: studio.payment_policy ?? "pay_in_studio",
    accepted_payment_methods: normalizeAcceptedPaymentMethods(studio.accepted_payment_methods),
    deposit_percent: studio.deposit_percent ?? 25,
    commission_percent: studio.commission_percent ?? 50,
  };
}

function normalizeAcceptedPaymentMethods(methods?: string[] | null) {
  const normalized = (methods ?? ["mb_way", "card"]).filter(
    (method) => method === "mb_way" || method === "card",
  );
  return normalized.length ? normalized : ["mb_way", "card"];
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

function RuleChoice(props: {
  checked: boolean;
  disabled: boolean;
  title: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background/60 p-4 transition hover:bg-muted">
      <input
        type="radio"
        checked={props.checked}
        onChange={props.onChange}
        disabled={props.disabled}
        className="mt-1"
      />
      <span>
        <span className="block text-sm font-medium">{props.title}</span>
        <span className="text-xs text-muted-foreground">{props.description}</span>
      </span>
    </label>
  );
}

function CheckRow(props: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-4 text-sm">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onChange}
        disabled={props.disabled}
      />
      <CreditCard className="h-4 w-4 text-muted-foreground" />
      <span>{props.label}</span>
    </label>
  );
}
