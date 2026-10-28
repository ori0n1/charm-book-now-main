import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, MessageCircle, RefreshCw, Save, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { CentralShell, MetricCard, Panel, formatMoney } from "@/components/central/central-ui";
import {
  getWhatsAppAdminDashboard,
  saveWhatsAppPlatformSettings,
  saveWhatsAppStudioEntitlement,
} from "@/lib/whatsapp-commercial.functions";

export const Route = createFileRoute("/_authenticated/admin/central-whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp - Central Bellza" }] }),
  component: CentralWhatsAppPage,
});

function CentralWhatsAppPage() {
  const loadDashboard = useServerFn(getWhatsAppAdminDashboard);
  const saveSettings = useServerFn(saveWhatsAppPlatformSettings);
  const saveEntitlement = useServerFn(saveWhatsAppStudioEntitlement);
  const query = useQuery<any>({
    queryKey: ["central-whatsapp"],
    queryFn: () => loadDashboard(),
    staleTime: 20_000,
  });
  const [draft, setDraft] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (query.data?.settings) setDraft(query.data.settings);
    if (query.isError) setDraft(null);
  }, [query.data?.settings, query.isError]);

  const studios = useMemo(() => {
    if (!query.isSuccess) return [];
    const needle = search.trim().toLocaleLowerCase("pt");
    if (!needle) return query.data?.studios ?? [];
    return (query.data?.studios ?? []).filter((studio: any) =>
      studio.name.toLocaleLowerCase("pt").includes(needle),
    );
  }, [query.data?.studios, query.isSuccess, search]);

  async function persistSettings() {
    if (!draft) return;
    setSaving(true);
    try {
      await saveSettings({ data: draft });
      await query.refetch();
      toast.success("Configuração do WhatsApp atualizada.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Não foi possível guardar.";
      toast.error(
        reason.includes("automatic_billing_requires")
          ? "Valide o contrato e configure custo e preço antes de ativar cobrança automática."
          : reason,
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateStudio(studio: any, status: string) {
    try {
      await saveEntitlement({
        data: {
          studioId: studio.id,
          status,
          trialMessageLimitOverride: null,
          addonEndsAt: null,
          pausedReason: status === "paused" ? "paused_by_admin" : null,
        },
      });
      await query.refetch();
      toast.success(`WhatsApp de ${studio.name} atualizado.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o estúdio.");
    }
  }

  const summary = query.data?.summary;
  const unavailable = query.isError ? "Indisponível" : undefined;
  const supportCode = getSupportCode(query.error);
  return (
    <CentralShell updatedAt={query.isSuccess ? query.data?.generatedAt : undefined}>
      <div className="space-y-4 sm:space-y-5">
        <section className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Central Bellza
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">WhatsApp</h1>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                Uso, teste, acesso adicional e custos separados da assinatura principal.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to="/admin/central"
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Central
            </Link>
            <button
              type="button"
              onClick={() => query.refetch()}
              className="grid size-9 place-items-center rounded-xl border border-border"
              aria-label="Atualizar"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </section>

        {query.isError && (
          <div className="flex flex-col gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Não foi possível carregar os dados do WhatsApp.</p>
              <p className="mt-1 text-xs opacity-80">
                Tente novamente. Se o problema continuar, informe o código de suporte {supportCode}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-background px-3 text-xs font-semibold disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />{" "}
              Tentar novamente
            </button>
          </div>
        )}

        <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 xl:grid-cols-8">
          <MetricCard
            label="Estúdios a usar"
            value={unavailable ?? summary?.studiosUsing ?? 0}
            hint="Envio ativo"
            icon={MessageCircle}
            accent="emerald"
            loading={query.isLoading}
          />
          <MetricCard
            label="Em teste"
            value={unavailable ?? summary?.trialStudios ?? 0}
            hint="Teste WhatsApp"
            icon={ShieldCheck}
            accent="amber"
            loading={query.isLoading}
          />
          <MetricCard
            label="Adicional ativo"
            value={unavailable ?? summary?.payingStudios ?? 0}
            hint="Ativação comercial"
            icon={ShieldCheck}
            accent="blue"
            loading={query.isLoading}
          />
          <MetricCard
            label="Mensagens"
            value={unavailable ?? summary?.messages ?? 0}
            hint="Enviadas ou entregues"
            icon={MessageCircle}
            accent="violet"
            loading={query.isLoading}
          />
          <MetricCard
            label="Falhadas"
            value={unavailable ?? summary?.failedMessages ?? 0}
            hint="Falha do provedor"
            icon={MessageCircle}
            accent="red"
            loading={query.isLoading}
          />
          <MetricCard
            label="Bloqueadas"
            value={unavailable ?? summary?.blockedMessages ?? 0}
            hint="Regra de acesso"
            icon={ShieldCheck}
            accent="amber"
            loading={query.isLoading}
          />
          <MetricCard
            label="Custo estimado"
            value={
              unavailable ??
              (summary?.costConfigured
                ? formatMoney(summary?.estimatedProviderCostCents ?? 0)
                : "Por configurar")
            }
            hint="Custo do provedor"
            icon={MessageCircle}
            money={!query.isError && summary?.costConfigured}
            loading={query.isLoading}
          />
          <MetricCard
            label="Receita estimada"
            value={
              unavailable ??
              (draft?.commercialExcessMessageCents != null
                ? formatMoney(summary?.estimatedRevenueCents ?? 0)
                : "Por configurar")
            }
            hint="Regra Bellza"
            icon={MessageCircle}
            money={!query.isError && draft?.commercialExcessMessageCents != null}
            loading={query.isLoading}
          />
        </section>

        {draft && (
          <Panel
            title="Configuração global"
            description="A cobrança automática só pode ser ativada após validação explícita do contrato do provedor."
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Toggle
                label="WhatsApp global"
                checked={draft.globalEnabled}
                onChange={(value) => setDraft({ ...draft, globalEnabled: value })}
              />
              <Toggle
                label="Teste gratuito"
                checked={draft.trialEnabled}
                onChange={(value) => setDraft({ ...draft, trialEnabled: value })}
              />
              <NumberField
                label="Duração do teste (dias)"
                value={draft.trialDurationDays}
                onChange={(value) => setDraft({ ...draft, trialDurationDays: value })}
              />
              <NumberField
                label="Limite do teste"
                value={draft.trialMessageLimit}
                onChange={(value) => setDraft({ ...draft, trialMessageLimit: value })}
              />
              <TextField
                label="Alertas (%)"
                value={draft.alertThresholds.join(", ")}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    alertThresholds: value
                      .split(",")
                      .map((item: string) => Number(item.trim()))
                      .filter((item: number) => Number.isFinite(item)),
                  })
                }
              />
              <MoneyField
                label="Custo provedor / mensagem"
                value={draft.providerCostPerMessageCents}
                onChange={(value) => setDraft({ ...draft, providerCostPerMessageCents: value })}
              />
              <MoneyField
                label="Preço comercial do adicional"
                value={draft.commercialPriceCents}
                onChange={(value) => setDraft({ ...draft, commercialPriceCents: value })}
              />
              <NumberField
                label="Mensagens incluídas no adicional"
                value={draft.commercialIncludedMessages ?? 0}
                onChange={(value) => setDraft({ ...draft, commercialIncludedMessages: value })}
              />
              <MoneyField
                label="Excesso / mensagem"
                value={draft.commercialExcessMessageCents}
                onChange={(value) => setDraft({ ...draft, commercialExcessMessageCents: value })}
              />
              <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                Após o teste
                <select
                  value={draft.postTrialMode}
                  onChange={(event) => setDraft({ ...draft, postTrialMode: event.target.value })}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="inactive">WhatsApp inativo</option>
                  <option value="manual_addon">Adicional manual</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
                Cobrança
                <select
                  value={draft.billingMode}
                  onChange={(event) => setDraft({ ...draft, billingMode: event.target.value })}
                  className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="disabled">Desativada</option>
                  <option value="manual">Manual</option>
                  <option value="automatic">Automática</option>
                </select>
              </label>
              <Toggle
                label="Contrato do provedor validado"
                checked={draft.providerContractVerified}
                onChange={(value) => setDraft({ ...draft, providerContractVerified: value })}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={persistSettings}
                disabled={saving}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-foreground px-4 text-xs font-semibold text-background disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> {saving ? "A guardar..." : "Guardar configuração"}
              </button>
            </div>
          </Panel>
        )}

        <Panel
          title="Estúdios"
          description={
            query.isError
              ? "Dados indisponíveis"
              : `${studios.length} conta${studios.length === 1 ? "" : "s"}`
          }
        >
          {query.isError ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              A lista não foi substituída por valores vazios. Use “Tentar novamente” para repetir a
              consulta.
            </p>
          ) : (
            <>
              <label className="mb-3 flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Pesquisar estúdio"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <div className="grid gap-2 lg:grid-cols-2">
                {studios.map((studio: any) => (
                  <article
                    key={studio.id}
                    className="grid gap-3 rounded-2xl border border-border/70 bg-background/50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold">{studio.name}</h3>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase">
                          {studio.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {studio.used} enviadas
                        {studio.limit != null
                          ? ` · ${studio.remaining} restantes de ${studio.limit}`
                          : ""}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {studio.pendingMessages} pendentes · {studio.failedMessages} falhadas ·{" "}
                        {studio.blockedMessages} bloqueadas
                        {summary?.costConfigured
                          ? ` · custo ${formatMoney(studio.estimatedProviderCostCents)}`
                          : ""}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Assinatura: {studio.subscriptionStatus || "não informada"} · Última
                        atividade: {formatActivity(studio.lastActivityAt)}
                      </p>
                    </div>
                    <select
                      value={studio.status}
                      onChange={(event) => updateStudio(studio, event.target.value)}
                      className="h-9 rounded-xl border border-border bg-card px-2 text-xs font-semibold"
                    >
                      <option value="legacy">Legado</option>
                      <option value="trial">Teste</option>
                      <option value="active">Adicional ativo</option>
                      <option value="inactive">Inativo</option>
                      <option value="paused">Pausado</option>
                    </select>
                  </article>
                ))}
              </div>
            </>
          )}
        </Panel>
      </div>
    </CentralShell>
  );
}

function getSupportCode(error: unknown) {
  const match = (error instanceof Error ? error.message : String(error ?? "")).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
  return match?.[0] ?? "indisponível";
}

function formatActivity(value: string | null | undefined) {
  if (!value) return "sem registo";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "sem registo" : date.toLocaleString("pt-PT");
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex h-10 items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 text-xs font-semibold">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-emerald-600"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
      {label}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
      />
    </label>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">
      {label}
      <input
        type="number"
        min={0}
        step="0.01"
        value={value == null ? "" : (value / 100).toFixed(2)}
        placeholder="Por configurar"
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Math.round(Number(event.target.value) * 100))
        }
        className="h-10 rounded-xl border border-border bg-background px-3 text-sm text-foreground"
      />
    </label>
  );
}
