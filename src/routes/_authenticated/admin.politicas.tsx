import {
  BadgeCheck,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Edit3,
  FileText,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TimerReset,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";

import { updateStudioRefundRequest } from "@/lib/refund-operations.functions";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ExpandableList } from "@/components/ui/expandable-list";

export const Route = createFileRoute("/_authenticated/admin/politicas")({
  component: AdminPoliciesPage,
});

type RefundStatus = StudioRefundRequestListItem["status"];
type RefundView = "pending" | "approved" | "rejected";
type PeriodFilter = "all" | "today" | "7d" | "30d";
type MainTab = "policies" | "refunds";
type PolicyKey = "cancellation" | "reschedule" | "deposit" | "refund" | "late" | "no_show" | "general" | "privacy" | "terms";

const PAGE_SIZE = 8;

type RefundPolicy = "non_refundable" | "reschedule_only" | "refund_allowed";

type StudioCompliancePolicies = {
  id: string;
  payment_policy: "pay_in_studio" | "pre_payment";
  deposit_percent: number;
  cancellation_min_notice_hours: number;
  cancellation_after_deadline_policy: RefundPolicy;
  refund_requests_enabled: boolean;
  cancellation_policy_text: string | null;
  legal_policy_version: string;
  studio_policy_settings: StudioPolicySettings;
  updated_at?: string | null;
};

type StudioPolicySettings = Partial<Record<PolicyKey, PolicySetting>>;

type PolicySetting = {
  active?: boolean;
  text?: string | null;
  notice_hours?: number | null;
  updated_at?: string | null;
};

type StudioRefundRequestListItem = {
  id: string;
  created_at: string;
  status: "pending" | "in_review" | "approved" | "rejected" | "refunded";
  reason: string | null;
  client_name: string | null;
  client_phone: string | null;
  client_email: string | null;
  reviewed_at: string | null;
  resolved_at?: string | null;
  decision_note: string | null;
  deposit_amount_cents?: number | null;
  refund_amount_cents?: number | null;
  service_name?: string | null;
  custom_service_name?: string | null;
  appointment_start_at?: string | null;
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

const statusCopy: Record<RefundStatus, string> = {
  pending: "Pendente",
  in_review: "Pendente",
  approved: "Aprovado",
  rejected: "Recusado",
  refunded: "Aprovado",
};

const policyTitles: Record<PolicyKey, string> = {
  cancellation: "Política de Cancelamento",
  reschedule: "Política de Remarcação",
  deposit: "Política de Sinal",
  refund: "Política de Reembolso",
  late: "Política de Atrasos",
  no_show: "Política de Faltas",
  general: "Regras Gerais",
  privacy: "Política de Privacidade",
  terms: "Termos e Condições",
};

function AdminPoliciesPage() {
  const { studio } = useCurrentStudio();
  const updateRefund = useServerFn(updateStudioRefundRequest);

  const [activeTab, setActiveTab] = useState<MainTab>("policies");
  const [policies, setPolicies] = useState<StudioCompliancePolicies | null>(null);
  const [draft, setDraft] = useState<StudioCompliancePolicies | null>(null);
  const [editingPolicy, setEditingPolicy] = useState<PolicyKey | null>(null);
  const [refunds, setRefunds] = useState<StudioRefundRequestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyRefundId, setBusyRefundId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refundView, setRefundView] = useState<RefundView>("pending");
  const [period, setPeriod] = useState<PeriodFilter>("30d");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!studio) return;

    let alive = true;
    setLoading(true);
    Promise.all([loadPolicy(studio.id), loadRefundList(studio.id)])
      .then(([policyData, refundData]) => {
        if (!alive) return;
        const normalized = normalizePolicy(policyData);
        setPolicies(normalized);
        setDraft(normalized);
        setRefunds(refundData);
      })
      .catch((error) => {
        console.error("Erro ao carregar políticas e reembolsos", error);
        if (alive) toast.error("Não foi possível carregar esta central.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [studio]);

  useEffect(() => {
    setPage(0);
  }, [activeTab, period, query, refundView]);

  const summary = useMemo(() => buildSummary(refunds), [refunds]);
  const policyRows = useMemo(() => (draft ? buildPolicyRows(draft) : []), [draft]);
  const filteredRefunds = useMemo(
    () => filterRefunds(refunds, refundView, period, query),
    [period, query, refundView, refunds],
  );
  const totalPages = Math.max(1, Math.ceil(filteredRefunds.length / PAGE_SIZE));
  const pagedRefunds = filteredRefunds.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  async function refreshRefunds() {
    if (!studio) return;
    const data = await loadRefundList(studio.id);
    setRefunds(data);
  }

  async function savePolicy() {
    if (!studio || !draft) return false;
    setSaving(true);
    try {
      const version = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from("studios")
        .update({
          payment_policy: draft.payment_policy,
          deposit_percent: draft.deposit_percent,
          cancellation_min_notice_hours: draft.cancellation_min_notice_hours,
          cancellation_after_deadline_policy: draft.cancellation_after_deadline_policy,
          refund_requests_enabled: draft.refund_requests_enabled,
          cancellation_policy_text: draft.cancellation_policy_text,
          legal_policy_version: version,
          studio_policy_settings: draft.studio_policy_settings,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", studio.id);
      if (error) throw error;
      const updated = { ...draft, legal_policy_version: version, updated_at: new Date().toISOString() };
      const normalized = normalizePolicy(updated);
      setPolicies(normalized);
      setDraft(normalized);
      toast.success("Política atualizada.");
      return true;
    } catch (error) {
      console.error("Erro ao guardar política", error);
      toast.error("Não foi possível guardar a política.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function discardDraft() {
    setDraft(policies);
    setEditingPolicy(null);
  }

  async function handleRefundAction(refundId: string, action: "approve" | "reject") {
    if (!studio) return;
    setBusyRefundId(refundId);
    try {
      await updateRefund({
        data: {
          studioId: studio.id,
          requestId: refundId,
          status: action === "approve" ? "approved" : "rejected",
        },
      });
      toast.success(action === "approve" ? "Reembolso aprovado e saldo atualizado." : "Pedido recusado e cliente notificado.");
      await refreshRefunds();
    } catch (error) {
      console.error("Erro ao processar reembolso", error);
      toast.error("Não foi possível processar este pedido.");
    } finally {
      setBusyRefundId(null);
    }
  }

  if (loading || !draft) {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <div className="text-sm text-muted-foreground">A carregar a central...</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-3 px-3 pb-24 pt-3 md:px-5 md:pb-4 md:pt-4">
      <div className="flex flex-col gap-3 border-b border-border/60 pb-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            Central do Estúdio
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground md:text-2xl">
            Políticas, reembolsos e conformidade
          </h1>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[640px] xl:min-w-[700px]">
          <Metric label="Pendentes" value={summary.pending} icon={<TimerReset className="h-4 w-4" />} tone="amber" />
          <Metric label="Aprovados" value={summary.approvedThisMonth} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" />
          <Metric label="Recusados" value={summary.rejectedThisMonth} icon={<XCircle className="h-4 w-4" />} tone="rose" />
          <Metric label="Valor reembolsado" value={formatMoney(summary.totalRefundedCents)} icon={<Wallet className="h-4 w-4" />} tone="sky" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-muted p-1">
          <TabButton active={activeTab === "policies"} onClick={() => setActiveTab("policies")}>
            Políticas
          </TabButton>
          <TabButton active={activeTab === "refunds"} onClick={() => setActiveTab("refunds")}>
            Reembolsos
          </TabButton>
        </div>
        <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
          <BadgeCheck className="h-4 w-4 text-emerald-600" />
          Atualização automática entre saldo, histórico e notificações
        </div>
      </div>

      {activeTab === "policies" ? (
        <div className="space-y-3">
          <ManageabilityPolicyPanel
            draft={draft}
            saving={saving}
            onChange={setDraft}
            onSave={savePolicy}
            onDiscard={discardDraft}
          />
        <section className="rounded-xl border border-border/70 bg-card shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Políticas do Estúdio</h2>
              <p className="text-xs text-muted-foreground">Edite cada regra no painel lateral.</p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {policyRows.length} políticas
            </span>
          </div>

          <ExpandableList
            items={policyRows}
            initialCount={5}
            className="divide-y divide-border/60"
            getKey={(policy) => policy.key}
            moreLabel={(hidden) => `Ver mais ${hidden} política${hidden !== 1 ? "s" : ""}`}
            renderItem={(policy) => (
              <PolicyRow policy={policy} onEdit={() => setEditingPolicy(policy.key)} />
            )}
          />
        </section>
        </div>
      ) : (
        <section className="rounded-xl border border-border/70 bg-card shadow-sm">
          <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-3 md:flex-row md:items-center md:justify-between md:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar cliente, serviço ou motivo"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>

            <div className="flex gap-2 overflow-x-auto">
              <CompactSelect value={refundView} onChange={(value) => setRefundView(value as RefundView)}>
                <SelectItem value="pending">Pendentes</SelectItem>
                <SelectItem value="approved">Aprovados</SelectItem>
                <SelectItem value="rejected">Recusados</SelectItem>
              </CompactSelect>
              <CompactSelect value={period} onChange={(value) => setPeriod(value as PeriodFilter)}>
                <SelectItem value="30d">30 dias</SelectItem>
                <SelectItem value="7d">7 dias</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="all">Tudo</SelectItem>
              </CompactSelect>
            </div>
          </div>

          <RefundTable
            refunds={pagedRefunds}
            busyRefundId={busyRefundId}
            onAction={handleRefundAction}
          />

          <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {filteredRefunds.length === 0
                ? "Nenhum pedido encontrado"
                : `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, filteredRefunds.length)} de ${filteredRefunds.length}`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <span className="min-w-14 text-center">Página {page + 1}/{totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
              >
                Seguinte
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </section>
      )}

      {editingPolicy ? (
        <PolicyDrawer
          policyKey={editingPolicy}
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onClose={discardDraft}
          onSave={async () => {
            const ok = await savePolicy();
            if (ok) setEditingPolicy(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ManageabilityPolicyPanel({
  draft,
  saving,
  onChange,
  onSave,
  onDiscard,
}: {
  draft: StudioCompliancePolicies;
  saving: boolean;
  onChange: (policy: StudioCompliancePolicies) => void;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
}) {
  const cancellationHours = Number(draft.cancellation_min_notice_hours ?? 24);
  const rescheduleHours = getRescheduleNoticeHoursFromSettings(draft);

  function updateCancellationHours(hours: number) {
    onChange(
      updatePolicySetting(
        { ...draft, cancellation_min_notice_hours: hours },
        "cancellation",
        { active: true, notice_hours: hours },
      ),
    );
  }

  function updateRescheduleHours(hours: number) {
    onChange(updatePolicySetting(draft, "reschedule", { active: true, notice_hours: hours }));
  }

  return (
    <section className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
              Cancelamentos e Reembolsos
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
              Regras de cancelamento, remarcação e reembolso
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Defina aqui as regras que explicam quando uma cliente pode alterar uma marcação e quando pode pedir reembolso.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
              Repor
            </Button>
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? "A guardar..." : "Guardar regras"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <PolicyRuleCard
          title="Prazo mínimo para cancelar"
          description="Quando este prazo passa, o botão Cancelar fica bloqueado para a cliente."
          value={cancellationHours}
          onChange={updateCancellationHours}
          exampleTitle="Exemplo de cancelamento"
          actionLabel="cancelar"
        />

        <PolicyRuleCard
          title="Prazo mínimo para remarcar"
          description="Quando este prazo passa, o botão Remarcar fica bloqueado para a cliente."
          value={rescheduleHours}
          onChange={updateRescheduleHours}
          exampleTitle="Exemplo de remarcação"
          actionLabel="remarcar"
        />

        <div className="rounded-lg bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Política de reembolso</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Escolha o que acontece quando a cliente cancela dentro do prazo permitido.
              </p>
            </div>
            <RefundPolicySwitch
              checked={draft.refund_requests_enabled}
              onCheckedChange={(checked) =>
                onChange(updatePolicySetting({ ...draft, refund_requests_enabled: checked }, "refund", { active: checked }))
              }
            />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[
              ["refund_allowed", "Permitir pedido de reembolso", "A cliente pode pedir reembolso quando cancelar dentro do prazo."],
              ["reschedule_only", "Apenas remarcação", "O valor fica válido para remarcar, sem pedido de devolução."],
              ["non_refundable", "Sem reembolso", "O pagamento ou sinal não gera pedido de reembolso automático."],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  onChange(
                    updatePolicySetting(
                      { ...draft, cancellation_after_deadline_policy: value as RefundPolicy },
                      "refund",
                      { text: refundPolicyLabel(value as RefundPolicy) },
                    ),
                  )
                }
                className={cn(
                  "min-h-10 rounded-lg border px-3 py-2 text-center text-sm font-semibold transition hover:bg-muted/60",
                  draft.cancellation_after_deadline_policy === value ? "border-foreground bg-foreground text-background" : "border-border bg-card",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-muted/30 p-3">
          <h3 className="text-sm font-semibold text-foreground">Texto visível para clientes</h3>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Este texto aparece na experiência pública para explicar as regras do estúdio em linguagem simples.
          </p>
          <Textarea
            className="mt-3 min-h-28 resize-y"
            value={draft.cancellation_policy_text ?? ""}
            onChange={(event) =>
              onChange({
                ...updatePolicySetting(draft, "cancellation", { text: event.target.value }),
                cancellation_policy_text: event.target.value,
              })
            }
          />
        </div>
      </div>
    </section>
  );
}

function PolicyRuleCard({
  title,
  description,
  value,
  onChange,
  exampleTitle,
  actionLabel,
}: {
  title: string;
  description: string;
  value: number;
  onChange: (hours: number) => void;
  exampleTitle: string;
  actionLabel: "cancelar" | "remarcar";
}) {
  const exampleDeadline = value === 24 ? "02/07 às 16:00" : `${value} horas antes da reserva`;
  return (
    <div className="rounded-lg bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div>
          <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Horas</Label>
          <Input
            className="mt-1.5 h-10 text-base font-semibold"
            type="number"
            min={0}
            value={value}
            onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
          />
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-card px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{exampleTitle}</p>
        <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          <ExampleItem label="Reserva" value="03/07 às 16:00" />
          <ExampleItem label={`Pode ${actionLabel} até`} value={exampleDeadline} />
          <ExampleItem label="Depois disso" value="O botão fica bloqueado" />
        </div>
        <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-800">
          {value} horas significa exatamente {value} horas antes do horário da reserva, e não apenas no dia anterior.
        </div>
        <div className="hidden">
          Outro exemplo: reserva em 10/08 às 09:00. Último momento para {actionLabel}: 09/08 às 09:00 quando o prazo é 24 horas.
        </div>
      </div>
    </div>
  );
}

function ExampleItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-background px-2.5 py-2">
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  tone: "amber" | "emerald" | "rose" | "sky";
}) {
  const toneClass = {
    amber: "text-amber-700 bg-amber-50",
    emerald: "text-emerald-700 bg-emerald-50",
    rose: "text-rose-700 bg-rose-50",
    sky: "text-sky-700 bg-sky-50",
  }[tone];

  return (
    <div className="flex min-h-14 items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", toneClass)}>{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className="truncate text-base font-semibold text-foreground">{value}</div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 rounded-md px-4 text-sm font-medium transition",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PolicyRow({
  policy,
  onEdit,
}: {
  policy: ReturnType<typeof buildPolicyRows>[number];
  onEdit: () => void;
}) {
  return (
    <div className="grid min-h-14 grid-cols-[1fr_auto] items-center gap-3 px-4 py-2 transition hover:bg-muted/35 md:grid-cols-[minmax(260px,1fr)_140px_150px_92px]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {policy.icon}
        </span>
        <span className="truncate text-sm font-medium text-foreground">{policy.title}</span>
      </div>

      <div className="hidden md:block">
        <StatusBadge active={policy.active} />
      </div>

      <div className="hidden text-sm text-muted-foreground md:block">{policy.updatedAt}</div>

      <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5" onClick={onEdit}>
        <Edit3 className="h-3.5 w-3.5" />
        Editar
      </Button>

      <div className="col-span-2 flex items-center justify-between text-xs text-muted-foreground md:hidden">
        <StatusBadge active={policy.active} />
        <span>{policy.updatedAt}</span>
      </div>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        active ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
      )}
    >
      {active ? "Ativa" : "Inativa"}
    </span>
  );
}

function PolicyDrawer({
  policyKey,
  draft,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  policyKey: PolicyKey;
  draft: StudioCompliancePolicies;
  saving: boolean;
  onChange: (policy: StudioCompliancePolicies) => void;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Editar política</div>
            <h2 className="truncate text-lg font-semibold text-foreground">{policyTitles[policyKey]}</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <PolicyEditor policyKey={policyKey} draft={draft} onChange={onChange} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "A guardar..." : "Guardar"}
          </Button>
        </div>
      </aside>
    </div>
  );
}

function PolicyEditor({
  policyKey,
  draft,
  onChange,
}: {
  policyKey: PolicyKey;
  draft: StudioCompliancePolicies;
  onChange: (policy: StudioCompliancePolicies) => void;
}) {
  const setting = draft.studio_policy_settings[policyKey] ?? {};
  const setSetting = (patch: Partial<PolicySetting>) => onChange(updatePolicySetting(draft, policyKey, patch));

  if (policyKey === "cancellation") {
    return (
      <>
        <Field label="Estado">
          <ToggleRow
            checked={Boolean(setting.active)}
            onCheckedChange={(checked) => setSetting({ active: checked })}
            text="Política ativa"
          />
        </Field>
        <Field label="Aviso mínimo">
          <Input
            type="number"
            min={0}
            value={draft.cancellation_min_notice_hours}
            onChange={(event) => {
              const hours = Math.max(0, Number(event.target.value) || 0);
              onChange(updatePolicySetting({ ...draft, cancellation_min_notice_hours: hours }, "cancellation", { notice_hours: hours }));
            }}
          />
        </Field>
        <Field label="Texto visível para clientes">
          <Textarea
            rows={7}
            value={draft.cancellation_policy_text ?? setting.text ?? ""}
            onChange={(event) =>
              onChange({
                ...updatePolicySetting(draft, "cancellation", { text: event.target.value }),
                cancellation_policy_text: event.target.value,
              })
            }
          />
        </Field>
      </>
    );
  }

  if (policyKey === "refund") {
    return (
      <>
        <Field label="Estado">
          <ToggleRow
            checked={draft.refund_requests_enabled}
            onCheckedChange={(checked) =>
              onChange(updatePolicySetting({ ...draft, refund_requests_enabled: checked }, "refund", { active: checked }))
            }
            text="Pedidos de reembolso ativos"
          />
        </Field>
        <Field label="Regra de reembolso">
          <div className="grid gap-2">
            {[
              ["refund_allowed", "Reembolso permitido"],
              ["reschedule_only", "Apenas reagendamento"],
              ["non_refundable", "Sem reembolso"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() =>
                  onChange(
                    updatePolicySetting(
                      { ...draft, cancellation_after_deadline_policy: value as RefundPolicy },
                      "refund",
                      { text: refundPolicyLabel(value as RefundPolicy) },
                    ),
                  )
                }
                className={cn(
                  "rounded-lg border px-3 py-2 text-left text-sm transition hover:bg-muted/60",
                  draft.cancellation_after_deadline_policy === value ? "border-foreground bg-foreground text-background" : "border-border bg-background",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      </>
    );
  }

  if (policyKey === "reschedule") {
    return (
      <>
        <Field label="Estado">
          <ToggleRow
            checked={Boolean(setting.active)}
            onCheckedChange={(checked) => setSetting({ active: checked })}
            text="Remarcação pela cliente ativa"
          />
        </Field>
        <Field label="Prazo mínimo para remarcar">
          <Input
            type="number"
            min={0}
            value={getRescheduleNoticeHoursFromSettings(draft)}
            onChange={(event) => setSetting({ notice_hours: Math.max(0, Number(event.target.value) || 0) })}
          />
        </Field>
        <Field label="Resumo">
          <Textarea
            rows={5}
            value={setting.text ?? ""}
            onChange={(event) => setSetting({ text: event.target.value })}
          />
        </Field>
      </>
    );
  }

  if (policyKey === "deposit") {
    return (
      <>
        <Field label="Estado">
          <ToggleRow
            checked={draft.payment_policy === "pre_payment"}
            onCheckedChange={(checked) =>
              onChange(
                updatePolicySetting(
                  { ...draft, payment_policy: checked ? "pre_payment" : "pay_in_studio" },
                  "deposit",
                  { active: checked },
                ),
              )
            }
            text="Exigir sinal online"
          />
        </Field>
        <Field label="Valor do sinal">
          <Input
            type="number"
            min={1}
            max={100}
            value={draft.deposit_percent}
            onChange={(event) => {
              const depositPercent = Math.min(100, Math.max(1, Number(event.target.value) || 1));
              onChange(
                updatePolicySetting(
                  { ...draft, deposit_percent: depositPercent },
                  "deposit",
                  { text: `Sinal de ${depositPercent}% para confirmar reservas online.` },
                ),
              );
            }}
          />
        </Field>
        <Field label="Resumo">
          <Textarea
            rows={5}
            value={setting.text ?? ""}
            onChange={(event) => setSetting({ text: event.target.value })}
          />
        </Field>
      </>
    );
  }

  return (
    <>
      <Field label="Estado">
        <ToggleRow
          checked={Boolean(setting.active)}
          onCheckedChange={(checked) => setSetting({ active: checked })}
          text="Política ativa"
        />
      </Field>
      <Field label="Resumo operacional">
        <Textarea
          rows={7}
          value={setting.text ?? ""}
          onChange={(event) => setSetting({ text: event.target.value })}
        />
      </Field>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function RefundPolicySwitch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-1">
      <span
        className={cn(
          "text-xs font-semibold leading-none transition-colors",
          checked ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {checked ? "Política ativa" : "Política inativa"}
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={checked ? "Desativar política de reembolso" : "Ativar política de reembolso"}
        className="relative h-6 w-11 border-0 bg-muted shadow-none after:absolute after:-inset-2.5 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted-foreground/30 [&>span]:h-5 [&>span]:w-5 [&>span]:bg-background [&>span]:shadow-sm [&>span]:data-[state=checked]:translate-x-5"
      />
    </div>
  );
}

function ToggleRow({
  checked,
  text,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  text: string;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange?.(value === true)} />
      {text}
    </label>
  );
}

function CompactSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-[132px] shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

function RefundTable({
  refunds,
  busyRefundId,
  onAction,
}: {
  refunds: StudioRefundRequestListItem[];
  busyRefundId: string | null;
  onAction: (refundId: string, action: "approve" | "reject") => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = 5;
  const hasMore = refunds.length > limit;
  const visibleRefunds = expanded || !hasMore ? refunds : refunds.slice(0, limit);

  if (refunds.length === 0) {
    return (
      <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
        <SlidersHorizontal className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Nenhum pedido nesta seleção</p>
        <p className="text-xs text-muted-foreground">A pesquisa e os filtros ajudam a localizar rapidamente.</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed">
          <thead className="bg-muted/40 text-left text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Cliente</th>
              <th className="px-4 py-2">Serviço</th>
              <th className="w-28 px-4 py-2">Valor</th>
              <th className="w-32 px-4 py-2">Data</th>
              <th className="w-28 px-4 py-2">Estado</th>
              <th className="w-44 px-4 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {visibleRefunds.map((refund) => (
              <RefundTableRow key={refund.id} refund={refund} busy={busyRefundId === refund.id} onAction={onAction} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-border/60 md:hidden">
        {visibleRefunds.map((refund) => (
          <RefundMobileRow key={refund.id} refund={refund} busy={busyRefundId === refund.id} onAction={onAction} />
        ))}
      </div>

      {hasMore && (
        <div className="px-3 pb-3 pt-2 sm:px-4">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mx-auto flex min-h-10 w-full max-w-sm items-center justify-center rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs font-semibold text-muted-foreground shadow-sm transition hover:border-foreground/15 hover:bg-muted hover:text-foreground active:scale-[0.99]"
          >
            {expanded ? "Ver menos" : `Ver mais ${refunds.length - limit} pedido${refunds.length - limit !== 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </>
  );
}

function RefundTableRow({
  refund,
  busy,
  onAction,
}: {
  refund: StudioRefundRequestListItem;
  busy: boolean;
  onAction: (refundId: string, action: "approve" | "reject") => Promise<void>;
}) {
  const canProcess = refund.status === "pending" || refund.status === "in_review";

  return (
    <tr className="h-14 transition hover:bg-muted/30">
      <td className="min-w-0 px-4 py-2">
        <div className="truncate text-sm font-medium text-foreground">{refund.client_name || "Cliente"}</div>
        <div className="truncate text-xs text-muted-foreground">{refund.reason || "Pedido de reembolso"}</div>
      </td>
      <td className="truncate px-4 py-2 text-sm text-foreground">{serviceLabel(refund)}</td>
      <td className="px-4 py-2 text-sm font-semibold text-foreground">{formatMoney(refundAmountCents(refund))}</td>
      <td className="px-4 py-2 text-sm text-muted-foreground">{formatBookingDate(refundDate(refund))}</td>
      <td className="px-4 py-2">
        <RefundStatusBadge status={refund.status} />
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-2">
          {canProcess ? (
            <>
              <Button size="sm" className="h-8 px-2.5" disabled={busy} onClick={() => onAction(refund.id, "approve")}>
                Aprovar
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-2.5" disabled={busy} onClick={() => onAction(refund.id, "reject")}>
                Recusar
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Finalizado</span>
          )}
        </div>
      </td>
    </tr>
  );
}

function RefundMobileRow({
  refund,
  busy,
  onAction,
}: {
  refund: StudioRefundRequestListItem;
  busy: boolean;
  onAction: (refundId: string, action: "approve" | "reject") => Promise<void>;
}) {
  const canProcess = refund.status === "pending" || refund.status === "in_review";

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{refund.client_name || "Cliente"}</div>
          <div className="truncate text-xs text-muted-foreground">{serviceLabel(refund)} · {formatBookingDate(refundDate(refund))}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-foreground">{formatMoney(refundAmountCents(refund))}</div>
          <RefundStatusBadge status={refund.status} />
        </div>
      </div>

      {canProcess ? (
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" className="h-8" disabled={busy} onClick={() => onAction(refund.id, "approve")}>
            Aprovar
          </Button>
          <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={() => onAction(refund.id, "reject")}>
            Recusar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const view = status === "approved" || status === "refunded" ? "approved" : status === "rejected" ? "rejected" : "pending";
  const classes = {
    pending: "bg-amber-50 text-amber-700",
    approved: "bg-emerald-50 text-emerald-700",
    rejected: "bg-rose-50 text-rose-700",
  }[view];

  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", classes)}>{statusCopy[status]}</span>;
}

async function loadPolicy(studioId: string): Promise<StudioCompliancePolicies> {
  const { data, error } = await supabase
    .from("studios")
    .select(
      "id,payment_policy,deposit_percent,cancellation_min_notice_hours,cancellation_after_deadline_policy,refund_requests_enabled,cancellation_policy_text,legal_policy_version,studio_policy_settings,updated_at",
    )
    .eq("id", studioId)
    .maybeSingle();
  if (error || !data) throw error ?? new Error("studio_policy_not_found");
  return data as unknown as StudioCompliancePolicies;
}

async function loadRefundList(studioId: string): Promise<StudioRefundRequestListItem[]> {
  const { data, error } = await (supabase as any)
    .from("refund_requests")
    .select(
      "id,created_at,status,reason,client_name,client_phone,client_email,decision_note,reviewed_at,payment_intents(amount_cents,status,stripe_checkout_session_id),appointments(starts_at,total_price,appointment_services(services(name)))",
    )
    .eq("studio_id", studioId)
    .order("created_at", { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data ?? []) as StudioRefundRequestListItem[];
}

function normalizePolicy(policy: StudioCompliancePolicies): StudioCompliancePolicies {
  const settings = normalizePolicySettings(policy.studio_policy_settings, policy);
  return {
    ...policy,
    payment_policy: policy.payment_policy === "pre_payment" ? "pre_payment" : "pay_in_studio",
    deposit_percent: Number(policy.deposit_percent ?? 30),
    cancellation_policy_text:
      policy.cancellation_policy_text ||
      "O sinal garante a reserva. Cancelamentos fora do prazo podem não ser elegíveis para reembolso.",
    cancellation_min_notice_hours: policy.cancellation_min_notice_hours ?? 24,
    cancellation_after_deadline_policy: policy.cancellation_after_deadline_policy ?? "non_refundable",
    refund_requests_enabled: policy.refund_requests_enabled ?? false,
    studio_policy_settings: settings,
  };
}

function getRescheduleNoticeHoursFromSettings(policy: StudioCompliancePolicies) {
  const raw = Number(policy.studio_policy_settings?.reschedule?.notice_hours);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return Number(policy.cancellation_min_notice_hours ?? 24);
}

function buildPolicyRows(policy: StudioCompliancePolicies) {
  const settings = policy.studio_policy_settings ?? {};
  const row = (key: PolicyKey, icon: ReactNode, active: boolean) => ({
    key,
    title: policyTitles[key],
    active,
    updatedAt: formatDate(settings[key]?.updated_at || policy.updated_at),
    icon,
  });
  return [
    row("deposit", <CircleDollarSign className="h-4 w-4" />, policy.payment_policy === "pre_payment"),
    row("late", <TimerReset className="h-4 w-4" />, Boolean(settings.late?.active)),
    row("no_show", <Ban className="h-4 w-4" />, Boolean(settings.no_show?.active)),
    row("general", <FileText className="h-4 w-4" />, Boolean(settings.general?.active)),
    row("privacy", <ShieldCheck className="h-4 w-4" />, Boolean(settings.privacy?.active)),
    row("terms", <FileText className="h-4 w-4" />, Boolean(settings.terms?.active)),
  ];
}

function normalizePolicySettings(value: unknown, policy: StudioCompliancePolicies): StudioPolicySettings {
  const raw = isPolicySettings(value) ? value : {};
  const now = policy.updated_at ?? null;
  return {
    cancellation: {
      active: raw.cancellation?.active ?? true,
      text: raw.cancellation?.text ?? policy.cancellation_policy_text,
      notice_hours: raw.cancellation?.notice_hours ?? Number(policy.cancellation_min_notice_hours ?? 24),
      updated_at: raw.cancellation?.updated_at ?? now,
    },
    reschedule: {
      active: raw.reschedule?.active ?? true,
      text: raw.reschedule?.text ?? `Clientes podem remarcar até ${Number(policy.cancellation_min_notice_hours ?? 24)} horas antes da reserva.`,
      notice_hours: raw.reschedule?.notice_hours ?? Number(policy.cancellation_min_notice_hours ?? 24),
      updated_at: raw.reschedule?.updated_at ?? now,
    },
    deposit: {
      active: policy.payment_policy === "pre_payment",
      text: raw.deposit?.text ?? `Sinal de ${Number(policy.deposit_percent ?? 30)}% para confirmar reservas online.`,
      updated_at: raw.deposit?.updated_at ?? now,
    },
    refund: {
      active: Boolean(policy.refund_requests_enabled),
      text: raw.refund?.text ?? refundPolicyLabel(policy.cancellation_after_deadline_policy),
      updated_at: raw.refund?.updated_at ?? now,
    },
    late: {
      active: raw.late?.active ?? false,
      text: raw.late?.text ?? "Atrasos podem reduzir a duração do serviço para não prejudicar reservas seguintes.",
      updated_at: raw.late?.updated_at ?? now,
    },
    no_show: {
      active: raw.no_show?.active ?? false,
      text: raw.no_show?.text ?? "Faltas sem aviso podem limitar futuras reservas online.",
      updated_at: raw.no_show?.updated_at ?? now,
    },
    general: {
      active: raw.general?.active ?? true,
      text: raw.general?.text ?? "As regras gerais ajudam a manter reservas claras, pontuais e confirmadas.",
      updated_at: raw.general?.updated_at ?? now,
    },
    privacy: {
      active: raw.privacy?.active ?? true,
      text: raw.privacy?.text ?? "Os dados dos clientes são utilizados apenas para marcações, comunicação e gestão do serviço.",
      updated_at: raw.privacy?.updated_at ?? now,
    },
    terms: {
      active: raw.terms?.active ?? true,
      text: raw.terms?.text ?? "Ao marcar, o cliente aceita as condições do estúdio apresentadas no fluxo de reserva.",
      updated_at: raw.terms?.updated_at ?? now,
    },
  };
}

function isPolicySettings(value: unknown): value is StudioPolicySettings {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function updatePolicySetting(
  draft: StudioCompliancePolicies,
  key: PolicyKey,
  patch: Partial<PolicySetting>,
): StudioCompliancePolicies {
  const current = draft.studio_policy_settings[key] ?? {};
  return {
    ...draft,
    studio_policy_settings: {
      ...draft.studio_policy_settings,
      [key]: {
        ...current,
        ...patch,
        updated_at: new Date().toISOString(),
      },
    },
  };
}

function refundPolicyLabel(value: RefundPolicy) {
  if (value === "refund_allowed") return "Reembolso permitido dentro das regras do estúdio.";
  if (value === "reschedule_only") return "Cancelamentos fora do prazo permitem apenas reagendamento.";
  return "O sinal não é reembolsável após o prazo definido.";
}

function buildSummary(refunds: StudioRefundRequestListItem[]) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  return refunds.reduce(
    (summary, refund) => {
      const decidedAt = refund.resolved_at || refund.reviewed_at ? new Date(refund.resolved_at || refund.reviewed_at || "") : null;
      if (refund.status === "pending" || refund.status === "in_review") summary.pending += 1;
      if ((refund.status === "approved" || refund.status === "refunded") && decidedAt && decidedAt >= startOfMonth) {
        summary.approvedThisMonth += 1;
      }
      if (refund.status === "rejected" && decidedAt && decidedAt >= startOfMonth) summary.rejectedThisMonth += 1;
      if (refund.status === "approved" || refund.status === "refunded") {
        summary.totalRefundedCents += refundAmountCents(refund);
      }
      return summary;
    },
    { pending: 0, approvedThisMonth: 0, rejectedThisMonth: 0, totalRefundedCents: 0 },
  );
}

function filterRefunds(
  refunds: StudioRefundRequestListItem[],
  view: RefundView,
  period: PeriodFilter,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  const cutoff = periodCutoff(period);

  return refunds.filter((refund) => {
    const statusGroup =
      refund.status === "approved" || refund.status === "refunded"
        ? "approved"
        : refund.status === "rejected"
          ? "rejected"
          : "pending";
    if (statusGroup !== view) return false;

    const createdAt = refund.created_at ? new Date(refund.created_at) : null;
    if (cutoff && createdAt && createdAt < cutoff) return false;

    if (!normalizedQuery) return true;
    const haystack = [
      refund.client_name,
      refund.client_email,
      refund.service_name,
      refund.custom_service_name,
      refund.reason,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function periodCutoff(period: PeriodFilter) {
  if (period === "all") return null;
  const date = new Date();
  if (period === "today") date.setHours(0, 0, 0, 0);
  if (period === "7d") date.setDate(date.getDate() - 7);
  if (period === "30d") date.setDate(date.getDate() - 30);
  return date;
}

function refundAmountCents(refund: StudioRefundRequestListItem) {
  return refund.refund_amount_cents || refund.deposit_amount_cents || refund.payment_intents?.amount_cents || 0;
}

function serviceLabel(refund: StudioRefundRequestListItem) {
  if (refund.service_name || refund.custom_service_name) return refund.service_name || refund.custom_service_name || "Serviço";
  const names = refund.appointments?.appointment_services
    ?.map((line) => line.services?.name)
    .filter(Boolean);
  return names?.length ? names.join(", ") : "Serviço";
}

function refundDate(refund: StudioRefundRequestListItem) {
  return refund.appointment_start_at || refund.appointments?.starts_at || refund.created_at;
}

function formatDate(value?: string | null) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatBookingDate(value?: string | null) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short" }).format(new Date(value));
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}
