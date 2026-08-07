import { createPortal } from "react-dom";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Euro,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Printer,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import {
  InternationalPhoneInput,
  isValidInternationalPhone,
  normalizeInternationalPhone,
} from "@/components/ui/international-phone-input";
import { ExpandableList } from "@/components/ui/expandable-list";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { sortAppointmentsChronologically as sortAppointmentsChronologicallyShared } from "@/lib/appointment-ordering";
import { getRescheduleUserMessage } from "@/lib/appointment-reschedule-errors";
import { getPublicReservationCode } from "@/lib/reservation-code";
import { rescheduleStudioAppointment } from "@/lib/studio-appointment.functions";
import {
  computeAttendanceRevenue,
  computeFinancialSplit,
  formatAppointmentStatus,
  formatEUR,
  isFinanciallyRelevantAppointment,
  type FinancialRuleSource,
} from "@/lib/utils";
import { sendAppointmentConfirmationForAppointment } from "@/lib/whatsapp.functions";
import {
  buildPastAppointmentWhatsAppMessage,
  buildWhatsAppComposeUrl,
  isPastAppointment,
} from "@/lib/appointment-whatsapp-message";
import {
  buildAgendaDayGroups,
  findNextOperationalAppointmentId,
  getAgendaTimelineState,
  type AgendaTimelineState,
} from "@/lib/agenda-list-presentation";
import {
  createInPersonMbWayPayment,
  getInPersonMbWaySettings,
} from "@/lib/in-person-mbway.functions";
import { ProfessionalTimeline } from "@/components/agenda/professional-timeline";
import type {
  ProfessionalTimelineAppointment,
  ProfessionalTimelinePerson,
} from "@/components/agenda/professional-timeline-utils";
import {
  TimelineAppointmentDrawer,
  type TimelineDrawerAction,
} from "@/components/agenda/timeline-appointment-drawer";

export const Route = createFileRoute("/_authenticated/admin/agenda")({
  component: AgendaPage,
});

// ─── Types ───────────────────────────────────────────────────────────────────

type Appt = {
  id: string;
  public_token?: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  total_price: number;
  total_duration_min?: number | null;
  notes: string | null;
  clients: {
    name: string;
    phone: string;
    avatar_url?: string | null;
    date_of_birth?: string | null;
  } | null;
  staff: ({ id: string; name: string } & FinancialRuleSource) | null;
  appointment_services?: {
    price: number;
    services: ({ name: string } & FinancialRuleSource) | null;
  }[];
};

type PaidRow = { appointment_id: string | null; amount_cents: number; status: string };
type CashPaymentRow = { appointment_id: string | null; amount: number; movement_type: string };
type MessageLog = {
  appointment_id: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  reason: string | null;
  created_at: string;
};

type AgendaFilters = {
  dateMode: "all" | "today" | "upcoming" | "specific";
  date: string;
  staffId: string;
  service: string;
  status: string;
  client: string;
  payment: "all" | "online" | "studio" | "pending";
  confirmation: "all" | "confirmed" | "unconfirmed";
  attendance: "all" | "attended" | "missed";
};

type StudioService = { id: string; name: string; price: number; duration_min: number };
type StudioStaff = { id: string; name: string; photo_url?: string | null; is_active?: boolean };
type StudioClient = { id: string; name: string; phone: string };
type StaffAvailabilityRow = {
  staff_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};
type StaffTimeOffRow = {
  id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
};
type StudioPaymentMethod = "cash" | "card" | "mb_way" | "other";
type StaffAgendaVisibility = "private" | "team_busy" | "team_basic";

const EMPTY_FILTERS: AgendaFilters = {
  dateMode: "all",
  date: "",
  staffId: "all",
  service: "all",
  status: "all",
  client: "",
  payment: "all",
  confirmation: "all",
  attendance: "all",
};

// ─── Page ────────────────────────────────────────────────────────────────────

function AgendaPage() {
  const { studio } = useCurrentStudio();
  const resendWhatsApp = useServerFn(sendAppointmentConfirmationForAppointment);
  const getMbWaySettings = useServerFn(getInPersonMbWaySettings);
  const createMbWayCharge = useServerFn(createInPersonMbWayPayment);
  const exportBtnRef = useRef<HTMLButtonElement>(null);

  const [appts, setAppts] = useState<Appt[]>([]);
  const [paidRows, setPaidRows] = useState<PaidRow[]>([]);
  const [cashPaymentRows, setCashPaymentRows] = useState<CashPaymentRow[]>([]);
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [groupCollapseOverrides, setGroupCollapseOverrides] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [savingPresenceId, setSavingPresenceId] = useState<string | null>(null);
  const [resendingMessageId, setResendingMessageId] = useState<string | null>(null);
  const [receivingPaymentId, setReceivingPaymentId] = useState<string | null>(null);
  const [paymentDialogAppt, setPaymentDialogAppt] = useState<Appt | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [filters, setFilters] = useState<AgendaFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [agendaToolsOpen, setAgendaToolsOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [showDepositSplit, setShowDepositSplit] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [agendaScope, setAgendaScope] = useState<"mine" | "team">("mine");
  const [newApptOpen, setNewApptOpen] = useState(false);
  const [newApptDefaults, setNewApptDefaults] = useState<{
    staffId?: string;
    date?: string;
    time?: string;
  } | null>(null);
  const [blockTimeDefaults, setBlockTimeDefaults] = useState<{
    staffId: string;
    date: string;
    time: string;
  } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editApptId, setEditApptId] = useState<string | null>(null);
  const [rescheduleApptId, setRescheduleApptId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "excel" | "pdf" | null>(null);
  const [enableInPersonMbWay, setEnableInPersonMbWay] = useState(false);
  const [agendaNow, setAgendaNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => startOfLocalDay(new Date()));
  const [timelineFocusRequest, setTimelineFocusRequest] = useState(0);
  const [timelineDetailId, setTimelineDetailId] = useState<string | null>(null);
  const [agendaStaff, setAgendaStaff] = useState<StudioStaff[]>([]);
  const [staffAvailability, setStaffAvailability] = useState<StaffAvailabilityRow[]>([]);
  const [staffTimeOff, setStaffTimeOff] = useState<StaffTimeOffRow[]>([]);
  const selectedDayButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDateScrollerRef = useRef<HTMLDivElement>(null);
  const mobileDateAnchorRef = useRef(startOfLocalDay(new Date()));
  const prependScrollWidthRef = useRef<number | null>(null);
  const dateRangeLoadingRef = useRef(false);
  const dateScrollFrameRef = useRef<number | null>(null);
  const selectedDateScrollPendingRef = useRef(true);
  const [mobileDateRange, setMobileDateRange] = useState({ start: -21, end: 21 });
  const [mobileCalendarMonth, setMobileCalendarMonth] = useState(selectedDate);
  const mobileAgendaDays = useMemo(
    () =>
      getMobileAgendaDays(mobileDateAnchorRef.current, mobileDateRange.start, mobileDateRange.end),
    [mobileDateRange.end, mobileDateRange.start],
  );
  const loadStaffTimeOffForDate = useCallback(
    async (date: Date) => {
      if (!studio?.id) return;
      const dayStart = startOfLocalDay(date);
      const dayEnd = addLocalDays(dayStart, 1);
      const { data } = await supabase
        .from("staff_time_off")
        .select("id,staff_id,starts_at,ends_at,reason")
        .eq("studio_id", studio.id)
        .lt("starts_at", dayEnd.toISOString())
        .gt("ends_at", dayStart.toISOString())
        .order("starts_at");
      setStaffTimeOff((data ?? []) as StaffTimeOffRow[]);
    },
    [studio?.id],
  );

  useEffect(() => {
    setShowDepositSplit(localStorage.getItem("agenda-show-deposit-split") === "true");
  }, []);
  useEffect(() => {
    localStorage.setItem("agenda-show-deposit-split", String(showDepositSplit));
  }, [showDepositSplit]);
  useEffect(() => {
    const timer = window.setInterval(() => setAgendaNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () => () => {
      if (dateScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dateScrollFrameRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [mobileFiltersOpen]);

  useEffect(() => {
    const selectedOffset = differenceInLocalCalendarDays(selectedDate, mobileDateAnchorRef.current);
    setMobileDateRange((current) => {
      if (selectedOffset >= current.start && selectedOffset <= current.end) return current;
      return {
        start: Math.min(current.start, selectedOffset - 14),
        end: Math.max(current.end, selectedOffset + 14),
      };
    });
  }, [selectedDate]);

  useLayoutEffect(() => {
    const scroller = mobileDateScrollerRef.current;
    const previousWidth = prependScrollWidthRef.current;
    if (scroller && previousWidth !== null) {
      scroller.scrollLeft += scroller.scrollWidth - previousWidth;
    }
    prependScrollWidthRef.current = null;
    dateRangeLoadingRef.current = false;
    if (selectedDateScrollPendingRef.current && selectedDayButtonRef.current) {
      selectedDayButtonRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
      selectedDateScrollPendingRef.current = false;
    }
  }, [mobileDateRange.end, mobileDateRange.start, selectedDate]);

  useEffect(() => {
    if (!studio) return;
    loadData();
  }, [studio]);

  useEffect(() => {
    let mounted = true;
    getMbWaySettings({ data: undefined as never })
      .then((settings) => {
        if (mounted) setEnableInPersonMbWay(Boolean(settings.enableInPersonMbWay));
      })
      .catch(() => {
        if (mounted) setEnableInPersonMbWay(false);
      });
    return () => {
      mounted = false;
    };
  }, [getMbWaySettings]);

  useEffect(() => {
    const visibility = (studio?.staff_agenda_visibility ?? "private") as StaffAgendaVisibility;
    if (studio?.role !== "staff" || visibility === "private") setAgendaScope("mine");
  }, [studio?.role, studio?.staff_agenda_visibility]);

  async function loadData(options?: { silent?: boolean }) {
    if (!studio) return;
    if (!options?.silent) setLoading(true);
    const staffAgendaVisibility = (studio.staff_agenda_visibility ??
      "private") as StaffAgendaVisibility;
    const canStaffLoadTeamAgenda = studio.role === "staff" && staffAgendaVisibility !== "private";
    const staffDataFilter =
      studio.role === "staff" && !canStaffLoadTeamAgenda ? studio.staff_id : null;
    const [{ data }, staffResult, availabilityResult] = await Promise.all([
      fetchAgendaAppointments(studio.id, staffDataFilter),
      supabase
        .from("staff")
        .select("id,name,photo_url,is_active")
        .eq("studio_id", studio.id)
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("staff_availability")
        .select("staff_id,weekday,start_time,end_time")
        .eq("studio_id", studio.id),
    ]);
    const appointmentRows = sortAppointmentsChronologically((data ?? []) as unknown as Appt[]);
    const sensitiveAppointmentIds =
      studio.role === "staff"
        ? appointmentRows
            .filter((appt) => appt.staff?.id === studio.staff_id)
            .map((appt) => appt.id)
        : appointmentRows.map((appt) => appt.id);
    const shouldLoadSensitiveRows = studio.role !== "staff" || sensitiveAppointmentIds.length > 0;
    const [paymentsResult, cashPaymentsResult, logsResult] = shouldLoadSensitiveRows
      ? await Promise.all([
          scopeAppointmentRows(
            supabase
              .from("payment_intents")
              .select("appointment_id,amount_cents,status")
              .eq("studio_id", studio.id),
            studio.role === "staff" ? sensitiveAppointmentIds : null,
          ),
          scopeAppointmentRows(
            (supabase as any)
              .from("cash_register_movements")
              .select("appointment_id,amount,movement_type")
              .eq("studio_id", studio.id)
              .eq("movement_type", "service_payment"),
            studio.role === "staff" ? sensitiveAppointmentIds : null,
          ),
          scopeAppointmentRows(
            (supabase as any)
              .from("whatsapp_message_logs")
              .select("appointment_id,status,reason,created_at")
              .eq("studio_id", studio.id)
              .order("created_at", { ascending: false }),
            studio.role === "staff" ? sensitiveAppointmentIds : null,
          ),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    setAppts(appointmentRows);
    setAgendaStaff((staffResult.data ?? []) as StudioStaff[]);
    setStaffAvailability((availabilityResult.data ?? []) as StaffAvailabilityRow[]);
    setPaidRows((paymentsResult.data ?? []) as PaidRow[]);
    setCashPaymentRows((cashPaymentsResult.data ?? []) as CashPaymentRow[]);
    setMessageLogs((logsResult.data ?? []) as MessageLog[]);
    if (!options?.silent) setLoading(false);
  }

  useEffect(() => {
    if (!studio?.id) return;
    let refreshTimer: number | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void loadData({ silent: true });
      }, 650);
    };
    const channel = supabase
      .channel(`admin-agenda-live-${studio.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "appointments",
          filter: `studio_id=eq.${studio.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_intents",
          filter: `studio_id=eq.${studio.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "booking_payment_requests",
          filter: `studio_id=eq.${studio.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cash_register_movements",
          filter: `studio_id=eq.${studio.id}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointment_services" },
        scheduleRefresh,
      )
      .subscribe();
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
    // loadData intentionally reads the latest studio state from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio?.id, studio?.role, studio?.staff_id]);

  // Derived maps
  const paidByAppointment = new Map<string, number>();
  for (const p of paidRows) {
    if (!p.appointment_id || p.status !== "succeeded") continue;
    paidByAppointment.set(
      p.appointment_id,
      (paidByAppointment.get(p.appointment_id) ?? 0) + p.amount_cents / 100,
    );
  }
  for (const p of cashPaymentRows) {
    if (!p.appointment_id || p.movement_type !== "service_payment") continue;
    paidByAppointment.set(
      p.appointment_id,
      (paidByAppointment.get(p.appointment_id) ?? 0) + Number(p.amount || 0),
    );
  }
  const latestMessageByAppointment = new Map<string, MessageLog>();
  for (const log of messageLogs) {
    if (!log.appointment_id || latestMessageByAppointment.has(log.appointment_id)) continue;
    latestMessageByAppointment.set(log.appointment_id, log);
  }

  // Filtering
  const isProfessionalPanel = studio?.role === "staff";
  const staffAgendaVisibility = (studio?.staff_agenda_visibility ??
    "private") as StaffAgendaVisibility;
  const canStaffViewTeamAgenda = isProfessionalPanel && staffAgendaVisibility !== "private";
  const canStaffViewBasicDetails = staffAgendaVisibility === "team_basic";
  const filterOptions = buildFilterOptions(appts);
  const activeFilterCount = countActiveFilters(filters);
  const filteredAppts = sortAppointmentsChronologically(
    appts.filter((a) => {
      if (isProfessionalPanel) {
        if (!canStaffViewTeamAgenda || agendaScope === "mine") {
          if (a.staff?.id !== studio?.staff_id) return false;
        }
      }
      if (!appointmentMatchesFilters(a, filters, paidByAppointment)) return false;
      if (searchQuery.trim()) {
        const q = normalizeFilterText(searchQuery);
        const canSeeSensitive = canViewSensitiveAppointment(a, studio);
        const canSeeBasic = canSeeSensitive || canStaffViewBasicDetails;
        const hay = normalizeFilterText(
          `${canSeeSensitive ? `${a.clients?.name ?? ""} ${a.clients?.phone ?? ""}` : ""} ${canSeeBasic ? appointmentServiceLabel(a) : ""} ${a.staff?.name ?? ""}`,
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    }),
  );
  const sensitiveFilteredAppts = filteredAppts.filter((a) =>
    canViewSensitiveAppointment(a, studio),
  );

  // KPIs
  const now = agendaNow;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  const startYesterday = new Date(startOfToday);
  startYesterday.setDate(startOfToday.getDate() - 1);
  const startLastWeek = new Date(startOfWeek);
  startLastWeek.setDate(startOfWeek.getDate() - 7);

  const todayAppts = filteredAppts.filter((a) => {
    const d = new Date(a.starts_at);
    return d >= startOfToday && d < new Date(startOfToday.getTime() + 86400000);
  });
  const yesterdayAppts = appts.filter((a) => {
    const d = new Date(a.starts_at);
    return d >= startYesterday && d < startOfToday;
  });
  const weekAppts = filteredAppts.filter((a) => {
    const d = new Date(a.starts_at);
    return d >= startOfWeek && d < endOfWeek;
  });
  const lastWeekAppts = appts.filter((a) => {
    const d = new Date(a.starts_at);
    return d >= startLastWeek && d < startOfWeek;
  });
  const activeClients = new Set(sensitiveFilteredAppts.map((a) => a.clients?.phone).filter(Boolean))
    .size;
  const lastWeekClients = new Set(lastWeekAppts.map((a) => a.clients?.phone).filter(Boolean)).size;
  const totalRevenue = sensitiveFilteredAppts.reduce((sum, a) => {
    const p = paidByAppointment.get(a.id) ?? 0;
    if (!isFinanciallyRelevantAppointment(a.status, p)) return sum;
    return sum + computeAttendanceRevenue(a.total_price, p, a.status).confirmed;
  }, 0);
  const lastWeekRevenue = lastWeekAppts.reduce((sum, a) => {
    const p = paidByAppointment.get(a.id) ?? 0;
    if (!isFinanciallyRelevantAppointment(a.status, p)) return sum;
    return sum + computeAttendanceRevenue(a.total_price, p, a.status).confirmed;
  }, 0);

  function pctChange(cur: number, prev: number) {
    if (prev === 0) return cur > 0 ? 100 : 0;
    return Math.round(((cur - prev) / prev) * 100);
  }

  // Presentation-only daily grouping. Today and upcoming dates stay first in
  // ascending order; historical dates follow with the most recent day first.
  const dayGroups = buildAgendaDayGroups(filteredAppts, now);
  const nextAppointmentId = findNextOperationalAppointmentId(filteredAppts, now);
  const visibleAgendaStaff = agendaStaff.filter((person) => {
    if (
      isProfessionalPanel &&
      (!canStaffViewTeamAgenda || agendaScope === "mine") &&
      person.id !== studio?.staff_id
    ) {
      return false;
    }
    return filters.staffId === "all" || filters.staffId === person.id;
  });
  const timelineProfessionals: ProfessionalTimelinePerson[] = visibleAgendaStaff.map((person) => ({
    id: person.id,
    name: person.name,
    avatarUrl: person.photo_url,
  }));
  for (const [id, name] of filterOptions.professionals) {
    if (filters.staffId !== "all" && filters.staffId !== id) continue;
    if (!timelineProfessionals.some((person) => person.id === id)) {
      timelineProfessionals.push({ id, name });
    }
  }

  useEffect(() => {
    if (!studio?.id) return;
    void loadStaffTimeOffForDate(selectedDate);
  }, [loadStaffTimeOffForDate, selectedDate, studio?.id]);

  useEffect(() => {
    if (!studio?.id) return;
    let refreshTimer: number | null = null;
    const channel = supabase
      .channel(`admin-agenda-blocks-${studio.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "staff_time_off",
          filter: `studio_id=eq.${studio.id}`,
        },
        () => {
          if (refreshTimer) window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => {
            void loadStaffTimeOffForDate(selectedDate);
          }, 300);
        },
      )
      .subscribe();
    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [loadStaffTimeOffForDate, selectedDate, studio?.id]);
  const hasUnassignedAppointments = filteredAppts.some((appointment) => !appointment.staff?.id);
  if (hasUnassignedAppointments) {
    timelineProfessionals.push({ id: "unassigned", name: "Sem profissional" });
  }
  const timelineAppointments: ProfessionalTimelineAppointment[] = filteredAppts
    .filter((appointment) => isSameLocalDay(new Date(appointment.starts_at), selectedDate))
    .map((appointment) => {
      const canSeeSensitive = canViewSensitiveAppointment(appointment, studio);
      const canSeeBasic = canSeeSensitive || canStaffViewBasicDetails;
      return {
        id: appointment.id,
        staffId: appointment.staff?.id ?? "unassigned",
        startsAt: appointment.starts_at,
        endsAt: appointment.ends_at,
        status: appointment.status,
        clientName: canSeeSensitive
          ? (appointment.clients?.name ?? "Sem cliente")
          : "Horário ocupado",
        serviceName: canSeeBasic ? appointmentServiceLabel(appointment) : "Ocupado",
        professionalName: appointment.staff?.name ?? "Sem profissional",
        valueLabel: canSeeSensitive ? formatEUR(appointment.total_price) : undefined,
        durationLabel: formatDurationBetween(
          appointment.starts_at,
          appointment.ends_at,
          appointment.total_duration_min,
        ),
        privateDetails: canSeeSensitive,
      };
    });
  const visibleProfessionalIds = new Set(timelineProfessionals.map((person) => person.id));
  const timelineBlocks: ProfessionalTimelineAppointment[] = staffTimeOff
    .filter((block) => visibleProfessionalIds.has(block.staff_id))
    .map((block) => {
      const selectedDayStart = startOfLocalDay(selectedDate).getTime();
      const selectedDayEnd = addLocalDays(selectedDate, 1).getTime();
      const clippedStart = new Date(
        Math.max(new Date(block.starts_at).getTime(), selectedDayStart),
      );
      const clippedEnd = new Date(Math.min(new Date(block.ends_at).getTime(), selectedDayEnd - 1));
      return {
        id: `block-${block.id}`,
        sourceId: block.id,
        staffId: block.staff_id,
        startsAt: clippedStart.toISOString(),
        endsAt: clippedEnd.toISOString(),
        status: "blocked",
        kind: "block",
        clientName: block.reason?.trim() || "Bloqueado",
        serviceName: "Bloqueio",
        professionalName:
          agendaStaff.find((person) => person.id === block.staff_id)?.name ?? "Profissional",
        durationLabel: formatDurationBetween(clippedStart.toISOString(), clippedEnd.toISOString()),
        privateDetails: false,
      };
    });
  const selectedAvailability = staffAvailability
    .filter(
      (period) =>
        period.weekday === selectedDate.getDay() && visibleProfessionalIds.has(period.staff_id),
    )
    .map((period) => ({
      startMinutes: timeValueToMinutes(period.start_time),
      endMinutes: timeValueToMinutes(period.end_time),
    }))
    .filter((period) => period.endMinutes > period.startMinutes);
  const timelineEntries = [...timelineAppointments, ...timelineBlocks];
  const timelineDetailAppt = timelineDetailId
    ? (appts.find((appointment) => appointment.id === timelineDetailId) ?? null)
    : null;
  const selectedBlock = selectedBlockId
    ? (staffTimeOff.find((block) => block.id === selectedBlockId) ?? null)
    : null;

  function toggleGroup(key: string, defaultCollapsed: boolean) {
    setGroupCollapseOverrides((prev) => {
      const next = new Map(prev);
      const current = next.get(key) ?? defaultCollapsed;
      next.set(key, !current);
      return next;
    });
  }
  function updateFilter<K extends keyof AgendaFilters>(key: K, value: AgendaFilters[K]) {
    setFilters((c) => ({ ...c, [key]: value }));
    if (key === "date" && typeof value === "string" && value) {
      selectedDateScrollPendingRef.current = true;
      const nextDate = dateFromInputValue(value);
      setSelectedDate(nextDate);
      setMobileCalendarMonth(nextDate);
    }
    if (key === "dateMode" && (value === "today" || value === "upcoming")) {
      selectedDateScrollPendingRef.current = true;
      const today = startOfLocalDay(new Date());
      setSelectedDate(today);
      setMobileCalendarMonth(today);
    }
  }
  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    setMobileFiltersOpen(false);
  }
  function navigateToAgendaDate(date: Date) {
    selectedDateScrollPendingRef.current = true;
    setTimelineFocusRequest((current) => current + 1);
    const nextDate = startOfLocalDay(date);
    setSelectedDate(nextDate);
    setMobileCalendarMonth(nextDate);
    setFilters((current) => ({ ...current, dateMode: "all", date: "" }));
  }

  function extendMobileDateRange(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
    if (dateScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dateScrollFrameRef.current);
    }
    dateScrollFrameRef.current = window.requestAnimationFrame(() => {
      const center = scroller.scrollLeft + scroller.clientWidth / 2;
      let closest: HTMLButtonElement | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      for (const button of scroller.querySelectorAll<HTMLButtonElement>(
        "button[data-agenda-date]",
      )) {
        const distance = Math.abs(button.offsetLeft + button.offsetWidth / 2 - center);
        if (distance < closestDistance) {
          closest = button;
          closestDistance = distance;
        }
      }
      const dateValue = closest?.dataset.agendaDate;
      if (dateValue) setMobileCalendarMonth(dateFromInputValue(dateValue));
      dateScrollFrameRef.current = null;
    });
    if (dateRangeLoadingRef.current) return;
    const remaining = scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft;
    if (scroller.scrollLeft <= 96) {
      dateRangeLoadingRef.current = true;
      prependScrollWidthRef.current = scroller.scrollWidth;
      setMobileDateRange((current) => ({ ...current, start: current.start - 14 }));
      return;
    }
    if (remaining <= 96) {
      dateRangeLoadingRef.current = true;
      setMobileDateRange((current) => ({ ...current, end: current.end + 14 }));
    }
  }

  function closeMenu() {
    setMenuOpenId(null);
    setMenuAnchorEl(null);
  }

  // Actions
  async function markPresence(appt: Appt, nextStatus: "completed" | "no_show") {
    if (!studio) return;
    setSavingPresenceId(appt.id);
    const { error } = await supabase
      .from("appointments")
      .update({ status: nextStatus, updated_at: new Date().toISOString() } as any)
      .eq("id", appt.id)
      .eq("studio_id", studio.id);
    setSavingPresenceId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAppts((c) => c.map((i) => (i.id === appt.id ? { ...i, status: nextStatus } : i)));
    toast.success(nextStatus === "completed" ? "Atendimento confirmado." : "Falta registada.");
  }

  async function confirmStudioPayment(
    appt: Appt,
    paymentMethod: StudioPaymentMethod,
    options?: { phone?: string },
  ) {
    if (!studio) return;
    setReceivingPaymentId(appt.id);
    if (paymentMethod === "mb_way" && enableInPersonMbWay) {
      try {
        await createMbWayCharge({
          data: { appointmentId: appt.id, phone: options?.phone || appt.clients?.phone || "" },
        });
        setPaymentDialogAppt(null);
        await loadData({ silent: true });
        toast.success(
          "Cobrança MB WAY enviada. O pagamento será confirmado automaticamente pela Stripe.",
        );
      } catch (error) {
        toast.error(
          inPersonMbWayErrorMessage(error instanceof Error ? error.message : String(error)),
        );
      } finally {
        setReceivingPaymentId(null);
      }
      return;
    }
    const { error } = await (supabase as any).rpc("confirm_studio_appointment_payment", {
      p_appointment_id: appt.id,
      p_payment_method: paymentMethod,
    });
    setReceivingPaymentId(null);
    if (error) {
      toast.error(studioPaymentErrorMessage(error.message));
      return;
    }
    setPaymentDialogAppt(null);
    setAppts((c) => c.map((i) => (i.id === appt.id ? { ...i, status: "completed" } : i)));
    await loadData({ silent: true });
    toast.success("Pagamento confirmado e atendimento finalizado.");
  }

  async function cancelAppointment(apptId: string) {
    if (!studio) return;
    setCancellingId(apptId);
    const { error } = await supabase
      .from("appointments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() } as any)
      .eq("id", apptId)
      .eq("studio_id", studio.id);
    setCancellingId(null);
    setConfirmCancelId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAppts((c) => c.map((i) => (i.id === apptId ? { ...i, status: "cancelled" } : i)));
    toast.success("Marcação cancelada.");
  }

  async function resendMessage(appt: Appt) {
    if (isPastAppointment(appt.ends_at)) {
      const message = buildPastAppointmentWhatsAppMessage({
        clientName: appt.clients?.name ?? "",
        studioName: studio?.name ?? "",
        bookingUrl: studio?.slug ? `${window.location.origin}/s/${studio.slug}` : "",
        serviceName: appointmentServiceLabel(appt),
        startsAt: appt.starts_at,
        endsAt: appt.ends_at,
        status: appt.status,
      });
      const url = buildWhatsAppComposeUrl(appt.clients?.phone ?? "", message);
      if (!url) {
        toast.error("O telefone da cliente não é válido para abrir o WhatsApp.");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Mensagem personalizada preparada no WhatsApp.");
      return;
    }
    setResendingMessageId(appt.id);
    try {
      const log = (await resendWhatsApp({ data: { appointmentId: appt.id } })) as MessageLog | null;
      if (!log) throw new Error("Não foi possível iniciar o envio pelo WhatsApp.");
      setMessageLogs((current) => [
        log,
        ...current.filter((item) => item.appointment_id !== log.appointment_id),
      ]);
      if (log.status === "sent") {
        toast.success("Mensagem entregue no WhatsApp.");
      } else if (log.status === "pending") {
        toast.info("Mensagem aceite pela operadora. A aguardar confirmação de entrega.");
      } else {
        toast.error(formatWhatsAppFailure(log.reason));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível reenviar.");
    } finally {
      setResendingMessageId(null);
    }
  }

  // Export
  function buildExportRows() {
    return filteredAppts.map((a) => {
      const canSeeSensitive = canViewSensitiveAppointment(a, studio);
      const canSeeBasic = canSeeSensitive || canStaffViewBasicDetails;
      const paid = paidByAppointment.get(a.id) ?? 0;
      const service = canSeeBasic ? appointmentServiceLabel(a) : "Ocupado";
      const payLabel = formatPaymentState(a, paid);
      return {
        Cliente: canSeeSensitive ? (a.clients?.name ?? "-") : "Reservado",
        Telefone: canSeeSensitive ? (a.clients?.phone ?? "-") : "-",
        Serviço: service,
        Profissional: a.staff?.name ?? "-",
        Data: new Date(a.starts_at).toLocaleDateString("pt-PT"),
        Hora: new Date(a.starts_at).toLocaleTimeString("pt-PT", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        Estado: canSeeSensitive ? formatAppointmentStatus(a.status) : "Ocupado",
        Valor: canSeeSensitive ? formatEUR(a.total_price) : "-",
        Pagamento: canSeeSensitive ? payLabel : "-",
      };
    });
  }

  async function handleExport(format: "csv" | "excel" | "pdf") {
    setExporting(format);
    setExportOpen(false);
    try {
      await new Promise((r) => setTimeout(r, 300));
      const rows = buildExportRows();
      if (rows.length === 0) {
        toast.error("Nenhuma marcação para exportar.");
        return;
      }
      if (format === "csv") {
        const headers = Object.keys(rows[0]);
        const csvLines = [
          headers.join(";"),
          ...rows.map((row) =>
            headers
              .map((h) => `"${String((row as Record<string, string>)[h]).replace(/"/g, '""')}"`)
              .join(";"),
          ),
        ];
        const blob = new Blob(["﻿" + csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
        triggerDownload(blob, `marcacoes-${todayStr()}.csv`);
        toast.success("CSV exportado com sucesso.");
      } else if (format === "excel") {
        const headers = Object.keys(rows[0]);
        const th = headers.map((h) => `<th>${h}</th>`).join("");
        const trs = rows
          .map(
            (row) =>
              `<tr>${headers.map((h) => `<td>${(row as Record<string, string>)[h]}</td>`).join("")}</tr>`,
          )
          .join("");
        const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
        const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
        triggerDownload(blob, `marcacoes-${todayStr()}.xls`);
        toast.success("Excel exportado com sucesso.");
      } else {
        const headers = Object.keys(rows[0]);
        const th = headers.map((h) => `<th>${h}</th>`).join("");
        const trs = rows
          .map(
            (row) =>
              `<tr>${headers.map((h) => `<td>${(row as Record<string, string>)[h]}</td>`).join("")}</tr>`,
          )
          .join("");
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Marcações</title><style>body{font-family:sans-serif;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f5f5f5}</style></head><body><h2>Marcações - ${new Date().toLocaleDateString("pt-PT")}</h2><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
          win.focus();
          win.print();
        }
        toast.success("Janela de impressão aberta.");
      }
    } catch {
      toast.error("Erro ao exportar. Tente novamente.");
    } finally {
      setExporting(null);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  const editAppt = editApptId ? (appts.find((a) => a.id === editApptId) ?? null) : null;
  const rescheduleAppt = rescheduleApptId
    ? (appts.find((a) => a.id === rescheduleApptId) ?? null)
    : null;

  return (
    <div
      className="agenda-timeline-page -mx-3 flex w-[calc(100%+1.5rem)] max-w-none flex-col gap-0 pb-0 sm:-mx-4 sm:w-[calc(100%+2rem)] md:mx-auto md:w-full md:max-w-[1320px] md:gap-4 md:pb-6"
      onClick={() => {
        if (menuOpenId) closeMenu();
        if (exportOpen) setExportOpen(false);
      }}
    >
      <header className="hidden min-h-12 items-center justify-between gap-2 px-3 py-1 md:flex md:min-h-0 md:px-2 md:py-1">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-black tracking-[-0.035em] md:text-3xl">Agenda</h1>
          <p className="truncate text-[10px] font-semibold text-muted-foreground md:mt-0.5 md:text-[11px]">
            {timelineAppointments.length}{" "}
            {timelineAppointments.length === 1 ? "marcação" : "marcações"}{" "}
            {isSameLocalDay(selectedDate, new Date()) ? "hoje" : "neste dia"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigateToAgendaDate(new Date())}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-border bg-card text-xs font-black shadow-sm transition hover:bg-muted md:h-11 md:w-auto md:gap-2 md:rounded-2xl md:px-4"
            aria-label="Voltar para hoje"
          >
            <CalendarDays className="size-4" />
            <span className="hidden md:inline">Hoje</span>
          </button>
          <div className="hidden md:block">
            <button
              ref={exportBtnRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setExportOpen((v) => !v);
              }}
              disabled={exporting !== null}
              className={`bellza-panel-action ${exportOpen ? "bellza-panel-action-primary" : "bellza-panel-action-secondary"}`}
            >
              {exporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>{exporting ? "A exportar..." : "Exportar"}</span>
            </button>
            {exportOpen && (
              <PortalExportMenu
                anchorEl={exportBtnRef.current}
                onClose={() => setExportOpen(false)}
                onExport={(type) => handleExport(type)}
                exporting={exporting}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setNewApptDefaults(null);
              setNewApptOpen(true);
            }}
            className="hidden h-11 items-center gap-2 rounded-2xl bg-foreground px-5 text-xs font-black text-background shadow-lg shadow-black/10 transition hover:opacity-90 md:inline-flex"
          >
            <Plus className="size-4" />
            <span className="hidden min-[360px]:inline">Nova marcação</span>
          </button>
        </div>
      </header>

      <nav
        className="agenda-date-navigation agenda-touch-surface relative z-30 select-none border-y border-border/70 bg-card/95 py-1 backdrop-blur-xl touch-pan-x md:static md:rounded-2xl md:border md:px-1 md:py-2 md:shadow-sm"
        aria-label="Navegação semanal"
        data-testid="agenda-date-navigation"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex h-7 items-center justify-between px-3 md:hidden">
          <p className="whitespace-nowrap text-[10px] font-black capitalize tracking-[0.04em] text-muted-foreground">
            {mobileCalendarMonth.toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigateToAgendaDate(new Date())}
              className="agenda-compact-control h-7 min-h-0 rounded-lg border border-border bg-background/70 px-2 text-[9px] font-black"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className={`agenda-compact-control grid size-7 min-h-0 place-items-center rounded-lg border ${mobileFiltersOpen || activeFilterCount > 0 ? "border-foreground bg-foreground text-background" : "border-border bg-background/70"}`}
              aria-label="Abrir filtros da agenda"
            >
              <Filter className="size-3" />
            </button>
          </div>
        </div>
        <div
          ref={mobileDateScrollerRef}
          onScroll={extendMobileDateRange}
          className="flex snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain px-[calc(50%-1.55rem)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden"
        >
          {mobileAgendaDays.map((day) => {
            const selected = isSameLocalDay(day, selectedDate);
            const today = isSameLocalDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                ref={selected ? selectedDayButtonRef : undefined}
                data-agenda-date={toDateInputValue(day)}
                type="button"
                onClick={() => navigateToAgendaDate(day)}
                className="agenda-compact-control flex min-h-0 w-[3.1rem] shrink-0 snap-center flex-col items-center gap-0.5 rounded-xl py-1"
                aria-current={selected ? "date" : undefined}
                aria-label={day.toLocaleDateString("pt-PT", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                })}
              >
                <span
                  className={`text-[8px] font-black uppercase tracking-[0.08em] ${selected ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {day.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "")}
                </span>
                <span
                  className={`grid size-8 place-items-center rounded-full text-sm font-black transition ${selected ? "bg-foreground text-background shadow-md" : "bg-muted/45"}`}
                >
                  {day.getDate()}
                </span>
                <span
                  className={`size-1 rounded-full ${today ? "bg-emerald-500" : "bg-transparent"}`}
                />
              </button>
            );
          })}
        </div>
        <div className="hidden grid-cols-[2.5rem_repeat(7,minmax(2.5rem,1fr))_2.5rem] items-center md:grid">
          <button
            type="button"
            onClick={() => navigateToAgendaDate(addLocalDays(selectedDate, -7))}
            className="grid size-8 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground md:size-10"
            aria-label="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {getAgendaWeekDays(selectedDate).map((day) => {
            const selected = isSameLocalDay(day, selectedDate);
            const today = isSameLocalDay(day, new Date());
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => navigateToAgendaDate(day)}
                className="group flex min-w-0 flex-col items-center gap-1"
                aria-current={selected ? "date" : undefined}
              >
                <span className="text-[9px] font-black uppercase tracking-[0.08em] text-muted-foreground">
                  {day.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "")}
                </span>
                <span
                  className={`grid size-8 place-items-center rounded-full text-sm font-black transition md:size-9 ${selected ? "bg-foreground text-background shadow-md" : "group-hover:bg-muted"}`}
                >
                  {day.getDate()}
                </span>
                <span
                  className={`size-1 rounded-full ${today ? "bg-emerald-500" : "bg-transparent"}`}
                />
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => navigateToAgendaDate(addLocalDays(selectedDate, 7))}
            className="grid size-8 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground md:size-10"
            aria-label="Próxima semana"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </nav>

      <div className="hidden min-h-11 items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card px-3 py-2.5 shadow-sm md:flex">
        <div className="min-w-0">
          <p className="truncate text-xs font-black md:text-sm">
            {formatAgendaDateTitle(selectedDate)}
          </p>
          <p className="hidden font-mono text-[10px] font-semibold tabular-nums text-muted-foreground min-[390px]:block">
            {agendaNow.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="relative inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border text-[11px] font-bold md:h-9 md:w-auto md:gap-1.5 md:rounded-xl md:px-3">
            <CalendarDays className="size-3.5" />
            <span className="hidden md:inline">Data</span>
            <input
              type="date"
              value={toDateInputValue(selectedDate)}
              onChange={(event) =>
                event.target.value && navigateToAgendaDate(dateFromInputValue(event.target.value))
              }
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Escolher data"
            />
          </label>
          <button
            type="button"
            onClick={() => setAgendaToolsOpen((value) => !value)}
            className={`grid size-8 place-items-center rounded-lg border md:size-9 md:rounded-xl ${agendaToolsOpen || activeFilterCount > 0 ? "border-foreground bg-foreground text-background" : "border-border"}`}
            aria-label="Pesquisa e filtros"
          >
            <Filter className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Search + Filter */}
      {agendaToolsOpen && (
        <div className="flex flex-col gap-2 border-b border-border/80 bg-card/95 p-3 shadow-sm md:rounded-[1.25rem] md:border">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar cliente, telefone ou profissional..."
                className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-4 text-sm text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/8 md:bg-background/70"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              className={`hidden h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-all md:inline-flex ${filtersOpen || activeFilterCount > 0 ? "border-foreground/25 bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <Filter className="h-3.5 w-3.5" />
              Filtros
              {activeFilterCount > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-background/20 text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-all md:hidden ${activeFilterCount > 0 ? "border-foreground/25 bg-foreground text-background" : "border-border bg-card text-muted-foreground"}`}
            >
              <Filter className="h-3.5 w-3.5" />
              {activeFilterCount > 0 && (
                <span className="grid size-5 place-items-center rounded-full bg-background/20 text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {canStaffViewTeamAgenda && (
            <div className="grid grid-cols-2 gap-2 md:flex md:w-fit">
              <AgendaScopeButton
                active={agendaScope === "mine"}
                onClick={() => {
                  setAgendaScope("mine");
                  updateFilter("staffId", "all");
                }}
              >
                Minha agenda
              </AgendaScopeButton>
              <AgendaScopeButton
                active={agendaScope === "team"}
                onClick={() => setAgendaScope("team")}
              >
                Toda a equipa
              </AgendaScopeButton>
            </div>
          )}

          {filtersOpen && (
            <div className="hidden animate-in fade-in slide-in-from-top-1 duration-200 md:block">
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground">Filtros Avançados</p>
                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    >
                      Limpar filtros
                    </button>
                  )}
                </div>
                <AgendaFilterFields
                  filters={filters}
                  options={filterOptions}
                  onChange={updateFilter}
                  hideProfessional={isProfessionalPanel && !canStaffViewTeamAgenda}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="h-9 rounded-xl border border-border px-4 text-xs font-semibold text-muted-foreground transition hover:bg-muted"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="h-9 rounded-xl bg-foreground px-4 text-xs font-semibold text-background transition hover:opacity-90"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Agenda profissional em linha do tempo */}
      {loading ? (
        <div className="overflow-hidden border-y border-border/80 bg-card shadow-sm md:rounded-[1.35rem] md:border">
          <div className="h-10 animate-pulse border-b border-border bg-muted/45 md:h-[4.5rem]" />
          <div className="grid h-[60dvh] grid-cols-[3.4rem_1fr] md:grid-cols-[3.6rem_1fr]">
            <div className="border-r border-border bg-muted/20" />
            <div className="bg-[linear-gradient(to_bottom,transparent_57px,hsl(var(--border)/0.45)_58px)] bg-[length:100%_58px] md:bg-[linear-gradient(to_bottom,transparent_80px,hsl(var(--border)/0.45)_81px)] md:bg-[length:100%_82px]" />
          </div>
        </div>
      ) : (
        <ProfessionalTimeline
          date={selectedDate}
          now={agendaNow}
          professionals={timelineProfessionals}
          appointments={timelineEntries}
          availability={selectedAvailability}
          focusRequestKey={timelineFocusRequest}
          onOpenAppointment={(appointment) => {
            if (appointment.privateDetails) setTimelineDetailId(appointment.id);
          }}
          onOpenBlock={(block) => {
            if (block.sourceId) setSelectedBlockId(block.sourceId);
          }}
          onCreateAtSlot={(staffId, minutes) => {
            setNewApptDefaults({
              staffId: staffId === "unassigned" ? undefined : staffId,
              date: toDateInputValue(selectedDate),
              time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
            });
            setNewApptOpen(true);
          }}
          onBlockAtSlot={(staffId, minutes) => {
            if (staffId === "unassigned") {
              toast.error("Escolha um profissional para bloquear o horário.");
              return;
            }
            setBlockTimeDefaults({
              staffId,
              date: toDateInputValue(selectedDate),
              time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
            });
          }}
        />
      )}

      {timelineDetailAppt &&
        canViewSensitiveAppointment(timelineDetailAppt, studio) &&
        (() => {
          const paid = paidByAppointment.get(timelineDetailAppt.id) ?? 0;
          const split = computeAppointmentSplit(timelineDetailAppt, studio, paid);
          const revenue = computeAttendanceRevenue(
            timelineDetailAppt.total_price,
            paid,
            timelineDetailAppt.status,
          );
          const financialSummary = getAppointmentFinancialSummary(timelineDetailAppt, split, paid);
          const messageState = formatMessageState(
            timelineDetailAppt,
            paid,
            latestMessageByAppointment.get(timelineDetailAppt.id),
          );
          const canConfirm = revenue.isOnlinePaid && timelineDetailAppt.status !== "cancelled";
          const canResend =
            messageState?.tone === "danger" ||
            (isPastAppointment(timelineDetailAppt.ends_at) &&
              Boolean(
                timelineDetailAppt.clients?.phone &&
                normalizePhoneForDisplay(timelineDetailAppt.clients.phone),
              ));
          const actions: TimelineDrawerAction[] = [
            {
              id: "edit",
              label: "Editar",
              icon: <Pencil className="h-3.5 w-3.5" />,
              onClick: () => {
                setEditApptId(timelineDetailAppt.id);
                setTimelineDetailId(null);
              },
            },
            {
              id: "reschedule",
              label: "Reagendar",
              icon: <CalendarClock className="h-3.5 w-3.5" />,
              onClick: () => {
                setRescheduleApptId(timelineDetailAppt.id);
                setTimelineDetailId(null);
              },
            },
          ];
          if (financialSummary.needsStudioPaymentConfirmation) {
            actions.push({
              id: "payment",
              label: "Receber pagamento",
              icon: <Euro className="h-3.5 w-3.5" />,
              onClick: () => {
                setPaymentDialogAppt(timelineDetailAppt);
                setTimelineDetailId(null);
              },
            });
          }
          if (canConfirm) {
            actions.push(
              {
                id: "complete",
                label: "Compareceu",
                icon: <Check className="h-3.5 w-3.5" />,
                onClick: () => markPresence(timelineDetailAppt, "completed"),
                disabled: savingPresenceId === timelineDetailAppt.id,
              },
              {
                id: "no-show",
                label: "Não compareceu",
                icon: <X className="h-3.5 w-3.5" />,
                onClick: () => markPresence(timelineDetailAppt, "no_show"),
                disabled: savingPresenceId === timelineDetailAppt.id,
              },
            );
          }
          if (canResend) {
            actions.push({
              id: "whatsapp",
              label: isPastAppointment(timelineDetailAppt.ends_at)
                ? "Contactar no WhatsApp"
                : "Reenviar WhatsApp",
              icon: <MessageCircle className="h-3.5 w-3.5" />,
              onClick: () => resendMessage(timelineDetailAppt),
              disabled: resendingMessageId === timelineDetailAppt.id,
            });
          }
          if (timelineDetailAppt.status !== "cancelled") {
            actions.push({
              id: "cancel",
              label: "Cancelar marcação",
              icon: <X className="h-3.5 w-3.5" />,
              onClick: () => undefined,
              danger: true,
              disabled: cancellingId === timelineDetailAppt.id,
            });
          }
          return (
            <TimelineAppointmentDrawer
              details={{
                clientName: timelineDetailAppt.clients?.name ?? "Sem cliente",
                clientPhone: timelineDetailAppt.clients?.phone,
                serviceName: appointmentServiceLabel(timelineDetailAppt),
                professionalName: timelineDetailAppt.staff?.name ?? "Não definido",
                startsAt: timelineDetailAppt.starts_at,
                endsAt: timelineDetailAppt.ends_at,
                durationLabel: formatDurationBetween(
                  timelineDetailAppt.starts_at,
                  timelineDetailAppt.ends_at,
                  timelineDetailAppt.total_duration_min,
                ),
                statusLabel: formatAppointmentStatus(timelineDetailAppt.status),
                paymentLabel: formatPaymentState(timelineDetailAppt, paid),
                messageLabel: messageState?.label ?? null,
                notes: timelineDetailAppt.notes,
                valueLabel: formatEUR(split.serviceTotal),
              }}
              actions={actions}
              onClose={() => setTimelineDetailId(null)}
              onConfirmCancel={() => {
                void cancelAppointment(timelineDetailAppt.id).then(() => setTimelineDetailId(null));
              }}
              cancelling={cancellingId === timelineDetailAppt.id}
            />
          );
        })()}

      {/* Mobile Filter Bottom Sheet */}
      {mobileFiltersOpen && (
        <div
          className="fixed inset-0 z-[100] md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filtros da agenda"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label="Fechar filtros da agenda"
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-max(env(safe-area-inset-top),0.5rem))] min-h-0 flex-col overflow-hidden rounded-t-[1.5rem] border-t border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Filtros
                </p>
                <p className="text-sm font-semibold">Filtros Avançados</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="grid size-9 place-items-center rounded-xl border border-border bg-background/70 text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <AgendaFilterFields
                filters={filters}
                options={filterOptions}
                onChange={updateFilter}
                mobile
                hideProfessional
              />
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={resetFilters}
                className="h-12 rounded-2xl border border-border text-sm font-semibold text-muted-foreground transition hover:bg-muted"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="h-12 rounded-2xl bg-foreground text-sm font-semibold text-background transition hover:opacity-90"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Nova marcação Modal */}
      {newApptOpen && studio && (
        <NewAppointmentModal
          studioId={studio.id}
          staffId={studio.role === "staff" ? studio.staff_id : null}
          initialStaffId={newApptDefaults?.staffId}
          initialDate={newApptDefaults?.date}
          initialTime={newApptDefaults?.time}
          onClose={() => {
            setNewApptOpen(false);
            setNewApptDefaults(null);
          }}
          onCreated={() => {
            setNewApptOpen(false);
            setNewApptDefaults(null);
            loadData();
          }}
        />
      )}

      {blockTimeDefaults && studio && (
        <BlockTimeModal
          studioId={studio.id}
          staffId={blockTimeDefaults.staffId}
          staffName={
            agendaStaff.find((person) => person.id === blockTimeDefaults.staffId)?.name ??
            "Profissional"
          }
          initialDate={blockTimeDefaults.date}
          initialTime={blockTimeDefaults.time}
          onClose={() => setBlockTimeDefaults(null)}
          onCreated={() => {
            setBlockTimeDefaults(null);
            void Promise.all([loadData({ silent: true }), loadStaffTimeOffForDate(selectedDate)]);
          }}
        />
      )}

      {selectedBlock && studio && (
        <ManageBlockTimeModal
          studioId={studio.id}
          block={selectedBlock}
          staffName={
            agendaStaff.find((person) => person.id === selectedBlock.staff_id)?.name ??
            "Profissional"
          }
          onClose={() => setSelectedBlockId(null)}
          onChanged={async () => {
            await Promise.all([loadData({ silent: true }), loadStaffTimeOffForDate(selectedDate)]);
          }}
        />
      )}

      {/* Editar marcação Modal */}
      {editAppt && studio && (
        <EditAppointmentModal
          studioId={studio.id}
          staffId={studio.role === "staff" ? studio.staff_id : null}
          appt={editAppt}
          onClose={() => setEditApptId(null)}
          onSaved={() => {
            setEditApptId(null);
            loadData();
          }}
        />
      )}

      {/* Reagendar Modal */}
      {rescheduleAppt && studio && (
        <RescheduleModal
          studioId={studio.id}
          staffId={studio.role === "staff" ? studio.staff_id : null}
          appt={rescheduleAppt}
          onClose={() => setRescheduleApptId(null)}
          onSaved={() => {
            setRescheduleApptId(null);
            loadData();
          }}
        />
      )}

      {paymentDialogAppt && (
        <StudioPaymentDialog
          appt={paymentDialogAppt}
          amount={
            paidByAppointment.get(paymentDialogAppt.id)
              ? Math.max(
                  0,
                  paymentDialogAppt.total_price -
                    (paidByAppointment.get(paymentDialogAppt.id) ?? 0),
                )
              : paymentDialogAppt.total_price
          }
          busy={receivingPaymentId === paymentDialogAppt.id}
          enableInPersonMbWay={enableInPersonMbWay}
          onClose={() => setPaymentDialogAppt(null)}
          onConfirm={(method, options) => confirmStudioPayment(paymentDialogAppt, method, options)}
        />
      )}
    </div>
  );
}

// ─── Export Menu Item ────────────────────────────────────────────────────────

function ExportMenuItem({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </button>
  );
}

// ─── Portal Export Menu ───────────────────────────────────────────────────────

function PortalExportMenu({
  anchorEl,
  onClose,
  onExport,
  exporting,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onExport: (type: "csv" | "excel" | "pdf") => void;
  exporting: "csv" | "excel" | "pdf" | null;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobile = window.innerWidth < 768;
    setIsMobile(mobile);
    if (!anchorEl || mobile) return;

    const rect = anchorEl.getBoundingClientRect();
    const menuW = 210;
    const menuH = 130;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    const newStyle: React.CSSProperties = { position: "fixed", zIndex: 9999, minWidth: menuW };

    // Horizontal: right-align to button, clamp to viewport
    const rightGap = viewW - rect.right;
    if (rightGap >= menuW) {
      newStyle.right = Math.max(8, rightGap);
    } else {
      newStyle.left = Math.max(8, rect.left - menuW + rect.width);
    }

    // Vertical: below if space, else above
    if (viewH - rect.bottom - 8 >= menuH) {
      newStyle.top = rect.bottom + 6;
    } else {
      newStyle.bottom = viewH - rect.top + 6;
    }

    setStyle(newStyle);
  }, [anchorEl]);

  // Close on scroll
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [onClose]);

  // Mobile bottom sheet
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-[9998]">
        <button
          type="button"
          aria-label="Fechar"
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[1.5rem] border-t border-border bg-card shadow-2xl animate-in slide-in-from-bottom-2 duration-200">
          <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-border" />
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
            <p className="text-sm font-semibold">Exportar dados</p>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-3 pb-10">
            <SheetItem
              icon={<FileText className="h-4 w-4" />}
              onClick={() => {
                onExport("csv");
                onClose();
              }}
              disabled={exporting !== null}
            >
              Exportar CSV
            </SheetItem>
            <SheetItem
              icon={<FileSpreadsheet className="h-4 w-4" />}
              onClick={() => {
                onExport("excel");
                onClose();
              }}
              disabled={exporting !== null}
            >
              Exportar Excel (.xls)
            </SheetItem>
            <SheetItem
              icon={<Printer className="h-4 w-4" />}
              onClick={() => {
                onExport("pdf");
                onClose();
              }}
              disabled={exporting !== null}
            >
              Imprimir / PDF
            </SheetItem>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop dropdown via portal — never clips viewport
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-1">
          <DropMenuItem
            icon={<FileText className="h-3.5 w-3.5" />}
            onClick={() => {
              onExport("csv");
              onClose();
            }}
            disabled={exporting !== null}
          >
            Exportar CSV
          </DropMenuItem>
          <DropMenuItem
            icon={<FileSpreadsheet className="h-3.5 w-3.5" />}
            onClick={() => {
              onExport("excel");
              onClose();
            }}
            disabled={exporting !== null}
          >
            Exportar Excel (.xls)
          </DropMenuItem>
          <DropMenuItem
            icon={<Printer className="h-3.5 w-3.5" />}
            onClick={() => {
              onExport("pdf");
              onClose();
            }}
            disabled={exporting !== null}
          >
            Imprimir / PDF
          </DropMenuItem>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ─── New Appointment Modal ───────────────────────────────────────────────────

function BlockTimeModal({
  studioId,
  staffId,
  staffName,
  initialDate,
  initialTime,
  onClose,
  onCreated,
}: {
  studioId: string;
  staffId: string;
  staffName: string;
  initialDate: string;
  initialTime: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const initialStart = `${initialDate}T${initialTime}`;
  const initialEndDate = new Date(`${initialStart}:00`);
  initialEndDate.setMinutes(initialEndDate.getMinutes() + 60);
  const [starts, setStarts] = useState(initialStart);
  const [ends, setEnds] = useState(
    `${toDateInputValue(initialEndDate)}T${initialEndDate.toLocaleTimeString("pt-PT", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })}`,
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!starts || !ends) {
      toast.error("Preencha o início e o fim do bloqueio.");
      return;
    }
    const startsAt = new Date(starts);
    const endsAt = new Date(ends);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      toast.error("Preencha uma data e um horário válidos.");
      return;
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      toast.error("O fim do bloqueio deve ser posterior ao início.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("staff_time_off").insert({
      studio_id: studioId,
      staff_id: staffId,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason: reason.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error("Não foi possível bloquear o horário. Tente novamente.");
      return;
    }
    toast.success("Horário bloqueado.");
    onCreated();
  }

  return (
    <ModalShell title="Bloquear horário" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
            <LockKeyhole className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Profissional
            </p>
            <p className="truncate text-sm font-black">{staffName}</p>
          </div>
        </div>
        <div className="grid min-w-0 gap-3 min-[390px]:grid-cols-2">
          <ModalField label="Início do bloqueio">
            <BlockDateTimeFields value={starts} onChange={setStarts} prefix="início" />
          </ModalField>
          <ModalField label="Fim do bloqueio">
            <BlockDateTimeFields value={ends} onChange={setEnds} prefix="fim" />
          </ModalField>
        </div>
        <ModalField label="Motivo (opcional)">
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Almoço, reunião, formação..."
            className={inputCls}
          />
        </ModalField>
      </div>
      <ModalFooter
        onClose={onClose}
        onSave={() => void handleSave()}
        saving={saving}
        disabled={!isValidLocalDateTime(starts) || !isValidLocalDateTime(ends)}
        label="Bloquear horário"
      />
    </ModalShell>
  );
}

function ManageBlockTimeModal({
  studioId,
  block,
  staffName,
  onClose,
  onChanged,
}: {
  studioId: string;
  block: StaffTimeOffRow;
  staffName: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"actions" | "edit" | "confirm-delete">("actions");
  const [starts, setStarts] = useState(() => toLocalDateTimeValue(block.starts_at));
  const [ends, setEnds] = useState(() => toLocalDateTimeValue(block.ends_at));
  const [reason, setReason] = useState(block.reason ?? "");
  const [saving, setSaving] = useState(false);

  async function handleUpdate() {
    if (!isValidLocalDateTime(starts) || !isValidLocalDateTime(ends)) {
      toast.error("Preencha uma data e um horário válidos.");
      return;
    }
    const startsAt = new Date(starts);
    const endsAt = new Date(ends);
    if (endsAt.getTime() <= startsAt.getTime()) {
      toast.error("O fim do bloqueio deve ser posterior ao início.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("staff_time_off")
      .update({
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        reason: reason.trim() || null,
      })
      .eq("id", block.id)
      .eq("studio_id", studioId);
    if (error) {
      setSaving(false);
      console.error("agenda_block_update_failed", {
        blockId: block.id,
        studioId,
        message: error.message,
      });
      toast.error("Não foi possível atualizar o bloqueio. Tente novamente.");
      return;
    }
    await onChanged();
    setSaving(false);
    toast.success("Bloqueio atualizado.");
    onClose();
  }

  async function handleDelete() {
    setSaving(true);
    const { error } = await supabase
      .from("staff_time_off")
      .delete()
      .eq("id", block.id)
      .eq("studio_id", studioId);
    if (error) {
      setSaving(false);
      console.error("agenda_block_delete_failed", {
        blockId: block.id,
        studioId,
        message: error.message,
      });
      toast.error("Não foi possível desbloquear o horário. Tente novamente.");
      return;
    }
    await onChanged();
    setSaving(false);
    toast.success("Horário desbloqueado.");
    onClose();
  }

  return (
    <ModalShell title={mode === "edit" ? "Editar bloqueio" : "Gerir bloqueio"} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {mode === "actions" && (
          <div className="space-y-3">
            <BlockSummary block={block} staffName={staffName} />
            <div className="grid gap-2 min-[360px]:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background/70 px-3 text-sm font-semibold transition hover:bg-muted"
              >
                <Pencil className="size-4" />
                Editar bloqueio
              </button>
              <button
                type="button"
                onClick={() => setMode("confirm-delete")}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-300/70 bg-rose-50 px-3 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
              >
                <LockKeyhole className="size-4" />
                Desbloquear horário
              </button>
            </div>
          </div>
        )}

        {mode === "confirm-delete" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-rose-300/70 bg-rose-50 px-4 py-3 dark:border-rose-500/25 dark:bg-rose-500/10">
              <p className="text-sm font-black text-rose-700 dark:text-rose-300">
                Desbloquear horário?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                O período voltará a ficar disponível na agenda.
              </p>
            </div>
            <BlockSummary block={block} staffName={staffName} />
          </div>
        )}

        {mode === "edit" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <LockKeyhole className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Profissional
                </p>
                <p className="truncate text-sm font-black">{staffName}</p>
              </div>
            </div>
            <div className="grid min-w-0 gap-3 min-[390px]:grid-cols-2">
              <ModalField label="Início do bloqueio">
                <BlockDateTimeFields value={starts} onChange={setStarts} prefix="início" />
              </ModalField>
              <ModalField label="Fim do bloqueio">
                <BlockDateTimeFields value={ends} onChange={setEnds} prefix="fim" />
              </ModalField>
            </div>
            <ModalField label="Motivo (opcional)">
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Almoço, reunião, formação..."
                className={inputCls}
              />
            </ModalField>
          </div>
        )}
      </div>

      {mode === "actions" && (
        <div className="shrink-0 border-t border-border bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-full rounded-xl border border-border text-sm font-semibold text-muted-foreground transition hover:bg-muted"
          >
            Cancelar
          </button>
        </div>
      )}
      {mode === "confirm-delete" && (
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setMode("actions")}
            disabled={saving}
            className="h-10 rounded-xl border border-border text-sm font-semibold text-muted-foreground transition hover:bg-muted disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Desbloquear
          </button>
        </div>
      )}
      {mode === "edit" && (
        <ModalFooter
          onClose={() => setMode("actions")}
          onSave={() => void handleUpdate()}
          saving={saving}
          disabled={!isValidLocalDateTime(starts) || !isValidLocalDateTime(ends)}
          label="Guardar bloqueio"
        />
      )}
    </ModalShell>
  );
}

function BlockSummary({ block, staffName }: { block: StaffTimeOffRow; staffName: string }) {
  return (
    <dl className="grid min-w-0 gap-2 rounded-xl border border-border bg-muted/25 p-3 text-xs">
      <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
        <dt className="font-semibold text-muted-foreground">Profissional</dt>
        <dd className="min-w-0 truncate text-right font-black">{staffName}</dd>
      </div>
      <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
        <dt className="font-semibold text-muted-foreground">Data</dt>
        <dd className="min-w-0 text-right font-black">{formatBlockDate(block.starts_at)}</dd>
      </div>
      <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
        <dt className="font-semibold text-muted-foreground">Horário</dt>
        <dd className="min-w-0 whitespace-nowrap text-right font-mono font-black tabular-nums">
          {formatBlockTime(block.starts_at)} – {formatBlockTime(block.ends_at)}
        </dd>
      </div>
      {block.reason && (
        <div className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
          <dt className="font-semibold text-muted-foreground">Motivo</dt>
          <dd className="min-w-0 break-words text-right font-black">{block.reason}</dd>
        </div>
      )}
    </dl>
  );
}

function BlockDateTimeFields({
  value,
  onChange,
  prefix,
}: {
  value: string;
  onChange: (value: string) => void;
  prefix: "início" | "fim";
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2">
      <input
        type="date"
        value={value.slice(0, 10)}
        onChange={(event) => onChange(mergeLocalDateTime(value, "date", event.target.value))}
        className={`${inputCls} max-w-full min-w-0 appearance-none px-2`}
        aria-label={`Data de ${prefix} do bloqueio`}
      />
      <input
        type="time"
        value={value.slice(11, 16)}
        onChange={(event) => onChange(mergeLocalDateTime(value, "time", event.target.value))}
        className={`${timeCls} max-w-full min-w-0 px-2`}
        aria-label={`Hora de ${prefix} do bloqueio`}
      />
    </div>
  );
}

function NewAppointmentModal({
  studioId,
  staffId,
  initialStaffId,
  initialDate,
  initialTime,
  onClose,
  onCreated,
}: {
  studioId: string;
  staffId?: string | null;
  initialStaffId?: string;
  initialDate?: string;
  initialTime?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [services, setServices] = useState<StudioService[]>([]);
  const [staffList, setStaffList] = useState<StudioStaff[]>([]);
  const [clients, setClients] = useState<StudioClient[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<StudioClient | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [isNewClient, setIsNewClient] = useState(false);
  const [selectedService, setSelectedService] = useState("");
  const [selectedStaff, setSelectedStaff] = useState(initialStaffId ?? "");
  const [date, setDate] = useState(initialDate ?? "");
  const [time, setTime] = useState(initialTime ?? "09:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: svcs }, { data: stf }, { data: cls }] = await Promise.all([
        supabase
          .from("services" as any)
          .select("id,name,price,duration_min")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .order("sort_order"),
        supabase
          .from("staff" as any)
          .select("id,name")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .match(staffId ? { id: staffId } : {})
          .order("sort_order"),
        staffId
          ? (supabase as any)
              .from("appointments")
              .select("clients(id,name,phone)")
              .eq("studio_id", studioId)
              .eq("staff_id", staffId)
              .not("client_id", "is", null)
              .order("starts_at", { ascending: true })
          : supabase
              .from("clients" as any)
              .select("id,name,phone")
              .eq("studio_id", studioId)
              .order("name"),
      ]);
      setServices((svcs ?? []) as unknown as StudioService[]);
      const staffRows = (stf ?? []) as unknown as StudioStaff[];
      setStaffList(staffRows);
      if (!initialStaffId && staffRows[0]) setSelectedStaff(staffRows[0].id);
      setClients(normalizeAppointmentClients(cls ?? [], Boolean(staffId)));
      setLoadingData(false);
    })();
  }, [initialStaffId, staffId, studioId]);

  const filteredClients = clients.filter((c) => {
    if (!clientSearch.trim()) return true;
    const q = normalizeFilterText(clientSearch);
    return normalizeFilterText(`${c.name} ${c.phone}`).includes(q);
  });
  const chosenService = services.find((s) => s.id === selectedService);

  async function handleSave() {
    if (!date || !time || !selectedService || !selectedStaff) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    if (!isNewClient && !selectedClient) {
      toast.error("Selecione ou crie um cliente.");
      return;
    }
    const normalizedNewClientPhone = normalizeInternationalPhone(newClientPhone);
    if (isNewClient && (!newClientName.trim() || !isValidInternationalPhone(newClientPhone))) {
      toast.error("Nome e telefone são obrigatórios.");
      return;
    }
    setSaving(true);
    try {
      let clientId: string;
      if (isNewClient) {
        const { data: existing } = await supabase
          .from("clients" as any)
          .select("id")
          .eq("studio_id", studioId)
          .eq("phone", normalizedNewClientPhone)
          .maybeSingle();
        if (existing) {
          clientId = (existing as any).id;
        } else {
          const { data: created, error: ce } = await supabase
            .from("clients" as any)
            .insert({
              studio_id: studioId,
              name: newClientName.trim(),
              phone: normalizedNewClientPhone,
            })
            .select("id")
            .single();
          if (ce || !created) throw new Error(ce?.message ?? "Erro ao criar cliente");
          clientId = (created as any).id;
        }
      } else {
        clientId = selectedClient!.id;
      }
      const svc = chosenService!;
      const startsAt = new Date(`${date}T${time}:00`);
      const endsAt = new Date(startsAt.getTime() + svc.duration_min * 60000);
      const { data: appt, error: ae } = await supabase
        .from("appointments" as any)
        .insert({
          studio_id: studioId,
          client_id: clientId,
          staff_id: selectedStaff,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          status: "confirmed",
          total_price: svc.price,
          total_duration_min: svc.duration_min,
          notes: notes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (ae || !appt) throw new Error(ae?.message ?? "Erro ao criar marcação");
      await supabase.from("appointment_services" as any).insert({
        appointment_id: (appt as any).id,
        service_id: svc.id,
        price: svc.price,
        duration_min: svc.duration_min,
      });
      toast.success("Marcação criada com sucesso!");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar marcação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Nova marcação" onClose={onClose}>
      {loadingData ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Cliente *
              </label>
              <button
                type="button"
                onClick={() => {
                  setIsNewClient((v) => !v);
                  setSelectedClient(null);
                  setClientSearch("");
                }}
                className="inline-flex h-7 shrink-0 items-center rounded-full border border-border bg-background/70 px-2.5 text-[10px] font-bold text-muted-foreground transition hover:border-foreground/20 hover:bg-muted hover:text-foreground"
              >
                {isNewClient ? "Escolher existente" : "+ Novo cliente"}
              </button>
            </div>
            {isNewClient ? (
              <div className="space-y-2">
                <input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  placeholder="Nome completo"
                  className={inputCls}
                />
                <InternationalPhoneInput
                  value={newClientPhone}
                  onChange={setNewClientPhone}
                  inputClassName="h-11 rounded-xl bg-background/70 shadow-none"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setSelectedClient(null);
                    }}
                    placeholder="Pesquisar cliente..."
                    className={`${inputCls} pl-9`}
                  />
                </div>
                {selectedClient ? (
                  <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2">
                    <ClientAvatar name={selectedClient.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" title={selectedClient.name}>
                        {selectedClient.name}
                      </p>
                      <p
                        className="truncate text-xs text-muted-foreground"
                        title={selectedClient.phone ?? ""}
                      >
                        {selectedClient.phone}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedClient(null);
                        setClientSearch("");
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : clientSearch.trim() ? (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-border bg-background shadow-lg">
                    {filteredClients.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-muted-foreground">
                        Nenhum cliente encontrado.{" "}
                        <button
                          type="button"
                          onClick={() => setIsNewClient(true)}
                          className="underline"
                        >
                          Criar novo?
                        </button>
                      </p>
                    ) : (
                      filteredClients.slice(0, 8).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedClient(c);
                            setClientSearch(c.name);
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted"
                        >
                          <ClientAvatar name={c.name} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold" title={c.name}>
                              {c.name}
                            </p>
                            <p
                              className="truncate text-[11px] text-muted-foreground"
                              title={c.phone ?? ""}
                            >
                              {c.phone}
                            </p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
          <ModalField label="Serviço *">
            <Select value={selectedService} onValueChange={setSelectedService}>
              <SelectTrigger className={selectTriggerCls}>
                <SelectValue placeholder="Escolher serviço" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-border/80 bg-popover/98 shadow-2xl">
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — {formatEUR(s.price)} — {s.duration_min}min
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ModalField>
          <ModalField label="Profissional *">
            <Select value={selectedStaff} onValueChange={setSelectedStaff}>
              <SelectTrigger className={selectTriggerCls}>
                <SelectValue placeholder="Escolher profissional" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-border/80 bg-popover/98 shadow-2xl">
                {staffList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ModalField>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <ModalField label="Data *">
              {/* Override PremiumDatePicker base styles (h-12 rounded-2xl px-4 shadow-sm) to match inputCls */}
              <PremiumDatePicker
                value={date}
                onChange={setDate}
                placeholder="Escolher data"
                className={datePickerCls}
              />
            </ModalField>
            <ModalField label="Hora *">
              {/* [color-scheme] ensures native time picker respects dark/light theme */}
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={`${timeCls}`}
              />
            </ModalField>
          </div>
          <ModalField label="Notas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações opcionais..."
              rows={2}
              className={textareaCls}
            />
          </ModalField>
          {chosenService && date && time && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Resumo
              </p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-semibold" title={chosenService.name}>
                  {chosenService.name}
                </p>
                <p className="shrink-0 text-sm font-black text-emerald-700 dark:text-emerald-300">
                  {formatEUR(chosenService.price)}
                </p>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {new Date(`${date}T${time}:00`).toLocaleDateString("pt-PT", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                })}{" "}
                as {time} · {chosenService.duration_min}min
              </p>
            </div>
          )}
        </div>
      )}
      <ModalFooter onClose={onClose} onSave={handleSave} saving={saving} disabled={loadingData} />
    </ModalShell>
  );
}

// ─── Edit Appointment Modal ───────────────────────────────────────────────────

function EditAppointmentModal({
  studioId,
  staffId,
  appt,
  onClose,
  onSaved,
}: {
  studioId: string;
  staffId?: string | null;
  appt: Appt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [services, setServices] = useState<StudioService[]>([]);
  const [staffList, setStaffList] = useState<StudioStaff[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const currentSvc = appt.appointment_services?.[0];
  const [selectedService, setSelectedService] = useState("");
  const [selectedStaff, setSelectedStaff] = useState(appt.staff?.id ?? "");
  const [notes, setNotes] = useState(appt.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: svcs }, { data: stf }] = await Promise.all([
        supabase
          .from("services" as any)
          .select("id,name,price,duration_min")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .order("sort_order"),
        supabase
          .from("staff" as any)
          .select("id,name")
          .eq("studio_id", studioId)
          .eq("is_active", true)
          .match(staffId ? { id: staffId } : {})
          .order("sort_order"),
      ]);
      const svcList = (svcs ?? []) as unknown as StudioService[];
      setServices(svcList);
      setStaffList((stf ?? []) as unknown as StudioStaff[]);
      // Pre-select current service by matching name/price
      const current = svcList.find((s) => Math.abs(s.price - appt.total_price) < 0.01);
      setSelectedService(current?.id ?? svcList[0]?.id ?? "");
      if (staffId) setSelectedStaff(staffId);
      setLoadingData(false);
    })();
  }, [staffId, studioId, appt.total_price]);

  const chosenService = services.find((s) => s.id === selectedService);

  async function handleSave() {
    if (!selectedService || !selectedStaff) {
      toast.error("Serviço e profissional são obrigatórios.");
      return;
    }
    const svc = chosenService!;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("appointments" as any)
        .update({
          staff_id: selectedStaff,
          total_price: svc.price,
          total_duration_min: svc.duration_min,
          notes: notes.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", appt.id)
        .eq("studio_id", studioId);
      if (error) throw error;
      // Update appointment_services if present
      if (appt.appointment_services?.length) {
        await supabase
          .from("appointment_services" as any)
          .update({ service_id: svc.id, price: svc.price, duration_min: svc.duration_min })
          .eq("appointment_id", appt.id);
      }
      toast.success("Marcação atualizada.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar marcação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Editar marcação" onClose={onClose}>
      {loadingData ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* Client info (read-only) */}
          {appt.clients && (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <ClientAvatar
                name={appt.clients.name}
                avatarUrl={appt.clients.avatar_url}
                size="sm"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={appt.clients.name}>
                  {appt.clients.name}
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={appt.clients.phone ?? ""}
                >
                  {appt.clients.phone}
                </p>
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                Fixo
              </span>
            </div>
          )}
          <ModalField label="Serviço *">
            <Select value={selectedService} onValueChange={setSelectedService}>
              <SelectTrigger className={selectTriggerCls}>
                <SelectValue placeholder="Escolher serviço" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-border/80 bg-popover/98 shadow-2xl">
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — {formatEUR(s.price)} — {s.duration_min}min
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ModalField>
          <ModalField label="Profissional *">
            <Select value={selectedStaff} onValueChange={setSelectedStaff}>
              <SelectTrigger className={selectTriggerCls}>
                <SelectValue placeholder="Escolher profissional" />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-border/80 bg-popover/98 shadow-2xl">
                {staffList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ModalField>
          <ModalField label="Notas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações opcionais..."
              rows={2}
              className={textareaCls}
            />
          </ModalField>
        </div>
      )}
      <ModalFooter
        onClose={onClose}
        onSave={handleSave}
        saving={saving}
        disabled={loadingData}
        label="Guardar alterações"
      />
    </ModalShell>
  );
}

// ─── Reschedule Modal ────────────────────────────────────────────────────────

function RescheduleModal({
  studioId,
  appt,
  onClose,
  onSaved,
}: {
  studioId: string;
  staffId?: string | null;
  appt: Appt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const rescheduleAppointment = useServerFn(rescheduleStudioAppointment);
  const durationMin = Math.round(
    (new Date(appt.ends_at).getTime() - new Date(appt.starts_at).getTime()) / 60000,
  );
  const currentDate = toDateInputValue(new Date(appt.starts_at));
  const currentTime = new Date(appt.starts_at)
    .toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
    .replace(":", ":");
  const [date, setDate] = useState(currentDate);
  const [time, setTime] = useState(currentTime);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!date || !time) {
      toast.error("Data e hora são obrigatórias.");
      return;
    }
    setSaving(true);
    try {
      await rescheduleAppointment({
        data: {
          studioId,
          appointmentId: appt.id,
          date,
          time,
        },
      });
      toast.success("Marcação reagendada.");
      onSaved();
    } catch (err) {
      toast.error(getRescheduleUserMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Reagendar marcação" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {appt.clients && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2">
            <ClientAvatar name={appt.clients.name} avatarUrl={appt.clients.avatar_url} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" title={appt.clients.name}>
                {appt.clients.name}
              </p>
              <p
                className="truncate text-xs text-muted-foreground"
                title={
                  appt.appointment_services
                    ?.map((s) => s.services?.name)
                    .filter(Boolean)
                    .join(", ") || "-"
                }
              >
                {appt.appointment_services
                  ?.map((s) => s.services?.name)
                  .filter(Boolean)
                  .join(", ") || "-"}{" "}
                · {durationMin}min
              </p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
          <ModalField label="Nova data *">
            <PremiumDatePicker
              value={date}
              onChange={setDate}
              placeholder="Escolher data"
              className={datePickerCls}
            />
          </ModalField>
          <ModalField label="Nova hora *">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={`${timeCls}`}
            />
          </ModalField>
        </div>
        {date && time && (
          <div className="rounded-xl border border-blue-500/25 bg-blue-500/8 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Nova data
            </p>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">
                {new Date(`${date}T${time}:00`).toLocaleDateString("pt-PT", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                })}
              </p>
              <p className="shrink-0 rounded-full bg-blue-500/12 px-2 py-0.5 text-xs font-black text-blue-700 dark:text-blue-300">
                {time}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">Duração: {durationMin}min</p>
          </div>
        )}
      </div>
      <ModalFooter
        onClose={onClose}
        onSave={handleSave}
        saving={saving}
        label="Confirmar reagendamento"
      />
    </ModalShell>
  );
}

// ─── Modal Shell & helpers ────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Body scroll lock while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    return () => {
      document.body.style.overflow = prev;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-x-hidden bg-black/40 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-sm md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="relative flex max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-0.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-[1.25rem] border border-border bg-card/98 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 md:max-h-[min(88dvh,44rem)] md:rounded-2xl">
        {/* Sticky header — always visible, never scrolls away */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Agenda
            </p>
            <p className="truncate text-sm font-semibold" title={title}>
              {title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/70 text-muted-foreground hover:text-foreground"
            aria-label={`Fechar ${title}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  onClose,
  onSave,
  saving,
  disabled,
  label = "Guardar marcação",
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="grid shrink-0 gap-2 border-t border-border bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[380px]:grid-cols-[0.85fr_1.15fr]">
      <button
        type="button"
        onClick={onClose}
        className="h-10 rounded-xl border border-border text-sm font-semibold text-muted-foreground transition hover:bg-muted"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-xl bg-foreground px-3 py-2 text-center text-xs font-semibold leading-tight text-background transition hover:opacity-90 disabled:opacity-60 min-[380px]:text-sm"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />A guardar...
          </>
        ) : (
          <span className="min-w-0 break-words">{label}</span>
        )}
      </button>
    </div>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "h-9 min-w-0 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/8";
// timeCls: same visual as inputCls but with color-scheme + appearance resets so iOS Safari renders consistently
const timeCls =
  "h-9 min-w-0 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/8 appearance-none [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:ml-auto [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-date-and-time-value]:text-left";
const selectTriggerCls =
  "h-9 min-w-0 rounded-xl border-border bg-background/70 px-3 text-sm shadow-none focus:ring-2 focus:ring-foreground/10 [&>span]:truncate";
const datePickerCls = "h-9 min-w-0 rounded-xl border-border bg-background/70 px-3 shadow-none";
const textareaCls =
  "max-h-20 min-w-0 w-full resize-none rounded-xl border border-border bg-background/70 px-3 py-2 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/8";

// ─── Client Avatar ────────────────────────────────────────────────────────────

function ClientAvatar({
  name,
  avatarUrl,
  size = "md",
  className: sizeOverride,
}: {
  name?: string | null;
  avatarUrl?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);

  const sizeClass =
    sizeOverride ??
    (size === "sm" ? "size-7 text-[10px]" : size === "lg" ? "size-11 text-sm" : "size-9 text-xs");

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? "Cliente"}
        onError={() => setImgError(true)}
        className={`shrink-0 rounded-full object-cover ${sizeClass}`}
      />
    );
  }

  const initials = name
    ? name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("")
    : "?";

  const palettes = [
    "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    "bg-orange-500/15 text-orange-700 dark:text-orange-300",
    "bg-pink-500/15 text-pink-700 dark:text-pink-300",
  ];
  const idx = name
    ? name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % palettes.length
    : 0;

  return (
    <div
      className={`shrink-0 grid place-items-center rounded-full font-semibold select-none ${sizeClass} ${palettes[idx]}`}
    >
      {initials}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  pct,
  hint,
  money,
  color = "emerald",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  pct: number | null;
  hint: string;
  money?: boolean;
  color?: "emerald" | "violet" | "blue" | "amber";
}) {
  const isPos = (pct ?? 0) >= 0;
  const iconColors: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    amber: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  };
  const valueColor: Record<string, string> = {
    emerald: "text-emerald-700 dark:text-emerald-400",
    violet: "text-foreground",
    blue: "text-foreground",
    amber: "text-foreground",
  };
  return (
    <div className="group flex min-h-[8.25rem] min-w-[160px] flex-1 flex-col justify-between gap-3 rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm transition-all hover:border-foreground/15 hover:shadow-md md:min-w-0">
      <div className="flex items-center justify-between">
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${iconColors[color]}`}>
          {icon}
        </span>
        {pct !== null && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isPos ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}
          >
            {isPos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {isPos ? "+" : ""}
            {pct}%
          </span>
        )}
      </div>
      {value === null ? (
        <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
      ) : (
        <p
          className={`font-semibold tracking-tight leading-none ${
            money
              ? `inline-flex max-w-full flex-nowrap items-center whitespace-nowrap font-mono text-[clamp(1.125rem,4.8vw,1.5rem)] ${valueColor[color]}`
              : "text-2xl"
          }`}
        >
          {value}
        </p>
      )}
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

// ─── Quick Chips ──────────────────────────────────────────────────────────────

function QuickChips({
  filters,
  setFilters,
  resetFilters,
}: {
  filters: AgendaFilters;
  setFilters: React.Dispatch<React.SetStateAction<AgendaFilters>>;
  resetFilters: () => void;
}) {
  const activeCount = countActiveFilters(filters);
  const chips = [
    {
      label: "Hoje",
      active: filters.dateMode === "today",
      onClick: () => setFilters((c) => ({ ...c, dateMode: "today", date: "" })),
    },
    {
      label: "Próximos",
      active: filters.dateMode === "upcoming",
      onClick: () => setFilters((c) => ({ ...c, dateMode: "upcoming", date: "" })),
    },
    {
      label: "Canceladas",
      active: filters.status === "cancelled",
      onClick: () => setFilters((c) => ({ ...c, status: "cancelled" })),
    },
    {
      label: "Compareceu",
      active: filters.attendance === "attended",
      onClick: () => setFilters((c) => ({ ...c, attendance: "attended" })),
    },
    {
      label: "Faltas",
      active: filters.attendance === "missed",
      onClick: () => setFilters((c) => ({ ...c, attendance: "missed" })),
    },
  ];
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={chip.onClick}
          className={`h-7 shrink-0 rounded-full border px-3 text-[11px] font-semibold transition-all ${chip.active ? "border-foreground bg-foreground text-background" : "border-border bg-transparent text-muted-foreground hover:border-foreground/20 hover:text-foreground"}`}
        >
          {chip.label}
        </button>
      ))}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={resetFilters}
          className="h-7 shrink-0 rounded-full border border-border px-3 text-[11px] font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <X className="inline h-3 w-3 mr-1" />
          Limpar
        </button>
      )}
    </div>
  );
}

// ─── Day Group ────────────────────────────────────────────────────────────────

function DayGroup({
  label,
  count,
  collapsed,
  isToday,
  isTomorrow,
  isPast,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  isToday: boolean;
  isTomorrow: boolean;
  isPast: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      data-agenda-day={label}
      className={`overflow-hidden rounded-[1.25rem] border bg-card/95 shadow-sm ${
        isToday
          ? "border-emerald-500/30 ring-1 ring-emerald-500/10"
          : isTomorrow
            ? "border-violet-500/20"
            : "border-border/80"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={`flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition hover:bg-muted/45 md:px-5 md:py-3.5 ${
          collapsed ? "bg-muted/15" : "border-b border-border/70 bg-muted/25"
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-xl ${
              isToday
                ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                : isTomorrow
                  ? "bg-violet-500/10 text-violet-700 dark:text-violet-300"
                  : isPast
                    ? "bg-muted text-muted-foreground"
                    : "bg-blue-500/10 text-blue-700 dark:text-blue-300"
            }`}
          >
            <CalendarDays className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span
              className={`block text-[13px] font-bold leading-snug md:text-sm ${
                isPast ? "text-muted-foreground" : "text-foreground"
              }`}
            >
              {label}
            </span>
            <span className="mt-0.5 block text-[10px] font-semibold text-muted-foreground md:text-[11px]">
              {count} {count === 1 ? "agendamento" : "agendamentos"} · ordem cronológica
            </span>
          </span>
        </div>
        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full border border-border/60 bg-background px-2.5 py-1 text-[10px] font-semibold text-muted-foreground sm:inline-flex">
            {collapsed ? "Expandir" : "Recolher"}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-300 ${
              collapsed ? "-rotate-90" : ""
            }`}
          />
        </span>
      </button>

      {/* CSS-grid smooth collapse — animates height without JS */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: collapsed ? "0fr" : "1fr",
          transition: "grid-template-rows 320ms cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-2.5 p-2.5 md:gap-2 md:p-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

// ─── Appointment Card ─────────────────────────────────────────────────────────

function AppointmentCard({
  appt: a,
  timelineState,
  isNextAppointment,
  split,
  paidAmount,
  paymentLabel,
  messageState,
  canConfirmPresence,
  canResendMessage,
  canViewSensitiveDetails,
  canViewBasicDetails,
  canUseActions,
  savingPresenceId,
  resendingMessageId,
  receivingPaymentId,
  cancellingId,
  confirmCancelId,
  showDepositSplit,
  setShowDepositSplit,
  isExpanded,
  isMenuOpen,
  menuAnchorEl,
  onExpand,
  onMenuToggle,
  onMenuClose,
  onMarkPresence,
  onRequestReceivePayment,
  onResendMessage,
  onRequestCancel,
  onConfirmCancel,
  onDismissCancel,
  onRequestEdit,
  onRequestReschedule,
}: {
  appt: Appt;
  timelineState: AgendaTimelineState;
  isNextAppointment: boolean;
  split: ReturnType<typeof computeAppointmentSplit>;
  paidAmount: number;
  paymentLabel: string;
  messageState: ReturnType<typeof formatMessageState>;
  canConfirmPresence: boolean;
  canResendMessage: boolean;
  canViewSensitiveDetails: boolean;
  canViewBasicDetails: boolean;
  canUseActions: boolean;
  savingPresenceId: string | null;
  resendingMessageId: string | null;
  receivingPaymentId: string | null;
  cancellingId: string | null;
  confirmCancelId: string | null;
  showDepositSplit: boolean;
  setShowDepositSplit: (v: boolean) => void;
  isExpanded: boolean;
  isMenuOpen: boolean;
  menuAnchorEl: HTMLElement | null;
  onExpand: () => void;
  onMenuToggle: (e: React.MouseEvent, el: HTMLElement) => void;
  onMenuClose: () => void;
  onMarkPresence: (s: "completed" | "no_show") => void;
  onRequestReceivePayment: () => void;
  onResendMessage: () => void;
  onRequestCancel: () => void;
  onConfirmCancel: () => void;
  onDismissCancel: () => void;
  onRequestEdit: () => void;
  onRequestReschedule: () => void;
}) {
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const cancelled = a.status === "cancelled";
  const completed = a.status === "completed";
  const missed = a.status === "no_show";
  const service = canViewBasicDetails ? appointmentServiceLabel(a) : "Ocupado";
  const time = new Date(a.starts_at).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const timeEnd = new Date(a.ends_at).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const durationLabel = formatDurationBetween(a.starts_at, a.ends_at, a.total_duration_min);
  const isCancelling = cancellingId === a.id;
  const isConfirmingCancel = confirmCancelId === a.id;
  const financialSummary = getAppointmentFinancialSummary(a, split, paidAmount);
  const canShowSplit = financialSummary.splitAvailable;
  const canExpand = canUseActions || canViewSensitiveDetails;
  const timelineAccent =
    timelineState === "current"
      ? "bg-amber-500"
      : isNextAppointment
        ? "bg-violet-500"
        : timelineState === "past"
          ? "bg-muted-foreground/25"
          : "bg-blue-500/45";

  return (
    <article
      data-timeline-state={timelineState}
      data-next-appointment={isNextAppointment ? "true" : undefined}
      className={`relative overflow-hidden rounded-xl border shadow-sm transition-all duration-200
      md:rounded-xl md:border md:shadow-sm md:hover:border-foreground/15 md:hover:shadow-md
      ${isNextAppointment ? "border-violet-500/35 ring-2 ring-violet-500/15 shadow-md shadow-violet-500/5" : ""}
      ${timelineState === "past" && !cancelled && !completed && !missed ? "bg-muted/15" : ""}
      ${
        missed
          ? "border-red-400/25 bg-red-500/[0.04] dark:bg-red-500/[0.025]"
          : cancelled
            ? "border-border/50 bg-muted/20 opacity-60"
            : completed
              ? "border-emerald-500/15 bg-emerald-500/[0.03] md:bg-emerald-500/[0.025]"
              : "border-border/80 bg-card md:bg-background/60 md:hover:bg-background/90"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-2 left-0 w-1 rounded-r-full ${timelineAccent}`}
      />

      {/* Cancel confirm overlay */}
      {isConfirmingCancel && canUseActions && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/96 px-4 text-center backdrop-blur-sm">
          <p className="text-sm font-semibold">Cancelar esta marcação?</p>
          <p className="text-xs text-muted-foreground">Esta ação não pode ser desfeita.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onDismissCancel}
              className="h-9 rounded-xl border border-border px-4 text-xs font-semibold text-muted-foreground hover:bg-muted"
            >
              Não
            </button>
            <button
              type="button"
              onClick={onConfirmCancel}
              disabled={isCancelling}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              {isCancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Sim, cancelar
            </button>
          </div>
        </div>
      )}

      {/* Main row */}
      <div className="grid grid-cols-[4rem_2.5rem_minmax(0,1fr)_2rem] items-center gap-x-2.5 gap-y-1.5 py-2.5 pl-4 pr-3 md:grid-cols-[4.8rem_2.25rem_minmax(12rem,1.4fr)_minmax(11rem,0.9fr)_auto_6.75rem] md:gap-x-3 md:pl-5 md:pr-4">
        {/* Time block */}
        <div
          className={`row-span-2 flex min-h-[3rem] shrink-0 flex-col items-center justify-center rounded-xl px-2 py-1.5 text-center md:min-h-[3.15rem] ${
            timelineState === "current" && !cancelled
              ? "bg-amber-500/12 text-amber-800 ring-1 ring-amber-500/20 dark:text-amber-200"
              : isNextAppointment
                ? "bg-violet-500/10 text-violet-800 ring-1 ring-violet-500/15 dark:text-violet-200"
                : missed
                  ? "bg-red-500/10 text-red-700 dark:text-red-300"
                  : completed
                    ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                    : cancelled
                      ? "bg-muted/60 text-muted-foreground/60"
                      : "bg-muted text-foreground"
          }`}
        >
          <span className="inline-flex w-full items-center justify-center whitespace-nowrap text-[16px] font-black tabular-nums leading-none tracking-normal md:text-[17px]">
            {time}
          </span>
          <span className="mt-1 inline-flex w-full items-center justify-center whitespace-nowrap text-[9px] font-semibold tabular-nums leading-none opacity-55">
            até {timeEnd}
          </span>
        </div>

        <ClientAvatar
          name={canViewSensitiveDetails ? a.clients?.name : undefined}
          avatarUrl={canViewSensitiveDetails ? a.clients?.avatar_url : undefined}
          className="size-10 shrink-0 text-xs md:size-9"
        />

        <div
          className={`min-w-0 md:pr-1 ${canExpand ? "cursor-pointer" : ""}`}
          onClick={canExpand ? onExpand : undefined}
          role={canExpand ? "button" : undefined}
          tabIndex={canExpand ? 0 : undefined}
          onKeyDown={(e) => e.key === "Enter" && canExpand && onExpand()}
        >
          <p className="min-w-0 break-words text-sm font-bold leading-tight text-foreground md:text-[15px]">
            {canViewSensitiveDetails
              ? (a.clients?.name ?? (
                  <span className="italic text-muted-foreground">Sem cliente</span>
                ))
              : "Horário ocupado"}
          </p>
          <p className="mt-0.5 min-w-0 break-words text-xs font-medium leading-snug text-muted-foreground md:text-[12px]">
            {service} <span className="text-muted-foreground/70">· {durationLabel}</span>
          </p>
          {a.staff?.name && (
            <p className="mt-0.5 min-w-0 break-words text-[11px] font-medium leading-snug text-muted-foreground/85">
              Profissional · {a.staff.name}
            </p>
          )}
          {a.public_token && canViewSensitiveDetails && (
            <p className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              Reserva #{getPublicReservationCode(a.public_token)}
            </p>
          )}
        </div>

        <div className="col-start-4 row-start-1 flex shrink-0 items-center justify-end gap-0.5 md:col-start-6 md:row-start-1 md:justify-end">
          {canExpand && (
            <button
              type="button"
              onClick={onExpand}
              title={isExpanded ? "Fechar" : "Ver detalhes"}
              className={`hidden md:grid size-8 place-items-center rounded-lg transition hover:bg-muted ${isExpanded ? "text-foreground bg-muted" : "text-muted-foreground"}`}
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          )}
          {canUseActions && a.clients?.phone && (
            <a
              href={`tel:${a.clients.phone}`}
              onClick={(e) => e.stopPropagation()}
              title="Ligar"
              className="hidden md:grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
          )}
          {canUseActions && (
            <button
              ref={menuBtnRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMenuToggle(e, menuBtnRef.current!);
              }}
              className={`grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground ${isMenuOpen ? "bg-muted text-foreground" : ""}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="col-span-4 flex min-w-0 items-start justify-between gap-2 md:contents">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 md:col-start-4 md:row-start-1 md:flex-col md:items-start md:gap-1">
            {canViewSensitiveDetails ? <StatusChip status={a.status} /> : <SharedAgendaChip />}
            <TimelineChip state={timelineState} isNext={isNextAppointment} />
            {canViewSensitiveDetails && <FinancialStatusChip summary={financialSummary} />}
            {canViewSensitiveDetails && isBirthdayThisWeek(a.clients?.date_of_birth) && (
              <span className="max-w-full rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-amber-700 dark:text-amber-300">
                Aniversário esta semana
              </span>
            )}
          </div>
          {canViewSensitiveDetails && (
            <span className="shrink-0 self-start whitespace-nowrap pt-0.5 font-mono text-sm font-bold leading-none text-emerald-700 dark:text-emerald-400 md:col-start-5 md:row-start-1 md:self-center md:pt-0 md:text-right md:text-[15px]">
              {formatEUR(split.serviceTotal)}
            </span>
          )}
        </div>
      </div>

      {/* Notes */}
      {canViewSensitiveDetails && a.notes && (
        <p className="border-t border-border/40 px-4 pb-2.5 pt-2 text-[11px] italic text-muted-foreground">
          "{a.notes}"
        </p>
      )}

      {/* Expanded financial panel */}
      {isExpanded && canViewSensitiveDetails && (
        <div
          className={`border-t px-3.5 pb-3.5 pt-3 md:px-4 ${missed ? "border-red-500/20 bg-red-500/3" : "border-border/50 bg-muted/15"}`}
        >
          <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
            <div className="grid gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-center">
              {financialSummary.items.map((item) => (
                <FinancialLine
                  key={item.label}
                  label={item.label}
                  value={formatEUR(item.value)}
                  emphasis={item.emphasis}
                />
              ))}
            </div>
            {canShowSplit && (
              <div className="flex items-center justify-between gap-2 md:justify-end">
                <button
                  type="button"
                  onClick={() => setShowDepositSplit(!showDepositSplit)}
                  className="h-8 shrink-0 rounded-full border border-border/70 bg-background/70 px-3 text-[11px] font-semibold text-muted-foreground transition hover:border-foreground/20 hover:bg-background hover:text-foreground"
                >
                  {showDepositSplit ? "Ocultar repartição" : "Ver repartição"}
                </button>
              </div>
            )}
          </div>

          {showDepositSplit && canShowSplit && (
            <div className="mt-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <FinancialSplitLine label="Estúdio" value={formatEUR(split.studio)} />
                <FinancialSplitLine label="Profissional" value={formatEUR(split.professional)} />
              </div>
            </div>
          )}

          <div className="hidden">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Repartição financeira
              </p>
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showDepositSplit}
                  onChange={(e) => setShowDepositSplit(e.target.checked)}
                  className="h-3 w-3 accent-emerald-600"
                />
                Ver divisão do sinal
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <FinancialMetricCard
                label="Valor total"
                value={formatEUR(split.serviceTotal)}
                featured
              />
              <FinancialMetricCard label="Recebido online" value={formatEUR(split.received)} />
              <FinancialMetricCard label="Restante" value={formatEUR(split.pending)} />
              <FinancialMetricCard
                label={a.status === "completed" ? "Faturado" : "Pendente"}
                value={formatEUR(split.confirmed)}
                muted={a.status !== "completed"}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FinancialMetricCard
                label="Estúdio recebe"
                value={formatEUR(split.studio)}
                detail={`${split.commissionPercent}% do total`}
                featured
              />
              <FinancialMetricCard
                label="Profissional recebe"
                value={formatEUR(split.professional)}
                detail={`${100 - split.commissionPercent}% do total`}
                featured
              />
            </div>
            {showDepositSplit && split.received > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <FinancialMetricCard
                  label="Sinal: estúdio"
                  value={formatEUR(split.signalStudio)}
                  detail="Apenas referência"
                  muted
                />
                <FinancialMetricCard
                  label="Sinal: profissional"
                  value={formatEUR(split.signalProfessional)}
                  detail="Apenas referência"
                  muted
                />
              </div>
            )}
          </div>
          {canConfirmPresence && (
            <div
              className={`mt-3 grid gap-2 ${canResendMessage ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
            >
              <PresenceButton
                active={a.status === "completed"}
                disabled={savingPresenceId === a.id}
                onClick={() => onMarkPresence("completed")}
              >
                <Check className="h-3.5 w-3.5" /> Compareceu
              </PresenceButton>
              <PresenceButton
                active={a.status === "no_show"}
                danger
                disabled={savingPresenceId === a.id}
                onClick={() => onMarkPresence("no_show")}
              >
                <X className="h-3.5 w-3.5" /> Não compareceu
              </PresenceButton>
              {canResendMessage && (
                <PresenceButton
                  active={false}
                  whatsapp
                  disabled={resendingMessageId === a.id}
                  onClick={onResendMessage}
                >
                  <WhatsAppIcon className="h-3.5 w-3.5 shrink-0" />
                  {resendingMessageId === a.id
                    ? "A reenviar..."
                    : isPastAppointment(a.ends_at)
                      ? "Contactar no WhatsApp"
                      : "Reenviar WhatsApp"}
                </PresenceButton>
              )}
            </div>
          )}
          {financialSummary.needsStudioPaymentConfirmation && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PresenceButton
                active={false}
                disabled={receivingPaymentId === a.id}
                onClick={onRequestReceivePayment}
              >
                <Euro className="h-3.5 w-3.5" /> Receber pagamento
              </PresenceButton>
              <PresenceButton
                active={a.status === "no_show"}
                danger
                disabled={savingPresenceId === a.id || receivingPaymentId === a.id}
                onClick={() => onMarkPresence("no_show")}
              >
                <X className="h-3.5 w-3.5" /> Marcar falta
              </PresenceButton>
            </div>
          )}
          {canResendMessage && !canConfirmPresence && (
            <div className="mt-3">
              <PresenceButton
                active={false}
                whatsapp
                disabled={resendingMessageId === a.id}
                onClick={onResendMessage}
              >
                <WhatsAppIcon className="h-3.5 w-3.5 shrink-0" />
                {resendingMessageId === a.id
                  ? "A reenviar..."
                  : isPastAppointment(a.ends_at)
                    ? "Contactar no WhatsApp"
                    : "Reenviar WhatsApp"}
              </PresenceButton>
            </div>
          )}
        </div>
      )}

      {/* Portal Action Menu */}
      {isMenuOpen && canUseActions && (
        <PortalActionMenu
          anchorEl={menuAnchorEl}
          appt={a}
          canResendMessage={canResendMessage}
          canReceivePayment={financialSummary.needsStudioPaymentConfirmation}
          resendingMessageId={resendingMessageId}
          onViewDetails={() => {
            onExpand();
            onMenuClose();
          }}
          onEdit={() => {
            onRequestEdit();
          }}
          onReschedule={() => {
            onRequestReschedule();
          }}
          onReceivePayment={() => {
            onRequestReceivePayment();
            onMenuClose();
          }}
          onResendMessage={() => {
            onResendMessage();
            onMenuClose();
          }}
          onRequestCancel={() => {
            onRequestCancel();
          }}
          onClose={onMenuClose}
        />
      )}
    </article>
  );
}

// ─── Portal Action Menu ───────────────────────────────────────────────────────

function PortalActionMenu({
  anchorEl,
  appt: a,
  canResendMessage,
  canReceivePayment,
  resendingMessageId,
  onViewDetails,
  onEdit,
  onReschedule,
  onReceivePayment,
  onResendMessage,
  onRequestCancel,
  onClose,
}: {
  anchorEl: HTMLElement | null;
  appt: Appt;
  canResendMessage: boolean;
  canReceivePayment: boolean;
  resendingMessageId: string | null;
  onViewDetails: () => void;
  onEdit: () => void;
  onReschedule: () => void;
  onReceivePayment: () => void;
  onResendMessage: () => void;
  onRequestCancel: () => void;
  onClose: () => void;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsMobile(window.innerWidth < 768);

    if (!anchorEl || window.innerWidth < 768) return;

    const rect = anchorEl.getBoundingClientRect();
    const menuW = 216;
    const menuH = a.status !== "cancelled" ? 280 : 240;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    const rightGap = viewW - rect.right;

    const newStyle: React.CSSProperties = { position: "fixed", zIndex: 9999, minWidth: menuW };

    // Horizontal: right-align to button; if too close to left edge, left-align
    if (rightGap + menuW <= viewW) {
      newStyle.right = Math.max(8, rightGap);
    } else {
      newStyle.left = Math.max(8, rect.left - menuW + rect.width);
    }

    // Vertical: below if space, else above
    const spaceBelow = viewH - rect.bottom - 8;
    if (spaceBelow >= menuH) {
      newStyle.top = rect.bottom + 6;
    } else {
      newStyle.bottom = viewH - rect.top + 6;
    }

    setStyle(newStyle);
  }, [anchorEl, a.status]);

  // Close on scroll
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [onClose]);

  // Mobile bottom sheet
  if (isMobile) {
    return createPortal(
      <div className="fixed inset-0 z-[9998]">
        <button
          type="button"
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[1.5rem] border-t border-border bg-card shadow-2xl animate-in slide-in-from-bottom-2 duration-200">
          {/* Handle + client info */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
            <div className="flex items-center gap-3">
              <ClientAvatar name={a.clients?.name} avatarUrl={a.clients?.avatar_url} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{a.clients?.name ?? "Sem cliente"}</p>
                <p className="text-xs text-muted-foreground">{a.clients?.phone ?? ""}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-2">
            <SheetItem icon={<Eye className="h-4 w-4" />} onClick={onViewDetails}>
              Ver detalhes
            </SheetItem>
            <SheetItem icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Editar marcação
            </SheetItem>
            <SheetItem icon={<CalendarClock className="h-4 w-4" />} onClick={onReschedule}>
              Reagendar
            </SheetItem>
            {canReceivePayment && (
              <SheetItem icon={<Euro className="h-4 w-4" />} onClick={onReceivePayment}>
                Receber pagamento
              </SheetItem>
            )}
            {a.clients?.phone && (
              <SheetItem
                icon={<Phone className="h-4 w-4" />}
                onClick={() => {
                  window.open(`tel:${a.clients?.phone}`);
                  onClose();
                }}
              >
                Contactar cliente
              </SheetItem>
            )}
            {canResendMessage && (
              <SheetItem
                icon={<WhatsAppIcon className="h-4 w-4" />}
                onClick={() => {
                  onResendMessage();
                }}
                disabled={resendingMessageId === a.id}
              >
                {isPastAppointment(a.ends_at) ? "Contactar no WhatsApp" : "Reenviar WhatsApp"}
              </SheetItem>
            )}
          </div>
          {a.status !== "cancelled" && (
            <>
              <div className="mx-3 border-t border-border/60" />
              <div className="p-2 pb-10">
                <SheetItem icon={<X className="h-4 w-4" />} onClick={onRequestCancel} danger>
                  Cancelar marcação
                </SheetItem>
              </div>
            </>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  // Desktop dropdown via portal
  return createPortal(
    <>
      {/* Transparent backdrop to close on outside click */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div
        className="overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        style={style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-1">
          <DropMenuItem icon={<Eye className="h-3.5 w-3.5" />} onClick={onViewDetails}>
            Ver detalhes
          </DropMenuItem>
          <DropMenuItem icon={<Pencil className="h-3.5 w-3.5" />} onClick={onEdit}>
            Editar marcação
          </DropMenuItem>
          <DropMenuItem icon={<CalendarClock className="h-3.5 w-3.5" />} onClick={onReschedule}>
            Reagendar
          </DropMenuItem>
          {canReceivePayment && (
            <DropMenuItem icon={<Euro className="h-3.5 w-3.5" />} onClick={onReceivePayment}>
              Receber pagamento
            </DropMenuItem>
          )}
          {a.clients?.phone && (
            <DropMenuItem
              icon={<Phone className="h-3.5 w-3.5" />}
              onClick={() => {
                window.open(`tel:${a.clients?.phone}`);
                onClose();
              }}
            >
              Contactar cliente
            </DropMenuItem>
          )}
          {canResendMessage && (
            <DropMenuItem
              icon={<WhatsAppIcon className="h-3.5 w-3.5" />}
              onClick={onResendMessage}
              disabled={resendingMessageId === a.id}
            >
              {isPastAppointment(a.ends_at) ? "Contactar no WhatsApp" : "Reenviar WhatsApp"}
            </DropMenuItem>
          )}
        </div>
        {a.status !== "cancelled" && (
          <>
            <div className="border-t border-border/50" />
            <div className="p-1">
              <DropMenuItem icon={<X className="h-3.5 w-3.5" />} danger onClick={onRequestCancel}>
                Cancelar marcação
              </DropMenuItem>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

function StudioPaymentDialog({
  appt,
  amount,
  busy,
  enableInPersonMbWay,
  onClose,
  onConfirm,
}: {
  appt: Appt;
  amount: number;
  busy: boolean;
  enableInPersonMbWay: boolean;
  onClose: () => void;
  onConfirm: (method: StudioPaymentMethod, options?: { phone?: string }) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<StudioPaymentMethod>("cash");
  const [clientAttended, setClientAttended] = useState(true);
  const [mbWayPhone, setMbWayPhone] = useState(appt.clients?.phone ?? "");
  const isStripeMbWay = enableInPersonMbWay && paymentMethod === "mb_way";
  const normalizedMbWayPhone = normalizeInternationalPhone(mbWayPhone);
  const canSendMbWayCharge = !isStripeMbWay || isValidInternationalPhone(normalizedMbWayPhone);
  const primaryLabel = isStripeMbWay ? "Enviar cobrança" : "Confirmar pagamento";

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center bg-black/45 p-3 backdrop-blur-sm sm:items-center">
      <button type="button" aria-label="Fechar" className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Receber pagamento</p>
            <p className="truncate text-xs text-muted-foreground">
              {appt.clients?.name ?? "Cliente"} · {formatEUR(amount)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-xl border border-border text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Valor a receber
            </p>
            <p className="mt-1 font-mono text-xl font-bold text-foreground">{formatEUR(amount)}</p>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Forma de pagamento</p>
            <div className="grid grid-cols-2 gap-2">
              {STUDIO_PAYMENT_METHODS.map((method) => (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => setPaymentMethod(method.value)}
                  className={`h-10 rounded-xl border px-3 text-xs font-semibold transition ${
                    paymentMethod === method.value
                      ? "border-foreground bg-foreground text-background shadow-sm"
                      : "border-border bg-background/70 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {isStripeMbWay && (
            <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3">
              <div className="mt-2">
                <InternationalPhoneInput
                  value={mbWayPhone}
                  onChange={setMbWayPhone}
                  label="Telemóvel MB WAY"
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                A cliente aprova a cobrança na app MB WAY. A Bellza só confirma o pagamento após
                resposta da Stripe.
              </p>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5 text-sm font-medium">
            <input
              type="checkbox"
              checked={clientAttended}
              onChange={(event) => setClientAttended(event.target.checked)}
              className="size-4 accent-emerald-600"
            />
            Cliente compareceu.
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t border-border bg-muted/20 p-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-border bg-background text-sm font-semibold text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !clientAttended || !canSendMbWayCharge}
            onClick={() =>
              onConfirm(paymentMethod, isStripeMbWay ? { phone: normalizedMbWayPhone } : undefined)
            }
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const STUDIO_PAYMENT_METHODS: Array<{ value: StudioPaymentMethod; label: string }> = [
  { value: "cash", label: "Dinheiro" },
  { value: "card", label: "Cartão" },
  { value: "mb_way", label: "MB WAY" },
  { value: "other", label: "Outro" },
];

function DropMenuItem({
  icon,
  children,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors disabled:opacity-50 ${danger ? "text-red-600 hover:bg-red-500/10 dark:text-red-400" : "text-foreground hover:bg-muted"}`}
    >
      <span className={danger ? "text-red-500" : "text-muted-foreground"}>{icon}</span>
      {children}
    </button>
  );
}

function SheetItem({
  icon,
  children,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition-colors disabled:opacity-50 ${danger ? "text-red-600 hover:bg-red-500/10 dark:text-red-400" : "text-foreground hover:bg-muted"}`}
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-xl ${danger ? "bg-red-500/10 text-red-500" : "bg-muted text-muted-foreground"}`}
      >
        {icon}
      </span>
      {children}
    </button>
  );
}

// ─── Status Chip ──────────────────────────────────────────────────────────────

function TimelineChip({ state, isNext }: { state: AgendaTimelineState; isNext: boolean }) {
  if (state === "current") {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-amber-800 dark:text-amber-300">
        <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
        Agora
      </span>
    );
  }
  if (isNext) {
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-violet-800 dark:text-violet-300">
        <Clock className="h-2.5 w-2.5" />
        Próximo atendimento
      </span>
    );
  }
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase leading-tight tracking-wide ${
        state === "past"
          ? "bg-muted text-muted-foreground/80"
          : "bg-blue-500/8 text-blue-700/80 dark:text-blue-300/80"
      }`}
    >
      {state === "past" ? "Horário passado" : "Mais tarde"}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    confirmed: {
      label: "Confirmada",
      cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
    },
    completed: { label: "Concluída", cls: "bg-blue-500/12 text-blue-700 dark:text-blue-400" },
    cancelled: { label: "Cancelada", cls: "bg-red-500/12 text-red-600 dark:text-red-400" },
    no_show: { label: "Falta", cls: "bg-red-500/12 text-red-600 dark:text-red-400" },
    pending: { label: "Pendente", cls: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
    pending_payment: {
      label: "Aguarda pagamento",
      cls: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
    },
  };
  const cfg = map[status] ?? {
    label: formatAppointmentStatus(status),
    cls: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`max-w-full rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

function SharedAgendaChip() {
  return (
    <span className="max-w-full rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold leading-tight text-muted-foreground">
      Ocupado
    </span>
  );
}

function AgendaScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-xl border px-3 text-xs font-semibold transition ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

type AppointmentFinancialSummary = {
  stateLabel: string;
  tone: "success" | "warning" | "muted";
  splitAvailable: boolean;
  needsStudioPaymentConfirmation: boolean;
  items: Array<{ label: string; value: number; emphasis?: boolean }>;
};

function getAppointmentFinancialSummary(
  a: Appt,
  split: ReturnType<typeof computeAppointmentSplit>,
  paidAmount: number,
): AppointmentFinancialSummary {
  const total = Math.max(0, Number(split.serviceTotal) || 0);
  const paid = Math.min(total, Math.max(0, Number(paidAmount) || 0));
  const remaining = Math.max(0, total - paid);
  const completed = a.status === "completed";
  const paidInFull = total > 0 && paid >= total - 0.005;
  const hasDeposit = paid > 0 && !paidInFull;

  if (paidInFull) {
    return {
      stateLabel: completed ? "Pago" : "Pago integralmente",
      tone: "success",
      splitAvailable: true,
      needsStudioPaymentConfirmation: false,
      items: [{ label: "Valor do serviço", value: total, emphasis: true }],
    };
  }

  if (hasDeposit) {
    return {
      stateLabel: completed ? "Pagamento recebido" : "Sinal recebido",
      tone: completed ? "success" : "warning",
      splitAvailable: completed,
      needsStudioPaymentConfirmation: false,
      items: [
        { label: "Valor do serviço", value: total, emphasis: true },
        { label: "Sinal recebido", value: paid },
        {
          label: completed ? "Cobrado no estúdio" : "Cobrar no estúdio",
          value: remaining,
          emphasis: !completed,
        },
      ],
    };
  }

  return {
    stateLabel: "Aguardando pagamento presencial",
    tone: "muted",
    splitAvailable: false,
    needsStudioPaymentConfirmation: !["cancelled", "no_show"].includes(a.status),
    items: [{ label: "Valor do serviço", value: total, emphasis: true }],
  };
}

function FinancialStatusChip({
  summary,
  size = "sm",
}: {
  summary: AppointmentFinancialSummary;
  size?: "sm" | "lg";
}) {
  const toneClass =
    summary.tone === "success"
      ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
      : summary.tone === "warning"
        ? "bg-amber-500/12 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      title={summary.stateLabel}
      className={`min-w-0 max-w-full whitespace-normal break-words rounded-full font-semibold leading-tight ${toneClass} ${
        size === "lg" ? "px-2.5 py-1 text-[11px]" : "px-2 py-0.5 text-[10px]"
      }`}
    >
      {summary.stateLabel}
    </span>
  );
}

function FinancialLine({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background/70 px-3 py-2 md:min-w-[8.5rem]">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-0.5 truncate font-mono text-sm font-semibold ${emphasis ? "text-foreground" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        {value}
      </p>
    </div>
  );
}

function FinancialSplitLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((g) => (
        <div key={g} className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="h-10 animate-pulse border-b border-border bg-muted/40 rounded-t-2xl" />
          <div className="flex flex-col divide-y divide-border/40">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-10 w-12 animate-pulse rounded-xl bg-muted shrink-0" />
                <div className="size-9 animate-pulse rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="flex gap-2 items-center">
                    <div className="h-4 w-28 animate-pulse rounded-lg bg-muted" />
                    <div className="h-4 w-16 animate-pulse rounded-full bg-muted" />
                  </div>
                  <div className="h-3 w-44 animate-pulse rounded-lg bg-muted/70" />
                </div>
                <div className="flex gap-1 shrink-0">
                  <div className="size-8 animate-pulse rounded-lg bg-muted" />
                  <div className="size-8 animate-pulse rounded-lg bg-muted" />
                  <div className="size-8 animate-pulse rounded-lg bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-sm">
      <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-muted">
        <CalendarDays className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

// ─── Financial Metric Card ────────────────────────────────────────────────────

function FinancialMetricCard({
  label,
  value,
  detail,
  featured,
  muted,
}: {
  label: string;
  value: string;
  detail?: string;
  featured?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${featured ? "border-emerald-700/20 bg-emerald-950/5 dark:bg-emerald-400/[0.05]" : "border-border/60 bg-background/60"}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-sm font-semibold text-emerald-700 dark:text-emerald-400 ${muted ? "opacity-70" : ""}`}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

// ─── Presence Button ──────────────────────────────────────────────────────────

function PresenceButton({
  children,
  active,
  danger,
  whatsapp,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  danger?: boolean;
  whatsapp?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 w-full items-center justify-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-all disabled:cursor-wait disabled:opacity-60 ${active ? (danger ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300" : "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300") : whatsapp ? "border-emerald-500/20 bg-emerald-600/8 text-emerald-700 hover:bg-emerald-600/12 dark:text-emerald-300" : "border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}

// ─── WhatsApp Icon ────────────────────────────────────────────────────────────

function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M20.52 3.49A11.82 11.82 0 0 0 12.1 0C5.55 0 .22 5.33.22 11.88c0 2.09.55 4.14 1.6 5.94L.12 24l6.32-1.66a11.9 11.9 0 0 0 5.66 1.44h.01c6.55 0 11.88-5.33 11.88-11.88 0-3.17-1.23-6.15-3.47-8.41Zm-8.42 18.3h-.01a9.86 9.86 0 0 1-5.03-1.38l-.36-.21-3.75.98 1-3.65-.24-.38a9.85 9.85 0 0 1-1.51-5.27c0-5.46 4.44-9.9 9.9-9.9 2.65 0 5.13 1.03 7 2.9a9.82 9.82 0 0 1 2.9 7c0 5.46-4.44 9.91-9.9 9.91Zm5.43-7.42c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.06 2.87 1.21 3.07c.15.2 2.09 3.19 5.06 4.47.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.69.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35Z" />
    </svg>
  );
}

// ─── Filter Fields ────────────────────────────────────────────────────────────

function AgendaFilterFields({
  filters,
  options,
  onChange,
  mobile,
  hideProfessional,
}: {
  filters: AgendaFilters;
  options: ReturnType<typeof buildFilterOptions>;
  onChange: <K extends keyof AgendaFilters>(key: K, value: AgendaFilters[K]) => void;
  mobile?: boolean;
  hideProfessional?: boolean;
}) {
  return (
    <div className={`grid gap-3 ${mobile ? "" : "md:grid-cols-2 xl:grid-cols-4"}`}>
      <FilterField label="Data">
        <PremiumFilterSelect
          value={filters.dateMode}
          onValueChange={(v) => {
            const value = v as AgendaFilters["dateMode"];
            onChange("dateMode", value);
            if (value !== "specific") onChange("date", "");
          }}
          options={[
            ["all", "Todas as datas"],
            ["today", "Hoje"],
            ["upcoming", "Próximos"],
            ["specific", "Escolher data"],
          ]}
        />
      </FilterField>
      <FilterField label="Dia especifico">
        <PremiumDatePicker
          value={filters.date}
          onChange={(v) => {
            onChange("date", v);
            onChange("dateMode", v ? "specific" : "all");
          }}
          placeholder="Escolher data"
          className="h-10 rounded-xl px-3 shadow-none bg-background/70 border-border"
        />
      </FilterField>
      {!hideProfessional && (
        <FilterField label="Profissional">
          <PremiumFilterSelect
            value={filters.staffId}
            onValueChange={(v) => onChange("staffId", v)}
            options={[["all", "Todos"], ...options.professionals]}
          />
        </FilterField>
      )}
      <FilterField label="Serviço">
        <PremiumFilterSelect
          value={filters.service}
          onValueChange={(v) => onChange("service", v)}
          options={[["all", "Todos"], ...options.services.map((s) => [s, s] as [string, string])]}
        />
      </FilterField>
      <FilterField label="Estado">
        <PremiumFilterSelect
          value={filters.status}
          onValueChange={(v) => onChange("status", v)}
          options={[
            ["all", "Todos"],
            ...options.statuses.map((s) => [s, formatAppointmentStatus(s)] as [string, string]),
            ...(!options.statuses.includes("cancelled")
              ? [["cancelled", "Cancelada"] as [string, string]]
              : []),
          ]}
        />
      </FilterField>
      <FilterField label="Cliente / Telefone">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filters.client}
            onChange={(e) => onChange("client", e.target.value)}
            placeholder="Nome ou telefone"
            className="h-10 w-full rounded-xl border border-border bg-background/70 pl-9 pr-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/8"
          />
        </div>
      </FilterField>
      <FilterField label="Pagamento">
        <PremiumFilterSelect
          value={filters.payment}
          onValueChange={(v) => onChange("payment", v as AgendaFilters["payment"])}
          options={[
            ["all", "Todos"],
            ["online", "Online"],
            ["studio", "No estudio"],
            ["pending", "Aguarda pagamento"],
          ]}
        />
      </FilterField>
      <FilterField label="Presenca">
        <PremiumFilterSelect
          value={filters.attendance}
          onValueChange={(v) => onChange("attendance", v as AgendaFilters["attendance"])}
          options={[
            ["all", "Todos"],
            ["attended", "Compareceu"],
            ["missed", "Faltas"],
          ]}
        />
      </FilterField>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function PremiumFilterSelect({
  value,
  onValueChange,
  options,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-10 rounded-xl border-border bg-background/70 px-3 text-sm shadow-none hover:bg-background focus:ring-2 focus:ring-foreground/10">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-2xl border-border/80 bg-popover/98 shadow-2xl">
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

function buildFilterOptions(appts: Appt[]) {
  const professionals = new Map<string, string>();
  const services = new Set<string>();
  const statuses = new Set<string>();
  for (const a of appts) {
    if (a.staff?.id) professionals.set(a.staff.id, a.staff.name);
    a.appointment_services?.forEach((line) => {
      if (line.services?.name) services.add(line.services.name);
    });
    if (a.status) statuses.add(a.status);
  }
  return {
    professionals: Array.from(professionals.entries()).sort((a, b) => a[1].localeCompare(b[1])),
    services: Array.from(services).sort((a, b) => a.localeCompare(b)),
    statuses: Array.from(statuses).sort((a, b) =>
      formatAppointmentStatus(a).localeCompare(formatAppointmentStatus(b)),
    ),
  };
}

function normalizeAppointmentClients(rows: unknown[], nested: boolean): StudioClient[] {
  if (!nested) return rows as StudioClient[];
  const map = new Map<string, StudioClient>();
  for (const row of rows) {
    const client = (row as { clients?: StudioClient | StudioClient[] | null }).clients;
    const value = Array.isArray(client) ? client[0] : client;
    if (value?.id) map.set(value.id, value);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function isBirthdayThisWeek(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const birthday = new Date(today.getFullYear(), Number(match[2]) - 1, Number(match[3]));
  if (birthday < start) birthday.setFullYear(today.getFullYear() + 1);
  return birthday >= start && birthday <= end;
}

function appointmentMatchesFilters(
  a: Appt,
  filters: AgendaFilters,
  paidByAppointment: Map<string, number>,
) {
  const start = new Date(a.starts_at);
  const now = new Date();
  const paid = paidByAppointment.get(a.id) ?? 0;
  const svcNames = a.appointment_services?.map((l) => l.services?.name).filter(Boolean) as
    | string[]
    | undefined;
  if (filters.dateMode === "today" && start.toDateString() !== now.toDateString()) return false;
  if (filters.dateMode === "upcoming" && start.getTime() < now.getTime()) return false;
  if (filters.dateMode === "specific" && filters.date && toDateInputValue(start) !== filters.date)
    return false;
  if (filters.staffId !== "all" && a.staff?.id !== filters.staffId) return false;
  if (filters.service !== "all" && !svcNames?.includes(filters.service)) return false;
  if (filters.status !== "all" && a.status !== filters.status) return false;
  if (filters.client.trim()) {
    const q = normalizeFilterText(filters.client);
    const hay = normalizeFilterText(`${a.clients?.name ?? ""} ${a.clients?.phone ?? ""}`);
    if (!hay.includes(q)) return false;
  }
  if (filters.payment === "online" && paid <= 0) return false;
  if (filters.payment === "studio" && paid > 0) return false;
  if (filters.payment === "pending" && a.status !== "pending_payment") return false;
  if (filters.confirmation === "confirmed" && !["confirmed", "completed"].includes(a.status))
    return false;
  if (filters.confirmation === "unconfirmed" && ["confirmed", "completed"].includes(a.status))
    return false;
  if (filters.attendance === "attended" && a.status !== "completed") return false;
  if (filters.attendance === "missed" && a.status !== "no_show") return false;
  return true;
}

function countActiveFilters(filters: AgendaFilters) {
  return [
    filters.dateMode !== "all",
    filters.dateMode === "specific" && !!filters.date,
    filters.staffId !== "all",
    filters.service !== "all",
    filters.status !== "all",
    !!filters.client.trim(),
    filters.payment !== "all",
    filters.confirmation !== "all",
    filters.attendance !== "all",
  ].filter(Boolean).length;
}

function normalizeFilterText(v: string) {
  return v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  return `${toDateInputValue(date)}T${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}
function formatBlockDate(value: string) {
  return new Date(value).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function formatBlockTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function addLocalDays(value: Date, amount: number) {
  const result = startOfLocalDay(value);
  result.setDate(result.getDate() + amount);
  return result;
}
function timeValueToMinutes(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}
function mergeLocalDateTime(value: string, part: "date" | "time", nextValue: string) {
  const currentDate = value.slice(0, 10);
  const currentTime = value.slice(11, 16);
  return part === "date" ? `${nextValue}T${currentTime}` : `${currentDate}T${nextValue}`;
}
function isValidLocalDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}
function getAgendaWeekDays(value: Date) {
  const selected = startOfLocalDay(value);
  const mondayOffset = (selected.getDay() + 6) % 7;
  const monday = addLocalDays(selected, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
}
function getMobileAgendaDays(anchor: Date, startOffset: number, endOffset: number) {
  return Array.from({ length: endOffset - startOffset + 1 }, (_, index) =>
    addLocalDays(anchor, startOffset + index),
  );
}
function differenceInLocalCalendarDays(value: Date, anchor: Date) {
  const valueUtc = Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const anchorUtc = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  return Math.round((valueUtc - anchorUtc) / 86_400_000);
}
function dateFromInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function formatAgendaDateTitle(value: Date) {
  const today = startOfLocalDay(new Date());
  const prefix = isSameLocalDay(value, today)
    ? "Hoje"
    : isSameLocalDay(value, addLocalDays(today, 1))
      ? "Amanhã"
      : null;
  const complete = value.toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const normalized = complete.charAt(0).toUpperCase() + complete.slice(1);
  return prefix ? `${prefix} · ${normalized}` : normalized;
}
function canViewSensitiveAppointment(
  a: Appt,
  studio: { role: string; staff_id: string | null } | null,
) {
  if (!studio || studio.role !== "staff") return true;
  return !!studio.staff_id && a.staff?.id === studio.staff_id;
}
function appointmentServiceLabel(a: Appt) {
  return (
    a.appointment_services
      ?.map((s) => s.services?.name)
      .filter(Boolean)
      .join(", ") || "-"
  );
}
function formatDurationBetween(startsAt: string, endsAt: string, explicitDuration?: number | null) {
  const minutes =
    Number(explicitDuration) ||
    Math.max(0, Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000));
  if (minutes <= 0) return "duração por confirmar";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}
function scopeAppointmentRows<T extends { in: (column: string, values: string[]) => T }>(
  query: T,
  appointmentIds: string[] | null,
) {
  return appointmentIds ? query.in("appointment_id", appointmentIds) : query;
}
function sortAppointmentsChronologically(items: Appt[]) {
  return sortAppointmentsChronologicallyShared(items, "future");
}

async function fetchAgendaAppointments(studioId: string, staffId?: string | null) {
  // Try with avatar_url (present if clients table has that column)
  const withAvatar = await supabase
    .from("appointments")
    .select(
      "id,public_token,starts_at,ends_at,status,total_price,total_duration_min,notes,clients(name,phone,avatar_url,date_of_birth),staff(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(price,services(name,commission_percent,deposit_recipient,deposit_professional_percent))",
    )
    .eq("studio_id", studioId)
    .match(staffId ? { staff_id: staffId } : {})
    .order("starts_at", { ascending: true })
    .limit(1000);
  if (!withAvatar.error) return withAvatar;

  // Fallback: full schema without avatar_url
  const full = await supabase
    .from("appointments")
    .select(
      "id,public_token,starts_at,ends_at,status,total_price,total_duration_min,notes,clients(name,phone,date_of_birth),staff(id,name,commission_percent,deposit_recipient,deposit_professional_percent),appointment_services(price,services(name,commission_percent,deposit_recipient,deposit_professional_percent))",
    )
    .eq("studio_id", studioId)
    .match(staffId ? { staff_id: staffId } : {})
    .order("starts_at", { ascending: true })
    .limit(1000);
  if (!full.error) return full;

  // Legacy fallback
  return supabase
    .from("appointments")
    .select(
      "id,public_token,starts_at,ends_at,status,total_price,total_duration_min,notes,clients(name,phone,date_of_birth),staff(id,name),appointment_services(price,services(name))",
    )
    .eq("studio_id", studioId)
    .match(staffId ? { staff_id: staffId } : {})
    .order("starts_at", { ascending: true })
    .limit(1000);
}

function computeAppointmentSplit(
  a: Appt,
  studio: (FinancialRuleSource & { deposit_percent: number; payment_policy: string }) | null,
  paidAmount: number,
) {
  const revenue = computeAttendanceRevenue(Number(a.total_price), paidAmount, a.status);
  const lines = a.appointment_services?.length
    ? a.appointment_services
    : [{ price: Number(a.total_price), services: null }];
  return lines.reduce(
    (acc, line) => {
      const rule = line.services ?? a.staff ?? studio;
      const studioPercent =
        rule?.commission_percent ?? a.staff?.commission_percent ?? studio?.commission_percent ?? 0;
      const linePaid =
        Number(a.total_price) > 0 ? (paidAmount * Number(line.price)) / Number(a.total_price) : 0;
      const lineTotal = Number(line.price);
      const lineConfirmed =
        Number(a.total_price) > 0
          ? (revenue.confirmed * lineTotal) / Number(a.total_price)
          : lineTotal;
      const linePredicted =
        Number(a.total_price) > 0 ? (revenue.predicted * lineTotal) / Number(a.total_price) : 0;
      const finalSplit = computeFinancialSplit(lineTotal, studioPercent, {
        depositPercent: studio?.deposit_percent ?? 0,
        requiresDeposit: false,
        receivedAmount: linePaid,
      });
      const signalSplit = computeFinancialSplit(linePaid, studioPercent, {
        depositPercent: studio?.deposit_percent ?? 0,
        requiresDeposit: false,
        receivedAmount: linePaid,
      });
      return {
        total: acc.total + lineTotal,
        serviceTotal: acc.serviceTotal + lineTotal,
        confirmed: acc.confirmed + lineConfirmed,
        predicted: acc.predicted + linePredicted,
        deposit: acc.deposit + signalSplit.deposit,
        remaining: acc.remaining + linePredicted,
        commissionBase: acc.commissionBase + finalSplit.commissionBase,
        commission: acc.commission + finalSplit.commission,
        professional: acc.professional + finalSplit.professional,
        studio: acc.studio + finalSplit.studio,
        signalProfessional: acc.signalProfessional + signalSplit.professional,
        signalStudio: acc.signalStudio + signalSplit.studio,
        received: acc.received + Math.min(lineTotal, Math.max(0, linePaid)),
        pending: acc.pending + linePredicted,
        commissionPercent: studioPercent,
        depositProfessionalPercent: 0,
      };
    },
    {
      total: 0,
      serviceTotal: 0,
      confirmed: 0,
      predicted: 0,
      deposit: 0,
      remaining: 0,
      commissionBase: 0,
      commission: 0,
      professional: 0,
      studio: 0,
      signalProfessional: 0,
      signalStudio: 0,
      received: 0,
      pending: 0,
      commissionPercent: 0,
      depositProfessionalPercent: 0,
    },
  );
}

function formatPaymentState(a: Appt, paid: number) {
  if (paid > 0) {
    if (a.status === "completed") return "Pago + atendido";
    if (a.status === "no_show") return "Pago (mantido)";
    return "Pago";
  }
  if (a.status === "cancelled" || a.status === "no_show") return "Sem pagamento";
  return "No estudio";
}

function studioPaymentErrorMessage(message: string) {
  if (message.includes("cash_register_not_open"))
    return "Abra o caixa antes de receber este pagamento.";
  if (message.includes("appointment_payment_already_confirmed"))
    return "Este pagamento já foi confirmado.";
  if (message.includes("appointment_already_paid_online"))
    return "Este agendamento já tem pagamento online confirmado.";
  if (message.includes("appointment_cancelled")) return "Esta marcação está cancelada.";
  if (message.includes("appointment_no_show")) return "Esta marcação foi registada como falta.";
  if (message.includes("invalid_payment_method")) return "Escolha uma forma de pagamento válida.";
  if (message.includes("invalid_amount")) return "O valor deste agendamento não é válido.";
  if (message.includes("not_authorized")) return "Sem permissão para confirmar este pagamento.";
  return message || "Não foi possível confirmar o pagamento.";
}

function inPersonMbWayErrorMessage(message: string) {
  if (message.includes("in_person_mb_way_disabled"))
    return "MB WAY automatico ainda nao esta ativo.";
  if (message.includes("mb_way_phone_invalid"))
    return "Indique um telemovel portugues valido para MB WAY.";
  if (message.includes("connect_account_not_ready"))
    return "A conta Stripe Connect do estudio ainda nao esta pronta para MB WAY.";
  if (message.includes("appointment_already_paid")) return "Este agendamento ja esta pago.";
  if (message.includes("appointment_not_payable"))
    return "Esta marcacao nao pode receber pagamento.";
  if (message.includes("payment_method")) return "MB WAY nao esta disponivel nesta conta Stripe.";
  return message || "Nao foi possivel enviar a cobranca MB WAY.";
}

function formatMessageState(a: Appt, paid: number, log?: MessageLog) {
  if (paid <= 0 && a.status === "pending_payment")
    return { label: "Aguarda pagamento", tone: "muted" as const };
  if (!a.clients?.phone || !normalizePhoneForDisplay(a.clients.phone))
    return { label: "Telefone invalido", tone: "danger" as const };
  if (!log) return { label: "WhatsApp pendente", tone: "muted" as const };
  if (log.status === "sent") return { label: "Mensagem entregue", tone: "success" as const };
  if (log.status === "pending") return { label: "A confirmar entrega", tone: "muted" as const };
  if (log.status === "failed" && log.reason?.includes("63015"))
    return { label: "Número não autorizado", tone: "danger" as const };
  if (log.status === "failed") return { label: "Falha no envio", tone: "danger" as const };
  if (log.status === "skipped" && log.reason === "invalid_phone")
    return { label: "Telefone invalido", tone: "danger" as const };
  if (log.status === "skipped" && log.reason === "auto_send_disabled")
    return { label: "Envio desligado", tone: "muted" as const };
  return { label: "Aguarda envio", tone: "muted" as const };
}

function formatWhatsAppFailure(reason?: string | null) {
  const value = String(reason || "");
  if (value.includes("auto_send_disabled")) return "O envio automático de WhatsApp está desligado.";
  if (value.includes("invalid_phone")) return "O número de WhatsApp da cliente é inválido.";
  if (value.includes("channel_unavailable") || value.includes("channel_mismatch")) {
    return "A operadora não reconheceu este contacto como disponível no WhatsApp.";
  }
  if (value.includes("button_parameter_unresolved") || value.includes("template")) {
    return "O template de WhatsApp está inválido ou incompleto.";
  }
  if (value.includes("awaiting_delivery")) return "A operadora ainda não confirmou a entrega.";
  return "A mensagem não foi entregue pelo WhatsApp. Tente novamente.";
}

function normalizePhoneForDisplay(v: string) {
  return v.replace(/\D/g, "").length >= 9;
}
