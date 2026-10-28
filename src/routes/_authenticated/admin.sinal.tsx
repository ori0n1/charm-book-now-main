import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { readDepositRule } from "@/lib/deposit-rule";

export const Route = createFileRoute("/_authenticated/admin/sinal")({
  head: () => ({ meta: [{ title: "Sinal - Painel" }] }),
  component: SinalPage,
});

type StudioRow = {
  id: string;
  payment_policy: "pay_in_studio" | "pre_payment";
  accepted_payment_methods: string[];
  stripe_connect_charges_enabled?: boolean | null;
  stripe_connect_onboarding_completed?: boolean | null;
  stripe_connect_mb_way_payments_enabled?: boolean | null;
  deposit_percent: number;
  studio_policy_settings: Record<string, unknown>;
  deposit_mode: "percent" | "fixed";
  deposit_fixed_cents: number;
  commission_percent: number;
};

function SinalPage() {
  const fixedSettingsEditable = import.meta.env.VITE_FIXED_DEPOSIT_SETTINGS_ENABLED !== "false";
  const [studio, setStudio] = useState<StudioRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [fixedInput, setFixedInput] = useState("10,00");

  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("studio_id").limit(1);
      const studioId = (roles?.[0] as { studio_id: string } | undefined)?.studio_id;
      if (!studioId) return;
      const result = await loadSinalSettings(studioId);
      if (result.studio) {
        setStudio(result.studio);
        setFixedInput((result.studio.deposit_fixed_cents / 100).toFixed(2).replace(".", ","));
      }
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

  async function saveDepositMode(mode: "percent" | "fixed", fixedText = fixedInput) {
    if (!studio || saving) return;
    const normalized = fixedText.trim().replace(",", ".");
    if (mode === "fixed" && !/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
      toast.error("Indique um valor fixo válido, com até duas casas decimais.");
      return;
    }
    const fixedCents = mode === "fixed" ? Math.round(Number(normalized) * 100) : studio.deposit_fixed_cents;
    if (!Number.isSafeInteger(fixedCents) || fixedCents < 50 || fixedCents > 999_999_999) {
      toast.error("Indique um sinal fixo entre 0,50 € e 9.999.999,99 €.");
      return;
    }
    setSaving(true);
    const { data, error: loadError } = await (supabase.from("studios") as any)
      .select("studio_policy_settings").eq("id", studio.id).single();
    if (loadError) { setSaving(false); toast.error(loadError.message); return; }
    const settings = (data?.studio_policy_settings ?? {}) as Record<string, unknown>;
    const depositSetting = settings.deposit && typeof settings.deposit === "object"
      ? settings.deposit as Record<string, unknown> : {};
    const previousText = typeof depositSetting.text === "string" ? depositSetting.text : "";
    const generatedText = mode === "fixed"
      ? `Sinal fixo de ${(fixedCents / 100).toFixed(2)} € para confirmar reservas online.`
      : `Sinal de ${studio.deposit_percent}% para confirmar reservas online.`;
    const updateText = !previousText || /^Sinal (fixo de .*€|de .*%) para confirmar reservas online\.$/.test(previousText);
    const updated = {
      ...settings, deposit_mode: mode, deposit_fixed_cents: fixedCents,
      deposit: updateText ? { ...depositSetting, text: generatedText, updated_at: new Date().toISOString() } : depositSetting,
    };
    const { error } = await (supabase.from("studios") as any)
      .update({ studio_policy_settings: updated }).eq("id", studio.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setStudio({ ...studio, studio_policy_settings: updated, deposit_mode: mode, deposit_fixed_cents: fixedCents });
    setFixedInput((fixedCents / 100).toFixed(2).replace(".", ","));
    toast.success("Guardado.");
  }

  if (!studio) return <p className="text-sm text-muted-foreground">A carregar...</p>;

  const requirePayment = studio.payment_policy === "pre_payment";
  const connectReady = Boolean(studio.stripe_connect_charges_enabled && studio.stripe_connect_onboarding_completed);
  const mbWayReady = Boolean(studio.stripe_connect_mb_way_payments_enabled);

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
            <h2 className="text-base font-medium">Como a pessoa cliente confirma a reserva</h2>
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
                title="Cobrar pagamento online"
                description="A cliente paga no checkout. Pode ser um sinal parcial ou o valor total do serviço."
                onChange={() => saveStudio({ payment_policy: "pre_payment" })}
              />
            </div>
          </div>

          {requirePayment && (
            <div className="rounded-3xl border border-border/70 bg-background/45 p-4">
              <h2 className="text-base font-medium">Valor e métodos</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {studio.deposit_mode === "percent" && studio.deposit_percent >= 100
                  ? "100% do valor é cobrado no checkout  -  a pessoa cliente paga o serviço na totalidade online."
                  : "Este valor aparece no checkout como \"paga agora\"."}
              </p>
              <div className="mt-4 grid gap-4">
                {fixedSettingsEditable && <fieldset className="flex flex-wrap gap-4 text-sm">
                  <legend className="mb-2 font-medium">Modalidade do sinal</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="deposit-mode" checked={studio.deposit_mode === "percent"} disabled={saving} onChange={() => void saveDepositMode("percent")} />Percentual (%)</label>
                  <label className="flex items-center gap-2"><input type="radio" name="deposit-mode" checked={studio.deposit_mode === "fixed"} disabled={saving} onChange={() => void saveDepositMode("fixed")} />Valor fixo (€)</label>
                </fieldset>}
                {studio.deposit_mode === "percent" ? <PercentSlider
                  label={studio.deposit_percent >= 100 ? "Pagamento integral (100%)" : "Sinal cobrado"}
                  value={studio.deposit_percent}
                  min={10}
                  onChange={(value) => setStudio({ ...studio, deposit_percent: value })}
                  onCommit={(value) => saveStudio({ deposit_percent: value })}
                  disabled={saving}
                /> : fixedSettingsEditable ? <label className="block text-sm">Sinal cobrado (€)
                  <input type="text" inputMode="decimal" value={fixedInput} disabled={saving}
                    onChange={(event) => setFixedInput(event.target.value)}
                    onBlur={() => void saveDepositMode("fixed")}
                    onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2" />
                </label> : <p className="text-sm text-muted-foreground">Sinal fixo ativo: {(studio.deposit_fixed_cents / 100).toFixed(2)} €.</p>}
                {studio.deposit_mode === "percent" && studio.deposit_percent >= 100 && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/8 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                    <span className="font-semibold">Pagamento integral ativo.</span> A cliente paga 100% no checkout. Não será cobrado nenhum valor adicional no estúdio.
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <CheckRow
                    checked={studio.accepted_payment_methods.includes("card")}
                    label="Cartão"
                    onChange={() => toggleMethod("card")}
                    disabled={saving}
                  />
                  <CheckRow
                    checked={studio.accepted_payment_methods.includes("mb_way")}
                    label="MB WAY"
                    onChange={() => toggleMethod("mb_way")}
                    disabled={saving || !connectReady || !mbWayReady}
                  />
                </div>
                {connectReady && !mbWayReady && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/8 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                    MB WAY ainda não está ativo na conta Stripe conectada. Abra a página de recebimentos, atualize o estado e conclua a ativação pedida pela Stripe.
                  </div>
                )}
                {!connectReady && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/8 px-4 py-3 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                    Para cobrar online, conclua primeiro a configuração da conta Stripe em Recebimentos.
                  </div>
                )}
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
    .select("id,payment_policy,accepted_payment_methods,deposit_percent,commission_percent,studio_policy_settings,stripe_connect_charges_enabled,stripe_connect_onboarding_completed,stripe_connect_mb_way_payments_enabled")
    .eq("id", studioId)
    .maybeSingle();

  return { studio: normalizeStudio(data) };
}

function normalizeStudio(row: unknown): StudioRow | null {
  const studio = row as Partial<StudioRow> | null;
  if (!studio?.id) return null;
  const settings = studio.studio_policy_settings ?? {};
  const rule = readDepositRule({ deposit_percent: studio.deposit_percent, studio_policy_settings: settings });
  return {
    id: studio.id,
    payment_policy: studio.payment_policy ?? "pay_in_studio",
    accepted_payment_methods: normalizeAcceptedPaymentMethods(studio.accepted_payment_methods),
    stripe_connect_charges_enabled: studio.stripe_connect_charges_enabled ?? false,
    stripe_connect_onboarding_completed: studio.stripe_connect_onboarding_completed ?? false,
    stripe_connect_mb_way_payments_enabled: studio.stripe_connect_mb_way_payments_enabled ?? false,
    deposit_percent: studio.deposit_percent ?? 25,
    studio_policy_settings: settings,
    deposit_mode: rule.mode,
    deposit_fixed_cents: rule.mode === "fixed" ? rule.fixed_cents : Number(settings.deposit_fixed_cents) || 1000,
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
