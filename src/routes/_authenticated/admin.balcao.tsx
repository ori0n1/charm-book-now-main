import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  DoorOpen,
  LockKeyhole,
  Plus,
  ReceiptText,
  Repeat2,
  Search,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { VisualMoney, VisualPrivacyBoundary, VisualPrivacyButton } from "@/components/visual-money-privacy";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import { PremiumTimeSelect } from "@/components/ui/premium-time-select";
import { searchProtectedStudioClients } from "@/lib/agenda-access.functions";
import { getProtectedCashAttribution } from "@/lib/agenda-access.functions";
import { getDeskBalcaoCatalog } from "@/lib/desk-access.functions";

export const Route = createFileRoute("/_authenticated/admin/balcao")({
  head: () => ({ meta: [{ title: "Balcão - Painel" }] }),
  component: BalcaoRoute,
});

function BalcaoRoute() {
  return <VisualPrivacyBoundary><BalcaoPage /></VisualPrivacyBoundary>;
}

const SHOW_LEGACY_CASH_HISTORY_HEADER = false as boolean;
const SHOW_LEGACY_CASH_MOVEMENTS_LIST = false as boolean;

type StudioRow = { id: string; slug: string };

type ServiceOption = {
  id: string;
  name: string;
  price: number;
  duration_min: number;
};

type StaffOption = {
  id: string;
  name: string;
  current_status?: string | null;
};

type ClientOption = {
  id: string;
  name: string;
  phone: string;
};

type CashRegister = {
  id: string;
  studio_id: string;
  opening_amount: number;
  opened_at: string;
  movement_count: number;
  total_cash: number;
  total_mb_way: number;
  total_card: number;
  total_bank_transfer: number;
  total_other: number;
  manual_in: number;
  manual_out: number;
  expected_cash_amount: number;
};

type CashMovement = {
  id: string;
  movement_type: string;
  payment_method: string;
  amount: number;
  description: string;
  occurred_at: string;
  created_by?: string | null;
  source_key?: string | null;
  responsible_name?: string | null;
  appointment_status?: string | null;
  refund_status?: string | null;
  appointment_origin?: string | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  cancelled_by_name?: string | null;
};

type ClosedCashSession = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  closing_counted_amount: number | null;
  expected_cash_amount: number | null;
  difference_amount: number | null;
  total_in: number | null;
  total_out: number | null;
  movement_count: number | null;
  closed_by_name?: string | null;
  movements: CashMovement[];
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Dinheiro" },
  { value: "mb_way", label: "MB WAY" },
  { value: "card", label: "Cartão" },
  { value: "bank_transfer", label: "Transferência" },
  { value: "other", label: "Outro" },
];

const controlClass =
  "box-border min-h-11 w-full min-w-0 rounded-xl border border-border bg-background/85 px-3.5 py-2 text-sm leading-relaxed shadow-sm outline-none transition placeholder:text-muted-foreground/55 hover:bg-background focus:border-foreground/30 focus:ring-2 focus:ring-ring/15";
const selectTriggerClass =
  "box-border min-h-11 w-full min-w-0 rounded-xl border-border bg-background/85 px-3.5 pr-3 text-sm leading-relaxed shadow-sm transition hover:bg-background focus:ring-2 focus:ring-ring/15 [&>svg]:ml-3 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-60";
const selectContentClass = "rounded-2xl border-border/80 bg-popover/98 p-2 shadow-xl shadow-foreground/5";
const selectItemClass =
  "rounded-xl px-3 py-2.5 text-sm transition-colors focus:bg-emerald-950/10 focus:text-foreground data-[state=checked]:bg-emerald-950/10 data-[state=checked]:text-foreground";

function BalcaoPage() {
  const { studio: currentStudio } = useCurrentStudio();
  const searchStudioClients = useServerFn(searchProtectedStudioClients);
  const loadDeskCatalog = useServerFn(getDeskBalcaoCatalog);
  const loadCashAttribution = useServerFn(getProtectedCashAttribution);
  const [studio, setStudio] = useState<StudioRow | null>(null);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [cashRegister, setCashRegister] = useState<CashRegister | null>(null);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [closedSessions, setClosedSessions] = useState<ClosedCashSession[]>([]);
  const [cashAttributionReady, setCashAttributionReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [openingAmount, setOpeningAmount] = useState("0");
  const [movementType, setMovementType] = useState<"manual_in" | "manual_out" | "sangria" | "transfer_in" | "transfer_out">("manual_in");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementMethod, setMovementMethod] = useState("cash");
  const [movementDescription, setMovementDescription] = useState("");
  const [closingAmount, setClosingAmount] = useState("");
  const [closingNote, setClosingNote] = useState("");

  const [walkServiceId, setWalkServiceId] = useState("");
  const [walkStaffId, setWalkStaffId] = useState("");
  const [walkDateTime, setWalkDateTime] = useState(toDateTimeLocal(new Date()));
  const [walkAmount, setWalkAmount] = useState("");
  const [walkPaymentMethod, setWalkPaymentMethod] = useState("cash");
  const [walkNotes, setWalkNotes] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [walkClientName, setWalkClientName] = useState("Cliente balcão");
  const [walkClientPhone, setWalkClientPhone] = useState("");
  const [availableTimes, setAvailableTimes] = useState<string[]>([]);
  const [activePane, setActivePane] = useState<"walkin" | "cash" | "history">("walkin");
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Record<string, boolean>>({});
  const [historyFilter, setHistoryFilter] = useState<"today" | "7d" | "30d" | "all">("30d");

  useEffect(() => {
    void boot();
  }, [currentStudio?.id, currentStudio?.role, currentStudio?.staff_id]);

  useEffect(() => {
    if (!studio?.id || (activePane !== "history" && activePane !== "cash")) return;
    const refresh = () => void refreshCash(studio.id);
    const refreshWhenVisible = () => { if (!document.hidden) refresh(); };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [studio?.id, activePane]);

  useEffect(() => {
    const service = serviceOptions.find((item) => item.id === walkServiceId);
    if (service) setWalkAmount(String(service.price));
  }, [walkServiceId]);

  useEffect(() => {
    if (!studio || !walkStaffId || !walkServiceId || !walkDateTime) return;
    void loadAvailableTimes(studio.slug, walkStaffId, walkServiceId, walkDateTime.slice(0, 10));
  }, [studio?.slug, walkStaffId, walkServiceId, walkDateTime]);

  useEffect(() => {
    const query = clientSearch.trim();
    if (!studio?.id || selectedClientId || query.length < 2) {
      if (!selectedClientId) setClients([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchStudioClients({ data: { studioId: studio.id, query } })
        .then((rows) => {
          if (!cancelled) setClients(rows as ClientOption[]);
        })
        .catch((error) => {
          console.error("[balcao] protected client search failed", error);
          if (!cancelled) setClients([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clientSearch, searchStudioClients, selectedClientId, studio?.id]);

  async function boot() {
    setLoading(true);
    const studioId = currentStudio?.id;
    if (!studioId) {
      setLoading(false);
      return;
    }
    const ownStaffId = currentStudio.role === "staff" ? currentStudio.staff_id : null;

    let services: ServiceOption[];
    let staff: StaffOption[];
    if (currentStudio.role === "desk_staff") {
      const catalog = (await loadDeskCatalog({ data: { studioId } })) as {
        services: ServiceOption[];
        staff: StaffOption[];
      };
      services = catalog.services;
      staff = catalog.staff;
    } else {
      const [servicesResult, staffResult] = await Promise.all([
        supabase
          .from("services")
          .select("id,name,price,duration_min")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .order("sort_order"),
        supabase
          .from("staff")
          .select("id,name,current_status")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .match(ownStaffId ? { id: ownStaffId } : {})
          .order("sort_order"),
      ]);
      services = (servicesResult.data ?? []) as ServiceOption[];
      staff = (staffResult.data ?? []) as StaffOption[];
    }
    setStudio({ id: studioId, slug: currentStudio.slug });
    setServiceOptions(services);
    setStaffOptions(staff);
    setClients([]);
    if (services[0]) {
      setWalkServiceId(services[0].id);
      setWalkAmount(String(services[0].price));
    }
    if (staff[0]) setWalkStaffId(staff[0].id);
    await refreshCash(studioId);
    setLoading(false);
  }

  async function refreshCash(studioId = studio?.id) {
    if (!studioId) return;
    const canReadClosedHistory = currentStudio?.role === "studio_owner" || currentStudio?.role === "saas_owner" || currentStudio?.role === "manager";
    const db = supabase as any;
    const { data: openRows } = await db.rpc("get_open_cash_register", { p_studio_id: studioId });
    const openRegister = Array.isArray(openRows) ? openRows[0] ?? null : openRows ?? null;
    setCashRegister(openRegister as CashRegister | null);

    let openMovements: CashMovement[] = [];
    if (openRegister?.id) {
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db
          .from("cash_register_movements")
          .select("id,movement_type,payment_method,amount,description,occurred_at,created_by,source_key")
          .eq("studio_id", studioId)
          .eq("session_id", openRegister.id)
          .order("occurred_at", { ascending: false })
          .range(offset, offset + 999);
        if (error) {
          setCashAttributionReady(false);
          setCashMovements([]);
          setClosedSessions([]);
          return;
        }
        openMovements.push(...((data ?? []) as CashMovement[]));
        if ((data ?? []).length < 1000) break;
      }
      setClosingAmount(String(Number(openRegister.expected_cash_amount ?? 0)));
    } else {
      setCashMovements([]);
      setClosingAmount("");
    }

    const { data: sessions, error: sessionsError } = canReadClosedHistory
      ? await db.rpc("get_cash_register_closure_history", { p_studio_id: studioId, p_limit: 30 })
      : { data: [], error: null };
    if (sessionsError) {
      setCashAttributionReady(false);
      setCashMovements([]);
      setClosedSessions([]);
      return;
    }
    const closed = ((sessions ?? []) as ClosedCashSession[]).map(normalizeClosedSession);
    const sessionIds = [...closed.map((session) => session.id), ...(openRegister?.id ? [openRegister.id] : [])];
    let attribution: {
      sessions: Array<{ id: string; closed_by_name: string | null }>;
      movements: Array<{ id: string; responsible_name: string | null; appointment_status: string | null; refund_status: string | null; appointment_origin: CashMovement["appointment_origin"]; cancellation_reason: string | null; cancelled_at: string | null; cancelled_by_name: string | null }>;
    } = { sessions: [], movements: [] };
    try {
      attribution = await loadCashAttribution({ data: { studioId, sessionIds } });
    } catch {
      setCashAttributionReady(false);
      setCashMovements([]);
      setClosedSessions([]);
      toast.error("Não foi possível confirmar a receita efetiva do caixa.");
      return;
    }
    const sessionNames = new Map<string, string | null>(attribution.sessions.map(
      (row: { id: string; closed_by_name: string | null }) => [row.id, row.closed_by_name],
    ));
    const movementDetails = new Map(attribution.movements.map(
      (row) => [row.id, row],
    ));
    setCashMovements(openMovements.map((movement) => ({
      ...movement, ...movementDetails.get(movement.id),
    })));
    setClosedSessions(closed.map((session) => normalizeClosedSession({
      ...session,
      closed_by_name: sessionNames.get(session.id) ?? null,
      movements: session.movements.map((movement) => ({
        ...movement, ...movementDetails.get(movement.id),
      })),
    })));
    setCashAttributionReady(true);
  }

  async function openCashRegister() {
    if (!studio) return;
    const amount = Number(openingAmount || 0);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indique um valor inicial válido.");
    setBusy(true);
    const { error } = await (supabase as any).rpc("open_cash_register", {
      p_studio_id: studio.id,
      p_opening_amount: amount,
    });
    setBusy(false);
    if (error) return toast.error(cashErrorMessage(error.message));
    toast.success("Caixa aberto.");
    await refreshCash(studio.id);
  }

  async function addCashMovement() {
    if (!cashRegister) return;
    const amount = Number(movementAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error("Indique um valor válido.");
    if (!movementDescription.trim()) return toast.error("Adicione uma descrição curta.");

    setBusy(true);
    const { error } = await (supabase as any).rpc("add_cash_register_movement", {
      p_session_id: cashRegister.id,
      p_movement_type: movementType,
      p_payment_method: movementMethod,
      p_amount: amount,
      p_description: movementDescription.trim(),
    });
    setBusy(false);
    if (error) return toast.error(cashErrorMessage(error.message));
    toast.success(movementType === "manual_in" ? "Entrada adicionada." : "Saída adicionada.");
    setMovementAmount("");
    setMovementDescription("");
    setShowMovementForm(false);
    await refreshCash();
  }

  async function closeCashRegister() {
    if (!cashRegister) return;
    const amount = Number(closingAmount);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indique o valor contado.");
    setBusy(true);
    const { error } = await (supabase as any).rpc("close_cash_register", {
      p_session_id: cashRegister.id,
      p_counted_amount: amount,
      p_note: closingNote.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(cashErrorMessage(error.message));
    toast.success("Caixa fechado.");
    setClosingNote("");
    setActivePane("history");
    await refreshCash();
  }

  async function createWalkIn() {
    if (!studio || !walkServiceId || !walkStaffId || !walkDateTime) {
      return toast.error("Escolha serviço, profissional e horário.");
    }
    if (selectedStaff?.current_status === "absent") {
      return toast.error("Este profissional está em folga e não aceita novas marcações agora.");
    }
    const amount = Number(walkAmount);
    if (!Number.isFinite(amount) || amount < 0) return toast.error("Indique um valor válido.");

    setBusy(true);
    const { error } = await (supabase as any).rpc("create_walk_in_appointment", {
      p_studio_id: studio.id,
      p_staff_id: walkStaffId,
      p_service_id: walkServiceId,
      p_starts_at: new Date(walkDateTime).toISOString(),
      p_client_id: selectedClientId || null,
      p_client_name: selectedClientId ? null : walkClientName.trim() || "Cliente balcão",
      p_client_phone: selectedClientId ? null : walkClientPhone.trim() || null,
      p_payment_method: walkPaymentMethod,
      p_amount: amount,
      p_notes: walkNotes.trim() || null,
    });
    setBusy(false);
    if (error) return toast.error(walkInErrorMessage(error.message));

    toast.success("Encaixe criado e refletido na agenda.");
    setClientSearch("");
    setSelectedClientId("");
    setWalkClientName("Cliente balcão");
    setWalkClientPhone("");
    setWalkNotes("");
    await refreshCash();
  }

  async function loadAvailableTimes(studioSlug: string, staffId: string, serviceId: string, date: string) {
    const service = serviceOptions.find((item) => item.id === serviceId);
    if (!service) return;
    const staff = staffOptions.find((item) => item.id === staffId);
    if (staff?.current_status === "absent") {
      setAvailableTimes([]);
      return;
    }
    const { data, error } = await supabase.rpc("get_available_slots", {
      p_studio_slug: studioSlug,
      p_staff_id: staffId,
      p_date: date,
      p_duration_min: service.duration_min,
      p_slot_step_min: 15,
    });
    if (error) {
      console.error("[balcao] get_available_slots failed", error);
      setAvailableTimes([]);
      return;
    }
    setAvailableTimes(
      Array.from(new Set(((data ?? []) as Array<{ slot_label: string }>).map((slot) => slot.slot_label))),
    );
  }

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return [];
    return clients
      .filter((client) => {
        return (
          client.name.toLowerCase().includes(term) ||
          client.phone.toLowerCase().includes(term) ||
          cleanPhone(client.phone).includes(cleanPhone(term))
        );
      })
      .slice(0, 5);
  }, [clientSearch, clients]);

  const selectedClient = clients.find((client) => client.id === selectedClientId);
  const selectedStaff = staffOptions.find((staff) => staff.id === walkStaffId);
  const selectedStaffOnDayOff = selectedStaff?.current_status === "absent";
  const visibleMovements = cashMovements;
  const filteredClosedSessions = useMemo(
    () => filterClosedSessions(closedSessions, historyFilter),
    [closedSessions, historyFilter],
  );
  const visibleSessions = showFullHistory ? filteredClosedSessions : filteredClosedSessions.slice(0, 3);
  const canExpandHistory = filteredClosedSessions.length > 3;

  if (loading) return <p className="text-sm text-muted-foreground">A carregar Balcão...</p>;
  if (!studio) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Nenhum estúdio vinculado à sua conta.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[78rem] space-y-2.5 pb-safe-4 md:pb-4">
      <header className="rounded-2xl border border-border/70 bg-card/90 px-3.5 py-3 shadow-sm md:px-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-400">
              Operação presencial
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">Balcão</h1>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:min-w-[20rem]">
            <MiniMetric label="Caixa" value={cashRegister ? "Aberto" : "Fechado"} positive={Boolean(cashRegister)} />
            <MiniMetric label="Saldo válido" value={cashRegister ? (cashAttributionReady ? formatEUR(effectiveCashBalance(cashRegister.opening_amount, cashMovements)) : "—") : formatEUR(0)} positive mask={activePane === "history"} />
            <MiniMetric label="Movimentos" value={String(cashRegister?.movement_count ?? 0)} />
          </div>
        </div>
      </header>

      <nav className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border/70 bg-card/80 p-1.5 shadow-sm" aria-label="Áreas do Balcão">
        <button
          type="button"
          onClick={() => setActivePane("walkin")}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
            activePane === "walkin" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Encaixe
        </button>
        <button
          type="button"
          onClick={() => setActivePane("cash")}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
            activePane === "cash" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Caixa
        </button>
        <button
          type="button"
          onClick={() => setActivePane("history")}
          className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
            activePane === "history" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          Histórico
        </button>
      </nav>

      <div className="grid gap-3">
        <section className={`${activePane === "cash" ? "block" : "hidden"} overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm`}>
          {cashRegister ? (
            <div className="border-b border-border/60 bg-muted/10 px-3.5 py-2.5 md:px-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-tight">Sessão em andamento</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Aberto às {formatTime(cashRegister.opened_at)}</p>
                </div>
                <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs font-semibold text-muted-foreground">
                  Valor inicial • {formatEUR(cashRegister.opening_amount)}
                </span>
              </div>
            </div>
          ) : (
            <PanelHeader
              icon={<Wallet className="h-4 w-4" />}
              eyebrow="Caixa"
              title="Abrir caixa"
              description="Informe o valor inicial."
            />
          )}

          <div className="space-y-2.5 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 md:p-4">
            {!cashRegister ? (
              <div className="grid gap-2.5 rounded-xl border border-border/60 bg-background/45 p-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <Field label="Valor inicial">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={openingAmount}
                    onChange={(event) => setOpeningAmount(event.target.value)}
                    className={controlClass}
                  />
                </Field>
                <button
                  type="button"
                  onClick={openCashRegister}
                  disabled={busy}
                  className="bellza-panel-action bellza-panel-action-emerald"
                >
                  <DoorOpen className="h-4 w-4" />
                  Abrir caixa
                </button>
              </div>
            ) : (
              <>
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Resumo do caixa
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                  {cashAttributionReady && <CashStat label="Saldo válido" value={effectiveCashBalance(cashRegister.opening_amount, cashMovements)} highlight />}
                  {cashAttributionReady && <CashStat label="Entradas válidas" value={effectiveCashIncome(cashMovements)} highlight />}
                  <CashStat label="Recebido fisicamente" value={totalReceived(cashRegister)} />
                  <CashStat label="Entrada manual" value={cashRegister.manual_in} />
                    <CashStat label="Saídas" value={cashRegister.manual_out} />
                  <CashStat label="Esperado físico" value={cashRegister.expected_cash_amount} />
                  </div>
                </div>

                <PaymentMethodSummary register={cashRegister} />

                <div className="rounded-xl border border-border/55 bg-background/40 p-2.5">
                  <button
                    type="button"
                    onClick={() => setShowMovementForm((value) => !value)}
                    className="bellza-panel-action bellza-panel-action-secondary border-dashed"
                  >
                    <Plus className="h-4 w-4" />
                    {showMovementForm ? "Ocultar movimento" : "Adicionar movimento"}
                  </button>

                  {showMovementForm && (
                    <div className="mt-2.5 grid gap-2.5 lg:grid-cols-[minmax(7rem,0.75fr)_minmax(7rem,0.75fr)_minmax(9rem,0.85fr)_minmax(12rem,1.2fr)_auto] lg:items-end">
                      <Field label="Tipo">
                        <Select value={movementType} onValueChange={(value) => setMovementType(value as "manual_in" | "manual_out" | "sangria" | "transfer_in" | "transfer_out")}>
                          <SelectTrigger className={selectTriggerClass}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={selectContentClass}>
                            <SelectItem value="manual_in" className={selectItemClass}>Entrada</SelectItem>
                            <SelectItem value="manual_out" className={selectItemClass}>Saída</SelectItem>
                            <SelectItem value="sangria" className={selectItemClass}>Sangria</SelectItem>
                            <SelectItem value="transfer_in" className={selectItemClass}>Transferência recebida</SelectItem>
                            <SelectItem value="transfer_out" className={selectItemClass}>Transferência enviada</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Valor">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={movementAmount}
                          onChange={(event) => setMovementAmount(event.target.value)}
                          className={controlClass}
                        />
                      </Field>
                      <Field label="Método">
                        <PaymentSelect value={movementMethod} onChange={setMovementMethod} />
                      </Field>
                      <Field label="Observação">
                        <input
                          value={movementDescription}
                          onChange={(event) => setMovementDescription(event.target.value)}
                          placeholder="Ex.: compra de material"
                          className={controlClass}
                        />
                      </Field>
                      <button
                        type="button"
                        onClick={addCashMovement}
                        disabled={busy}
                        className="bellza-panel-action bellza-panel-action-primary"
                      >
                        Guardar
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid gap-2.5 rounded-xl border border-border/60 bg-background/45 p-2.5 lg:grid-cols-[minmax(9rem,0.75fr)_minmax(12rem,1fr)] lg:items-end">
                  <Field label="Valor contado">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={closingAmount}
                      onChange={(event) => setClosingAmount(event.target.value)}
                      className={controlClass}
                    />
                  </Field>
                  <Field label="Observação de fechamento">
                    <input
                      value={closingNote}
                      onChange={(event) => setClosingNote(event.target.value)}
                      placeholder="Opcional"
                      className={controlClass}
                    />
                  </Field>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={closeCashRegister}
                    disabled={busy}
                    className="bellza-panel-action bellza-panel-action-primary md:w-[13rem]"
                  >
                    <LockKeyhole className="h-4 w-4" />
                    Fechar caixa
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <section className={`${activePane === "walkin" ? "block" : "hidden"} overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm`}>
          <PanelHeader
            icon={<CalendarClock className="h-4 w-4" />}
            eyebrow="Atendimento"
            title="Criar encaixe"
            description="Atendimento rápido no balcão."
          />

          <div className="space-y-2.5 px-3.5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3.5 md:p-4">
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Serviço">
                <Select value={walkServiceId} onValueChange={setWalkServiceId}>
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue placeholder="Selecionar serviço" />
                  </SelectTrigger>
                  <SelectContent className={selectContentClass}>
                    {serviceOptions.map((service) => (
                      <SelectItem key={service.id} value={service.id} className={selectItemClass}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Profissional">
                <Select value={walkStaffId} onValueChange={setWalkStaffId}>
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue placeholder="Selecionar profissional" />
                  </SelectTrigger>
                  <SelectContent className={selectContentClass}>
                    {staffOptions.map((member) => (
                      <SelectItem key={member.id} value={member.id} className={selectItemClass}>
                        {member.name}{member.current_status === "absent" ? " · Em folga" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedStaffOnDayOff && (
                  <p className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium leading-relaxed text-amber-700 dark:text-amber-300">
                    Em folga. Este profissional não aceita marcações ou encaixes enquanto este estado estiver ativo.
                  </p>
                )}
              </Field>

              <Field label="Data e hora" className="md:col-span-2 xl:col-span-2">
                <DateTimePicker value={walkDateTime} onChange={setWalkDateTime} />
              </Field>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/45 p-2.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Horários livres
                </p>
                <span className="text-[11px] text-muted-foreground">
                  {selectedStaffOnDayOff ? "Em folga" : `${availableTimes.length} opções`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedStaffOnDayOff ? (
                  <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-medium leading-relaxed text-amber-700 dark:text-amber-300">
                    Profissional em folga. Não existem horários livres para marcações nesta data.
                  </p>
                ) : availableTimes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    Sem horários livres para esta data.
                  </p>
                ) : (
                  availableTimes.map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => setWalkDateTime(`${walkDateTime.slice(0, 10)}T${time}`)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        walkDateTime.slice(11, 16) === time
                          ? "border-emerald-600 bg-emerald-600 text-white shadow-sm"
                          : "border-border bg-card hover:border-emerald-600/35"
                      }`}
                    >
                      {time}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/60 bg-background/45 p-2.5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Cliente
                </p>
              </div>
              <input
                value={clientSearch}
                onChange={(event) => {
                  setClientSearch(event.target.value);
                  setSelectedClientId("");
                }}
                placeholder="Pesquisar nome ou WhatsApp"
                className={`${controlClass} mt-2`}
              />
              {selectedClient ? (
                <ClientPill
                  client={selectedClient}
                  onClear={() => {
                    setSelectedClientId("");
                    setClientSearch("");
                  }}
                />
              ) : clientSearch.trim() ? (
                <div className="mt-2 grid gap-2">
                  {filteredClients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setClientSearch(`${client.name} - ${client.phone}`);
                      }}
                      className="rounded-xl border border-border bg-card/80 px-3 py-2 text-left text-sm transition hover:border-emerald-700/25 hover:bg-emerald-950/5"
                    >
                      <span className="block break-words font-medium leading-snug">{client.name}</span>
                      <span className="break-words text-xs leading-relaxed text-muted-foreground">{client.phone}</span>
                    </button>
                  ))}
                  {filteredClients.length === 0 && (
                    <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                      Nenhum cliente encontrado. O atendimento seguirá como avulso.
                    </p>
                  )}
                </div>
              ) : null}
              {!selectedClientId && (
                <p className="mt-2 rounded-xl border border-dashed border-border/80 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  Sem cliente selecionado. Atendimento presencial avulso.
                </p>
              )}
            </div>

            <div className="grid gap-2.5 md:grid-cols-[minmax(8rem,0.7fr)_minmax(10rem,0.9fr)_minmax(0,1.4fr)] md:items-end">
              <Field label="Valor">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={walkAmount}
                  onChange={(event) => setWalkAmount(event.target.value)}
                  className={controlClass}
                />
              </Field>
              <Field label="Forma de pagamento">
                <PaymentSelect value={walkPaymentMethod} onChange={setWalkPaymentMethod} />
              </Field>
              <Field label="Observação">
                <input
                  value={walkNotes}
                  onChange={(event) => setWalkNotes(event.target.value)}
                  placeholder="Opcional"
                  className={controlClass}
                />
              </Field>
            </div>

            <button
              type="button"
              onClick={createWalkIn}
              disabled={busy || selectedStaffOnDayOff}
              className="bellza-panel-action bellza-panel-action-emerald md:ml-2.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              Criar encaixe
            </button>
          </div>
        </section>

        <section className={`${activePane === "history" ? "block" : "hidden"} overflow-hidden rounded-[1.35rem] border border-border/70 bg-card/95 shadow-[0_18px_60px_rgba(0,0,0,0.16)]`}>
          {SHOW_LEGACY_CASH_HISTORY_HEADER && <PanelHeader
            icon={<ReceiptText className="h-4 w-4" />}
            eyebrow="Histórico"
            title="Últimos movimentos"
            description="Resumo rápido do caixa."
          />}

          <div className="border-b border-border/60 bg-muted/10 px-3.5 py-3.5 md:px-5 md:py-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 ring-1 ring-emerald-500/15 dark:text-emerald-400">
                  <ReceiptText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase leading-none tracking-[0.26em] text-muted-foreground">
                    HISTÓRICO
                  </p>
                  <h2 className="mt-1.5 text-lg font-black tracking-tight md:text-xl">Fechamentos de caixa</h2>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {currentStudio?.role === "studio_owner" || currentStudio?.role === "saas_owner" || currentStudio?.role === "manager"
                      ? "Movimentações da sessão aberta e dos caixas encerrados"
                      : "Movimentações da sessão aberta"}
                  </p>
                </div>
                <div className="ml-auto shrink-0"><VisualPrivacyButton /></div>
              </div>

              <div className="flex min-w-0 items-center gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-2xl border border-border/70 bg-background/60 p-1 shadow-inner lg:w-[22rem]">
                  {[
                    ["today", "Hoje"],
                    ["7d", "7 dias"],
                    ["30d", "30 dias"],
                    ["all", "Todos"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setHistoryFilter(value as typeof historyFilter);
                        setShowFullHistory(false);
                        setExpandedSessions({});
                      }}
                      className={`min-h-9 rounded-xl px-2 text-[11px] font-bold transition ${
                        historyFilter === value
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4 px-3.5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3.5 md:p-5">
            {cashRegister && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3 md:p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-black">Caixa aberto · movimentações em tempo real</p>
                    <p className="text-xs text-muted-foreground">Aberto às {formatTime(cashRegister.opened_at)} · {visibleMovements.length} registos</p>
                  </div>
                  <button type="button" onClick={() => void refreshCash(studio.id)} className="rounded-xl border border-border px-3 py-2 text-xs font-semibold">Atualizar</button>
                </div>
                {visibleMovements.length ? <ClosedMovementsList movements={visibleMovements} /> :
                  <p className="text-xs text-muted-foreground">Ainda não existem movimentações neste caixa.</p>}
              </div>
            )}
            {visibleSessions.length > 0 ? (
              <div className="grid items-start gap-3 md:grid-cols-2 md:gap-5 xl:grid-cols-3">
                {visibleSessions.map((session, index) => (
                  <ClosedSessionCard
                    key={session.id}
                    session={session}
                    previousSession={filteredClosedSessions[filteredClosedSessions.findIndex((item) => item.id === session.id) + 1] ?? visibleSessions[index + 1]}
                    expanded={Boolean(expandedSessions[session.id])}
                    onToggle={() =>
                      setExpandedSessions((current) =>
                        current[session.id] ? {} : { [session.id]: true },
                      )
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border/80 bg-background/45 px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                {currentStudio?.role === "studio_owner" || currentStudio?.role === "saas_owner" || currentStudio?.role === "manager"
                  ? "Nenhum caixa fechado neste período."
                  : "O histórico financeiro de caixas fechados está reservado ao proprietário."}
              </p>
            )}
            {SHOW_LEGACY_CASH_MOVEMENTS_LIST && (
              <>
            <CompactList
              icon={<ReceiptText className="h-4 w-4" />}
              title="Movimentos"
              empty="Ainda não existem movimentos."
            >
              {visibleMovements.map((movement) => (
                <MovementRow key={movement.id} movement={movement} />
              ))}
            </CompactList>
            <CompactList
              icon={<Clock className="h-4 w-4" />}
              title="Caixas fechados"
              empty="Nenhum caixa fechado ainda."
            >
              {visibleSessions.map((session) => (
                <ClosedSessionRow key={session.id} session={session} />
              ))}
            </CompactList>
              </>
            )}
            {canExpandHistory && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowFullHistory((value) => !value)}
                  className="w-full max-w-sm rounded-2xl border border-border bg-background/70 px-4 py-3 text-xs font-bold text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
                >
                  {showFullHistory ? "Ver menos fechamentos" : "Ver mais fechamentos"}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function PanelHeader({
  icon,
  eyebrow,
  title,
  description,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
}) {
  const isHistory = eyebrow.toLowerCase().includes("hist");
  const displayTitle = isHistory ? "Fechamentos de caixa" : title;
  const displayDescription = isHistory ? "Extrato completo de cada sessao encerrada." : description;
  return (
    <div className="border-b border-border/60 bg-muted/10 px-3.5 py-3 md:px-4">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
          <h2 className="mt-0.5 text-base font-semibold tracking-tight">{displayTitle}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{displayDescription}</p>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, positive = false, mask = false }: { label: string; value: string; positive?: boolean; mask?: boolean }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/55 px-3 py-2">
      <p className="break-words text-[8.5px] font-semibold uppercase leading-snug tracking-[0.08em] text-muted-foreground sm:text-[9px]">{label}</p>
      <p className={`mt-0.5 break-words text-sm font-bold leading-snug ${positive ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
        {mask ? <VisualMoney value={value} /> : value}
      </p>
    </div>
  );
}

function CashStat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-border/55 bg-background/55 px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 break-words text-base font-bold tracking-tight ${highlight ? "text-emerald-700 dark:text-emerald-400" : ""}`}>
        {formatEUR(value)}
      </p>
    </div>
  );
}

function PaymentMethodSummary({ register }: { register: CashRegister }) {
  const rows = [
    ["Dinheiro", register.total_cash],
    ["MB WAY", register.total_mb_way],
    ["Cartão", register.total_card],
    ["Transferência", register.total_bank_transfer],
    ["Outro", register.total_other],
  ] as const;

  return (
    <div className="rounded-xl border border-border/55 bg-background/40 px-3 py-2.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Recebido por método · conciliação
      </p>
      <div className="divide-y divide-border/55">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-1.5 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="border-b border-dotted border-border/80" />
            <strong className="font-semibold">{formatEUR(value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-[10px] font-medium uppercase leading-relaxed tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function PaymentSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={selectTriggerClass}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className={selectContentClass}>
        {PAYMENT_METHODS.map((method) => (
          <SelectItem key={method.value} value={method.value} className={selectItemClass}>
            {method.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CompactList({
  icon,
  title,
  empty,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rounded-xl border border-border/55 bg-background/40 p-2.5">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[10px] font-semibold uppercase leading-relaxed tracking-[0.16em]">{title}</p>
      </div>
      <div className="space-y-1.5">
        {hasChildren ? children : <p className="rounded-xl border border-dashed border-border px-3 py-4 text-sm leading-relaxed text-muted-foreground">{empty}</p>}
      </div>
    </div>
  );
}

function MovementRow({ movement }: { movement: CashMovement }) {
  const isOut = isOutgoingMovement(movement.movement_type);
  const voided = isVoidedServiceMovement(movement);
  const cancelled = isCancelledServiceMovement(movement);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/45 bg-card/60 px-3 py-2">
      <div className="min-w-0">
        <p className="break-words text-sm font-semibold leading-snug">{movementTypeLabel(movement.movement_type)}{voided ? " · ANULADO" : cancelled ? " · CANCELADO" : ""}</p>
        <p className="break-words text-[11px] leading-relaxed text-muted-foreground">{formatDateTimeShort(movement.occurred_at)} · {paymentMethodLabel(movement.payment_method)} · Registado por: {movement.responsible_name || "Não registado"}</p>
        {cancelled && <CancellationAudit movement={movement} />}
      </div>
      <p className={`break-words text-sm font-bold text-right ${cancelled ? "text-muted-foreground" : isOut ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}`}>
        {cancelled ? formatEUR(0) : `${isOut ? "-" : "+"}${formatEUR(movement.amount)}`}
        {cancelled && <span className="block text-[10px] font-medium">Recebido {formatEUR(movement.amount)}</span>}
      </p>
    </div>
  );
}

function ClosedSessionCard({
  session,
  previousSession,
  expanded,
  onToggle,
}: {
  session: ClosedCashSession;
  previousSession?: ClosedCashSession;
  expanded: boolean;
  onToggle: () => void;
}) {
  const totals = cashSessionTotals(session);
  const diff = totals.difference;
  const diffState = differenceState(diff);
  const movements = session.movements ?? [];
  const profit = totals.profit;
  const comparison = cashSessionComparison(session, previousSession);
  const profitTone = profit >= 0 ? "positive" : "negative";
  const closedAt = session.closed_at ?? session.opened_at;
  const adjustedAfterClose = Boolean(session.closed_at && movements.some((movement) =>
    isCancelledServiceMovement(movement) && movement.cancelled_at && new Date(movement.cancelled_at) > new Date(session.closed_at!)));

  return (
    <article className={`group flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border bg-background/70 shadow-sm transition-[border-color,box-shadow,transform] duration-300 md:rounded-[1.5rem] ${
      expanded
        ? "border-emerald-500/35 shadow-[0_18px_50px_rgba(0,0,0,0.18)] md:col-span-2 xl:col-span-3"
        : "min-h-[17.5rem] border-border/60 hover:border-emerald-500/25 hover:shadow-[0_14px_40px_rgba(0,0,0,0.12)] md:min-h-[19rem]"
    }`}>
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:gap-5 md:px-5 md:pb-4 md:pt-5">
        <div className="min-w-0">
          <p className="text-sm font-black leading-tight text-foreground md:whitespace-normal md:break-words md:text-base md:leading-snug">
            {formatDateTimeRangeCompact(session.opened_at, closedAt)}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-muted-foreground md:text-xs">
            Duração {formatDuration(session.opened_at, closedAt)}
          </p>
        </div>
        <span className={`inline-flex min-h-7 shrink-0 items-center justify-center rounded-full px-3 text-[9px] font-black uppercase tracking-[0.12em] md:px-3.5 ${diffState.badgeClass}`}>
          {diffState.label}
        </span>
      </div>

      <div className="grid flex-1 gap-2 px-4 pb-3 md:gap-3 md:px-5 md:pb-4">
        <div className="rounded-2xl border border-border/55 bg-card/60 px-3 py-3 md:px-4 md:py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Saldo válido</p>
          <p className="mt-1 truncate whitespace-nowrap text-xl font-black leading-tight tabular-nums text-emerald-700 dark:text-emerald-400 md:text-2xl">
            <VisualMoney value={formatEUR(totals.validBalance)} />
          </p>
        </div>
        <div className="rounded-2xl border border-border/55 bg-card/60 px-3 py-3 md:px-4 md:py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Contado no fecho</p>
          <p className="mt-1 truncate whitespace-nowrap text-lg font-black leading-tight tabular-nums text-foreground md:text-xl"><VisualMoney value={formatEUR(totals.counted)} /></p>
        </div>
        <div className="rounded-2xl border border-border/55 bg-card/60 px-3 py-3 md:px-4 md:py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Lucro do período</p>
          <p className={`mt-1 truncate whitespace-nowrap text-lg font-black leading-tight tabular-nums md:text-xl ${profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}`}>
            <VisualMoney value={formatSignedEUR(profit)} />
          </p>
        </div>
        {adjustedAfterClose && <p className="text-[10px] text-muted-foreground">Saldo válido ajustado após o fecho; valor contado preservado.</p>}
      </div>

      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="mx-4 mb-4 mt-auto inline-flex min-h-10 items-center justify-center rounded-2xl border border-border bg-card/75 px-3 text-xs font-black text-muted-foreground transition hover:bg-muted hover:text-foreground md:mx-5 md:mb-5 md:w-[calc(100%-2.5rem)]"
      >
        {expanded ? "Minimizar" : "Ver detalhes"}
      </button>

      {expanded && (
        <div className="animate-in fade-in-0 slide-in-from-top-1 space-y-4 border-t border-border/60 p-4 duration-300 md:space-y-5 md:p-5">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 md:gap-3 xl:grid-cols-4">
            <ClosureMetric label="Valor inicial" value={totals.opening} />
            <ClosureMetric label="Entradas válidas" value={totals.income} />
            <ClosureMetric label="Recebido fisicamente" value={totals.physicalIncome} />
            <ClosureMetric label="Saídas" value={totals.outcome} />
            <ClosureMetric label="Saldo válido" value={totals.validBalance} featured />
            <ClosureMetric label="Esperado físico" value={totals.expected} />
            <ClosureMetric label="Contado no fecho" value={totals.counted} />
            <ClosureMetric label="Diferença" value={diff} signed tone={diffState.tone} />
            <ClosureMetric label="Lucro do período" value={profit} signed tone={profitTone} />
            <ClosureMetric label="Vs anterior" value={comparison.amount} signed tone={comparison.tone} hint={comparisonShortLabel(comparison.amount, comparison.tone)} />
          </div>
          <div className="rounded-2xl border border-border/55 bg-card/60 px-3.5 py-3 text-xs leading-relaxed md:px-4 md:py-4">
            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">Informações</p>
            <div className="grid gap-x-5 gap-y-1 sm:grid-cols-2">
            <InfoLine label="Abertura" value={formatDateTimeShort(session.opened_at)} />
            <InfoLine label="Fechamento" value={formatDateTimeShort(closedAt)} />
            <InfoLine label="Duração" value={formatDuration(session.opened_at, closedAt)} />
            <InfoLine label="Fecho efetuado por" value={session.closed_by_name || "Não registado"} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Movimentos
            </p>
            <span className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[10px] font-bold text-muted-foreground">
              {movements.length} {movements.length === 1 ? "registo" : "registos"}
            </span>
          </div>
          <div className="space-y-2">
            {movements.length > 0 ? (
              <ClosedMovementsList movements={movements} />
            ) : (
              <p className="rounded-xl border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">
                Este fechamento não possui movimentos registados.
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function ClosureMetric({
  label,
  value,
  positive = false,
  negative = false,
  featured = false,
  signed = false,
  tone = "neutral",
  compact = false,
  hint,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
  featured?: boolean;
  signed?: boolean;
  tone?: "neutral" | "positive" | "negative";
  compact?: boolean;
  hint?: string;
}) {
  const toneClass =
    tone === "negative" || negative
      ? "text-rose-600"
      : tone === "positive" || positive
        ? "text-emerald-700 dark:text-emerald-400"
        : featured
          ? "text-foreground"
          : "";
  return (
    <div className={`flex min-w-0 flex-col justify-center rounded-xl border border-border/50 bg-card/60 px-3 md:rounded-2xl md:px-4 ${compact ? "min-h-[3.75rem] py-2" : "min-h-[4.85rem] py-2.5 md:min-h-[5.35rem]"}`}>
      <p className="truncate text-[9px] font-semibold uppercase leading-tight tracking-[0.12em] text-muted-foreground md:text-[10px]">{label}</p>
      <p className={`mt-1 max-w-full truncate text-[13px] font-black leading-tight tabular-nums sm:text-sm md:text-base ${toneClass}`}>
        <VisualMoney value={signed ? formatSignedEUR(value) : formatEUR(value)} />
      </p>
      {hint ? <p className="mt-0.5 truncate text-[10px] font-semibold text-muted-foreground md:text-[11px]"><VisualMoney value={hint} /></p> : null}
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-foreground">{value}</span>
    </div>
  );
}

function ClosedMovementsList({ movements }: { movements: CashMovement[] }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-border/45 md:block">
        <div className="grid grid-cols-[5.5rem_10rem_minmax(0,1fr)_9rem] gap-4 bg-muted/35 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
          <span>Hora</span>
          <span>Tipo / estado</span>
          <span>Descrição</span>
          <span className="text-right">Valor</span>
        </div>
        <div className="divide-y divide-border/45">
          {movements.map((movement) => (
            <ClosedMovementTableRow key={movement.id} movement={movement} />
          ))}
        </div>
      </div>
      <div className="grid gap-2 md:hidden">
        {movements.map((movement) => (
          <ClosedMovementLine key={movement.id} movement={movement} />
        ))}
      </div>
    </>
  );
}

function ClosedMovementTableRow({ movement }: { movement: CashMovement }) {
  const out = isOutgoingMovement(movement.movement_type);
  const transfer = movement.movement_type === "transfer_in" || movement.movement_type === "transfer_out";
  const valueClass = transfer
    ? "text-sky-700 dark:text-sky-300"
    : out
      ? "text-rose-600"
      : "text-emerald-700 dark:text-emerald-400";

  return (
    <div className="grid min-h-[3.35rem] grid-cols-[5.5rem_10rem_minmax(0,1fr)_9rem] items-center gap-4 px-4 py-2.5 text-xs">
      <span className="font-semibold text-muted-foreground">{formatTime(movement.occurred_at)}</span>
      <span className="font-black text-foreground">{movementTypeLabel(movement.movement_type, movement.appointment_origin)}<span className="block text-[10px] font-semibold text-muted-foreground">{movementStateLabel(movement)}</span></span>
      <div className="min-w-0">
        <p className="truncate font-medium leading-snug text-foreground">{movement.description || "Movimento do caixa"}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{paymentMethodLabel(movement.payment_method)} · Registado por: {movement.responsible_name || "Não registado"}</p>
        {isCancelledServiceMovement(movement) && <CancellationAudit movement={movement} />}
      </div>
      <span className={`text-right text-sm font-black tabular-nums ${isCancelledServiceMovement(movement) ? "text-muted-foreground" : valueClass}`}>
        <VisualMoney value={isCancelledServiceMovement(movement) ? formatEUR(0) : `${out ? "-" : "+"}${formatEUR(movement.amount)}`} />
        {isCancelledServiceMovement(movement) && <span className="block text-[10px] font-medium">Recebido <VisualMoney value={formatEUR(movement.amount)} /></span>}
      </span>
    </div>
  );
}

function ClosedMovementLine({ movement }: { movement: CashMovement }) {
  const out = isOutgoingMovement(movement.movement_type);
  const transfer = movement.movement_type === "transfer_in" || movement.movement_type === "transfer_out";
  const Icon = transfer ? Repeat2 : out ? ArrowUpRight : ArrowDownLeft;
  const iconClass = transfer
    ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
    : out
      ? "bg-rose-500/10 text-rose-600"
      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  const valueClass = transfer
    ? "text-sky-700 dark:text-sky-300"
    : out
      ? "text-rose-600"
      : "text-emerald-700 dark:text-emerald-400";
  return (
    <div className="grid min-h-[4.15rem] grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border/45 bg-card/65 px-3 py-2.5">
      <span className={`grid size-8 place-items-center rounded-full ${iconClass}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="text-xs font-black leading-tight text-foreground">
            {movementTypeLabel(movement.movement_type, movement.appointment_origin)} · {movementStateLabel(movement)}
          </p>
          <span className="text-[10px] font-semibold text-muted-foreground">
            {formatTime(movement.occurred_at)}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-xs leading-relaxed text-muted-foreground">
          {movement.description || "Movimento do caixa"}
        </p>
        <p className="mt-0.5 truncate text-[10px] leading-tight text-muted-foreground">
          {paymentMethodLabel(movement.payment_method)} · Registado por: {movement.responsible_name || "Não registado"}
        </p>
        {isCancelledServiceMovement(movement) && <CancellationAudit movement={movement} />}
      </div>
      <p className={`min-w-[5.75rem] text-right text-sm font-black leading-tight tabular-nums ${isCancelledServiceMovement(movement) ? "text-muted-foreground" : valueClass}`}>
        <VisualMoney value={isCancelledServiceMovement(movement) ? formatEUR(0) : `${out ? "-" : "+"}${formatEUR(movement.amount)}`} />
        {isCancelledServiceMovement(movement) && <span className="block text-[10px] font-medium">Recebido <VisualMoney value={formatEUR(movement.amount)} /></span>}
      </p>
    </div>
  );
}

function ClosedSessionRow({ session }: { session: ClosedCashSession }) {
  const diff = cashSessionTotals(session).difference;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border/45 bg-card/60 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Caixa fechado</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {formatDateTimeShort(session.closed_at ?? session.opened_at)}
        </p>
      </div>
      <p className={`text-sm font-bold text-right ${diff < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}`}>
          <VisualMoney value={formatEUR(diff)} />
      </p>
    </div>
  );
}

function ClientPill({ client, onClear }: { client: ClientOption; onClear: () => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-700/25 bg-emerald-950/5 px-3 py-2">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium leading-snug">{client.name}</p>
        <p className="break-words text-xs leading-relaxed text-muted-foreground">{client.phone}</p>
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

function DateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const date = value ? value.slice(0, 10) : localDateValue(new Date());
  const time = value ? value.slice(11, 16) : "09:00";
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
      <PremiumDatePicker
        value={date}
        onChange={(nextDate) => {
          if (nextDate) onChange(`${nextDate}T${time}`);
        }}
        placeholder="Escolher data"
        className={`${controlClass} h-11`}
      />
      <PremiumTimeSelect
        value={time}
        onChange={(nextTime) => onChange(`${date}T${nextTime}`)}
        className="h-11 rounded-2xl bg-background/85 px-4 text-sm"
      />
    </div>
  );
}

function totalReceived(register: CashRegister) {
  return (
    Number(register.total_cash ?? 0) +
    Number(register.total_mb_way ?? 0) +
    Number(register.total_card ?? 0) +
    Number(register.total_bank_transfer ?? 0) +
    Number(register.total_other ?? 0)
  );
}

function isVoidedServiceMovement(movement: CashMovement) {
  return movement.movement_type === "service_payment" && Boolean(movement.source_key?.startsWith("voided:"));
}

function isCancelledServiceMovement(movement: CashMovement) {
  if (isVoidedServiceMovement(movement)) return false;
  return (movement.movement_type === "service_payment" || movement.movement_type === "online_payment") &&
    movement.appointment_status === "cancelled";
}

function effectiveServiceRevenue(movements: CashMovement[]) {
  return movements.reduce((cents, movement) =>
    cents + ((movement.movement_type === "service_payment" || movement.movement_type === "online_payment") &&
      !isCancelledServiceMovement(movement) ? Math.round(Number(movement.amount || 0) * 100) : 0), 0) / 100;
}

function effectiveCashIncome(movements: CashMovement[]) {
  return movements.reduce((cents, movement) =>
    cents + (!isOutgoingMovement(movement.movement_type) && !isCancelledServiceMovement(movement)
      ? Math.round(Number(movement.amount || 0) * 100) : 0), 0) / 100;
}

function effectiveCashBalance(opening: number, movements: CashMovement[]) {
  const outgoingCents = movements.reduce((cents, movement) =>
    cents + (isOutgoingMovement(movement.movement_type) ? Math.round(Number(movement.amount || 0) * 100) : 0), 0);
  return (Math.round(Number(opening || 0) * 100) + Math.round(effectiveCashIncome(movements) * 100) - outgoingCents) / 100;
}

function cancelledMovementDetail(movement: CashMovement) {
  if (!isCancelledServiceMovement(movement)) return null;
  const date = movement.cancelled_at ? formatDateTimeShort(movement.cancelled_at) : "Data não registada";
  return `Motivo: ${movement.cancellation_reason || "Não registado"} · ${date} · Por: ${movement.cancelled_by_name || "Não registado"}`;
}

function CancellationAudit({ movement }: { movement: CashMovement }) {
  if (!isCancelledServiceMovement(movement)) return null;
  return (
    <details className="mt-1 min-w-0 text-[10px] text-rose-700 dark:text-rose-300">
      <summary className="cursor-pointer font-semibold">Ver motivo</summary>
      <p className="mt-1 break-words leading-snug">{cancelledMovementDetail(movement)}</p>
      <p className="mt-1 leading-snug text-muted-foreground">Sem reembolso automático.</p>
    </details>
  );
}

function normalizeClosedSession(session: ClosedCashSession): ClosedCashSession {
  const movements = Array.isArray(session.movements) ? session.movements : [];
  const normalizedMovements = movements.map((movement) => ({
    ...movement,
    amount: Number(movement.amount ?? 0),
  }));
  const totalIn = normalizedMovements.reduce(
    (sum, movement) => sum + (isOutgoingMovement(movement.movement_type) ? 0 : Number(movement.amount ?? 0)),
    0,
  );
  const totalOut = normalizedMovements.reduce(
    (sum, movement) => sum + (isOutgoingMovement(movement.movement_type) ? Number(movement.amount ?? 0) : 0),
    0,
  );
  const openingAmount = Number(session.opening_amount ?? 0);
  const countedAmount = Number(session.closing_counted_amount ?? 0);
  const expectedAmount = openingAmount + totalIn - totalOut;
  return {
    ...session,
    opening_amount: openingAmount,
    closing_counted_amount: countedAmount,
    expected_cash_amount: expectedAmount,
    difference_amount: countedAmount - expectedAmount,
    total_in: totalIn,
    total_out: totalOut,
    movement_count: normalizedMovements.length,
    movements: normalizedMovements,
  };
}

function isOutgoingMovement(type: string) {
  return type === "manual_out" || type === "sangria" || type === "transfer_out";
}

function cashSessionTotals(session: ClosedCashSession) {
  const opening = Number(session.opening_amount ?? 0);
  const physicalIncome = Number(session.total_in ?? 0);
  const income = effectiveCashIncome(session.movements);
  const outcome = Number(session.total_out ?? 0);
  const counted = Number(session.closing_counted_amount ?? 0);
  const expected = opening + physicalIncome - outcome;
  const validBalance = effectiveCashBalance(opening, session.movements);
  return {
    opening,
    income,
    physicalIncome,
    outcome,
    counted,
    expected,
    validBalance,
    difference: counted - expected,
    profit: income - outcome,
  };
}

function cashSessionProfit(session: ClosedCashSession) {
  return cashSessionTotals(session).profit;
}

function cashSessionComparison(session: ClosedCashSession, previousSession?: ClosedCashSession) {
  const current = cashSessionProfit(session);
  if (!previousSession) {
    return {
      amount: 0,
      tone: "neutral" as const,
      className: "text-muted-foreground",
      label: "Sem fechamento anterior para comparar",
    };
  }

  const previous = cashSessionProfit(previousSession);
  const amount = current - previous;
  const isGrowth = amount >= 0;
  const className = isGrowth ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600";

  if (previous === 0) {
    return {
      amount,
      tone: isGrowth ? ("positive" as const) : ("negative" as const),
      className,
      label: `${isGrowth ? "▲" : "▼"} ${formatSignedEUR(amount)} em relação ao fechamento anterior`,
    };
  }

  const percent = (amount / Math.abs(previous)) * 100;
  return {
    amount,
    tone: isGrowth ? ("positive" as const) : ("negative" as const),
    className,
    label: `${isGrowth ? "▲" : "▼"} ${formatSignedEUR(amount)} (${formatPercent(percent)}) em relação ao fechamento anterior`,
  };
}

function comparisonShortLabel(amount: number, tone: "neutral" | "positive" | "negative") {
  if (tone === "neutral") return "Sem anterior";
  return `${amount >= 0 ? "↑" : "↓"} ${formatSignedEUR(amount)} vs anterior`;
}

function filterClosedSessions(sessions: ClosedCashSession[], filter: "today" | "7d" | "30d" | "all") {
  if (filter === "all") return sessions;
  const now = new Date();
  const start = new Date(now);
  if (filter === "today") {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - (filter === "7d" ? 7 : 30));
  }
  return sessions.filter((session) => new Date(session.closed_at ?? session.opened_at).getTime() >= start.getTime());
}

function formatDuration(startValue: string, endValue: string) {
  const minutes = Math.max(0, Math.round((new Date(endValue).getTime() - new Date(startValue).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
}

function differenceState(diff: number) {
  if (diff > 0) {
    return {
      label: "Sobrou dinheiro",
      message: "Sobrou dinheiro",
      tone: "positive" as const,
      textClass: "text-emerald-700 dark:text-emerald-400",
      badgeClass: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300",
    };
  }
  if (diff < 0) {
    return {
      label: "Faltou dinheiro",
      message: "Faltou dinheiro",
      tone: "negative" as const,
      textClass: "text-rose-600",
      badgeClass: "bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/20",
    };
  }
  return {
    label: "Conferido",
    message: "Caixa conferido",
    tone: "neutral" as const,
    textClass: "text-emerald-700 dark:text-emerald-400",
    badgeClass: "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300",
  };
}

function toDateTimeLocal(date: Date) {
  return `${localDateValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function localDateValue(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatEUR(value: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(value || 0));
}

function formatSignedEUR(value: number) {
  const amount = Number(value || 0);
  if (amount === 0) return formatEUR(0);
  return `${amount > 0 ? "+" : "-"}${formatEUR(Math.abs(amount))}`;
}

function formatPercent(value: number) {
  const amount = Number(value || 0);
  const formatted = new Intl.NumberFormat("pt-PT", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(amount));
  return `${amount >= 0 ? "+" : "-"}${formatted}%`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTimeShort(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" })} · ${date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}`;
}

function paymentMethodLabel(value: string | null | undefined) {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? "Não registado";
}

function formatDateTimeRange(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateOptions = { day: "2-digit", month: "2-digit" } as const;
  const timeOptions = { hour: "2-digit", minute: "2-digit" } as const;
  return `${startDate.toLocaleDateString("pt-PT", dateOptions)} ${startDate.toLocaleTimeString("pt-PT", timeOptions)} -> ${endDate.toLocaleDateString("pt-PT", dateOptions)} ${endDate.toLocaleTimeString("pt-PT", timeOptions)}`;
}

function formatDateTimeRangeCompact(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const dateOptions = { day: "2-digit", month: "2-digit" } as const;
  const timeOptions = { hour: "2-digit", minute: "2-digit" } as const;
  return `${startDate.toLocaleDateString("pt-PT", dateOptions)} ${startDate.toLocaleTimeString("pt-PT", timeOptions)} • ${endDate.toLocaleDateString("pt-PT", dateOptions)} ${endDate.toLocaleTimeString("pt-PT", timeOptions)}`;
}

function movementTypeLabel(value: string, origin?: CashMovement["appointment_origin"]) {
  if (value === "sangria") return "Sangria";
  if (value === "transfer_in") return "Transferência recebida";
  if (value === "transfer_out") return "Transferência enviada";
  if (value === "service_payment") return origin === "fit" ? "Encaixe" : origin === "online" ? "Reserva online" : origin === "onsite" ? "Agendamento presencial" : "Pagamento de serviço";
  if (value === "online_payment") return "Pagamento online";
  if (value === "manual_in") return "Entrada";
  if (value === "manual_out") return "Saída";
  return "Movimento";
}

function movementStateLabel(movement: CashMovement) {
  if (isVoidedServiceMovement(movement)) return "ANULADO · Registo incorreto";
  if (isCancelledServiceMovement(movement)) {
    if (movement.refund_status === "refunded") return "CANCELADO · Reembolsado";
    if (movement.refund_status === "pending") return "CANCELADO · Pago, reembolso pendente";
    return "CANCELADO · Pago, reembolso não registado";
  }
  if (movement.appointment_status === "cancelled") return "Cancelada · valor recebido";
  if (isOutgoingMovement(movement.movement_type)) return "Efetuada";
  return movement.movement_type === "service_payment" ? "Recebida" : "Registada";
}

function cleanPhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function cashErrorMessage(message: string) {
  if (message.includes("invalid_description")) return "Adicione uma descricao curta.";
  if (message.includes("cash_register_close_failed")) return "Nao foi possivel fechar o caixa. Tente novamente.";
  if (message.includes("cash_register_already_open")) return "Já existe um caixa aberto.";
  if (message.includes("cash_register_not_open")) return "Abra o caixa antes de continuar.";
  if (message.includes("invalid_amount")) return "Indique um valor válido.";
  if (message.includes("not_authorized")) return "Sem permissão para gerir este caixa.";
  return message || "Não foi possível atualizar o caixa.";
}

function walkInErrorMessage(message: string) {
  if (message.includes("cash_register_not_open")) return "Abra o caixa antes de criar um encaixe pago.";
  if (message.includes("outside_staff_availability")) return "Este horário está fora da disponibilidade do profissional.";
  if (message.includes("staff_unavailable")) return "O profissional está indisponível neste horário.";
  if (message.includes("slot_unavailable")) return "Este horário já está ocupado.";
  if (message.includes("service_not_found")) return "Serviço indisponível.";
  if (message.includes("staff_not_found")) return "Profissional indisponível.";
  if (message.includes("not_authorized")) return "Sem permissão para criar encaixes.";
  return message || "Não foi possível criar o encaixe.";
}
