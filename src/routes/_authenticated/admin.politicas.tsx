import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Info, RefreshCcw, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getPolicyParts,
  type PolicyTextParts,
  type RefundPolicyValue,
} from "@/lib/policy-text";

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
  payment_intents?: { amount_cents: number | null; status: string | null } | null;
  appointments?: {
    starts_at: string | null;
    total_price: number | null;
    appointment_services?: { services: { name: string | null } | null }[] | null;
  } | null;
};

function PoliciesPage() {
  const { studio } = useCurrentStudio();
  const [data, setData] = useState<StudioPolicy | null>(null);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [noticeMode, setNoticeMode] = useState<"24" | "48" | "custom">("24");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!studio) return;
    supabase
      .from("studios")
      .select(
        "id,cancellation_min_notice_hours,cancellation_after_deadline_policy,refund_requests_enabled,cancellation_policy_text,legal_policy_version",
      )
      .eq("id", studio.id)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (error || !row) {
          toast.error("Não foi possível carregar as políticas.");
          return;
        }
        const normalized = normalizePolicy(row);
        setData(normalized);
        setNoticeMode(
          normalized.cancellation_min_notice_hours === 24
            ? "24"
            : normalized.cancellation_min_notice_hours === 48
              ? "48"
          : "custom",
        );
      });
    loadRefunds(studio.id);
  }, [studio]);

  async function loadRefunds(studioId: string) {
    const { data: rows, error } = await (supabase as any)
      .from("refund_requests")
      .select("id,created_at,status,reason,client_name,client_phone,client_email,payment_intents(amount_cents,status),appointments(starts_at,total_price,appointment_services(services(name)))")
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false })
      .limit(20);
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

  async function updateRefundStatus(id: string, status: RefundRequest["status"]) {
    const { error } = await (supabase as any)
      .from("refund_requests")
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    setRefunds((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    toast.success("Pedido atualizado.");
  }

  if (!data) return <p className="text-sm text-muted-foreground">A carregar políticas...</p>;

  return (
    <div className="space-y-6">
      <header className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-500">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Políticas e cancelamentos
            </p>
            <h1 className="mt-1 text-2xl font-light tracking-tight">Regras do estúdio</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Configure dois conceitos separados: o <span className="font-medium text-foreground">prazo</span>{" "}
              para o cliente cancelar ou reagendar o horário, e a{" "}
              <span className="font-medium text-foreground">política de reembolso</span> aplicada ao sinal
              já pago. Cancelar dentro do prazo não devolve, por si só, o valor do sinal.
            </p>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4 rounded-3xl border border-border bg-card p-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Prazo mínimo de cancelamento
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                ["24", "24 horas"],
                ["48", "48 horas"],
                ["custom", "Personalizado"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setNoticeMode(value as typeof noticeMode);
                    if (value === "24" || value === "48") {
                      setData({ ...data, cancellation_min_notice_hours: Number(value) });
                    }
                  }}
                  className={`h-11 rounded-2xl border text-sm font-medium transition ${
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
              <label className="mt-3 block">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Horas antes da marcação
                </span>
                <input
                  type="number"
                  min={1}
                  value={data.cancellation_min_notice_hours}
                  onChange={(event) =>
                    setData({
                      ...data,
                      cancellation_min_notice_hours: Math.max(1, Number(event.target.value || 1)),
                    })
                  }
                  className="mt-1 h-11 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none focus:border-foreground/40"
                />
              </label>
            )}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Política de reembolso do sinal
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Define o que acontece com o sinal pago. É independente do prazo: o cliente
              pode cancelar dentro do prazo sem que isso signifique direito automático a reembolso.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {(["refund_allowed", "reschedule_only", "non_refundable"] as const).map((value) => {
                const meta = getPolicyParts(value, data.cancellation_min_notice_hours);
                return (
                  <PolicyOption
                    key={value}
                    active={data.cancellation_after_deadline_policy === value}
                    title={meta.optionTitle}
                    subtitle={meta.optionSubtitle}
                    tone={value === "non_refundable" ? "warning" : "default"}
                    onClick={() =>
                      setData({ ...data, cancellation_after_deadline_policy: value })
                    }
                  />
                );
              })}
            </div>
          </div>

          <label className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-background px-4 py-3">
            <span>
              <span className="block text-sm font-semibold">
                Mostrar formulário de pedido de reembolso ao cliente
              </span>
              <span className="block text-xs leading-relaxed text-muted-foreground">
                Mesmo com sinal não reembolsável, o cliente pode apresentar um pedido excepcional.
                A análise e a decisão final continuam sempre do estúdio.
              </span>
            </span>
            <input
              type="checkbox"
              checked={data.refund_requests_enabled}
              onChange={(event) =>
                setData({ ...data, refund_requests_enabled: event.target.checked })
              }
              className="size-5 accent-foreground"
            />
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Nota adicional opcional
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              Aparece em destaque junto à política, antes do pagamento.
            </p>
            <textarea
              value={data.cancellation_policy_text ?? ""}
              onChange={(event) =>
                setData({ ...data, cancellation_policy_text: event.target.value })
              }
              rows={5}
              placeholder="Ex.: Para tatuagens grandes, o sinal cobre o tempo de desenho já realizado. Mesmo cancelando, o desenho fica pago."
              className="mt-2 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm outline-none focus:border-foreground/40"
            />
          </label>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="h-12 w-full rounded-2xl bg-foreground text-xs font-bold uppercase tracking-[0.16em] text-background transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "A guardar" : "Guardar políticas"}
          </button>
        </div>

        <aside className="rounded-3xl border border-border bg-card p-5">
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
              return <PolicyBadge tone={parts.refundTone} label={parts.badge} />;
            })()}
          </div>
          <PolicyPreview
            parts={getPolicyParts(
              data.cancellation_after_deadline_policy,
              data.cancellation_min_notice_hours,
            )}
            customText={data.cancellation_policy_text?.trim() || null}
          />
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Versão atual: <span className="font-medium text-foreground">{data.legal_policy_version}</span>.
            Esta versão fica registada quando o cliente aceita as políticas.
          </p>
        </aside>
      </section>

      <section className="rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Pedidos de reembolso
            </p>
            <h2 className="mt-1 text-lg font-medium">Análise manual</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Estrutura preparada para futura integração com Stripe Refunds.
          </p>
        </div>
        <div className="mt-4 space-y-3">
          {refunds.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-background p-5 text-sm text-muted-foreground">
              Ainda não existem pedidos de reembolso.
            </div>
          ) : (
            refunds.map((request) => (
              <div
                key={request.id}
                className="rounded-2xl border border-border bg-background p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{request.client_name || "Cliente"}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${refundStatusClass(request.status)}`}>
                        {refundStatusLabel(request.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[request.client_phone, request.client_email].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <span className="rounded-xl bg-muted/50 px-3 py-2">
                        Serviço: <strong className="text-foreground">{refundServiceLabel(request)}</strong>
                      </span>
                      <span className="rounded-xl bg-muted/50 px-3 py-2">
                        Valor: <strong className="text-foreground">{formatRefundAmount(request)}</strong>
                      </span>
                      <span className="rounded-xl bg-muted/50 px-3 py-2">
                        Data: <strong className="text-foreground">{formatRefundDate(request)}</strong>
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {request.reason}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:w-52">
                    <button
                      type="button"
                      onClick={() => updateRefundStatus(request.id, "in_review")}
                      disabled={request.status === "in_review"}
                      className="h-10 rounded-xl bg-muted text-xs font-bold text-muted-foreground ring-1 ring-border disabled:opacity-40"
                    >
                      Analisar
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRefundStatus(request.id, "approved")}
                      disabled={request.status === "approved"}
                      className="h-10 rounded-xl bg-emerald-500/10 text-xs font-bold text-emerald-500 ring-1 ring-emerald-500/20 disabled:opacity-40"
                    >
                      Aprovar
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRefundStatus(request.id, "rejected")}
                      disabled={request.status === "rejected"}
                      className="h-10 rounded-xl bg-red-500/10 text-xs font-bold text-red-500 ring-1 ring-red-500/20 disabled:opacity-40"
                    >
                      Recusar
                    </button>
                    <button
                      type="button"
                      onClick={() => updateRefundStatus(request.id, "refunded")}
                      disabled={request.status === "refunded"}
                      className="h-10 rounded-xl bg-sky-500/10 text-xs font-bold text-sky-500 ring-1 ring-sky-500/20 disabled:opacity-40"
                    >
                      Reembolsado
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function PolicyOption({
  active,
  title,
  subtitle,
  tone = "default",
  onClick,
}: {
  active: boolean;
  title: string;
  subtitle?: string;
  tone?: "default" | "warning";
  onClick: () => void;
}) {
  const activeWarning = active && tone === "warning";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[5.25rem] flex-col justify-between rounded-2xl border px-3.5 py-3 text-left transition ${
        active
          ? activeWarning
            ? "border-amber-500/60 bg-amber-500/15 text-foreground"
            : "border-foreground bg-foreground text-background"
          : "border-border hover:bg-muted"
      }`}
    >
      <span className="text-sm font-semibold leading-tight">{title}</span>
      {subtitle && (
        <span
          className={`mt-1 text-[11px] leading-snug ${
            active
              ? activeWarning
                ? "text-amber-700 dark:text-amber-300"
                : "text-background/75"
              : "text-muted-foreground"
          }`}
        >
          {subtitle}
        </span>
      )}
    </button>
  );
}

function PolicyBadge({
  tone,
  label,
}: {
  tone: PolicyTextParts["refundTone"];
  label: string;
}) {
  const palette =
    tone === "warning"
      ? "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300"
      : tone === "muted"
        ? "border-border bg-muted/60 text-foreground/80"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.16em] ${palette}`}
    >
      {tone === "warning" ? (
        <AlertTriangle className="h-3 w-3" />
      ) : tone === "muted" ? (
        <RefreshCcw className="h-3 w-3" />
      ) : (
        <Info className="h-3 w-3" />
      )}
      {label}
    </span>
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
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-border bg-background p-4">
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {parts.rescheduleLabel}
          </p>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">{parts.rescheduleBody}</p>
      </div>
      <div
        className={`rounded-2xl border p-4 ${
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
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">{parts.refundBody}</p>
      </div>
      {customText && (
        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Nota adicional do estúdio
          </p>
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
            {customText}
          </p>
        </div>
      )}
    </div>
  );
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

function refundStatusLabel(status: RefundRequest["status"]) {
  if (status === "in_review") return "Em análise";
  if (status === "approved") return "Aprovado";
  if (status === "rejected") return "Recusado";
  if (status === "refunded") return "Reembolsado";
  return "Pendente";
}

function refundStatusClass(status: RefundRequest["status"]) {
  if (status === "in_review") return "bg-sky-500/10 text-sky-500";
  if (status === "approved") return "bg-emerald-500/10 text-emerald-500";
  if (status === "rejected") return "bg-red-500/10 text-red-500";
  if (status === "refunded") return "bg-violet-500/10 text-violet-500";
  return "bg-amber-500/10 text-amber-500";
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
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(amount || 0);
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
