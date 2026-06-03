import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BadgePercent,
  CreditCard,
  FileText,
  RefreshCw,
  Scissors,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  createPlatformBillingPortalSession,
  createPlatformCheckoutSession,
  getPlatformSubscriptionSummary,
  syncPlatformCheckoutReturn,
} from "@/lib/subscriptions.functions";
import { computeAttendanceRevenue, computeFinancialSplit, formatEUR } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/_authenticated/admin/pagamentos")({
  head: () => ({ meta: [{ title: "Financeiro - Painel" }] }),
  component: PaymentsPage,
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

type ServiceOption = {
  id: string;
  name: string;
  price: number;
  duration_min: number;
  commission_percent: number | null;
};

type StaffOption = {
  id: string;
  name: string;
  commission_percent: number | null;
};

type ClientOption = {
  id: string;
  name: string;
  phone: string;
};

type OnlineAppointment = {
  id: string;
  total_price: number;
  staff_id: string;
  starts_at: string;
  status: string;
};

type PaidRow = {
  appointment_id: string | null;
  amount_cents: number;
  status: string;
};

type ManualEntry = {
  id: string;
  service_id: string;
  staff_id: string;
  client_id: string | null;
  performed_at: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  source: "manual" | "walk_in";
  services?: { name: string } | null;
  staff?: { name: string } | null;
  clients?: { name: string; phone: string } | null;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Dinheiro" },
  { value: "mb_way", label: "MB Way" },
  { value: "multibanco", label: "Multibanco" },
  { value: "card", label: "Cartão" },
  { value: "bank_transfer", label: "Transferência" },
  { value: "other", label: "Outro" },
];

const controlClass =
  "box-border h-12 w-full min-w-0 max-w-full rounded-2xl border border-border bg-background/85 px-4 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground/55 hover:bg-background focus:border-foreground/30 focus:ring-2 focus:ring-ring/15";
const selectTriggerClass =
  "box-border h-12 w-full min-w-0 max-w-full rounded-2xl border-border bg-background/85 px-4 pr-3 text-sm shadow-sm transition hover:bg-background focus:ring-2 focus:ring-ring/15 [&>svg]:ml-3 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-60";
const compactSelectTriggerClass =
  "box-border h-11 w-full min-w-0 max-w-full rounded-2xl border-border bg-card/90 px-4 pr-3 text-sm shadow-sm transition hover:bg-background focus:ring-2 focus:ring-ring/15 [&>svg]:ml-3 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-60";
const filterTriggerClass =
  "flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-full border-border bg-background/90 px-4 pr-3 text-xs font-medium shadow-sm transition hover:border-emerald-700/25 hover:bg-emerald-950/5 focus:ring-2 focus:ring-emerald-600/15 data-[state=open]:border-emerald-700/30 data-[state=open]:bg-emerald-950/5 [&>svg]:ml-1 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0 [&>svg]:opacity-60";
const selectContentClass =
  "rounded-3xl border-border/80 bg-popover/98 p-2 shadow-xl shadow-foreground/5";
const selectItemClass =
  "rounded-2xl px-3 py-2.5 text-sm transition-colors focus:bg-emerald-950/10 focus:text-foreground data-[state=checked]:bg-emerald-950/10 data-[state=checked]:text-foreground";

type BillingSummary = {
  available: boolean;
  plan: string;
  status: string;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  premiumActive: boolean;
  invoices: {
    id: string;
    number: string | null;
    status: string | null;
    amountPaid: number;
    amountDue: number;
    currency: string;
    hostedInvoiceUrl: string | null;
    createdAt: string | null;
  }[];
};

function PaymentsPage() {
  const loadBilling = useServerFn(getPlatformSubscriptionSummary);
  const startCheckout = useServerFn(createPlatformCheckoutSession);
  const openPortal = useServerFn(createPlatformBillingPortalSession);
  const syncCheckoutReturn = useServerFn(syncPlatformCheckoutReturn);
  const navigate = useNavigate();
  const [studio, setStudio] = useState<StudioRow | null>(null);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [onlineAppointments, setOnlineAppointments] = useState<OnlineAppointment[]>([]);
  const [onlinePayments, setOnlinePayments] = useState<PaidRow[]>([]);
  const [manualEntries, setManualEntries] = useState<ManualEntry[]>([]);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [checkoutReturnSynced, setCheckoutReturnSynced] = useState(false);
  const [manualFilters, setManualFilters] = useState({
    staffId: "all",
    paymentMethod: "all",
    type: "all",
    date: "",
  });

  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("studio_id").limit(1);
      const studioId = (roles?.[0] as { studio_id: string } | undefined)?.studio_id;
      if (!studioId) return;
      const result = await loadPaymentSettings(studioId);
      if (result.studio) {
        setStudio(result.studio);
        void refreshBilling(result.studio.id);
        void refreshFinancialData(result.studio.id);
      }
      setServiceOptions(result.serviceOptions);
      setStaffOptions(result.staffOptions);
    })();
  }, []);

  useEffect(() => {
    if (!studio?.id || checkoutReturnSynced) return;
    const params = new URLSearchParams(window.location.search);
    const billingResult = params.get("billing");
    const sessionId = params.get("session_id");
    if (billingResult !== "success" || !sessionId) return;

    setCheckoutReturnSynced(true);
    setBillingLoading(true);
    (async () => {
      try {
        await syncCheckoutReturn({ data: { studioId: studio.id, sessionId } });
        await refreshBilling(studio.id);
        toast.success("Assinatura sincronizada com sucesso.");
      } catch (error) {
        console.error("checkout_return_sync_failed", error);
        toast.info("Pagamento recebido. A assinatura pode demorar alguns instantes a sincronizar.");
        await refreshBilling(studio.id);
      } finally {
        setBillingLoading(false);
        navigate({ to: "/admin/pagamentos", replace: true });
      }
    })();
  }, [checkoutReturnSynced, navigate, studio?.id, syncCheckoutReturn]);

  async function refreshBilling(studioId: string) {
    setBillingLoading(true);
    try {
      const summary = (await loadBilling({ data: { studioId } })) as BillingSummary;
      setBilling(summary);
    } catch {
      setBilling({
        available: false,
        plan: "trial",
        status: "trialing",
        nextBillingAt: null,
        cancelAtPeriodEnd: false,
        premiumActive: true,
        invoices: [],
      });
    } finally {
      setBillingLoading(false);
    }
  }

  async function refreshFinancialData(studioId: string) {
    const db = supabase as any;
    const [appointmentsResult, paymentsResult, manualResult] = await Promise.all([
      supabase
        .from("appointments")
        .select("id,total_price,staff_id,starts_at,status")
        .eq("studio_id", studioId)
        .order("starts_at", { ascending: false }),
      supabase
        .from("payment_intents")
        .select("appointment_id,amount_cents,status")
        .eq("studio_id", studioId),
      db
        .from("manual_service_entries")
        .select(
          "id,service_id,staff_id,client_id,performed_at,amount,payment_method,notes,source,services(name),staff(name),clients(name,phone)",
        )
        .eq("studio_id", studioId)
        .order("performed_at", { ascending: false }),
    ]);

    if (!appointmentsResult.error) {
      setOnlineAppointments((appointmentsResult.data ?? []) as OnlineAppointment[]);
    }
    if (!paymentsResult.error) {
      setOnlinePayments((paymentsResult.data ?? []) as PaidRow[]);
    }
    if (!manualResult.error) {
      setManualEntries((manualResult.data ?? []) as ManualEntry[]);
    }
  }

  async function openBilling(action: "checkout" | "portal") {
    if (!studio) return;
    setBillingLoading(true);
    try {
      const result =
        action === "checkout"
          ? await startCheckout({ data: { studioId: studio.id } })
          : await openPortal({ data: { studioId: studio.id } });
      const url = (result as { url?: string | null }).url;
      if (!url) throw new Error("billing_url_missing");
      window.location.href = url;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível abrir a gestão da assinatura.",
      );
      setBillingLoading(false);
    }
  }

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

  const example = useMemo(() => {
    if (!studio) return null;
    return computeFinancialSplit(100, studio.commission_percent, {
      depositPercent: studio.deposit_percent,
      requiresDeposit: studio.payment_policy === "pre_payment",
    });
  }, [studio]);

  if (!studio || !example) return <p className="text-sm text-muted-foreground">A carregar...</p>;

  const requirePayment = studio.payment_policy === "pre_payment";
  const onlinePaidByAppointment = new Map<string, number>();
  for (const payment of onlinePayments) {
    if (!payment.appointment_id || payment.status !== "succeeded") continue;
    onlinePaidByAppointment.set(
      payment.appointment_id,
      (onlinePaidByAppointment.get(payment.appointment_id) ?? 0) +
        Number(payment.amount_cents || 0) / 100,
    );
  }
  const activeOnlineAppointments = onlineAppointments.filter((appointment) => {
    if (appointment.status === "cancelled" || appointment.status === "pending_payment") return false;
    if (appointment.status === "no_show") return (onlinePaidByAppointment.get(appointment.id) ?? 0) > 0;
    return true;
  });
  const onlineServiceRevenue = activeOnlineAppointments.reduce(
    (sum, appointment) =>
      sum +
      computeAttendanceRevenue(
        appointment.total_price,
        onlinePaidByAppointment.get(appointment.id) ?? 0,
        appointment.status,
      ).confirmed,
    0,
  );
  const onlinePaidBalance = Array.from(onlinePaidByAppointment.values()).reduce(
    (sum, value) => sum + value,
    0,
  );
  const pendingStudioRevenue = activeOnlineAppointments.reduce((sum, appointment) => {
    return (
      sum +
      computeAttendanceRevenue(
        appointment.total_price,
        onlinePaidByAppointment.get(appointment.id) ?? 0,
        appointment.status,
      ).predicted
    );
  }, 0);
  const manualRevenue = manualEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const totalRevenue = onlineServiceRevenue + manualRevenue;
  const filteredManualEntries = manualEntries.filter((entry) => {
    if (manualFilters.staffId !== "all" && entry.staff_id !== manualFilters.staffId) return false;
    if (
      manualFilters.paymentMethod !== "all" &&
      entry.payment_method !== manualFilters.paymentMethod
    ) {
      return false;
    }
    if (manualFilters.type !== "all" && entry.source !== manualFilters.type) return false;
    if (manualFilters.date && entry.performed_at.slice(0, 10) !== manualFilters.date) return false;
    return true;
  });
  const filteredOnlineAppointments = activeOnlineAppointments.filter((appointment) => {
    if (manualFilters.staffId !== "all" && appointment.staff_id !== manualFilters.staffId) {
      return false;
    }
    if (manualFilters.date && appointment.starts_at.slice(0, 10) !== manualFilters.date) {
      return false;
    }
    return true;
  });
  const revenueByStaff = staffOptions
    .map((member) => {
      const online = filteredOnlineAppointments
        .filter((appointment) => appointment.staff_id === member.id)
        .reduce(
          (sum, appointment) =>
            sum +
            computeAttendanceRevenue(
              appointment.total_price,
              onlinePaidByAppointment.get(appointment.id) ?? 0,
              appointment.status,
            ).confirmed,
          0,
        );
      const manual = filteredManualEntries
        .filter((entry) => entry.staff_id === member.id)
        .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      return { ...member, online, manual, total: online + manual };
    })
    .filter((member) => member.total > 0);
  return (
    <div className="space-y-4">
      <header className="overflow-hidden rounded-3xl border border-emerald-700/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.14),rgba(255,255,255,0.02)_42%,rgba(16,185,129,0.06))] p-4 shadow-sm md:p-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-400">
              Financeiro premium
            </p>
            <h1 className="mt-2 text-2xl font-light tracking-tight md:text-3xl">
              Gestão financeira do estúdio
            </h1>
            <p className="mt-2 hidden max-w-2xl text-sm leading-relaxed text-muted-foreground md:block">
              O saldo levantável mostra apenas sinais pagos online. Pagamentos presenciais ficam
              registados como receita do estúdio, mas não entram no levantamento.
            </p>
          </div>
          <div className="rounded-3xl border border-emerald-700/20 bg-background/70 p-3 shadow-sm">
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Saldo levantável
            </p>
            <MoneyValue value={formatEUR(onlinePaidBalance)} className="mt-1 text-3xl" />
            <p className="mt-1 text-[11px] text-muted-foreground">Apenas sinais pagos online</p>
          </div>
        </div>
      </header>

      <section className="hidden items-stretch gap-3 md:grid md:grid-cols-3">
        <Metric
          icon={<CreditCard className="h-4 w-4" />}
          label="Sinal online"
          value={requirePayment ? `${studio.deposit_percent}%` : "Inativo"}
        />
        <Metric
          icon={<BadgePercent className="h-4 w-4" />}
          label="Parte do estúdio"
          value={`${studio.commission_percent}%`}
        />
        <Metric
          icon={<UserRound className="h-4 w-4" />}
          label="Parte da equipa"
          value={`${100 - studio.commission_percent}%`}
        />
      </section>

      <section className="grid items-stretch gap-3 md:grid-cols-3">
        <RevenueCard
          label="Valor previsto"
          value={pendingStudioRevenue}
          note="Restante online ainda não confirmado."
        />
        <div className="hidden h-full md:block">
          <RevenueCard
            label="Atendimentos presenciais"
            value={manualRevenue}
            note="Pago diretamente no estúdio."
          />
        </div>
        <RevenueCard
          label="Receita confirmada"
          value={totalRevenue}
          note="Sinal online + comparecimentos + presencial."
        />
      </section>

      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="border-b border-border/70 px-4 py-4 md:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="grid size-8 place-items-center rounded-2xl bg-muted text-foreground">
                <UserRound className="h-4 w-4" />
              </span>
              <div>
                <span className="block text-[10px] uppercase tracking-[0.2em]">
                  Receita por profissional
                </span>
              </div>
            </div>
            <FinancialFilterBar
              filters={manualFilters}
              staffOptions={staffOptions}
              onChange={setManualFilters}
            />
          </div>
        </div>

        <div className="p-4 md:p-5">
          <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-background/45">
            {revenueByStaff.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Ainda não há receita registada por profissional.
              </p>
            )}
            {revenueByStaff.map((member) => (
              <div
                key={member.id}
                className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Online {formatEUR(member.online)} · Presencial {formatEUR(member.manual)}
                  </p>
                </div>
                <MoneyValue value={formatEUR(member.total)} className="text-xl" />
              </div>
            ))}
          </div>
        </div>

        <div className="hidden md:block">
          <ManualEntriesTable entries={filteredManualEntries} />
        </div>
      </section>

      <FinanceGroupLabel title="Financeiro" />

      <div className="md:hidden">
        <AccordionSection
          value="manual-history"
          title="Histórico de lançamentos"
          description="Atendimentos presenciais."
        >
          <ManualEntriesTable entries={filteredManualEntries} />
        </AccordionSection>
      </div>

      <AccordionSection
        value="billing-platform"
        title="Plano e assinatura"
        description="Plano, faturas e pagamento."
      >
        <BillingSection
          billing={billing}
          loading={billingLoading}
          onCheckout={() => openBilling("checkout")}
          onPortal={() => openBilling("portal")}
          onRefresh={() => refreshBilling(studio.id)}
        />
      </AccordionSection>

      <div className="md:hidden">
        <FinanceGroupLabel title="Plataforma" />
        <AccordionSection
          value="billing-mobile"
          title="Plano e assinatura"
          description="Plano, faturas e pagamento."
        >
          <BillingSection
            billing={billing}
            loading={billingLoading}
            onCheckout={() => openBilling("checkout")}
            onPortal={() => openBilling("portal")}
            onRefresh={() => refreshBilling(studio.id)}
          />
        </AccordionSection>
      </div>
    </div>
  );
}

async function loadPaymentSettings(studioId: string) {
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
      .select("id,name,price,duration_min,commission_percent")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  if (!studioFull.error && !staffFull.error && !serviceFull.error) {
    const staffOptions = (staffFull.data ?? []) as StaffOption[];
    const serviceOptions = (serviceFull.data ?? []) as ServiceOption[];
    return {
      advanced: true,
      studio: normalizeStudio(studioFull.data),
      staff: staffOptions,
      services: serviceOptions,
      staffOptions,
      serviceOptions,
    };
  }

  const [studioLegacy, staffLegacy, serviceLegacy] = await Promise.all([
    supabase
      .from("studios")
      .select("id,payment_policy,accepted_payment_methods,deposit_percent,commission_percent")
      .eq("id", studioId)
      .maybeSingle(),
    supabase.from("staff").select("id,name").eq("studio_id", studioId).eq("is_active", true),
    supabase
      .from("services")
      .select("id,name,price,duration_min,commission_percent")
      .eq("studio_id", studioId)
      .eq("is_active", true),
  ]);

  return {
    advanced: false,
    studio: normalizeStudio(studioLegacy.data),
    staff: ((staffLegacy.data ?? []) as { id: string; name: string }[]).map(normalizeOverride),
    services: ((serviceLegacy.data ?? []) as { id: string; name: string }[]).map(normalizeOverride),
    staffOptions: ((staffLegacy.data ?? []) as { id: string; name: string }[]).map(
      normalizeOverride,
    ),
    serviceOptions: ((serviceLegacy.data ?? []) as ServiceOption[]).map((service) => ({
      ...service,
      commission_percent: service.commission_percent ?? null,
    })),
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

function normalizeOverride(row: { id: string; name: string }): RuleOverride {
  return {
    id: row.id,
    name: row.name,
    commission_percent: null,
  };
}

function formatPlan(plan?: string | null) {
  const labels: Record<string, string> = {
    trial: "Teste",
    starter: "Starter",
    pro: "Pro",
    business: "Business",
    monthly: "Premium Mensal",
    quarterly: "Premium Trimestral",
    yearly: "Premium Anual",
  };
  return labels[plan ?? ""] ?? "Não definido";
}

function formatSubscriptionStatus(status?: string | null) {
  const labels: Record<string, string> = {
    trialing: "Em teste",
    active: "Ativa",
    past_due: "Pagamento em atraso",
    canceled: "Cancelada",
    unpaid: "Por regularizar",
    incomplete: "Incompleta",
    incomplete_expired: "Expirada",
    paused: "Pausada",
    paid: "Paga",
    open: "Em aberto",
    draft: "Rascunho",
    void: "Anulada",
  };
  return labels[status ?? ""] ?? "Não disponível";
}

function formatDate(value?: string | null) {
  if (!value) return "Não disponível";
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatCents(value: number, currency = "eur") {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format((value || 0) / 100);
}

function toDateTimeLocal(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-PT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnly(value: string) {
  if (!value) return "";
  return new Date(`${value}T12:00`).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function localDateValue(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function paymentMethodLabel(value: string) {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? "Outro";
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex h-full min-h-[8.75rem] flex-col justify-between rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="grid size-8 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700">
          {icon}
        </span>
        <span className="min-w-0 text-[10px] uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="pt-4 text-xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function MoneyValue({ value, className = "" }: { value: string; className?: string }) {
  return (
    <p
      className={`font-semibold tracking-tight text-emerald-700 dark:text-emerald-400 ${className}`}
    >
      {value}
    </p>
  );
}

function RevenueCard({
  label,
  value,
  note,
  highlight,
}: {
  label: string;
  value: number;
  note?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex h-full min-h-[8.75rem] flex-col rounded-2xl border p-4 shadow-sm ${
        highlight ? "border-emerald-700/25 bg-emerald-950/5" : "border-border bg-card"
      }`}
    >
      <p className="min-h-4 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </p>
      <MoneyValue value={formatEUR(value)} className="mt-3 text-2xl md:text-3xl" />
      {note && <p className="mt-auto pt-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </div>
  );
}

function AccordionSection({
  value,
  title,
  description,
  children,
}: {
  value: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-finance-section={value}
      className={`overflow-hidden rounded-2xl border border-border bg-card shadow-sm ${
        ["staff-percent", "service-percent", "billing-platform"].includes(value)
          ? "hidden md:block"
          : ""
      }`}
    >
      <Accordion type="single" collapsible>
        <AccordionItem value={value} className="border-0">
          <AccordionTrigger className="min-h-[4.25rem] px-4 py-2.5 text-left hover:no-underline md:min-h-0 md:px-5 md:py-3">
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-0.5 line-clamp-1 block text-xs font-normal text-muted-foreground md:line-clamp-none">
                {description}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-3 pt-1 md:px-5 md:pb-4 md:pt-0">
            {children}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}

function FinanceGroupLabel({ title }: { title: string }) {
  return (
    <div className="px-1 pt-2 mb-3 md:hidden">
      <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
        {title}
      </p>
    </div>
  );
}

function CompactCommissionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-2xl border border-border bg-background/55">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="text-lg leading-none text-muted-foreground transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="border-t border-border px-3 pb-3 pt-3">{children}</div>
    </details>
  );
}

function DatePicker({
  value,
  placeholder,
  onChange,
  variant = "filter",
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  variant?: "filter" | "field";
}) {
  return (
    <PremiumDatePicker
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={
        variant === "filter"
          ? "h-10 rounded-full bg-background/90 text-xs font-medium"
          : `${controlClass} h-12`
      }
      allowClear={variant === "filter"}
    />
  );
}

function DateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value ? new Date(value) : undefined;
  const time = value ? value.slice(11, 16) : "09:00";
  return (
    <div className="grid w-full min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_7rem]">
      <DatePicker
        value={value ? value.slice(0, 10) : ""}
        placeholder="Escolher data"
        variant="field"
        onChange={(date) => {
          if (date) onChange(`${date}T${time}`);
        }}
      />
      <span className="block w-full min-w-0 max-w-full overflow-hidden">
        <input
          type="time"
          value={time}
          onChange={(event) => {
            const date = selected ? localDateValue(selected) : localDateValue(new Date());
            onChange(`${date}T${event.target.value}`);
          }}
          className="block h-14 w-full min-w-0 max-w-full appearance-none rounded-2xl border border-border bg-background/85 px-4 py-0 text-base leading-[3.5rem] shadow-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15 md:h-12 md:px-3 md:text-sm md:leading-[3rem]"
          style={{ minWidth: 0 }}
        />
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block min-w-0">
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function FinancialFilterBar({
  filters,
  staffOptions,
  onChange,
}: {
  filters: {
    staffId: string;
    paymentMethod: string;
    type: string;
    date: string;
  };
  staffOptions: StaffOption[];
  onChange: React.Dispatch<
    React.SetStateAction<{
      staffId: string;
      paymentMethod: string;
      type: string;
      date: string;
    }>
  >;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:justify-end lg:overflow-visible lg:pb-0">
      <div className="min-w-0 lg:min-w-[11rem]">
        <Select
          value={filters.staffId}
          onValueChange={(staffId) => onChange((current) => ({ ...current, staffId }))}
        >
          <SelectTrigger className={filterTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value="all" className={selectItemClass}>
              Todas as profissionais
            </SelectItem>
            {staffOptions.map((member) => (
              <SelectItem key={member.id} value={member.id} className={selectItemClass}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 lg:min-w-[11rem]">
        <Select
          value={filters.paymentMethod}
          onValueChange={(paymentMethod) => onChange((current) => ({ ...current, paymentMethod }))}
        >
          <SelectTrigger className={filterTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value="all" className={selectItemClass}>
              Forma de pagamento
            </SelectItem>
            {PAYMENT_METHODS.map((method) => (
              <SelectItem key={method.value} value={method.value} className={selectItemClass}>
                {method.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 lg:min-w-[9.5rem]">
        <Select
          value={filters.type}
          onValueChange={(type) => onChange((current) => ({ ...current, type }))}
        >
          <SelectTrigger className={filterTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            <SelectItem value="all" className={selectItemClass}>
              Tipos
            </SelectItem>
            <SelectItem value="manual" className={selectItemClass}>
              Cliente associado
            </SelectItem>
            <SelectItem value="walk_in" className={selectItemClass}>
              Atendimento avulso
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="min-w-0 lg:min-w-[11rem]">
        <DatePicker
          value={filters.date}
          placeholder="Data"
          onChange={(date) => onChange((current) => ({ ...current, date }))}
        />
      </div>
    </div>
  );
}

function ClientPill({ client, onClear }: { client?: ClientOption; onClear: () => void }) {
  if (!client) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-700/25 bg-emerald-950/5 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{client.name}</p>
        <p className="text-xs text-muted-foreground">{client.phone}</p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full border border-border bg-background/70 px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Remover
      </button>
    </div>
  );
}

function ManualEntriesTable({ entries }: { entries: ManualEntry[] }) {
  return (
    <div className="mx-4 mb-4 overflow-hidden rounded-3xl border border-border bg-background/45 md:mx-5 md:mb-5">
      <div className="hidden gap-3 bg-muted/30 px-4 py-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(8rem,0.8fr)_minmax(6rem,auto)]">
        <span>Atendimento</span>
        <span>Cliente</span>
        <span className="md:pl-2">Pagamento</span>
        <span className="md:text-right">Valor</span>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Sem lançamentos manuais para os filtros selecionados.
        </p>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.id}
            className="grid gap-3 border-t border-border px-4 py-4 text-sm transition first:border-t-0 hover:bg-muted/25 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(8rem,0.8fr)_minmax(6rem,auto)] md:items-center"
          >
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:hidden">
                Atendimento
              </span>
              <p className="font-medium">{entry.services?.name ?? "Serviço"}</p>
              <p className="text-xs text-muted-foreground">
                {entry.staff?.name ?? "Profissional"} · {formatDateTime(entry.performed_at)}
              </p>
              <span className="mt-2 inline-flex rounded-full bg-muted px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {entry.source === "walk_in" ? "Atendimento presencial avulso" : "Lançamento manual"}
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:hidden">
                Cliente
              </span>
              <p className="font-medium">{entry.clients?.name ?? "Cliente avulso"}</p>
              <p className="text-xs text-muted-foreground">
                {entry.clients?.phone ?? "Sem cadastro"}
              </p>
            </div>
            <div className="space-y-1 md:pl-2">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:hidden">
                Pagamento
              </span>
              <p>{paymentMethodLabel(entry.payment_method)}</p>
              {entry.notes && <p className="text-xs text-muted-foreground">{entry.notes}</p>}
            </div>
            <div className="space-y-1 md:text-right">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:hidden">
                Valor
              </span>
              <MoneyValue value={formatEUR(Number(entry.amount || 0))} className="text-xl" />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function BillingSection({
  billing,
  loading,
  onCheckout,
  onPortal,
  onRefresh,
}: {
  billing: BillingSummary | null;
  loading: boolean;
  onCheckout: () => void;
  onPortal: () => void;
  onRefresh: () => void;
}) {
  const active = billing?.premiumActive ?? true;
  const hasSubscription = Boolean(billing && billing.status !== "trialing");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem] xl:items-start">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CreditCard className="h-4 w-4" />
            <span className="text-[10px] uppercase tracking-[0.2em]">Assinatura da plataforma</span>
          </div>
          <h2 className="mt-2 text-base font-medium">Plano, cobrança e acesso premium</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Gira a assinatura mensal recorrente do estúdio, atualize o método de pagamento e
            consulte faturas emitidas pela Stripe.
          </p>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <SmallStatus label="Plano ativo" value={formatPlan(billing?.plan)} />
            <SmallStatus label="Estado" value={formatSubscriptionStatus(billing?.status)} />
            <SmallStatus label="Próxima cobrança" value={formatDate(billing?.nextBillingAt)} />
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-700/20 bg-emerald-950/5 p-4 shadow-sm xl:max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {active ? "Acesso premium ativo" : "Acesso limitado"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {active
                  ? "As funcionalidades premium permanecem disponíveis enquanto a assinatura estiver ativa ou dentro do período já pago."
                  : "Regularize a assinatura para recuperar as funcionalidades premium do painel."}
              </p>
            </div>
            <span
              className={`inline-flex min-h-6 shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-wide ${
                active ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground"
              }`}
            >
              {active ? "Ativo" : "Pendente"}
            </span>
          </div>

          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={hasSubscription ? onPortal : onCheckout}
              disabled={loading}
              className="rounded-xl bg-foreground px-3 py-2 text-xs font-bold uppercase tracking-wide text-background disabled:opacity-60"
            >
              {hasSubscription ? "Gerir assinatura" : "Ativar assinatura"}
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </button>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-3 flex items-center gap-2 text-muted-foreground">
          <FileText className="h-4 w-4" />
          <h3 className="text-xs uppercase tracking-[0.2em]">Histórico de cobranças</h3>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
          {!billing?.invoices?.length && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Ainda não existem faturas sincronizadas para este estúdio.
            </p>
          )}
          {billing?.invoices?.map((invoice) => (
            <div
              key={invoice.id}
              className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div>
                <p className="font-medium">{invoice.number ?? "Fatura Stripe"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(invoice.createdAt)} · {formatSubscriptionStatus(invoice.status)}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {formatCents(invoice.amountPaid || invoice.amountDue, invoice.currency)}
                </span>
                {invoice.hostedInvoiceUrl && (
                  <a
                    href={invoice.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    Abrir
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SmallStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/25 p-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
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
      <span>{props.label}</span>
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
        className={`font-mono ${strong ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-emerald-700/90 dark:text-emerald-400/90"}`}
      >
        {value}
      </span>
    </div>
  );
}
