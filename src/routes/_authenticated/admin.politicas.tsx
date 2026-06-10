import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  Info,
  RefreshCcw,
  Search,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getPolicyParts,
  type PolicyTextParts,
  type RefundPolicyValue,
} from "@/lib/policy-text";
import { updateStudioRefundRequest } from "@/lib/refund-operations.functions";

export const Route = createFileRoute("/_authenticated/admin/politicas")({
  head: () => ({ meta: [{ title: "Políticas e Cancelamentos" }] }),
  component: PoliciesPage,
});

type RefundPolicy = RefundPolicyValue;
type StudioPolicy = {
  id: string;
  cancellation_min_notice_hours: number;
  cancellation_after_deadline_policy: RefundPolicy;
  refund_requests_enabled: boolean;
  cancellation_policy_text: string | null;
  legal_policy_version: string;
};

type RefundRequest = {
  id: string;
  created_at: string;
  status: "pending" | "in_review" | "approved" | "rejected" | "refunded";
  reason: string;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  reviewed_at: string | null;
  decision_note: string | null;
  payment_intents?: {
    amount_cents: number | null;
    status: string | null;
    stripe_checkout_session_id?: string | null;
  } | null;
  appointments?: {
    starts_at: string | null;
    total_price: number | null;
    appointment_services?: { services: { name: string | null } | null }[] | null;
  } | null;
};

type RefundTab = "all" | "pending" | "approved" | "rejected";

function PoliciesPage() {
  const { studio } = useCurrentStudio();
  const updateRefund = useServerFn(updateStudioRefundRequest);
  const [data, setData] = useState<StudioPolicy | null>(null);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [noticeMode, setNoticeMode] = useState<"24" | "48" | "custom">("24");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<RefundTab>("pending");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (!studio) return;
    let cancelled = false;

    async function init() {
      setLoading(true);
      const { data: row, error } = await supabase
        .from("studios")
        .select(
          "id,cancellation_min_notice_hours,cancellation_after_deadline_policy,refund_requests_enabled,cancellation_policy_text,legal_policy_version",
        )
        .eq("id", studio.id)
        .maybeSingle();

      if (!cancelled) {
        if (error || !row) {
          toast.error("Não foi possível carregar as políticas.");
        } else {
          const normalized = normalizePolicy(row);
          setData(normalized);
          setNoticeMode(
            normalized.cancellation_min_notice_hours === 24
              ? "24"
              : normalized.cancellation_min_notice_hours === 48
                ? "48"
                : "custom",
          );
        }

        await loadRefunds(studio.id);
      }
      setLoading(false);
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [studio]);

  async function loadRefunds(studioId: string) {
    const { data: rows, error } = await (supabase as any)
      .from("refund_requests")
      .select(
        "id,created_at,status,reason,client_name,client_phone,client_email,decision_note,reviewed_at,payment_intents(amount_cents,status,stripe_checkout_session_id),appointments(starts_at,total_price,appointment_services(services(name)))",
      )
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return;
    setRefunds((rows ?? []) as RefundRequest[]);
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    const version = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("studios")
      .update({
        cancellation_min_notice_hours: data.cancellation_min_notice_hours,
        cancellation_after_deadline_policy: data.cancellation_after_deadline_policy,
        refund_requests_enabled: data.refund_requests_enabled,
        cancellation_policy_text: data.cancellation_policy_text,
        legal_policy_version: version,
      })
      .eq("id", data.id);

    setSaving(false);
    if (error) return toast.error(error.message);

    setData({ ...data, legal_policy_version: version });
    toast.success("Políticas atualizadas.");
  }

  async function updateRefundStatus(id: string, status: RefundRequest["status"], note?: string) {
    if (!studio || status === "refunded") return;
    try {
      await updateRefund({
        data: {
          studioId: studio.id,
          requestId: id,
          status,
          note: note?.trim() || undefined,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("refund_payment_not_live")) {
        toast.error("Este reembolso não está ligado a um pagamento live confirmado.");
        return;
      }
      if (message.includes("refund_already_processed")) {
        toast.error("Este reembolso já foi processado.");
        return;
      }
      toast.error("Não foi possível atualizar este pedido.");
      return;
    }

    setRefunds((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              reviewed_at: new Date().toISOString(),
              decision_note: note || item.decision_note,
            }
          : item,
      ),
    );

    toast.success(
      status === "approved"
        ? "Reembolso aprovado para processamento."
        : "Pedido atualizado.",
    );
  }

  const filteredRefunds = useMemo(() => {
    const query = search.trim().toLowerCase();

    return refunds.filter((request) => {
      if (tab !== "all" && request.status !== tab) return false;

      if (dateFrom) {
        const from = new Date(dateFrom);
        const created = new Date(request.created_at);
        if (created < from) return false;
      }

      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        const created = new Date(request.created_at);
        if (created > to) return false;
      }

      if (!query) return true;

      const text = [
        request.client_name,
        request.client_email,
        request.client_phone,
        request.reason,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(query);
    });
  }, [refunds, tab, search, dateFrom, dateTo]);

  const summary = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    let pending = 0;
    let approvedThisMonth = 0;
    let rejectedThisMonth = 0;
    let refundedValue = 0;
    let approvedTotal = 0;

    for (const request of refunds) {
      const created = new Date(request.created_at);
      if (request.status === "pending" || request.status === "in_review") {
        pending += 1;
      }
      if (["approved", "refunded"].includes(request.status)) {
        const cents = Number(request.payment_intents?.amount_cents ?? 0);
        approvedTotal += 1;
        if (request.status === "approved") {
          if (created >= new Date(monthStart)) approvedThisMonth += 1;
        }
        if (request.status === "refunded") {
          refundedValue += cents;
          if (created >= new Date(monthStart)) rejectedThisMonth += 0;
        }
      }
      if (request.status === "rejected") {
        const createdRejected = new Date(request.created_at);
        if (createdRejected >= new Date(monthStart)) rejectedThisMonth += 1;
      }
    }

    const approvalRate = approvedTotal ? Math.round((refundedValue ? approvedTotal : 0) / approvedTotal) : 0;
    const rateForShow = approvedTotal
      ? Math.round((approvedTotal / (approvedTotal + Math.max(rejectedThisMonth, 0))) * 100)
      : 0;

    return {
      pending,
      approvedThisMonth,
      rejectedThisMonth,
      refundedValue,
      rateForShow,
    } as const;
  }, [refunds]);

  if (loading || !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="h-24 animate-pulse rounded-2xl bg-muted/60" />
        <div className="h-24 animate-pulse rounded-2xl bg-muted/60" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Central de Políticas e Conformidade
              </p>
              <h1 className="mt-1 text-xl font-light tracking-tight">Estúdio</h1>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Gestão de políticas, prazos e reembolsos com rápida localização,
                filtros e controlo total.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/60 px-1.5 py-1 text-xs text-muted-foreground">
            <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
            <span className="rounded-lg bg-background px-2 py-1.5 font-medium text-foreground shadow-sm">
              Versão <span className="font-semibold">{data.legal_policy_version}</span>
            </span>
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile
          label="Pendentes"
          value={summary.pending}
          icon={<Eye className="h-4 w-4" />}
          accent="pending"
        />
        <MetricTile
          label="Aprovados este mês"
          value={summary.approvedThisMonth}
          icon={<CheckCircle2 className="h-4 w-4" />}
          accent="approved"
        />
        <MetricTile
          label="Recusados este mês"
          value={summary.rejectedThisMonth}
          icon={<XCircle className="h-4 w-4" />}
          accent="rejected"
        />
        <MetricTile
          label="Total reembolsado"
          value={new Intl.NumberFormat("pt-PT", {
            style: "currency",
            currency: "EUR",
          }).format(summary.refundedValue / 100)}
          icon={<Wallet className="h-4 w-4" />}
          accent="value"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-lg bg-sky-500/10 text-sky-500">
                  <RefreshCcw className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Pedidos de reembolso
                  </p>
                  <h2 className="text-base font-medium leading-tight">
                    Fila operacional
                  </h2>
                </div>
              </div>
              <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {filteredRefunds.length} de {refunds.length}
              </span>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative sm:w-64">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cliente, email, telefone ou motivo..."
                  className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-xs outline-none transition focus:border-foreground/40"
                />
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </label>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none transition focus:border-foreground/40"
                />
                <span className="text-[10px] font-semibold uppercase tracking-widest">até</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none transition focus:border-foreground/40"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {(["all", "pending", "approved", "rejected"] as RefundTab[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] transition ${
                    tab === item
                      ? item === "pending"
                        ? "border-foreground bg-foreground text-background"
                        : item === "approved"
                          ? "border-emerald-500/70 bg-emerald-500/12 text-emerald-600"
                          : item === "rejected"
                            ? "border-red-500/70 bg-red-500/12 text-red-600"
                            : "border-foreground/70 bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {item === "all" ? "Todos" : item === "pending" ? "Pendentes" : item === "approved" ? "Aprovados" : "Recusados"}
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-2">
              {filteredRefunds.length === 0 ? (
                <EmptyState />
              ) : (
                filteredRefunds.map((request) => (
                  <RefundCard
                    key={request.id}
                    request={request}
                    onUpdate={(status, note) => updateRefundStatus(request.id, status, note)}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Pré-visualização para o cliente
              </p>
              {(() => {
                const parts = getPolicyParts(
                  data.cancellation_after_deadline_policy,
                  data.cancellation_min_notice_hours,
                );
                if (!parts.badge) return null;
                return (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${microBadgeTone(
                      parts.refundTone,
                    )}`}
                  >
                    {parts.refundTone === "warning" ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : parts.refundTone === "muted" ? (
                      <RefreshCcw className="h-3 w-3" />
                    ) : (
                      <Info className="h-3 w-3" />
                    )}
                    {parts.badge}
                  </span>
                );
              })()}
            </div>

            <PolicyPreview
              parts={getPolicyParts(
                data.cancellation_after_deadline_policy,
                data.cancellation_min_notice_hours,
              )}
              customText={data.cancellation_policy_text?.trim() || null}
            />

            <div className="mt-3 flex items-center justify-between rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span>
                Versão aplicada <span className="font-semibold text-foreground">{data.legal_policy_version}</span>
              </span>
              <span className="flex h-2 w-2 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-emerald-500/80" />
              </span>
            </div>
          </div>

          <PolicyConfigurator
            data={data}
            noticeMode={noticeMode}
            saving={saving}
            onChange={(patch) => setData((current) => (current ? { ...current, ...patch } : current))}
            onNoticeModeChange={(mode) => setNoticeMode(mode)}
            onSave={save}
          />
        </aside>
      </section>
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: "pending" | "approved" | "rejected" | "value";
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="space-y-0.5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {label}
        </p>
        <p className="text-base font-medium tabular-nums text-foreground">
          {value}
        </p>
      </div>
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-xl ${
          accent === "pending"
            ? "bg-amber-500/12 text-amber-600"
            : accent === "approved"
              ? "bg-emerald-500/12 text-emerald-600"
              : accent === "rejected"
                ? "bg-red-500/12 text-red-600"
                : "bg-sky-500/12 text-sky-600"
        }`}
      >
        {icon}
      </span>
    </div>
  );
}

function PolicyConfigurator({
  data,
  noticeMode,
  saving,
  onChange,
  onNoticeModeChange,
  onSave,
}: {
  data: StudioPolicy;
  noticeMode: "24" | "48" | "custom";
  saving: boolean;
  onChange: (patch: Partial<StudioPolicy>) => void;
  onNoticeModeChange: (mode: "24" | "48" | "custom") => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-violet-500/10 text-violet-500">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Configuração
            </p>
            <h3 className="text-sm font-medium">Políticas ativas</h3>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${
            data.cancellation_after_deadline_policy === "non_refundable"
              ? "border-amber-500/40 bg-amber-500/12 text-amber-600"
              : "border-border bg-muted/60 text-foreground"
          }`}
        >
          {data.cancellation_after_deadline_policy === "refund_allowed"
            ? "Com reembolso"
            : data.cancellation_after_deadline_policy === "reschedule_only"
              ? "Só remarcação"
              : "Não reembolsável"}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Prazo mínimo de cancelamento
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              ["24", "24 horas"],
              ["48", "48 horas"],
              ["custom", "Personalizado"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  onNoticeModeChange(value as typeof noticeMode);
                  if (value === "24" || value === "48") {
                    onChange({ cancellation_min_notice_hours: Number(value) });
                  }
                }}
                className={`h-9 rounded-xl border text-xs font-medium transition ${
                  noticeMode === value
                    ? "border-foreground bg-foreground text-background"
                    : "border-border hover:bg-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {noticeMode === "custom" && (
            <label className="mt-2 block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Horas antes da marcação
              </span>
              <input
                type="number"
                min={1}
                value={data.cancellation_min_notice_hours}
                onChange={(event) =>
                  onChange({
                    cancellation_min_notice_hours: Math.max(1, Number(event.target.value || 1)),
                  })
                }
                className="mt-1 h-9 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none transition focus:border-foreground/40"
              />
            </label>
          )}
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Política de reembolso do sinal
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            O que acontece com o sinal pago se o cliente cancelar dentro do prazo.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {([
              ["refund_allowed", "Reembolso possível", "O estúdio analisa"],
              ["reschedule_only", "Só remarcação", "Sem devolução em dinheiro"],
              ["non_refundable", "Não reembolsável", "Sinal nunca devolvido"],
            ] as const).map((option) => {
              const meta = getPolicyParts(option[0], data.cancellation_min_notice_hours);
              const isActive = data.cancellation_after_deadline_policy === option[0];
              const isWarning = option[0] === "non_refundable";
              return (
                <button
                  key={option[0]}
                  type="button"
                  onClick={() => onChange({ cancellation_after_deadline_policy: option[0] })}
                  className={`flex min-h-[4.5rem] flex-col justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                    isActive
                      ? isWarning
                        ? "border-amber-500/60 bg-amber-500/15 text-foreground"
                        : "border-foreground bg-foreground text-background"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <span className="text-[11px] font-semibold leading-snug">{meta.optionTitle}</span>
                  <span
                    className={`mt-1 text-[10px] leading-snug ${
                      isActive
                        ? isWarning
                          ? "text-amber-700 dark:text-amber-300"
                          : "text-background/75"
                        : "text-muted-foreground"
                    }`}
                  >
                    {meta.optionSubtitle}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Nota adicional para o cliente
          </p>
          <textarea
            value={data.cancellation_policy_text ?? ""}
            onChange={(event) =>
              onChange({ cancellation_policy_text: event.target.value })
            }
            rows={3}
            placeholder="Ex: Para tatuagens grandes o sinal cobre o tempo de desenho já realizado."
            className="mt-1.5 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-xs outline-none transition focus:border-foreground/40"
          />
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-foreground text-xs font-bold uppercase tracking-[0.16em] text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "A guardar..." : "Guardar políticas"}
        </button>
      </div>
    </div>
  );
}

function RefundCard({
  request,
  onUpdate,
}: {
  request: RefundRequest;
  onUpdate: (status: RefundRequest["status"], note?: string) => void;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-background p-4 transition hover:shadow-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-foreground">
            {request.client_name || "Cliente"}
          </p>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${refundStatusClass(request.status)}`}
          >
            {refundStatusLabel(request.status)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ExternalLink className="h-3 w-3" />
            {refundServiceLabel(request)}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-foreground">
            <Wallet className="h-3 w-3" />
            {formatRefundAmount(request)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="h-3 w-3" />
            {formatRefundDate(request)}
          </span>
        </div>

        <div className="rounded-xl border border-border bg-muted/50 px-3 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {request.reason}
          </p>
        </div>

        {open && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Nota interna
              </span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-xs outline-none transition focus:border-foreground/40"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onUpdate("approved", note)}
                disabled={request.status === "approved"}
                className="inline-flex h-9 items-center rounded-lg border border-emerald-500/70 bg-emerald-500/10 px-3 text-[11px] font-bold text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-40"
              >
                Aprovar
              </button>
              <button
                type="button"
                onClick={() => onUpdate("rejected", note)}
                disabled={request.status === "rejected"}
                className="inline-flex h-9 items-center rounded-lg border border-red-500/70 bg-red-500/10 px-3 text-[11px] font-bold text-red-600 transition hover:bg-red-500/20 disabled:opacity-40"
              >
                Recusar
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted"
              >
                Fechar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 sm:flex-col sm:items-end">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold transition ${
            open
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
          title={open ? "Fechar ações" : "Ações"}
        >
          {open ? <ArrowDownRight className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-xs text-muted-foreground">
      <RefreshCcw className="mx-auto mb-3 h-5 w-5 text-muted-foreground/70" />
      <p className="font-medium text-foreground/70">Sem pedidos para esta vista</p>
      <p className="mt-1">
        Utilize filtros e pesquisa para localizar um pedido rapidamente.
      </p>
    </div>
  );
}

function PolicyPreview({
  parts,
  customText,
}: {
  parts: PolicyTextParts;
  customText: string | null;
}) {
  return (
    <div className="mt-3 space-y-2.5">
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {parts.rescheduleLabel}
          </p>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-foreground/85">
          {parts.rescheduleBody}
        </p>
      </div>
      <div
        className={`rounded-xl border p-3 ${
          parts.refundTone === "warning"
            ? "border-amber-500/35 bg-amber-500/8"
            : "border-border bg-background"
        }`}
      >
        <div className="flex items-center gap-2">
          <Wallet
            className={`h-3.5 w-3.5 ${
              parts.refundTone === "warning"
                ? "text-amber-600 dark:text-amber-300"
                : "text-muted-foreground"
            }`}
          />
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
              parts.refundTone === "warning"
                ? "text-amber-700 dark:text-amber-200"
                : "text-muted-foreground"
            }`}
          >
            {parts.refundLabel}
          </p>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-foreground/85">
          {parts.refundBody}
        </p>
      </div>
      {customText && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Nota adicional
          </p>
          <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-foreground/85">
            {customText}
          </p>
        </div>
      )}
    </div>
  );
}

function refundStatusLabel(status: RefundRequest["status"]) {
  if (status === "in_review") return "Em análise";
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Recusado";
  if (status === "refunded") return "Reembolsado";
  return "Pendente";
}

function refundStatusClass(status: RefundRequest["status"]) {
  if (status === "in_review") return "bg-sky-500/10 text-sky-600";
  if (status === "approved") return "bg-emerald-500/10 text-emerald-600";
  if (status === "rejected") return "bg-red-500/10 text-red-600";
  if (status === "refunded") return "bg-violet-500/10 text-violet-600";
  return "bg-amber-500/10 text-amber-600";
}

function refundServiceLabel(request: RefundRequest) {
  const names = request.appointments?.appointment_services
    ?.map((line) => line.services?.name)
    .filter(Boolean);
  return names?.length ? names.join(", ") : "Marcação";
}

function formatRefundAmount(request: RefundRequest) {
  const cents = request.payment_intents?.amount_cents;
  const amount = typeof cents === "number" ? cents / 100 : Number(request.appointments?.total_price ?? 0);
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(
    amount || 0,
  );
}

function formatRefundDate(request: RefundRequest) {
  const value = request.appointments?.starts_at ?? request.created_at;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function microBadgeTone(tone: PolicyTextParts["refundTone"]) {
  if (tone === "warning") return "border-amber-500/40 bg-amber-500/12 text-amber-600";
  if (tone === "muted") return "border-border bg-muted/60 text-foreground/80";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600";
}

function normalizePolicy(
  row: Omit<Partial<StudioPolicy>, "cancellation_after_deadline_policy"> & {
    id: string;
    cancellation_after_deadline_policy?: string | null;
  },
): StudioPolicy {
  return {
    id: row.id,
    cancellation_min_notice_hours: Number(row.cancellation_min_notice_hours ?? 24),
    cancellation_after_deadline_policy:
      row.cancellation_after_deadline_policy === "refund_allowed" ||
      row.cancellation_after_deadline_policy === "reschedule_only"
        ? row.cancellation_after_deadline_policy
        : "non_refundable",
    refund_requests_enabled: row.refund_requests_enabled ?? true,
    cancellation_policy_text: row.cancellation_policy_text ?? null,
    legal_policy_version: row.legal_policy_version ?? "2026-05-28",
  };
}
