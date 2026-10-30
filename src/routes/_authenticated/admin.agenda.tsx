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
  AlertTriangle,
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Euro,
  Eye,
  Filter,
  Loader2,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Search,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  Undo2,
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
import { useAgendaView } from "@/hooks/use-agenda-view";
import { useAgendaColor } from "@/hooks/use-agenda-color";
import { useModalScrollLock } from "@/lib/modal-scroll-lock";
import { sortAppointmentsChronologically as sortAppointmentsChronologicallyShared } from "@/lib/appointment-ordering";
import { getPublicReservationCode } from "@/lib/reservation-code";
import { normalizeAppointmentStart } from "@/lib/appointment-datetime";
import {
  cancelStudioAppointment,
  createStudioManualFit,
  moveStudioAppointment,
  previewStudioScheduleChange,
  resolveStudioLocalDateTime,
  swapStudioAppointments,
  type StudioSchedulePreview,
} from "@/lib/studio-appointment.functions";
import {
  allocateAuthoritativeLineTotals,
  computeAttendanceRevenue,
  computeFinancialSplit,
  formatAppointmentStatus,
  formatEUR,
  isFinanciallyRelevantAppointment,
  type FinancialRuleSource,
} from "@/lib/utils";
import {
  sendAppointmentConfirmationForAppointment,
  sendManualAppointmentConfirmationForAppointment,
} from "@/lib/whatsapp.functions";
import { dispatchRecentStudioAppointmentPushNotification } from "@/lib/notification-dispatcher.functions";
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
import {
  getProtectedAgendaData,
  getProtectedAgendaCatalog,
  resolveProtectedJointServiceState,
  rescheduleProtectedJointService,
  getProtectedJointPaymentStatus,
  recordProtectedJointPayment,
  resolveProtectedAppointmentAttendance,
  correctProtectedAppointmentAttendance,
  correctProtectedOwnerAppointmentAction,
  correctProtectedOnsitePaymentMethod,
  undoProtectedMistakenOnsiteReceipt,
  updateProtectedResolvedAppointmentNotes,
  updateProtectedResolvedAppointmentFull,
} from "@/lib/agenda-access.functions";
import {
  DEFAULT_ATTENDANCE_GRACE_MINUTES,
  getAppointmentLifecycleStage,
  lifecycleStageLabel,
} from "@/lib/appointment-lifecycle";
import { ProfessionalTimeline } from "@/components/agenda/professional-timeline";
import {
  describeJointColleagues,
  hasJointProfessionals,
  visibleServiceLinesForAgenda,
} from "@/components/agenda/joint-service-presentation";
import type {
  ProfessionalTimelineAppointment,
  ProfessionalTimelinePerson,
} from "@/components/agenda/professional-timeline-utils";
import { getVisualOperatingHours } from "@/components/agenda/professional-timeline-utils";
import {
  buildAppointmentPaymentFacts,
  computeAppointmentLedger,
  computeAppointmentFinancialSplit,
  toCents,
  type AppointmentPaymentFacts,
  type RefundRow,
} from "@/lib/financial-ledger";
import {
  TimelineAppointmentDrawer,
  type TimelineDrawerAction,
  type DrawerPaymentMethod,
} from "@/components/agenda/timeline-appointment-drawer";
import {
  AttendancePendingSheet,
  type AttendancePendingSheetItem,
} from "@/components/agenda/attendance-pending-sheet";
import {
  attendancePendingSummaryLabel,
  buildAttendanceReviewState,
  isAttendanceClosingReview,
} from "@/lib/attendance-confirmation-ui";
import { formatStudioDate, formatStudioTime, getStudioDateKey } from "@/lib/studio-time";
import {
  buildAgendaModalPaymentPresentation,
  confirmedStripePaymentRows,
  buildAgendaPaymentPresentation,
  canResolvePaidAppointmentAttendance,
  type AgendaPaymentPresentation,
} from "@/lib/agenda-payment-presentation";
import { resolveScopedNotificationEntity } from "@/lib/notification-deep-link";
import {
  buildManualServiceSegments,
  filterAndSortManualAppointmentServices,
  isManualAppointmentServiceAllowed,
  manualAppointmentStaffForService,
  tenantScopedStaffServiceLinks,
  type ManualAppointmentStaffServiceLink,
  type ManualServiceAssignment,
} from "@/lib/manual-appointment-selection";

type AgendaRouteSearch = {
  appointment?: string;
  studio?: string;
  pendencias?: "1";
};

export const Route = createFileRoute("/_authenticated/admin/agenda")({
  validateSearch: (search: Record<string, unknown>): AgendaRouteSearch => ({
    appointment: validSearchUuid(search.appointment),
    studio: validSearchUuid(search.studio),
    pendencias: search.pendencias === "1" || search.pendencias === 1 ? "1" : undefined,
  }),
  component: AgendaPage,
});

// ─── Types ───────────────────────────────────────────────────────────────────

type Appt = {
  id: string;
  public_token?: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  attendance_resolved_at?: string | null;
  total_price: number;
  studio_commission_percent_snapshot?: number | null;
  total_duration_min?: number | null;
  notes: string | null;
  is_manual_fit?: boolean;
  duration_overridden?: boolean;
  clients: {
    id: string;
    name: string;
    phone: string;
    avatar_url?: string | null;
    date_of_birth?: string | null;
  } | null;
  staff: ({ id: string; name: string } & FinancialRuleSource) | null;
  appointment_services?: {
    id?: string;
    price: number;
    duration_min?: number | null;
    position?: number | null;
    starts_at?: string | null;
    ends_at?: string | null;
    service_state?: "confirmed" | "completed" | "cancelled" | "no_show" | null;
    potential_refund_cents?: number | null;
    staff?: { id: string; name: string } | null;
    studio_commission_percent_snapshot?: number | null;
    services: ({ id?: string; name: string } & FinancialRuleSource) | null;
  }[];
};

type PaidRow = {
  id?: string | null;
  appointment_id: string | null;
  amount_cents: number;
  status: string;
  method?: string | null;
  stripe_payment_intent_id?: string | null;
  dispute_status?: string | null;
  disputed_amount_cents?: number | null;
};
type CashPaymentRow = {
  id?: string | null;
  appointment_id: string | null;
  amount: number;
  movement_type: string;
  payment_method?: string | null;
  responsible_name?: string | null;
  source_key?: string | null;
};
type MessageLog = {
  appointment_id: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  reason: string | null;
  created_at: string;
};
type ScheduleEventRow = {
  appointment_id: string;
  related_appointment_id: string | null;
  operation: "move" | "swap" | "duration" | "manual_fit";
  overlap_confirmed: boolean;
  previous_state: Record<string, unknown> | null;
  next_state: Record<string, unknown> | null;
  created_at: string;
};

type AgendaFilters = {
  dateMode: "all" | "today" | "upcoming" | "specific";
  date: string;
  staffId: string;
  service: string;
  status: string;
  client: string;
  clientId: string;
  payment: "all" | "online" | "studio" | "pending";
  confirmation: "all" | "confirmed" | "unconfirmed";
  attendance: "all" | "attended" | "missed";
};

type StudioService = { id: string; name: string; price: number; duration_min: number; commission_percent?: number | null };
type StudioStaff = { id: string; name: string; photo_url?: string | null; is_active?: boolean; commission_percent?: number | null };
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
type StudioPaymentMethod = "cash" | "card" | "mb_way" | "bank_transfer" | "other";

const EMPTY_FILTERS: AgendaFilters = {
  dateMode: "all",
  date: "",
  staffId: "all",
  service: "all",
  status: "all",
  client: "",
  clientId: "",
  payment: "all",
  confirmation: "all",
  attendance: "all",
};

// ─── Page ────────────────────────────────────────────────────────────────────

function AgendaPage() {
  const notificationTarget = Route.useSearch();
  const { studio } = useCurrentStudio();
  const { view: agendaView } = useAgendaView(studio?.id);
  const { color: agendaColor } = useAgendaColor(studio?.id);
  const resendWhatsApp = useServerFn(sendAppointmentConfirmationForAppointment);
  const loadProtectedAgenda = useServerFn(getProtectedAgendaData);
  const resolveAttendance = useServerFn(resolveProtectedAppointmentAttendance);
  const correctAttendance = useServerFn(correctProtectedAppointmentAttendance);
  const correctOwnerAction = useServerFn(correctProtectedOwnerAppointmentAction);
  const correctOnsiteMethod = useServerFn(correctProtectedOnsitePaymentMethod);
  const undoOnsiteReceipt = useServerFn(undoProtectedMistakenOnsiteReceipt);
  const getMbWaySettings = useServerFn(getInPersonMbWaySettings);
  const createMbWayCharge = useServerFn(createInPersonMbWayPayment);
  const getJointPaymentStatus = useServerFn(getProtectedJointPaymentStatus);
  const recordJointPayment = useServerFn(recordProtectedJointPayment);

  const [appts, setAppts] = useState<Appt[]>([]);
  const [paidRows, setPaidRows] = useState<PaidRow[]>([]);
  const [cashPaymentRows, setCashPaymentRows] = useState<CashPaymentRow[]>([]);
  const [refundRows, setRefundRows] = useState<RefundRow[]>([]);
  const [messageLogs, setMessageLogs] = useState<MessageLog[]>([]);
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [scheduleEvents, setScheduleEvents] = useState<ScheduleEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [groupCollapseOverrides, setGroupCollapseOverrides] = useState<Map<string, boolean>>(
    new Map(),
  );
  const [savingPresenceId, setSavingPresenceId] = useState<string | null>(null);
  const [presenceCorrectionAppt, setPresenceCorrectionAppt] = useState<Appt | null>(null);
  const [paymentMethodCorrectionAppt, setPaymentMethodCorrectionAppt] = useState<Appt | null>(null);
  const [correctingPaymentMethod, setCorrectingPaymentMethod] = useState(false);
  const [attendancePanelOpen, setAttendancePanelOpen] = useState(false);
  const [attendancePanelFocusId, setAttendancePanelFocusId] = useState<string | null>(null);
  const [attendanceGraceMinutes, setAttendanceGraceMinutes] = useState(
    DEFAULT_ATTENDANCE_GRACE_MINUTES,
  );
  const [resendingMessageId, setResendingMessageId] = useState<string | null>(null);
  const [receivingPaymentId, setReceivingPaymentId] = useState<string | null>(null);
  const [paymentDialogAppt, setPaymentDialogAppt] = useState<Appt | null>(null);
  const [jointPaymentContext, setJointPaymentContext] = useState<{
    serviceLineId: string | null;
    amountCents: number;
    requestKey: string;
    label: string;
  } | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [filters, setFilters] = useState<AgendaFilters>(EMPTY_FILTERS);
  const [mobileDraftFilters, setMobileDraftFilters] = useState<AgendaFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [agendaToolsOpen, setAgendaToolsOpen] = useState(false);
  const [agendaFullscreen, setAgendaFullscreen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [showDepositSplit, setShowDepositSplit] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [agendaScope, setAgendaScope] = useState<"mine" | "team">("team");
  const [newApptOpen, setNewApptOpen] = useState(false);
  const [newApptDefaults, setNewApptDefaults] = useState<{
    staffId?: string;
    date?: string;
    time?: string;
    mode?: "standard" | "fit";
  } | null>(null);
  const [blockTimeDefaults, setBlockTimeDefaults] = useState<{
    staffId: string;
    date: string;
    time: string;
  } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editApptId, setEditApptId] = useState<string | null>(null);
  const [dropEditDraft, setDropEditDraft] = useState<{ date: string; time: string; staffId: string; lineId: string } | null>(null);
  const [rescheduleApptId, setRescheduleApptId] = useState<string | null>(null);
  const [rescheduleServiceLineId, setRescheduleServiceLineId] = useState<string | null>(null);
  const [dropRescheduleDraft, setDropRescheduleDraft] = useState<{ time: string; staffId: string; staffName: string } | null>(null);
  const [updatingServiceLineId, setUpdatingServiceLineId] = useState<string | null>(null);
  const [swapApptId, setSwapApptId] = useState<string | null>(null);
  const [durationApptId, setDurationApptId] = useState<string | null>(null);
  const [enableInPersonMbWay, setEnableInPersonMbWay] = useState(false);
  const [agendaNow, setAgendaNow] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => startOfLocalDay(new Date()));
  const [timelineFocusRequest, setTimelineFocusRequest] = useState(0);
  const [timelineDetailId, setTimelineDetailId] = useState<string | null>(null);
  const resolveJointServiceState = useServerFn(resolveProtectedJointServiceState);
  const previewDropSchedule = useServerFn(previewStudioScheduleChange);
  const resolveDropDateTime = useServerFn(resolveStudioLocalDateTime);
  const loadDropCatalog = useServerFn(getProtectedAgendaCatalog);
  const moveDroppedAppointment = useServerFn(moveStudioAppointment);
  const [agendaStaff, setAgendaStaff] = useState<StudioStaff[]>([]);
  const [staffAvailability, setStaffAvailability] = useState<StaffAvailabilityRow[]>([]);
  const [staffTimeOff, setStaffTimeOff] = useState<StaffTimeOffRow[]>([]);
  const selectedDayButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDateScrollerRef = useRef<HTMLDivElement>(null);
  const [mobileDateAnchor, setMobileDateAnchor] = useState(() => selectedDate);
  const prependScrollWidthRef = useRef<number | null>(null);
  const dateRangeLoadingRef = useRef(false);
  const agendaLoadSequenceRef = useRef(0);
  const selectedDateScrollPendingRef = useRef(true);
  const followsTodayRef = useRef(true);
  const lastObservedLocalDayRef = useRef(selectedDate);
  const agendaWasHiddenRef = useRef(false);
  const handledNotificationTargetRef = useRef<string | null>(null);
  const [mobileDateRange, setMobileDateRange] = useState({ start: -21, end: 21 });
  const mobileCalendarMonth = selectedDate;
  const mobileAgendaDays = useMemo(
    () => getMobileAgendaDays(mobileDateAnchor, mobileDateRange.start, mobileDateRange.end),
    [mobileDateAnchor, mobileDateRange.end, mobileDateRange.start],
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
    if (!agendaFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAgendaFullscreen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onEscape);
    };
  }, [agendaFullscreen]);
  useEffect(() => {
    const timer = window.setInterval(() => setAgendaNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const currentLocalDay = startOfLocalDay(agendaNow);
    if (isSameLocalDay(lastObservedLocalDayRef.current, currentLocalDay)) return;
    lastObservedLocalDayRef.current = currentLocalDay;
    if (followsTodayRef.current) resetAgendaToToday(currentLocalDay);
  }, [agendaNow]);
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        agendaWasHiddenRef.current = true;
        return;
      }
      if (!agendaWasHiddenRef.current) return;
      agendaWasHiddenRef.current = false;
      const now = new Date();
      setAgendaNow(now);
      if (followsTodayRef.current) resetAgendaToToday(now, false);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);
  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const scrollY = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
    };
  }, [mobileFiltersOpen]);

  useEffect(() => {
    const selectedOffset = differenceInLocalCalendarDays(selectedDate, mobileDateAnchor);
    setMobileDateRange((current) => {
      if (selectedOffset >= current.start && selectedOffset <= current.end) return current;
      return {
        start: Math.min(current.start, selectedOffset - 14),
        end: Math.max(current.end, selectedOffset + 14),
      };
    });
  }, [mobileDateAnchor, selectedDate]);

  useLayoutEffect(() => {
    const scroller = mobileDateScrollerRef.current;
    const previousWidth = prependScrollWidthRef.current;
    if (scroller && previousWidth !== null) {
      scroller.scrollLeft += scroller.scrollWidth - previousWidth;
    }
    prependScrollWidthRef.current = null;
    dateRangeLoadingRef.current = false;
    const selectedButton = selectedDayButtonRef.current;
    if (scroller && selectedDateScrollPendingRef.current && selectedButton) {
      // Center before paint so an older month never flashes during Agenda startup.
      scroller.scrollLeft = Math.max(
        0,
        selectedButton.offsetLeft - (scroller.clientWidth - selectedButton.offsetWidth) / 2,
      );
      selectedDateScrollPendingRef.current = false;
    }
  }, [mobileDateAnchor, mobileDateRange.end, mobileDateRange.start, selectedDate]);

  useEffect(() => {
    if (!studio) return;
    loadData();
  }, [studio]);

  useEffect(() => {
    if (loading || !studio?.id || !notificationTarget.appointment || !notificationTarget.studio) {
      return;
    }
    const targetKey = `${notificationTarget.studio}:${notificationTarget.appointment}`;
    if (handledNotificationTargetRef.current === targetKey) return;
    handledNotificationTargetRef.current = targetKey;

    const appointmentId = resolveScopedNotificationEntity({
      entityId: notificationTarget.appointment,
      targetStudioId: notificationTarget.studio,
      currentStudioId: studio.id,
      availableEntityIds: appts.map((appointment) => appointment.id),
    });
    if (!appointmentId) return;

    const appointment = appts.find((item) => item.id === appointmentId);
    if (!appointment || !canViewSensitiveAppointment(appointment, studio)) return;
    const appointmentDate = dateFromInputValue(
      getStudioDateKey(appointment.starts_at, studio.timezone),
    );
    selectedDateScrollPendingRef.current = true;
    followsTodayRef.current = isSameLocalDay(appointmentDate, new Date());
    setMobileDateAnchor(appointmentDate);
    setSelectedDate(appointmentDate);
    setTimelineFocusRequest((current) => current + 1);
    setTimelineDetailId(appointmentId);
  }, [appts, loading, notificationTarget.appointment, notificationTarget.studio, studio]);

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

  async function loadData(options?: { silent?: boolean }) {
    if (!studio) return;
    const sequence = ++agendaLoadSequenceRef.current;
    if (!options?.silent) setLoading(true);
    try {
      const payload = await loadProtectedAgenda({ data: { studioId: studio.id } });
      if (sequence !== agendaLoadSequenceRef.current) return;
      setAppts(sortAppointmentsChronologically((payload.appointments ?? []) as unknown as Appt[]));
      setAgendaStaff((payload.staff ?? []) as StudioStaff[]);
      setStaffAvailability((payload.availability ?? []) as StaffAvailabilityRow[]);
      setAttendanceGraceMinutes(
        Number(payload.lifecycleSettings?.graceMinutes ?? DEFAULT_ATTENDANCE_GRACE_MINUTES),
      );
      setPaidRows((payload.payments ?? []) as PaidRow[]);
      setCashPaymentRows((payload.cashPayments ?? []) as CashPaymentRow[]);
      setRefundRows((payload.refunds ?? []) as RefundRow[]);
      setMessageLogs((payload.messageLogs ?? []) as MessageLog[]);
      setWhatsappAvailable(Boolean(payload.communicationSettings?.whatsappAvailable));
      setScheduleEvents((payload.scheduleEvents ?? []) as ScheduleEventRow[]);
    } catch (error) {
      console.error("[agenda] protected load failed", error);
      if (sequence === agendaLoadSequenceRef.current && !options?.silent) toast.error("Não foi possível carregar a agenda.");
    } finally {
      if (sequence === agendaLoadSequenceRef.current) setLoading(false);
    }
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

  useEffect(() => {
    if (studio?.role !== "staff") return;

    // RLS intentionally hides colleagues' raw appointment rows from Realtime.
    // Refresh the studio-scoped agenda so colleagues' appointments remain current.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadData({ silent: true });
    }, 30_000);
    return () => window.clearInterval(timer);
    // loadData intentionally reads the latest studio state from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio?.id, studio?.role]);

  // Derived maps
  const confirmedPaidRows = confirmedStripePaymentRows(paidRows);
  const paymentFacts = buildAppointmentPaymentFacts(confirmedPaidRows, cashPaymentRows, refundRows);
  const paidByAppointment = new Map<string, number>();
  for (const [appointmentId, facts] of paymentFacts) {
    paidByAppointment.set(appointmentId, facts.receivedCents / 100);
  }
  const pendingOnlinePaymentByAppointment = new Set(
    paidRows
      .filter((row) => row.appointment_id && ["requires_action", "processing"].includes(row.status))
      .map((row) => row.appointment_id as string),
  );
  const latestMessageByAppointment = new Map<string, MessageLog>();
  for (const log of messageLogs) {
    if (!log.appointment_id || latestMessageByAppointment.has(log.appointment_id)) continue;
    latestMessageByAppointment.set(log.appointment_id, log);
  }

  // Filtering
  const isProfessionalPanel = studio?.role === "staff";
  const canStaffViewTeamAgenda = isProfessionalPanel;
  const canStaffViewBasicDetails = true;
  const filterOptions = buildFilterOptions(appts.filter((a) => a.status !== "cancelled"));
  const activeFilterCount = countActiveFilters(filters);
  const filteredAppts = sortAppointmentsChronologically(
    appts.filter((a) => {
      if (a.status === "cancelled") return false;
      if (isProfessionalPanel) {
        if (!canStaffViewTeamAgenda || agendaScope === "mine") {
          if (!appointmentIncludesStaff(a, studio?.staff_id)) return false;
        }
      }
      if (!appointmentMatchesFilters(a, filters, paymentFacts, studio?.timezone)) return false;
      if (searchQuery.trim()) {
        const q = normalizeFilterText(searchQuery);
        const canSeeSensitive = canViewSensitiveAppointment(a, studio);
        const canSeeBasic = canSeeSensitive || canStaffViewBasicDetails;
        const hay = normalizeFilterText(
          `${canSeeSensitive ? `${a.clients?.name ?? ""} ${a.clients?.phone ?? ""}` : ""} ${canSeeBasic ? appointmentServiceLabel(a) : ""} ${a.staff?.name ?? ""}`,
        );
        if (!hay.includes(q) && !(canSeeSensitive && clientPhoneMatches(a.clients?.phone, searchQuery))) return false;
      }
      return true;
    }),
  );
  const sensitiveFilteredAppts = filteredAppts.filter((a) =>
    canViewSensitiveAppointment(a, studio),
  );
  const showFilterResults = Boolean(searchQuery.trim()) || activeFilterCount > 0;

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
    .filter(
      (appointment) => {
        const selectedDateKey = toDateInputValue(selectedDate);
        const serviceSegments = getAppointmentServiceSegments(appointment);
        return serviceSegments.length > 0
          ? serviceSegments.some(
              (line) => getStudioDateKey(line.starts_at!, studio?.timezone) === selectedDateKey,
            )
          : getStudioDateKey(appointment.starts_at, studio?.timezone) === selectedDateKey;
      },
    )
    .flatMap((appointment) => {
      const canSeeSensitive = canViewSensitiveAppointment(appointment, studio);
      const canSeeBasic = canSeeSensitive || canStaffViewBasicDetails;
      const allServiceSegments = getAppointmentServiceSegments(appointment);
      const jointBooking = hasJointProfessionals(allServiceSegments);
      const base = {
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
        attendancePending:
          canSeeSensitive &&
          getAppointmentLifecycleStage({
            status: appointment.status,
            startsAt: appointment.starts_at,
            now: agendaNow,
            graceMinutes: attendanceGraceMinutes,
          }) === "awaiting_confirmation",
        manualFit: Boolean(appointment.is_manual_fit),
      };
      const selectedDateKey = toDateInputValue(selectedDate);
      const serviceSegments = visibleServiceLinesForAgenda(
        allServiceSegments, selectedDateKey, filters.staffId, studio?.timezone,
      );
      if (serviceSegments.length === 0) return allServiceSegments.length ? [] : [base];
      return serviceSegments.map((line, index) => ({
        ...base,
        id: `${appointment.id}:${line.id ?? index}`,
        sourceId: appointment.id,
        staffId: line.staff?.id ?? base.staffId,
        startsAt: line.starts_at!,
        endsAt: line.ends_at!,
        status: line.service_state ?? base.status,
        serviceName: canSeeBasic ? (line.services?.name ?? "Serviço") : "Ocupado",
        professionalName: line.staff?.name ?? base.professionalName,
        jointBooking,
        relatedServiceSummary: jointBooking && canSeeBasic
          ? describeJointColleagues(allServiceSegments, line, studio?.timezone)
          : undefined,
        valueLabel: canSeeSensitive ? formatEUR(line.price) : undefined,
        durationLabel: formatDurationBetween(
          line.starts_at!,
          line.ends_at!,
          line.duration_min,
        ),
      }));
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
      staffId: period.staff_id,
      startMinutes: timeValueToMinutes(period.start_time),
      endMinutes: timeValueToMinutes(period.end_time),
    }))
    .filter((period) => period.endMinutes > period.startMinutes);
  // Visual shading only. Keep selectedAvailability and all booking checks unchanged.
  const visualOperatingHours = getVisualOperatingHours(
    staffAvailability.filter((period) => visibleProfessionalIds.has(period.staff_id)).map((period) => ({
      staffId: period.staff_id, weekday: period.weekday,
      startMinutes: timeValueToMinutes(period.start_time),
      endMinutes: timeValueToMinutes(period.end_time),
    })),
    selectedDate.getDay(),
  );
  const timelineEntries = [...timelineAppointments, ...timelineBlocks];
  // Availability must still exclude appointments hidden by presentation filters.
  const timelineOccupiedIntervals = appts.flatMap((appointment) => {
    const segments = getAppointmentServiceSegments(appointment);
    return segments.length > 0 ? segments.map((line) => ({
      staffId: line.staff?.id ?? appointment.staff?.id ?? "unassigned",
      startsAt: line.starts_at!, endsAt: line.ends_at!, status: appointment.status,
    })) : [{staffId: appointment.staff?.id ?? "unassigned", startsAt: appointment.starts_at,
      endsAt: appointment.ends_at, status: appointment.status}];
  });
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
      navigateToAgendaDate(dateFromInputValue(value), false);
    }
    if (key === "dateMode" && (value === "today" || value === "upcoming")) {
      navigateToAgendaDate(new Date(), false);
    }
  }
  function resetFilters() {
    setFilters(EMPTY_FILTERS);
    setMobileDraftFilters(EMPTY_FILTERS);
    setFiltersOpen(false);
    setMobileFiltersOpen(false);
  }
  function openMobileFilters() {
    setMobileDraftFilters(filters);
    setMobileFiltersOpen(true);
  }
  function applyMobileFilters() {
    setFilters(mobileDraftFilters);
    if (mobileDraftFilters.dateMode === "specific" && mobileDraftFilters.date) {
      navigateToAgendaDate(dateFromInputValue(mobileDraftFilters.date), false);
    } else if (mobileDraftFilters.dateMode === "today" || mobileDraftFilters.dateMode === "upcoming") {
      navigateToAgendaDate(new Date(), false);
    }
    setMobileFiltersOpen(false);
  }
  function navigateToAgendaDate(date: Date, updateFilters = true) {
    selectedDateScrollPendingRef.current = true;
    setTimelineFocusRequest((current) => current + 1);
    const nextDate = startOfLocalDay(date);
    followsTodayRef.current = isSameLocalDay(nextDate, new Date());
    setSelectedDate(nextDate);
    if (updateFilters) {
      setFilters((current) => ({ ...current, dateMode: "all", date: "" }));
    }
  }

  function resetAgendaToToday(now: Date = new Date(), clearDateFilter = true) {
    const today = startOfLocalDay(now);
    followsTodayRef.current = true;
    lastObservedLocalDayRef.current = today;
    selectedDateScrollPendingRef.current = true;
    setMobileDateAnchor(today);
    setMobileDateRange({ start: -21, end: 21 });
    setTimelineFocusRequest((current) => current + 1);
    setSelectedDate(today);
    if (clearDateFilter) setFilters((current) => ({ ...current, dateMode: "all", date: "" }));
  }

  function extendMobileDateRange(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
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
  async function markPresenceMany(apptsToResolve: Appt[], nextStatus: "completed" | "no_show") {
    if (!studio) return false;
    if (apptsToResolve.length === 0) return false;
    setSavingPresenceId(apptsToResolve.length === 1 ? apptsToResolve[0].id : "bulk");
    try {
      await resolveAttendance({
        data: {
          studioId: studio.id,
          appointmentIds: apptsToResolve.map((appointment) => appointment.id),
          outcome: nextStatus,
        },
      });
    } catch (error) {
      toast.error(attendanceResolutionErrorMessage(error));
      setSavingPresenceId(null);
      return false;
    }
    const resolvedIds = new Set(apptsToResolve.map((appointment) => appointment.id));
    setAppts((c) => c.map((i) => (resolvedIds.has(i.id) ? { ...i, status: nextStatus } : i)));
    await loadData({ silent: true });
    setSavingPresenceId(null);
    const plural = apptsToResolve.length > 1;
    toast.success(
      nextStatus === "completed"
        ? plural
          ? `${apptsToResolve.length} atendimentos confirmados e liquidados.`
          : "Atendimento confirmado e liquidado."
        : plural
          ? `${apptsToResolve.length} faltas registadas sem nova receita.`
          : "Falta registada sem nova receita.",
    );
    return true;
  }

  async function markPresence(appt: Appt, nextStatus: "completed" | "no_show") {
    return markPresenceMany([appt], nextStatus);
  }

  async function correctPresence(nextStatus: "confirmed" | "completed" | "no_show" | "cancelled", reason = "", targetAppt = presenceCorrectionAppt) {
    if (!studio || !targetAppt) return false;
    const appointmentId = targetAppt.id;
    setSavingPresenceId(appointmentId);
    try {
      if (nextStatus === "cancelled" && targetAppt.status === "completed") {
        const cancelled = await cancelAppointment(appointmentId, reason);
        if (!cancelled) return false;
      } else if (nextStatus === "cancelled" || targetAppt.status === "cancelled") {
        await correctOwnerAction({ data: {
          studioId: studio.id, appointmentId, outcome: nextStatus as "confirmed" | "cancelled", reason,
        } });
      } else {
        await correctAttendance({
          data: { studioId: studio.id, appointmentId, outcome: nextStatus },
        });
      }
      setAppts((current) => current.map((item) =>
        item.id === appointmentId ? { ...item, status: nextStatus } : item,
      ));
      setPresenceCorrectionAppt(null);
      await loadData({ silent: true });
      toast.success("Presença corrigida.");
      return true;
    } catch (error) {
      toast.error(attendanceResolutionErrorMessage(error));
      return false;
    } finally {
      setSavingPresenceId(null);
    }
  }

  async function undoMistakenReceipt(reason: string, targetAppt: Appt): Promise<boolean> {
    if (!studio) return false;
    const appointmentId = targetAppt.id;
    setSavingPresenceId(appointmentId);
    try {
      await undoOnsiteReceipt({ data: { studioId: studio.id, appointmentId, reason } });
      setAppts((current) => current.map((item) => item.id === appointmentId ? { ...item, status: "confirmed" } : item));
      await loadData({ silent: true });
      setPresenceCorrectionAppt(null);
      toast.success("Marcação reaberta. O recebimento incorreto foi anulado e ficou no histórico.");
      return true;
    } catch (error) {
      toast.error(undoReceiptErrorMessage(error));
      return false;
    } finally {
      setSavingPresenceId(null);
    }
  }

  async function correctPaymentMethod(movementId: string, method: StudioPaymentMethod, targetAppt: Appt): Promise<boolean> {
    if (!studio) return false;
    setCorrectingPaymentMethod(true);
    try {
      await correctOnsiteMethod({ data: {
        studioId: studio.id, appointmentId: targetAppt.id,
        movementId, method,
      } });
      setPaymentMethodCorrectionAppt(null);
      await loadData({ silent: true });
      toast.success("Método de recebimento corrigido. A cobrança original foi mantida.");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível corrigir o método.");
      return false;
    } finally {
      setCorrectingPaymentMethod(false);
    }
  }

  async function openJointPayment(appt: Appt, serviceLineId: string | null, label: string): Promise<{ amount: number; label: string } | null> {
    if (!studio) return null;
    try {
      const status = await getJointPaymentStatus({
        data: { studioId: studio.id, appointmentId: appt.id },
      });
      if (status.pending_mbway) {
        toast.error("Existe uma cobrança MB WAY pendente para esta reserva.");
        return null;
      }
      const amountCents = serviceLineId
        ? Number(status.services.find((line) => line.service_line_id === serviceLineId)?.due_cents ?? 0)
        : Number(status.total_due_cents ?? 0);
      if (amountCents <= 0) {
        toast.info("Este serviço já está pago ou não tem saldo a receber.");
        return null;
      }
      setJointPaymentContext({ serviceLineId, amountCents, requestKey: crypto.randomUUID(), label });
      return { amount: amountCents / 100, label };
    } catch (error) {
      toast.error(studioPaymentErrorMessage(error instanceof Error ? error.message : String(error)));
      return null;
    }
  }

  async function confirmStudioPayment(
    appt: Appt,
    paymentMethod: StudioPaymentMethod,
    options?: { phone?: string; mbWayAction?: "charge" | "received" },
  ): Promise<boolean> {
    if (!studio) return false;
    if (jointPaymentContext) {
      setReceivingPaymentId(appt.id);
      try {
        if (paymentMethod === "mb_way" && enableInPersonMbWay && options?.mbWayAction !== "received") {
          await createMbWayCharge({ data: {
            appointmentId: appt.id,
            phone: options?.phone || appt.clients?.phone || "",
            serviceLineId: jointPaymentContext.serviceLineId,
            requestKey: jointPaymentContext.requestKey,
            expectedCents: jointPaymentContext.amountCents,
          } });
          toast.success("Cobrança MB WAY enviada. A confirmação será feita pela Stripe.");
        } else {
          await recordJointPayment({ data: {
            studioId: studio.id,
            appointmentId: appt.id,
            serviceLineId: jointPaymentContext.serviceLineId,
            method: paymentMethod,
            requestKey: jointPaymentContext.requestKey,
            expectedCents: jointPaymentContext.amountCents,
          } });
          toast.success("Pagamento registrado para os serviços selecionados.");
        }
        setPaymentDialogAppt(null);
        setJointPaymentContext(null);
        await loadData({ silent: true });
        return true;
      } catch (error) {
        toast.error(studioPaymentErrorMessage(error instanceof Error ? error.message : String(error)));
        return false;
      } finally {
        setReceivingPaymentId(null);
      }
    }
    setReceivingPaymentId(appt.id);
    if (paymentMethod === "mb_way" && enableInPersonMbWay && options?.mbWayAction !== "received") {
      try {
        await createMbWayCharge({
          data: { appointmentId: appt.id, phone: options?.phone || appt.clients?.phone || "" },
        });
        setPaymentDialogAppt(null);
        await loadData({ silent: true });
        toast.success(
          "Cobrança MB WAY enviada. O pagamento será confirmado automaticamente pela Stripe.",
        );
        return true;
      } catch (error) {
        toast.error(
          inPersonMbWayErrorMessage(error instanceof Error ? error.message : String(error)),
        );
        return false;
      } finally {
        setReceivingPaymentId(null);
      }
    }
    const { error } = await (supabase as any).rpc("confirm_studio_appointment_payment", {
      p_appointment_id: appt.id,
      p_payment_method: paymentMethod,
    });
    setReceivingPaymentId(null);
    if (error) {
      toast.error(studioPaymentErrorMessage(error.message));
      return false;
    }
    setPaymentDialogAppt(null);
    setAppts((c) => c.map((i) => (i.id === appt.id ? { ...i, status: "completed" } : i)));
    await loadData({ silent: true });
    toast.success("Pagamento confirmado e atendimento finalizado.");
    return true;
  }

  async function cancelAppointment(apptId: string, reason = "") {
    if (!studio) return false;
    const appointment = appts.find((item) => item.id === apptId);
    if (!appointment || appointment.status === "cancelled") return false;
    setCancellingId(apptId);
    let error: unknown = null;
    let cancelledNow: boolean | null = null;
    try {
      if (appointment.status === "completed") {
        const result = await (supabase as any).rpc("cancel_completed_appointment", {
          p_studio_id: studio.id,
          p_appointment_id: apptId,
          p_reason: reason.trim(),
        });
        if (result.error) throw result.error;
        cancelledNow = result.data;
      } else {
        await cancelStudioAppointment({ data: { appointmentId: apptId, studioId: studio.id } });
      }
    } catch (caught) {
      error = caught;
    }
    setCancellingId(null);
    setConfirmCancelId(null);
    if (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar a marcação.");
      return false;
    }
    if (cancelledNow === false) {
      await loadData({ silent: true });
      toast.info("Esta marcação já tinha sido cancelada.");
      return false;
    }
    setAppts((c) => c.map((i) => (i.id === apptId ? { ...i, status: "cancelled" } : i)));
    await loadData({ silent: true });
    toast.success("Marcação cancelada.");
    return true;
  }

  async function updateJointServiceLine(serviceLineId: string, nextState: "completed" | "cancelled" | "no_show") {
    if (!studio || updatingServiceLineId) return false;
    setUpdatingServiceLineId(serviceLineId);
    try {
      await resolveJointServiceState({
        data: { studioId: studio.id, serviceLineId, nextState },
      });
      await loadData({ silent: true });
      toast.success(nextState === "cancelled"
        ? "Serviço cancelado. O eventual reembolso depende da decisão da proprietária."
        : nextState === "no_show" ? "Falta registada para o serviço." : "Serviço concluído.");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o serviço.");
      return false;
    } finally {
      setUpdatingServiceLineId(null);
    }
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

  const editAppt = editApptId ? (appts.find((a) => a.id === editApptId) ?? null) : null;
  const rescheduleAppt = rescheduleApptId
    ? (appts.find((a) => a.id === rescheduleApptId) ?? null)
    : null;
  const swapAppt = swapApptId ? (appts.find((a) => a.id === swapApptId) ?? null) : null;
  const durationAppt = durationApptId ? (appts.find((a) => a.id === durationApptId) ?? null) : null;
  const pendingAttendanceAppointments = sortAppointmentsChronologically(
    appts.filter(
      (appointment) =>
        canViewSensitiveAppointment(appointment, studio) &&
        getAppointmentLifecycleStage({
          status: appointment.status,
          startsAt: appointment.starts_at,
          now: agendaNow,
          graceMinutes: attendanceGraceMinutes,
        }) === "awaiting_confirmation",
    ),
    "history",
  );
  const attendanceReview = buildAttendanceReviewState(
    pendingAttendanceAppointments,
    attendancePanelFocusId,
  );
  const attendanceSheetItems: AttendancePendingSheetItem[] = attendanceReview.visibleItems.map(
    (appointment) => ({
      id: appointment.id,
      startsAt: appointment.starts_at,
      clientName: appointment.clients?.name ?? "Cliente",
      serviceName: appointmentServiceLabel(appointment),
      professionalName: appointment.staff?.name ?? "Sem profissional",
    }),
  );
  const attendanceClosingReview = isAttendanceClosingReview(
    agendaNow,
    selectedDate,
    selectedAvailability,
  );

  async function prepareDraggedAppointment(entry: ProfessionalTimelineAppointment, staffId: string, minutes: number) {
    if (!studio || (studio.role !== "studio_owner" && studio.role !== "saas_owner")) return;
    const source = appts.find((item) => item.id === (entry.sourceId ?? entry.id));
    if (!source || source.status !== "confirmed") return;
    const serviceLineId = entry.sourceId ? entry.id.slice(entry.sourceId.length + 1) : "";
    const line = source.appointment_services?.find((item) => item.id === serviceLineId)
      ?? (source.appointment_services?.length === 1 ? source.appointment_services[0] : null);
    if (!line?.id || !line.services?.id) {
      toast.error("Use Editar marcação para esta reserva.");
      return;
    }
    const hasServiceStates = source.appointment_services?.some((item) => item.service_state != null);
    if ((source.appointment_services?.length ?? 0) > 1 && !hasServiceStates) {
      toast.info("Esta reserva tem vários serviços. Use Editar marcação para rever a sequência completa.");
      return;
    }
    const currentStaffId = line.staff?.id ?? source.staff?.id;
    if (currentStaffId !== staffId && (paidByAppointment.get(source.id) ?? 0) > 0) {
      toast.error("O profissional não pode mudar após um recebimento. O pagamento e a comissão ficam preservados.");
      return;
    }
    const date = toDateInputValue(selectedDate);
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    try {
      const catalog = await loadDropCatalog({ data: { studioId: studio.id, staffId: null } });
      if (!isManualAppointmentServiceAllowed(catalog.links as ManualAppointmentStaffServiceLink[], staffId, line.services.id)) {
        toast.error("Este profissional não realiza o serviço da marcação.");
        return;
      }
      const { startsAt } = await resolveDropDateTime({ data: { studioId: studio.id, date, time } });
      const durationMin = Math.round((new Date(entry.endsAt).getTime() - new Date(entry.startsAt).getTime()) / 60000);
      const preview = await previewDropSchedule({ data: {
        studioId: studio.id, staffId, startsAt, durationMin, ignoreAppointmentIds: [source.id],
      } });
      if (preview.hardBlocked || !preview.withinAvailability || preview.hasConflict) {
        toast.error("Horário indisponível, bloqueado ou em conflito. A marcação mantém a posição original.");
        return;
      }
      if (!hasServiceStates && source.appointment_services?.length === 1 &&
        currentStaffId === staffId && (paidByAppointment.get(source.id) ?? 0) <= 0) {
        const result = await moveDroppedAppointment({ data: {
          studioId: studio.id, appointmentId: source.id, startsAt, durationMin,
          confirmOverlap: false, expectedConflictIds: [], operation: "move",
        } });
        if (result.changed) {
          setAppts((current) => current.map((item) => item.id !== source.id ? item : {
            ...item, starts_at: result.startsAt, ends_at: result.endsAt,
            appointment_services: item.appointment_services?.map((service) => service.id !== line.id ? service :
              { ...service, starts_at: result.startsAt, ends_at: result.endsAt }),
          }));
          void loadData({ silent: true });
          toast.success("Marcação reagendada.");
        }
        return;
      }
      if (hasServiceStates) {
        setDropRescheduleDraft({ time, staffId,
          staffName: (catalog.staff as StudioStaff[]).find((person) => person.id === staffId)?.name ?? "Profissional" });
        setRescheduleServiceLineId(line.id);
        setRescheduleApptId(source.id);
      } else {
        setDropEditDraft({ date, time, staffId, lineId: line.id });
        setEditApptId(source.id);
      }
    } catch (error) {
      toast.error(scheduleChangeMessage(error));
    }
  }

  return (
    <div
      className={`agenda-timeline-page -mx-3 flex w-[calc(100%+1.5rem)] max-w-none flex-col gap-0 pb-0 sm:-mx-4 sm:w-[calc(100%+2rem)] md:mx-auto md:w-full md:gap-1 md:pb-3 ${agendaFullscreen ? "fixed inset-0 z-[80] !m-0 !h-[100dvh] !w-screen overflow-y-auto bg-background md:!max-w-none" : "md:max-w-[1320px]"}`}
      onClick={() => {
        if (menuOpenId) closeMenu();
      }}
    >
      <header className="hidden items-center justify-between gap-2 px-2 md:flex">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black tracking-[-0.035em]">Agenda</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setAgendaFullscreen((value) => !value)}
            aria-label={agendaFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            className="inline-flex h-8 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold hover:bg-muted">
            {agendaFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            {agendaFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          </button>
          <button
            type="button"
            onClick={() => setAgendaToolsOpen((value) => !value)}
            className={`inline-flex h-8 items-center justify-center gap-2 rounded-xl border px-3 text-xs font-black shadow-sm transition hover:bg-muted ${agendaToolsOpen || activeFilterCount > 0 ? "border-foreground bg-foreground text-background" : "border-border bg-card"}`}
            aria-label="Pesquisa e filtros"
          >
            <Filter className="size-4" />
            <span className="hidden md:inline">Filtros</span>
          </button>
        </div>
      </header>

      {pendingAttendanceAppointments.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setAttendancePanelFocusId(null);
            setAttendancePanelOpen(true);
          }}
          className="mx-2 flex min-h-10 items-center gap-2 rounded-xl border border-amber-300/55 bg-amber-50/65 px-3 py-2 text-left text-amber-950 shadow-sm transition hover:bg-amber-100/70 dark:border-amber-700/35 dark:bg-amber-500/10 dark:text-amber-100 dark:hover:bg-amber-500/15 md:mx-0 md:min-h-11 md:px-3.5"
          aria-label="Atendimentos aguardando confirmação"
          data-testid="attendance-pending-summary"
        >
          <Clock className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-xs font-black md:text-sm">
            {attendanceClosingReview ? "Fechar o dia · " : ""}
            {attendancePendingSummaryLabel(pendingAttendanceAppointments.length)}
          </span>
          <ChevronRight className="size-4 shrink-0 opacity-60" />
        </button>
      )}

      <nav
        className="agenda-date-navigation agenda-touch-surface relative z-30 select-none border-y border-border/70 bg-card/95 py-1 backdrop-blur-xl touch-pan-x md:static md:rounded-2xl md:border md:px-1 md:py-0 md:shadow-sm"
        aria-label="Navegação semanal"
        data-testid="agenda-date-navigation"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="flex h-7 items-center justify-between px-3 md:hidden">
          <p className="whitespace-nowrap text-[10px] font-black capitalize tracking-[0.04em] text-muted-foreground">
            {mobileCalendarMonth.toLocaleDateString("pt-PT", { month: "long", year: "numeric" })}
          </p>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setAgendaFullscreen((value) => !value)}
              aria-label={agendaFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              className="agenda-compact-control grid size-7 min-h-0 place-items-center rounded-lg border border-border bg-background/70">
              {agendaFullscreen ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
            </button>
            <button
              type="button"
              onClick={() => resetAgendaToToday()}
              className="agenda-compact-control h-7 min-h-0 rounded-lg border border-border bg-background/70 px-2 text-[9px] font-black"
            >
              Hoje
            </button>
            <button
              type="button"
                onClick={openMobileFilters}
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
              onClick={openMobileFilters}
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

      {showFilterResults && !loading && (
        <section className="mx-3 rounded-2xl border border-border bg-card p-3 shadow-sm md:mx-0" aria-label="Resultados dos filtros da agenda" data-testid="agenda-filter-results">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">
            {filteredAppts.length} {filteredAppts.length === 1 ? "marcação encontrada" : "marcações encontradas"}
          </p>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {filteredAppts.map((appointment) => {
              const canSeeSensitive = canViewSensitiveAppointment(appointment, studio);
              const canSeeBasic = canSeeSensitive || canStaffViewBasicDetails;
              return (
                <button
                  key={appointment.id}
                  type="button"
                  onClick={() => {
                    navigateToAgendaDate(dateFromInputValue(getStudioDateKey(appointment.starts_at, studio?.timezone)), false);
                    if (canSeeSensitive) setTimelineDetailId(appointment.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatStudioDate(appointment.starts_at, studio?.timezone, { day: "2-digit", month: "2-digit", year: "numeric" })} {formatStudioTime(appointment.starts_at, studio?.timezone)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {canSeeSensitive ? (appointment.clients?.name ?? "Sem cliente") : "Horário ocupado"}
                  </span>
                  <span className="hidden max-w-[35%] truncate text-xs text-muted-foreground sm:block">
                    {canSeeBasic ? appointmentServiceLabel(appointment) : "Ocupado"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
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
          unified={agendaView === "unificada"}
          appointmentColor={agendaColor}
          date={selectedDate}
          now={agendaNow}
          timeZone={studio?.timezone ?? "Europe/Lisbon"}
          professionals={timelineProfessionals}
          appointments={timelineEntries}
          occupiedIntervals={[...timelineOccupiedIntervals, ...timelineBlocks]}
          availability={selectedAvailability}
          operatingHours={visualOperatingHours}
          focusRequestKey={timelineFocusRequest}
          onOpenAppointment={(appointment) => {
            if (!appointment.privateDetails) return;
            setTimelineDetailId(appointment.sourceId ?? appointment.id);
          }}
          onOpenBlock={(block) => {
            if (block.sourceId) setSelectedBlockId(block.sourceId);
          }}
          onCreateAtSlot={(staffId, minutes, mode) => {
            setNewApptDefaults({
              staffId: staffId === "unassigned" ? undefined : staffId,
              date: toDateInputValue(selectedDate),
              time: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
              mode,
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
          onDropAppointment={studio?.role === "studio_owner" || studio?.role === "saas_owner"
            ? (appointment, staffId, minutes) => { void prepareDraggedAppointment(appointment, staffId, minutes); }
            : undefined}
        />
      )}

      {timelineDetailAppt &&
        canViewSensitiveAppointment(timelineDetailAppt, studio) &&
        (() => {
          const paid = paidByAppointment.get(timelineDetailAppt.id) ?? 0;
          const split = computeAppointmentSplit(
            timelineDetailAppt,
            studio,
            paymentFacts.get(timelineDetailAppt.id) ?? null,
          );
          const financialSummary = getAppointmentFinancialSummary(
            timelineDetailAppt,
            split,
            paid,
            pendingOnlinePaymentByAppointment.has(timelineDetailAppt.id),
          );
          const modalPayment = buildAgendaModalPaymentPresentation(paid, timelineDetailAppt.total_price);
          const messageState = formatMessageState(
            timelineDetailAppt,
            paid,
            latestMessageByAppointment.get(timelineDetailAppt.id),
          );
          const attendanceConfirmationDue =
            getAppointmentLifecycleStage({
              status: timelineDetailAppt.status,
              startsAt: timelineDetailAppt.starts_at,
              now: agendaNow,
              graceMinutes: attendanceGraceMinutes,
            }) === "awaiting_confirmation";
          const canConfirm =
            attendanceConfirmationDue ||
            canResolvePaidAppointmentAttendance({
              appointmentStatus: timelineDetailAppt.status,
              paidAmount: paid,
            });
          const canResend = Boolean(
            whatsappAvailable &&
              timelineDetailAppt.clients?.phone &&
              normalizePhoneForDisplay(timelineDetailAppt.clients.phone),
          );
          const serviceSegments = getAppointmentServiceSegments(timelineDetailAppt);
          const isMultiProfessional =
            new Set(serviceSegments.map((line) => line.staff?.id).filter(Boolean)).size > 1;
          const hasJointServiceState = serviceSegments.some((line) => line.service_state != null);
          const isJointBooking = isMultiProfessional || hasJointServiceState;
          const jointServicesConfirmed = serviceSegments.length > 0 &&
            serviceSegments.every((line) => line.service_state === "confirmed");
          const jointHasReceivableService = serviceSegments.some((line) =>
            line.service_state === "confirmed" || line.service_state === "completed");
          const owner = Boolean(studio);
          const canCorrectFinancialReceipt = studio?.role === "studio_owner" || studio?.role === "saas_owner";
          const canOperateJointPayments = canCorrectFinancialReceipt;
          const hasManualReceipt = cashPaymentRows.some(
            (row) => row.appointment_id === timelineDetailAppt.id && Number(row.amount) > 0,
          );
          const hasAttendanceReceipt = cashPaymentRows.some(
            (row) => row.appointment_id === timelineDetailAppt.id &&
              Number(row.amount) > 0 && row.source_key?.startsWith("attendance-settlement:"),
          );
          const canCorrectState = ["completed", "no_show", "cancelled"].includes(timelineDetailAppt.status) ||
            (timelineDetailAppt.status === "confirmed" && hasAttendanceReceipt);
          const actions: TimelineDrawerAction[] = [];
          if ((!hasJointServiceState || (owner &&
            ((jointServicesConfirmed && !pendingOnlinePaymentByAppointment.has(timelineDetailAppt.id)) ||
              ["completed", "no_show"].includes(timelineDetailAppt.status)))) &&
            (timelineDetailAppt.status !== "cancelled" || owner)) {
            actions.push({
              id: "edit",
              label: timelineDetailAppt.status === "cancelled" ? "Reabrir e editar" : "Editar reserva",
              icon: timelineDetailAppt.status === "cancelled" ? <Undo2 className="h-4 w-4" /> : <Pencil className="h-4 w-4" />,
              onClick: () => {
                if (timelineDetailAppt.status === "cancelled") {
                  void (async () => {
                    if (!await correctPresence("confirmed", "", timelineDetailAppt)) return;
                    setEditApptId(timelineDetailAppt.id);
                    setTimelineDetailId(null);
                  })();
                  return;
                }
                if (["completed", "no_show"].includes(timelineDetailAppt.status) && !owner) {
                  toast.info("Desfaça o estado atual para editar esta marcação.");
                  return;
                }
                setEditApptId(timelineDetailAppt.id);
                setTimelineDetailId(null);
              },
            });
          }
          if (isJointBooking && timelineDetailAppt.status === "confirmed" &&
            timelineDetailAppt.staff?.id) {
            actions.push({
              id: "fit",
              label: "Encaixar",
              icon: <Sparkles className="h-3.5 w-3.5" />,
              onClick: () => {
                const start = new Date(timelineDetailAppt.starts_at);
                setNewApptDefaults({
                  staffId: timelineDetailAppt.staff?.id,
                  date: getStudioDateKey(start, studio?.timezone),
                  time: formatStudioTime(start, studio?.timezone),
                  mode: "fit",
                });
                setNewApptOpen(true);
                setTimelineDetailId(null);
              },
            });
          }
          if (canResend) {
            actions.push({
              id: "whatsapp",
              label: isPastAppointment(timelineDetailAppt.ends_at)
                ? "Contactar no WhatsApp" : "Reenviar WhatsApp",
              icon: <MessageCircle className="h-3.5 w-3.5" />,
              onClick: () => resendMessage(timelineDetailAppt),
              disabled: resendingMessageId === timelineDetailAppt.id,
            });
          }
          if (!hasJointServiceState && timelineDetailAppt.status !== "cancelled" &&
            (timelineDetailAppt.status !== "completed" || owner)) {
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
              key={timelineDetailAppt.id}
              timeZone={studio?.timezone ?? "Europe/Lisbon"}
              details={{
                clientName: timelineDetailAppt.clients?.name ?? "Sem cliente",
                clientAvatarUrl: timelineDetailAppt.clients?.avatar_url,
                clientPhone: timelineDetailAppt.clients?.phone,
                serviceName: appointmentServiceLabel(timelineDetailAppt),
                professionalName: appointmentProfessionalLabel(timelineDetailAppt),
                jointBooking: isJointBooking,
                serviceLevelActions: hasJointServiceState,
                serviceAssignments: serviceSegments.map((line) => ({
                   serviceId: line.id,
                  serviceName: line.services?.name ?? "Serviço",
                   professionalId: line.staff?.id,
                  professionalName: line.staff?.name ?? "Não definido",
                  startsAt: line.starts_at!,
                  endsAt: line.ends_at!,
                   valueLabel: formatEUR(line.price),
                   statusLabel: formatAppointmentStatus(line.service_state ?? timelineDetailAppt.status),
                   serviceState: line.service_state,
                   potentialRefundLabel: line.potential_refund_cents != null
                     ? formatEUR(line.potential_refund_cents / 100) : null,
                })),
                startsAt: timelineDetailAppt.starts_at,
                endsAt: timelineDetailAppt.ends_at,
                durationLabel: formatDurationBetween(
                  timelineDetailAppt.starts_at,
                  timelineDetailAppt.ends_at,
                  timelineDetailAppt.total_duration_min,
                ),
                statusLabel: formatAppointmentStatus(timelineDetailAppt.status),
                status: timelineDetailAppt.status,
                paymentLabel: modalPayment.stateLabel,
                paymentBreakdown: modalPayment.items
                  ? modalPayment.items.map((item) => ({
                      label: item.label,
                      value: formatEUR(item.value),
                    }))
                  : undefined,
                paymentDetails: paid > 0
                  ? paymentAttribution(timelineDetailAppt.id, confirmedPaidRows, cashPaymentRows, refundRows)
                  : undefined,
                messageLabel: messageState?.label ?? null,
                notes: timelineDetailAppt.notes,
                valueLabel: formatEUR(split.serviceTotal),
                scheduleHistory: formatScheduleHistory(
                  scheduleEvents.filter((event) => event.appointment_id === timelineDetailAppt.id),
                ),
              }}
              actions={actions}
              payment={((!isJointBooking && financialSummary.needsStudioPaymentConfirmation) ||
                (hasJointServiceState && canOperateJointPayments && jointHasReceivableService && timelineDetailAppt.status !== "cancelled" &&
                  !pendingOnlinePaymentByAppointment.has(timelineDetailAppt.id) && split.pending > 0)) ? {
                busy: receivingPaymentId === timelineDetailAppt.id,
                enableInPersonMbWay,
                phone: timelineDetailAppt.clients?.phone,
                prepare: async () => isJointBooking
                  ? openJointPayment(timelineDetailAppt, null, "Saldo da reserva")
                  : (setJointPaymentContext(null), { amount: Math.max(0, timelineDetailAppt.total_price - paid) }),
                confirm: (method: DrawerPaymentMethod, options) => confirmStudioPayment(timelineDetailAppt, method, options),
                close: () => setJointPaymentContext(null),
              } : undefined}
              canUndoManualReceipt={canCorrectFinancialReceipt && hasAttendanceReceipt &&
                !confirmedPaidRows.some((row) => row.appointment_id === timelineDetailAppt.id)}
              onUndoManualReceipt={canCorrectFinancialReceipt && hasAttendanceReceipt &&
                !confirmedPaidRows.some((row) => row.appointment_id === timelineDetailAppt.id)
                ? (reason) => undoMistakenReceipt(reason, timelineDetailAppt) : undefined}
              paymentMovements={cashPaymentRows.filter((row) => row.appointment_id === timelineDetailAppt.id && row.id && Number(row.amount) > 0)
                .map((row) => ({ id: row.id!, amount: Number(row.amount), method: row.payment_method ?? "other" }))}
              onCorrectPaymentMethod={canCorrectFinancialReceipt && hasManualReceipt
                ? (movementId, method) => correctPaymentMethod(movementId, method, timelineDetailAppt) : undefined}
              correctingPaymentMethod={correctingPaymentMethod}
              onChangeAttendance={!hasJointServiceState && (
                timelineDetailAppt.status === "confirmed" ? canConfirm :
                  (owner || (studio?.role === "manager" && timelineDetailAppt.status !== "cancelled")) && canCorrectState
              ) ? (nextStatus) => timelineDetailAppt.status === "confirmed"
                ? markPresence(timelineDetailAppt, nextStatus as "completed" | "no_show")
                : correctPresence(nextStatus, "", timelineDetailAppt)
                : undefined}
              onServiceState={hasJointServiceState && owner && timelineDetailAppt.status !== "cancelled"
                ? (serviceLineId, nextState) => updateJointServiceLine(serviceLineId, nextState)
                : undefined}
              onServiceReschedule={hasJointServiceState && owner && timelineDetailAppt.status !== "cancelled"
                ? (serviceLineId) => {
                    setRescheduleServiceLineId(serviceLineId);
                    setRescheduleApptId(timelineDetailAppt.id);
                    setTimelineDetailId(null);
                  }
                : undefined}
              onServicePayment={hasJointServiceState && canOperateJointPayments && jointHasReceivableService && timelineDetailAppt.status !== "cancelled" &&
                !pendingOnlinePaymentByAppointment.has(timelineDetailAppt.id) && split.pending > 0
                ? (serviceLineId) => {
                    const line = serviceSegments.find((candidate) => candidate.id === serviceLineId);
                    return openJointPayment(timelineDetailAppt, serviceLineId, line?.services?.name ?? "Serviço");
                  }
                : undefined}
              updatingServiceId={updatingServiceLineId}
              onClose={() => { setJointPaymentContext(null); setTimelineDetailId(null); }}
              cancellationReasonRequired={timelineDetailAppt.status === "completed"}
              cancellationFinancialNotice={timelineDetailAppt.status === "completed"
                ? "Sai da receita do caixa. Sem reembolso automático."
                : paid > 0 ? "Verifique o eventual reembolso manual." : undefined}
              onConfirmCancel={(reason) => cancelAppointment(timelineDetailAppt.id, reason)}
              cancelling={cancellingId === timelineDetailAppt.id}
            />
          );
        })()}

      {attendancePanelOpen && (
        <AttendancePendingSheet
          items={attendanceSheetItems}
          timeZone={studio?.timezone}
          mode={attendanceReview.mode}
          closingReview={attendanceClosingReview}
          savingId={savingPresenceId}
          onClose={() => {
            setAttendancePanelOpen(false);
            setAttendancePanelFocusId(null);
          }}
          onResolve={(item, outcome) => {
            const appointment = appts.find((candidate) => candidate.id === item.id);
            if (!appointment) return;
            void markPresence(appointment, outcome).then((resolved) => {
              if (resolved && attendancePanelFocusId === appointment.id) {
                setAttendancePanelOpen(false);
                setAttendancePanelFocusId(null);
              }
            });
          }}
          onResolveMany={(items, outcome) => {
            const selected = items
              .map((item) => appts.find((candidate) => candidate.id === item.id))
              .filter((appointment): appointment is Appt => Boolean(appointment));
            void markPresenceMany(selected, outcome);
          }}
        />
      )}

      {/* Mobile Filter Bottom Sheet */}
      {mobileFiltersOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[100] isolate md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filtros da agenda"
        >
          <button
            type="button"
            className="absolute inset-0 touch-none bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileFiltersOpen(false)}
            aria-label="Fechar filtros da agenda"
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[calc(100dvh-max(env(safe-area-inset-top),0.5rem))] min-h-0 flex-col overflow-hidden overscroll-contain rounded-t-[1.5rem] border-t border-border bg-card shadow-2xl">
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
            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch]">
              <AgendaFilterFields
                filters={mobileDraftFilters}
                options={filterOptions}
                onChange={(key, value) => setMobileDraftFilters((current) => ({ ...current, [key]: value }))}
                mobile
                hideProfessional={isProfessionalPanel && !canStaffViewTeamAgenda}
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
                onClick={applyMobileFilters}
                className="h-12 rounded-2xl bg-foreground text-sm font-semibold text-background transition hover:opacity-90"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Nova marcação Modal */}
      {newApptOpen && studio && (
        <NewAppointmentModal
          studioId={studio.id}
          ownerCanOverridePaymentHold={
            studio.role === "studio_owner" || studio.role === "saas_owner"
          }
          staffId={null}
          initialStaffId={newApptDefaults?.staffId}
          initialDate={newApptDefaults?.date}
          initialTime={newApptDefaults?.time}
          creationMode={newApptDefaults?.mode ?? "standard"}
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
          ownerCanEditResolved={true}
          staffId={null}
          appt={editAppt}
          initialMove={dropEditDraft ?? undefined}
          receivedAmount={paidByAppointment.get(editAppt.id) ?? 0}
          studioTimezone={studio.timezone}
          onSwap={editAppt.status === "confirmed" && editAppt.staff?.id &&
            appts.some((candidate) => candidate.id !== editAppt.id && candidate.clients &&
              candidate.staff?.id && !["cancelled", "canceled", "no_show", "completed"].includes(candidate.status))
            ? () => {
              setEditApptId(null);
              setSwapApptId(editAppt.id);
            } : undefined}
          onFit={editAppt.status === "confirmed" && editAppt.staff?.id ? () => {
            const start = new Date(editAppt.starts_at);
            setNewApptDefaults({
              staffId: editAppt.staff?.id,
              date: getStudioDateKey(start, studio.timezone),
              time: formatStudioTime(start, studio.timezone),
              mode: "fit",
            });
            setEditApptId(null);
            setNewApptOpen(true);
          } : undefined}
          onClose={() => { setEditApptId(null); setDropEditDraft(null); }}
          onSaved={() => {
            setEditApptId(null);
            setDropEditDraft(null);
            void loadData({ silent: true });
          }}
        />
      )}

      {/* Reagendar Modal */}
      {rescheduleAppt && studio && (
        <RescheduleModal
          studioId={studio.id}
          studioTimezone={studio.timezone}
          staffId={null}
          appt={rescheduleAppt}
          serviceLineId={rescheduleServiceLineId}
          initialDrop={dropRescheduleDraft ?? undefined}
          onClose={() => { setRescheduleApptId(null); setRescheduleServiceLineId(null); setDropRescheduleDraft(null); }}
          onSaved={() => {
            setRescheduleApptId(null);
            setRescheduleServiceLineId(null);
            setDropRescheduleDraft(null);
            void loadData({ silent: true });
          }}
        />
      )}

      {swapAppt && studio && (
        <SwapAppointmentModal
          studioId={studio.id}
          appt={swapAppt}
          appointments={appts}
          onClose={() => setSwapApptId(null)}
          onSaved={() => {
            setSwapApptId(null);
            loadData();
          }}
        />
      )}

      {durationAppt && studio && (
        <AppointmentDurationModal
          studioId={studio.id}
          appt={durationAppt}
          onClose={() => setDurationApptId(null)}
          onSaved={() => {
            setDurationApptId(null);
            loadData();
          }}
        />
      )}

      {paymentDialogAppt && (
        <StudioPaymentDialog
          appt={paymentDialogAppt}
          amount={
            jointPaymentContext ? jointPaymentContext.amountCents / 100 : paidByAppointment.get(paymentDialogAppt.id)
              ? Math.max(
                  0,
                  paymentDialogAppt.total_price -
                    (paidByAppointment.get(paymentDialogAppt.id) ?? 0),
                )
              : paymentDialogAppt.total_price
          }
          busy={receivingPaymentId === paymentDialogAppt.id}
          jointPaymentLabel={jointPaymentContext?.label}
          enableInPersonMbWay={enableInPersonMbWay}
          onClose={() => { setPaymentDialogAppt(null); setJointPaymentContext(null); }}
          onConfirm={(method, options) => confirmStudioPayment(paymentDialogAppt, method, options)}
        />
      )}
      {presenceCorrectionAppt && (
        <PresenceCorrectionDialog
          appt={presenceCorrectionAppt}
          busy={savingPresenceId === presenceCorrectionAppt.id}
          canUndoManualReceipt={Boolean((studio?.role === "studio_owner" || studio?.role === "saas_owner") &&
            cashPaymentRows.some((row) => row.appointment_id === presenceCorrectionAppt.id && Number(row.amount) > 0 && row.source_key?.startsWith("attendance-settlement:")) &&
            !confirmedPaidRows.some((row) => row.appointment_id === presenceCorrectionAppt.id))}
          showStateCorrections={["completed", "no_show", "cancelled"].includes(presenceCorrectionAppt.status) ||
            (presenceCorrectionAppt.status === "confirmed" && cashPaymentRows.some((row) =>
              row.appointment_id === presenceCorrectionAppt.id && Number(row.amount) > 0 &&
              row.source_key?.startsWith("attendance-settlement:")))}
          onCorrectPaymentMethod={(studio?.role === "studio_owner" || studio?.role === "saas_owner") &&
            cashPaymentRows.some((row) => row.appointment_id === presenceCorrectionAppt.id && Number(row.amount) > 0)
            ? () => {
              setPaymentMethodCorrectionAppt(presenceCorrectionAppt);
              setPresenceCorrectionAppt(null);
            } : undefined}
          onClose={() => setPresenceCorrectionAppt(null)}
          onConfirm={correctPresence}
          onUndoReceipt={(reason) => { void undoMistakenReceipt(reason, presenceCorrectionAppt); }}
        />
      )}
      {paymentMethodCorrectionAppt && (
        <PaymentMethodCorrectionDialog
          appt={paymentMethodCorrectionAppt}
          movements={cashPaymentRows.filter((row) => row.appointment_id === paymentMethodCorrectionAppt.id && row.id && Number(row.amount) > 0)}
          busy={correctingPaymentMethod}
          onClose={() => setPaymentMethodCorrectionAppt(null)}
          onConfirm={(movementId, method) => { void correctPaymentMethod(movementId, method, paymentMethodCorrectionAppt); }}
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
  ownerCanOverridePaymentHold,
  staffId,
  initialStaffId,
  initialDate,
  initialTime,
  creationMode = "standard",
  onClose,
  onCreated,
}: {
  studioId: string;
  ownerCanOverridePaymentHold: boolean;
  staffId?: string | null;
  initialStaffId?: string;
  initialDate?: string;
  initialTime?: string;
  creationMode?: "standard" | "fit";
  onClose: () => void;
  onCreated: () => void;
}) {
  const sendManualAppointmentConfirmation = useServerFn(
    sendManualAppointmentConfirmationForAppointment,
  );
  const dispatchStudioAppointmentPush = useServerFn(
    dispatchRecentStudioAppointmentPushNotification,
  );
  const previewSchedule = useServerFn(previewStudioScheduleChange);
  const createManualFit = useServerFn(createStudioManualFit);
  const resolveScheduleDateTime = useServerFn(resolveStudioLocalDateTime);
  const loadCatalog = useServerFn(getProtectedAgendaCatalog);
  const [services, setServices] = useState<StudioService[]>([]);
  const [staffList, setStaffList] = useState<StudioStaff[]>([]);
  const [staffServiceLinks, setStaffServiceLinks] = useState<ManualAppointmentStaffServiceLink[]>(
    [],
  );
  const [clients, setClients] = useState<StudioClient[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<StudioClient | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [isNewClient, setIsNewClient] = useState(false);
  const [withoutClient, setWithoutClient] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [appliedDurations, setAppliedDurations] = useState<Record<string, number>>({});
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const [durationHints, setDurationHints] = useState<Record<string, { available: number; original: number }>>({});
  const [checkingDurations, setCheckingDurations] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceStaffById, setServiceStaffById] = useState<Record<string, string>>({});
  const [selectedStaff, setSelectedStaff] = useState(initialStaffId ?? "");
  const [date, setDate] = useState(initialDate ?? "");
  const [time, setTime] = useState(initialTime ?? "09:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [conflictPreview, setConflictPreview] = useState<StudioSchedulePreview | null>(null);

  useEffect(() => {
    (async () => {
      let catalog;
      try {
        catalog = await loadCatalog({ data: { studioId, staffId: staffId ?? null } });
      } catch {
        toast.error("Não foi possível carregar os dados para esta marcação.");
        setLoadingData(false);
        return;
      }
      const serviceRows = catalog.services as StudioService[];
      const staffRows = catalog.staff as StudioStaff[];
      const scopedLinks = tenantScopedStaffServiceLinks(
        catalog.links as ManualAppointmentStaffServiceLink[],
        staffRows.map((staff) => staff.id),
        serviceRows.map((service) => service.id),
      );
      setServices(serviceRows);
      setStaffList(staffRows);
      setStaffServiceLinks(scopedLinks);
      if (!initialStaffId && staffRows[0]) setSelectedStaff(staffRows[0].id);
      setClients(normalizeAppointmentClients(catalog.clients, false));
      setLoadingData(false);
    })();
  }, [initialStaffId, staffId, studioId, loadCatalog]);

  const filteredClients = clients.filter((c) => {
    if (!clientSearch.trim()) return true;
    const q = normalizeFilterText(clientSearch);
    return normalizeFilterText(`${c.name} ${c.phone}`).includes(q);
  });
  const selectableServices = useMemo(
    () =>
      services.filter(
        (service) =>
          manualAppointmentStaffForService(staffList, staffServiceLinks, service.id).length > 0,
      ),
    [services, staffList, staffServiceLinks],
  );
  const visibleServices = useMemo(
    () => filterAndSortManualAppointmentServices(selectableServices, serviceSearch),
    [selectableServices, serviceSearch],
  );
  const chosenServices = selectedServiceIds
    .map((serviceId) => selectableServices.find((service) => service.id === serviceId))
    .filter((service): service is StudioService => Boolean(service));
  const serviceAssignments: ManualServiceAssignment[] = chosenServices.map((service) => ({
    serviceId: service.id,
    staffId: serviceStaffById[service.id] ?? "",
    ...(appliedDurations[service.id] !== undefined
      ? { durationMin: appliedDurations[service.id] }
      : {}),
  }));
  const totalServiceDuration = chosenServices.reduce(
    (total, service) => total + (appliedDurations[service.id] ?? service.duration_min),
    0,
  );
  const totalServicePrice = chosenServices.reduce((total, service) => total + service.price, 0);

  useEffect(() => {
    setServiceStaffById((current) => {
      const next: Record<string, string> = {};
      for (const serviceId of selectedServiceIds) {
        const allowedStaff = manualAppointmentStaffForService(
          staffList,
          staffServiceLinks,
          serviceId,
        );
        const currentStaff = current[serviceId];
        next[serviceId] = allowedStaff.some((person) => person.id === currentStaff)
          ? currentStaff
          : allowedStaff.find((person) => person.id === selectedStaff)?.id ??
            allowedStaff[0]?.id ??
            "";
      }
      return next;
    });
  }, [selectedServiceIds, selectedStaff, staffList, staffServiceLinks]);

  useEffect(() => {
    setConflictPreview(null);
  }, [date, time, selectedServiceIds, serviceStaffById, appliedDurations]);

  const durationContext = JSON.stringify({
    date, time,
    assignments: serviceAssignments,
    services: chosenServices.map((service) => [service.id, service.duration_min]),
  });
  useEffect(() => {
    let cancelled = false;
    if (!date || !time || serviceAssignments.length === 0 ||
        serviceAssignments.some((assignment) => !assignment.staffId)) {
      setDurationHints({});
      setCheckingDurations(false);
      return;
    }
    setDurationHints({});
    setCheckingDurations(true);
    void (async () => {
      const { startsAt } = await resolveScheduleDateTime({ data: { studioId, date, time } });
      const segments = buildManualServiceSegments(services, serviceAssignments, startsAt);
      if (segments.length !== serviceAssignments.length) return;
      const hints = await Promise.all(segments.map(async (segment) => {
        const original = services.find((service) => service.id === segment.serviceId)!.duration_min;
        const result = await findClearDuration(original, (durationMin) => previewSchedule({
          data: { studioId, staffId: segment.staffId, startsAt: segment.startsAt,
            durationMin, ignoreAppointmentIds: [] },
        }));
        return [segment.serviceId, { available: result, original }] as const;
      }));
      if (!cancelled) setDurationHints(Object.fromEntries(hints));
    })().catch(() => {
      if (!cancelled) setDurationHints({});
    }).finally(() => {
      if (!cancelled) setCheckingDurations(false);
    });
    return () => { cancelled = true; };
  }, [durationContext, services, previewSchedule, resolveScheduleDateTime, studioId]);

  function applyDuration(service: StudioService, minutes: number) {
    const available = durationHints[service.id]?.available;
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > service.duration_min ||
        available === undefined || minutes > available) {
      toast.error("Indique uma duração válida que caiba no horário disponível.");
      return;
    }
    setAppliedDurations((current) => ({ ...current, [service.id]: minutes }));
    setDurationDrafts((current) => ({ ...current, [service.id]: String(minutes) }));
  }

  async function handleSave() {
    if (savingRef.current) return;
    if (
      !date ||
      !time ||
      serviceAssignments.length === 0 ||
      serviceAssignments.some((assignment) => !assignment.staffId)
    ) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }
    if (
      !serviceAssignments.every((assignment) =>
        isManualAppointmentServiceAllowed(
          staffServiceLinks,
          assignment.staffId,
          assignment.serviceId,
        ),
      )
    ) {
      toast.error("A profissional selecionada não realiza este serviço.");
      return;
    }
    if (!withoutClient && !isNewClient && !selectedClient) {
      toast.error("Selecione ou crie um cliente.");
      return;
    }
    const normalizedNewClientPhone = normalizeInternationalPhone(newClientPhone);
    const normalizedNewClientName = newClientName.trim();
    if (!withoutClient && isNewClient && (!normalizedNewClientName || !isValidInternationalPhone(newClientPhone))) {
      toast.error("Nome e telefone são obrigatórios.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      const { startsAt } = await resolveScheduleDateTime({
        data: { studioId, date, time },
      });
      const segments = buildManualServiceSegments(services, serviceAssignments, startsAt);
      if (segments.length !== serviceAssignments.length) {
        throw new Error("Não foi possível preparar os horários dos serviços.");
      }
      const previews = await Promise.all(
        segments.map((segment) =>
          previewSchedule({
            data: {
              studioId,
              staffId: segment.staffId,
              startsAt: segment.startsAt,
              durationMin: segment.durationMin,
              ignoreAppointmentIds: [],
            },
          }),
        ),
      );
      const preview = mergeSchedulePreviews(previews, startsAt, totalServiceDuration);
      const canReplaceUnpaidHold = ownerCanOverridePaymentHold && preview.paymentHolds.length > 0;
      const canOwnerOverrideHardBlock = ownerCanOverridePaymentHold && preview.hardBlocked;
      let appointmentId: string;
      if (withoutClient && creationMode === "standard" && !canOwnerOverrideHardBlock) {
        if (preview.hardBlocked || preview.hasConflict) throw new Error("Este horário já não está disponível.");
        const { data: created, error } = await (supabase as any).rpc("create_studio_walkin_appointment", {
          p_studio_id: studioId, p_assignments: serviceAssignments, p_starts_at: startsAt,
          p_notes: notes.trim() || null,
        });
        if (error || !created?.appointment_id) throw new Error(formatManualAppointmentError(error?.message));
        appointmentId = created.appointment_id;
      } else if (creationMode === "fit" || canOwnerOverrideHardBlock) {
        if (preview.hardBlocked && !canOwnerOverrideHardBlock) {
          setConflictPreview(preview);
          throw new Error("O horário contém um bloqueio, folga ou pagamento em processamento.");
        }
        const decisionPreview = canOwnerOverrideHardBlock || !preview.withinAvailability
          ? { ...preview, hardBlocked: false, hasConflict: true, canOverride: true }
          : preview;
        if (
          decisionPreview.hasConflict &&
          !sameScheduleDecision(decisionPreview, conflictPreview)
        ) {
          setConflictPreview(decisionPreview);
          return;
        }
        const created = await createManualFit({
          data: {
            studioId,
            assignments: serviceAssignments,
            startsAt,
            clientId: withoutClient || isNewClient ? null : selectedClient!.id,
            clientName: !withoutClient && isNewClient ? normalizedNewClientName : null,
            clientPhone: !withoutClient && isNewClient ? normalizedNewClientPhone : null,
            notes: notes.trim() || null,
            confirmOverlap: preview.hasConflict,
            expectedConflictIds: preview.conflicts.map((conflict) => conflict.appointmentId),
            expectedPaymentHoldIds: canReplaceUnpaidHold
              ? [...new Set(preview.paymentHolds.map((hold) => hold.requestId))]
              : [],
          },
        });
        appointmentId = created.appointmentId;
      } else {
        if (preview.hardBlocked || preview.hasConflict) {
          throw new Error("Este horário já não está disponível.");
        }
        const { data: created, error: createError } = await (supabase as any).rpc(
          "create_manual_multi_professional_appointment",
          {
            p_studio_id: studioId,
            p_assignments: serviceAssignments,
            p_starts_at: startsAt,
            p_client_id: isNewClient ? null : selectedClient!.id,
            p_client_name: isNewClient ? normalizedNewClientName : null,
            p_client_phone: isNewClient ? normalizedNewClientPhone : null,
            p_notes: notes.trim() || null,
          },
        );
        if (createError || !created?.appointment_id) {
          throw new Error(formatManualAppointmentError(createError?.message));
        }
        appointmentId = created.appointment_id as string;
      }
      const notificationTasks: Promise<unknown>[] = [
        ...(!withoutClient ? [sendManualAppointmentConfirmation({ data: { appointmentId } })] : []),
      ];
      if (creationMode === "standard") {
        notificationTasks.push(
          dispatchStudioAppointmentPush({ data: { studioId, appointmentId } }),
        );
      }
      void Promise.allSettled(notificationTasks).then((notificationResults) => {
        for (const result of notificationResults) {
          if (result.status === "rejected") {
            console.error("[admin-agenda] appointment notification dispatch failed", {
              studioId,
              appointmentId,
              error: result.reason,
            });
          }
        }
      });
      toast.success("Marcação criada com sucesso!");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar marcação.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <ModalShell
      title={creationMode === "fit" ? "Criar encaixe" : "Nova marcação"}
      onClose={onClose}
    >
      {loadingData ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {creationMode === "standard" && (
            <label className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-semibold">
              <input type="checkbox" checked={withoutClient} onChange={(e) => setWithoutClient(e.target.checked)} />
              Agendamento avulso — sem cadastro de cliente
            </label>
          )}
          {creationMode === "fit" && (
            <label className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm font-semibold">
              <input type="checkbox" checked={withoutClient} onChange={(e) => setWithoutClient(e.target.checked)} />
              Cliente avulso — sem cadastro de cliente
            </label>
          )}
          {withoutClient ? <p className="text-xs text-muted-foreground">Sem dados pessoais. Pode usar as notas para uma identificação opcional.</p> : <div>
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
          </div>}
          <ModalField label="Serviços *">
            <div className="relative mb-2">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={serviceSearch}
                onChange={(event) => setServiceSearch(event.target.value)}
                placeholder="Pesquisar serviço…"
                aria-label="Pesquisar serviço"
                className={`${inputCls} pl-9`}
              />
            </div>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border bg-background/70 p-1.5">
              {selectableServices.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Nenhum serviço associado à equipa
                </p>
              ) : visibleServices.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Nenhum serviço encontrado.
                </p>
              ) : (
                visibleServices.map((service) => {
                  const selected = selectedServiceIds.includes(service.id);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setSelectedServiceIds((current) => {
                          if (current.includes(service.id)) {
                            setAppliedDurations((durations) => {
                              const next = { ...durations };
                              delete next[service.id];
                              return next;
                            });
                            setDurationDrafts((drafts) => {
                              const next = { ...drafts };
                              delete next[service.id];
                              return next;
                            });
                            setServiceStaffById((staffByService) => {
                              const next = { ...staffByService };
                              delete next[service.id];
                              return next;
                            });
                            return current.filter((serviceId) => serviceId !== service.id);
                          }
                          const allowedStaff = manualAppointmentStaffForService(
                            staffList,
                            staffServiceLinks,
                            service.id,
                          );
                          const defaultStaff =
                            allowedStaff.find((person) => person.id === selectedStaff)?.id ??
                            allowedStaff[0]?.id ??
                            "";
                          setServiceStaffById((staffByService) => ({
                            ...staffByService,
                            [service.id]: defaultStaff,
                          }));
                          return [...current, service.id];
                        })
                      }
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                        selected
                          ? "bg-emerald-500/12 text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-border"
                        }`}
                      >
                        {selected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {service.name}
                      </span>
                      <span className="shrink-0 text-[11px]">
                        {formatEUR(service.price)} · {service.duration_min}min
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </ModalField>
          {chosenServices.length > 0 && (
            <ModalField label="Profissional por serviço *">
              <div className="space-y-2 rounded-xl border border-border bg-background/70 p-2">
                {chosenServices.map((service, index) => {
                  const allowedStaff = manualAppointmentStaffForService(
                    staffList,
                    staffServiceLinks,
                    service.id,
                  );
                  return (
                    <div
                      key={service.id}
                      className="grid min-w-0 grid-cols-1 gap-1.5 rounded-lg bg-muted/35 p-2 min-[420px]:grid-cols-[minmax(0,1fr)_minmax(9rem,0.9fr)] min-[420px]:items-center"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-xs font-bold">
                          {index + 1}. {service.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {service.duration_min}min · {formatEUR(service.price)}
                        </p>
                      </div>
                      <Select
                        value={serviceStaffById[service.id] ?? ""}
                        onValueChange={(staffId) => {
                          setSelectedStaff(staffId);
                          setServiceStaffById((current) => ({
                            ...current,
                            [service.id]: staffId,
                          }));
                        }}
                      >
                        <SelectTrigger className={`${selectTriggerCls} w-full`}>
                          <SelectValue placeholder="Profissional" />
                        </SelectTrigger>
                        <SelectContent className={modalSelectContentCls}>
                          {allowedStaff.map((person) => (
                            <SelectItem key={person.id} value={person.id}>
                              {person.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="min-w-0 space-y-2 min-[420px]:col-span-2">
                        <p className="text-xs text-muted-foreground">
                          Duração original: <strong>{service.duration_min} min</strong>
                          {appliedDurations[service.id] !== undefined && (
                            <> · Nesta marcação: <strong>{appliedDurations[service.id]} min</strong></>
                          )}
                        </p>
                        {durationHints[service.id] &&
                          durationHints[service.id].available < service.duration_min && (
                            <div role="status" className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs leading-relaxed">
                              {durationHints[service.id].available >= 5 ? (
                                <>
                                  <p>Este serviço dura {service.duration_min} minutos, mas há {durationHints[service.id].available} minutos disponíveis neste horário. Deseja ajustar a duração apenas nesta marcação?</p>
                                  <button type="button" className="mt-2 rounded-lg bg-foreground px-3 py-2 font-bold text-background"
                                    onClick={() => applyDuration(service, durationHints[service.id].available)}>
                                    Aplicar {durationHints[service.id].available} minutos
                                  </button>
                                </>
                              ) : (
                                <p>Não há um intervalo válido de pelo menos 5 minutos para este serviço. Escolha outro horário.</p>
                              )}
                            </div>
                          )}
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="min-w-[8rem] flex-1 text-xs font-semibold">
                            Duração individual (min)
                            <input type="number" min={5} max={service.duration_min} step={1}
                              value={durationDrafts[service.id] ?? String(appliedDurations[service.id] ?? service.duration_min)}
                              onChange={(event) => setDurationDrafts((current) => ({ ...current, [service.id]: event.target.value }))}
                              className={`${inputCls} mt-1`} />
                          </label>
                          <button type="button" className="h-11 rounded-xl border border-border px-3 text-xs font-bold"
                            disabled={checkingDurations || !durationHints[service.id]}
                            onClick={() => applyDuration(service, Number(durationDrafts[service.id] ?? service.duration_min))}>
                            Aplicar duração
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ModalField>
          )}
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <ModalField label="Data *">
              {/* Override PremiumDatePicker base styles (h-12 rounded-2xl px-4 shadow-sm) to match inputCls */}
              <PremiumDatePicker
                value={date}
                onChange={setDate}
                placeholder="Escolher data"
                className={datePickerCls}
                portalLayer="modal"
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
          {conflictPreview && <ScheduleConflictWarning preview={conflictPreview} mode="create" />}
          {chosenServices.length > 0 && date && time && (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Resumo
              </p>
              <div className="mt-1 flex items-end justify-between gap-3">
                <p
                  className="min-w-0 truncate text-sm font-semibold"
                  title={chosenServices.map((service) => service.name).join(", ")}
                >
                  {chosenServices.map((service) => service.name).join(" + ")}
                </p>
                <p className="shrink-0 text-sm font-black text-emerald-700 dark:text-emerald-300">
                  {formatEUR(totalServicePrice)}
                </p>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {new Date(`${date}T${time}:00`).toLocaleDateString("pt-PT", {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                })}{" "}
                as {time} · {totalServiceDuration}min
              </p>
            </div>
          )}
        </div>
      )}
      <ModalFooter
        onClose={onClose}
        onSave={handleSave}
        saving={saving}
        disabled={loadingData || Boolean(conflictPreview?.hardBlocked)}
        label={
          conflictPreview?.hasConflict
            ? "Confirmar encaixe"
            : creationMode === "fit"
              ? "Encaixe"
              : undefined
        }
      />
    </ModalShell>
  );
}

// ─── Edit Appointment Modal ───────────────────────────────────────────────────

function EditAppointmentModal({ studioId, studioTimezone, staffId, appt, receivedAmount, onClose, onSaved, initialMove,
  ownerCanEditResolved,
  onSwap, onFit }: {
  studioId: string; studioTimezone?: string | null; staffId?: string | null;
  appt: Appt; receivedAmount: number; onClose: () => void; onSaved: () => void;
  initialMove?: { date: string; time: string; staffId: string; lineId: string };
  ownerCanEditResolved: boolean;
  onSwap?: () => void; onFit?: () => void;
}) {
  const [services, setServices] = useState<StudioService[]>([]);
  const [staffList, setStaffList] = useState<StudioStaff[]>([]);
  const [links, setLinks] = useState<ManualAppointmentStaffServiceLink[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [assignments, setAssignments] = useState(() => (appt.appointment_services ?? []).map((line) => ({
    lineId: line.id ?? "", serviceId: line.services?.id ?? "", staffId: initialMove && line.id === initialMove.lineId
      ? initialMove.staffId : line.staff?.id ?? appt.staff?.id ?? "",
    durationMin: undefined as number | undefined, isNew: false,
  })));
  const [durationDrafts, setDurationDrafts] = useState<Record<string, string>>({});
  const [durationHints, setDurationHints] = useState<Record<string, { available: number; original: number }>>({});
  const [date, setDate] = useState(initialMove?.date ?? getStudioDateKey(appt.starts_at, studioTimezone));
  const [time, setTime] = useState(initialMove?.time ?? formatStudioTime(appt.starts_at, studioTimezone));
  const [price, setPrice] = useState(String(appt.total_price));
  const [notes, setNotes] = useState(appt.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmFinancialChange, setConfirmFinancialChange] = useState(false);
  const savingRef = useRef(false);
  const resolveDateTime = useServerFn(resolveStudioLocalDateTime);
  const previewSchedule = useServerFn(previewStudioScheduleChange);
  const updateResolvedNotes = useServerFn(updateProtectedResolvedAppointmentNotes);
  const updateResolvedFull = useServerFn(updateProtectedResolvedAppointmentFull);
  const loadCatalog = useServerFn(getProtectedAgendaCatalog);
  const resolvedState = appt.status === "completed" || appt.status === "no_show";
  const hasActiveReceipt = receivedAmount > 0;
  const isJointBooking = (appt.appointment_services ?? []).some((line) => line.service_state != null) ||
    new Set((appt.appointment_services ?? []).map((line) => line.staff?.id).filter(Boolean)).size > 1;
  const jointServicesConfirmed = Boolean(appt.appointment_services?.length) &&
    appt.appointment_services!.every((line) => line.service_state === "confirmed");
  const structuralChange = assignments.length !== (appt.appointment_services?.length ?? 0) ||
    assignments.some((item) => item.isNew);
  const canChangeStructure = appt.status === "confirmed" && !hasActiveReceipt &&
    (appt.appointment_services ?? []).every((line) => line.service_state == null || line.service_state === "confirmed");
  const resolvedFullEdit = !isJointBooking && ownerCanEditResolved && resolvedState &&
    Boolean(appt.appointment_services?.length);
  const paidConfirmedEdit = !isJointBooking && ownerCanEditResolved && appt.status === "confirmed" && hasActiveReceipt &&
    Boolean(appt.appointment_services?.length);
  const jointConfirmedEdit = isJointBooking && ownerCanEditResolved && appt.status === "confirmed" && jointServicesConfirmed;
  const protectedFullEdit = resolvedFullEdit || paidConfirmedEdit || (jointConfirmedEdit && !structuralChange);
  const resolvedNotesOnly = ownerCanEditResolved && resolvedState && !resolvedFullEdit;
  const editRestriction = (appt.status === "cancelled" ||
    (resolvedState && !ownerCanEditResolved))
    ? "Desfaça o estado atual para editar esta marcação." : null;
  const draftKey = JSON.stringify({ date, time, price, notes, assignments, durationDrafts });
  useEffect(() => setConfirmFinancialChange(false), [draftKey]);

  function updateDraftPrice(nextAssignments: typeof assignments) {
    const total = nextAssignments.reduce((sum, item) => sum + Number(
      services.find((service) => service.id === item.serviceId)?.price ??
      appt.appointment_services?.find((line) => line.id === item.lineId)?.price ?? 0,
    ), 0);
    setPrice(total.toFixed(2));
  }

  function addServiceLine() {
    const selected = new Set(assignments.map((item) => item.serviceId));
    const service = services.find((candidate) => !selected.has(candidate.id) &&
      manualAppointmentStaffForService(staffList, links, candidate.id).length > 0);
    if (!service) { toast.error("Não há outro serviço disponível para adicionar."); return; }
    const professional = manualAppointmentStaffForService(staffList, links, service.id)[0];
    const next = [...assignments, {
      lineId: crypto.randomUUID(), serviceId: service.id, staffId: professional.id,
      durationMin: undefined, isNew: true,
    }];
    setAssignments(next);
    updateDraftPrice(next);
  }

  function removeServiceLine(lineId: string) {
    if (assignments.length <= 1) return;
    const next = assignments.filter((item) => item.lineId !== lineId);
    setAssignments(next);
    setDurationDrafts((current) => {
      const copy = { ...current };
      delete copy[lineId];
      return copy;
    });
    updateDraftPrice(next);
  }

  useEffect(() => {
    if (editRestriction || resolvedNotesOnly) { setLoadingData(false); return; }
    let mounted = true;
    void (async () => {
      let catalog;
      try {
        catalog = await loadCatalog({ data: { studioId, staffId: staffId ?? null } });
      } catch {
        if (mounted) toast.error("Não foi possível carregar os dados da marcação.");
        return;
      }
      if (!mounted) return;
      const svcRows = catalog.services as StudioService[];
      const staffRows = catalog.staff as StudioStaff[];
      setServices(svcRows); setStaffList(staffRows);
      setLinks(tenantScopedStaffServiceLinks(catalog.links as ManualAppointmentStaffServiceLink[], staffRows.map((s) => s.id), svcRows.map((s) => s.id)));
      setLoadingData(false);
    })();
    return () => { mounted = false; };
  }, [studioId, staffId, editRestriction, resolvedNotesOnly, loadCatalog]);

  const editDurationContext = JSON.stringify({ date, time, assignments });
  useEffect(() => {
    let cancelled = false;
    if (editRestriction || resolvedNotesOnly || protectedFullEdit || loadingData || !date || !time || assignments.some((item) => !item.staffId || !item.serviceId)) {
      setDurationHints({});
      return;
    }
    setDurationHints({});
    void (async () => {
      const { startsAt } = await resolveDateTime({ data: { studioId, date, time } });
      let cursor = new Date(startsAt).getTime();
      const hints: Record<string, { available: number; original: number }> = {};
      for (const item of assignments) {
        const original = services.find((service) => service.id === item.serviceId)?.duration_min;
        const existingLine = appt.appointment_services?.find((line) => line.id === item.lineId);
        if (!original) continue;
        const segmentStart = new Date(cursor).toISOString();
        const available = await findClearDuration(original, (durationMin) => previewSchedule({
          data: { studioId, staffId: item.staffId, startsAt: segmentStart,
            durationMin, ignoreAppointmentIds: [appt.id] },
        }));
        hints[item.lineId] = { available, original };
        cursor += (item.durationMin ?? (existingLine?.services?.id === item.serviceId
          ? existingLine?.duration_min ?? original : original)) * 60_000;
      }
      if (!cancelled) setDurationHints(hints);
    })().catch(() => { if (!cancelled) setDurationHints({}); });
    return () => { cancelled = true; };
  }, [editDurationContext, editRestriction, resolvedNotesOnly, protectedFullEdit, loadingData, services, appt, previewSchedule, resolveDateTime, studioId]);

  async function handleSave() {
    if (savingRef.current) return;
    if (editRestriction) { toast.error(editRestriction); return; }
    if (resolvedNotesOnly) {
      savingRef.current = true; setSaving(true);
      try {
        await updateResolvedNotes({ data: {
          studioId, appointmentId: appt.id,
          expectedStatus: appt.status as "completed" | "no_show", notes,
        } });
        toast.success("Notas atualizadas."); onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao atualizar notas.");
      } finally { savingRef.current = false; setSaving(false); }
      return;
    }
    if (protectedFullEdit) {
      const amount = Number(price.replace(",", "."));
      const nextAssignments = assignments.map((item) => {
        const line = appt.appointment_services?.find((candidate) => candidate.id === item.lineId);
        const durationMin = Number(durationDrafts[item.lineId] ??
          (line?.services?.id === item.serviceId ? line?.duration_min : undefined) ??
          services.find((service) => service.id === item.serviceId)?.duration_min);
        return { ...item, durationMin };
      });
      if (!date || !time || !Number.isFinite(amount) || amount < 0 ||
        Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001 ||
        nextAssignments.some((item) => !item.lineId || !item.serviceId || !item.staffId ||
          !Number.isInteger(item.durationMin) || item.durationMin < 5 || item.durationMin > 720)) {
        toast.error("Indique serviço, profissional, data, hora, valor e duração válidos."); return;
      }
      if (amount < receivedAmount) {
        toast.error("O novo valor não pode ser inferior ao recebido. Corrija primeiro o recebimento."); return;
      }
      const financialFieldsChanged = amount !== Number(appt.total_price) ||
        nextAssignments.some((item) => {
          const line = appt.appointment_services?.find((candidate) => candidate.id === item.lineId);
          return item.serviceId !== line?.services?.id ||
            item.staffId !== (line?.staff?.id ?? appt.staff?.id);
        });
      if (hasActiveReceipt && financialFieldsChanged) {
        toast.error("Para preservar o pagamento e a comissão já registados, estes campos não podem ser alterados após o recebimento.");
        return;
      }
      if (financialFieldsChanged && !confirmFinancialChange) {
        setConfirmFinancialChange(true);
        return;
      }
      savingRef.current = true; setSaving(true);
      try {
        const { startsAt } = await resolveDateTime({ data: { studioId, date, time } });
        await updateResolvedFull({ data: {
          studioId, appointmentId: appt.id,
          expectedStatus: appt.status as "confirmed" | "completed" | "no_show",
          startsAt, assignments: nextAssignments, totalPrice: amount, notes,
        } });
        toast.success("Reserva atualizada na mesma marcação. Recebimentos preservados."); onSaved();
      } catch (err) {
        toast.error(formatManualAppointmentError(err instanceof Error ? err.message : String(err)));
      } finally { savingRef.current = false; setSaving(false); }
      return;
    }
    const amount = Number(price.replace(",", "."));
    if (!date || !time || !price.trim() || !Number.isFinite(amount) || amount < 0 || assignments.some((a) => !a.lineId || !a.serviceId || !a.staffId)) {
      toast.error("Preencha horário, serviço, profissional e um valor válido."); return;
    }
    savingRef.current = true; setSaving(true);
    try {
      const nextAssignments = assignments.map((item) => {
        const draft = durationDrafts[item.lineId];
        if (draft === undefined) return item;
        const durationMin = Number(draft);
        const hint = durationHints[item.lineId];
        if (!hint || !Number.isInteger(durationMin) || durationMin < 5 ||
          durationMin > hint.original || durationMin > hint.available) {
          throw new Error("Indique uma duração válida que caiba no horário disponível.");
        }
        return { ...item, durationMin };
      });
      const { startsAt } = await resolveDateTime({ data: { studioId, date, time } });
      const { error } = await (supabase as any).rpc("edit_studio_appointment", {
        p_studio_id: studioId, p_appointment_id: appt.id, p_starts_at: startsAt,
        p_assignments: nextAssignments, p_total_price: amount, p_notes: notes || null,
      });
      if (error) throw new Error(formatManualAppointmentError(error.message));
      toast.success("Marcação atualizada."); onSaved();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Erro ao atualizar marcação."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  if (editRestriction) return <ModalShell title="Editar marcação" onClose={onClose}>
    <div className="px-4 py-6"><p role="status" className="rounded-xl border border-border bg-muted/30 p-3 text-sm">{editRestriction}</p></div>
    <div className="border-t border-border p-3"><button type="button" onClick={onClose}
      className="h-10 w-full rounded-xl border border-border text-sm font-semibold">Voltar</button></div>
  </ModalShell>;

  if (resolvedNotesOnly) return <ModalShell title="Editar reserva" onClose={onClose}>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
      <p className="text-sm font-semibold">{appt.clients?.name ?? "Marcação sem cliente"}</p>
      <p role="status" className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
        Este serviço conjunto tem estados por serviço. Use as ações individuais para o horário; aqui só as notas podem ser alteradas.
        {hasActiveReceipt && " Para preservar o pagamento e a comissão já registados, estes campos não podem ser alterados após o recebimento."}
      </p>
      <ModalField label="Notas"><textarea aria-label="Notas" value={notes}
        onChange={(event) => setNotes(event.target.value)} maxLength={5000} rows={3} className={textareaCls} /></ModalField>
    </div>
    <ModalFooter onClose={onClose} onSave={handleSave} saving={saving}
      disabled={notes === (appt.notes ?? "")} label="Guardar alterações" cancelLabel="Voltar" />
  </ModalShell>;

  return <ModalShell title="Editar marcação" onClose={onClose}>
    {loadingData ? <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> :
      <div className="appointment-modal-scrollbar premium-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 pb-6 [scrollbar-gutter:stable]">
        <p className="text-sm font-semibold">{appt.clients?.name ?? "Agendamento avulso — sem cliente"}</p>
        {initialMove && <p role="status" className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-xs font-semibold">Nova posição selecionada na agenda. Confirme os dados antes de guardar.</p>}
        {protectedFullEdit && !hasActiveReceipt && <div role="status" className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-bold">Compare antes de guardar</p>
          <p>Antes: {appt.appointment_services?.map((line) => line.services?.name ?? "Serviço").join(" + ")} · {appt.staff?.name ?? "Profissional"} · {getStudioDateKey(appt.starts_at, studioTimezone)} às {formatStudioTime(appt.starts_at, studioTimezone)} · {appointmentDurationMinutes(appt)} min · {formatEUR(appt.total_price)}</p>
          <p>Depois: {assignments.map((item) => services.find((service) => service.id === item.serviceId)?.name ?? "Serviço").join(" + ")} · {staffList.find((person) => person.id === assignments[0]?.staffId)?.name ?? appt.staff?.name ?? "Profissional"} · {date} às {time} · {assignments.reduce((sum, item) => sum + Number(durationDrafts[item.lineId] ?? (appt.appointment_services?.find((line) => line.id === item.lineId)?.services?.id === item.serviceId ? appt.appointment_services?.find((line) => line.id === item.lineId)?.duration_min : undefined) ?? services.find((service) => service.id === item.serviceId)?.duration_min ?? 0), 0)} min · {formatEUR(Number(price.replace(",", ".")) || 0)}</p>
          <p>O serviço, o profissional e o valor serão confirmados antes de guardar.</p>
          {confirmFinancialChange && <p className="font-semibold text-amber-800 dark:text-amber-200">Confirme a alteração financeira no botão abaixo.</p>}
        </div>}
        {hasActiveReceipt && <p role="status" className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
          Para preservar o pagamento e a comissão já registados, estes campos não podem ser alterados após o recebimento.
        </p>}
        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <ModalField label="Data *"><PremiumDatePicker value={date} onChange={setDate} className={datePickerCls} portalLayer="modal" /></ModalField>
          <AppointmentTimePicker value={time} onChange={setTime} />
        </div>
        {assignments.map((assignment, index) => {
          const currentLine = appt.appointment_services?.find((line) => line.id === assignment.lineId);
          const currentServiceId = currentLine?.services?.id;
          const selectedDuration = services.find((service) => service.id === assignment.serviceId)?.duration_min;
          const selectableServices = services.filter((s) => manualAppointmentStaffForService(staffList, links, s.id).length > 0);
          const allowedStaff = manualAppointmentStaffForService(staffList, links, assignment.serviceId);
          return <div key={assignment.lineId} className="space-y-2 rounded-xl border border-border p-3">
            {canChangeStructure && assignments.length > 1 && <button type="button"
              aria-label={`Remover serviço ${index + 1}`}
              onClick={() => removeServiceLine(assignment.lineId)}
              className="ml-auto block min-h-8 rounded-lg border border-rose-300 px-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
              Remover serviço
            </button>}
            <ModalField label={assignments.length > 1 ? `Serviço ${index + 1} *` : "Serviço *"}>
              <Select value={assignment.serviceId} disabled={hasActiveReceipt} onValueChange={(serviceId) => {
                setDurationDrafts((current) => {
                  const next = { ...current };
                  delete next[assignment.lineId];
                  return next;
                });
                const next = assignments.map((a, i) => i !== index ? a : {
                  ...a, serviceId, durationMin: undefined, staffId: isManualAppointmentServiceAllowed(links, a.staffId, serviceId) ? a.staffId : manualAppointmentStaffForService(staffList, links, serviceId)[0]?.id ?? "",
                });
                setAssignments(next);
                updateDraftPrice(next);
              }}>
                <SelectTrigger className={`${selectTriggerCls} pr-4`}><SelectValue placeholder="Escolher serviço" /></SelectTrigger>
                <SelectContent className={modalSelectContentCls}>
                  {currentServiceId && !selectableServices.some((s) => s.id === currentServiceId) && <SelectItem value={currentServiceId}>{currentLine?.services?.name} (atual)</SelectItem>}
                  {selectableServices.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} — {s.duration_min}min</SelectItem>)}
                </SelectContent>
              </Select>
            </ModalField>
            <ModalField label="Profissional *">
              <Select value={assignment.staffId} disabled={hasActiveReceipt} onValueChange={(value) => setAssignments((current) => current.map((a, i) => i === index ? {...a, staffId: value} : a))}>
                <SelectTrigger className={`${selectTriggerCls} pr-4`}><SelectValue placeholder="Escolher profissional" /></SelectTrigger>
                <SelectContent className={modalSelectContentCls}>
                  {!allowedStaff.some((s) => s.id === assignment.staffId) && assignment.staffId && <SelectItem value={assignment.staffId}>{currentLine?.staff?.name ?? appt.staff?.name} (atual)</SelectItem>}
                  {allowedStaff.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </ModalField>
            <ModalField label="Duração individual">
              {durationHints[assignment.lineId] && durationHints[assignment.lineId].available < durationHints[assignment.lineId].original && (
                <div role="status" className="mb-2 rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 text-xs">
                  {durationHints[assignment.lineId].available >= 5 ? (
                    <>Há {durationHints[assignment.lineId].available} minutos disponíveis neste horário. Ajuste a duração abaixo.</>
                  ) : "Não há intervalo válido de pelo menos 5 minutos. Escolha outro horário."}
                </div>
              )}
              <div>
                <input aria-label="Duração individual em minutos" type="number" min={5} step={1}
                  max={protectedFullEdit ? 720 : durationHints[assignment.lineId]?.original}
                  value={durationDrafts[assignment.lineId] ?? String(assignment.durationMin ??
                    (currentServiceId === assignment.serviceId ? currentLine?.duration_min : undefined) ??
                    selectedDuration ?? appointmentDurationMinutes(appt))}
                  onChange={(event) => setDurationDrafts((current) => ({ ...current, [assignment.lineId]: event.target.value }))}
                  className={inputCls} />
              </div>
            </ModalField>
          </div>;
        })}
        {canChangeStructure && assignments.length < 20 && <button type="button"
          onClick={addServiceLine}
          className="min-h-10 w-full rounded-xl border border-dashed border-primary/50 px-3 text-sm font-bold text-primary hover:bg-primary/5">
          Adicionar serviço
        </button>}
        <ModalField label="Preço / valor (€) *"><input aria-label="Preço / valor (€)" type="number" min="0" step="0.01" value={price} disabled={hasActiveReceipt} onChange={(e) => setPrice(e.target.value)} className={inputCls} /></ModalField>
        <ModalField label="Notas"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={textareaCls} /></ModalField>
      </div>}
    {(onSwap || onFit) && (
      <div className="shrink-0 border-t border-border/70 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {onSwap && <button type="button" onClick={onSwap} className="min-h-8 rounded-lg border border-border px-2 text-xs font-semibold hover:bg-muted">Trocar</button>}
          {onFit && <button type="button" onClick={onFit} className="min-h-8 rounded-lg border border-border px-2 text-xs font-semibold hover:bg-muted">Encaixar</button>}
        </div>
      </div>
    )}
    <ModalFooter onClose={onClose} onSave={handleSave} saving={saving} disabled={loadingData}
      label={confirmFinancialChange ? "Confirmar alterações" : "Guardar alterações"} cancelLabel="Voltar" />
  </ModalShell>;
}


// ─── Reschedule Modal ────────────────────────────────────────────────────────

function RescheduleModal({
  studioId,
  studioTimezone,
  appt,
  serviceLineId,
  initialDrop,
  onClose,
  onSaved,
}: {
  studioId: string;
  studioTimezone?: string | null;
  staffId?: string | null;
  appt: Appt;
  serviceLineId?: string | null;
  initialDrop?: { time: string; staffId: string; staffName: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const previewSchedule = useServerFn(previewStudioScheduleChange);
  const moveAppointment = useServerFn(moveStudioAppointment);
  const moveJointService = useServerFn(rescheduleProtectedJointService);
  const resolveScheduleDateTime = useServerFn(resolveStudioLocalDateTime);
  const serviceLine = serviceLineId
    ? appt.appointment_services?.find((line) => line.id === serviceLineId)
    : null;
  const durationMin = Math.round(
    (new Date(serviceLine?.ends_at ?? appt.ends_at).getTime() -
      new Date(serviceLine?.starts_at ?? appt.starts_at).getTime()) / 60000,
  );
  const currentDate = getStudioDateKey(serviceLine?.starts_at ?? appt.starts_at, studioTimezone);
  const currentTime = formatStudioTime(serviceLine?.starts_at ?? appt.starts_at, studioTimezone);
  const [date, setDate] = useState(currentDate);
  const [time, setTime] = useState(initialDrop?.time ?? currentTime);
  const [saving, setSaving] = useState(false);
  const [conflictPreview, setConflictPreview] = useState<StudioSchedulePreview | null>(null);

  useEffect(() => {
    setConflictPreview(null);
  }, [date, time]);

  async function handleSave() {
    if (!date || !time) {
      toast.error("Data e hora são obrigatórias.");
      return;
    }
    setSaving(true);
    try {
      if (!appt.staff?.id) throw new Error("appointment_without_staff");
      const { startsAt } = await resolveScheduleDateTime({
        data: { studioId, date, time },
      });
      if (serviceLineId) {
        if (!serviceLine?.staff?.id) throw new Error("service_without_staff");
        await moveJointService({
          data: { studioId, serviceLineId, staffId: initialDrop?.staffId ?? serviceLine.staff.id, startsAt },
        });
        toast.success("Serviço reagendado.");
        onSaved();
        return;
      }
      const preview = await previewSchedule({
        data: {
          studioId,
          staffId: appt.staff.id,
          startsAt,
          durationMin,
          ignoreAppointmentIds: [appt.id],
        },
      });
      if (preview.hardBlocked || (!preview.withinAvailability && !appt.is_manual_fit)) {
        const blockedPreview = !preview.withinAvailability
          ? { ...preview, hardBlocked: true }
          : preview;
        setConflictPreview(blockedPreview);
        throw new Error("O novo horário contém um bloqueio, folga ou pagamento em processamento.");
      }
      const decisionPreview = !preview.withinAvailability
        ? { ...preview, hasConflict: true, canOverride: true }
        : preview;
      if (decisionPreview.hasConflict && !sameScheduleDecision(decisionPreview, conflictPreview)) {
        setConflictPreview(decisionPreview);
        return;
      }
      await moveAppointment({
        data: {
          studioId,
          appointmentId: appt.id,
          startsAt,
          durationMin,
          confirmOverlap: preview.hasConflict,
          expectedConflictIds: preview.conflicts.map((conflict) => conflict.appointmentId),
          operation: "move",
        },
      });
      toast.success("Marcação reagendada.");
      onSaved();
    } catch (err) {
      toast.error(scheduleChangeMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title={serviceLineId ? "Reagendar serviço" : "Reagendar marcação"} onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {initialDrop && <p role="status" className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-xs font-semibold">Nova posição selecionada na agenda: {initialDrop.staffName} às {initialDrop.time}. Confirme antes de guardar.</p>}
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
                {serviceLineId ? serviceLine?.services?.name : appt.appointment_services
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
              portalLayer="modal"
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
        {conflictPreview && <ScheduleConflictWarning preview={conflictPreview} mode="move" />}
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
        disabled={Boolean(conflictPreview?.hardBlocked)}
        label={conflictPreview?.hasConflict ? "Confirmar encaixe" : "Verificar e mover"}
      />
    </ModalShell>
  );
}

// ─── Modal Shell & helpers ────────────────────────────────────────────────────

function SwapAppointmentModal({
  studioId,
  appt,
  appointments,
  onClose,
  onSaved,
}: {
  studioId: string;
  appt: Appt;
  appointments: Appt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const previewSchedule = useServerFn(previewStudioScheduleChange);
  const swapAppointments = useServerFn(swapStudioAppointments);
  const candidates = appointments.filter(
    (candidate) =>
      candidate.id !== appt.id &&
      candidate.clients &&
      candidate.staff?.id &&
      !["cancelled", "canceled", "no_show", "completed"].includes(candidate.status),
  );
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflictPreview, setConflictPreview] = useState<StudioSchedulePreview | null>(null);
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;

  useEffect(() => setConflictPreview(null), [selectedId]);

  async function handleSwap() {
    if (!selected || !appt.staff?.id || !selected.staff?.id) {
      toast.error("Escolha a marcação que deseja trocar.");
      return;
    }
    setSaving(true);
    try {
      const ignoreAppointmentIds = [appt.id, selected.id];
      const [firstPreview, secondPreview] = await Promise.all([
        previewSchedule({
          data: {
            studioId,
            staffId: appt.staff.id,
            startsAt: selected.starts_at,
            durationMin: appointmentDurationMinutes(appt),
            ignoreAppointmentIds,
          },
        }),
        previewSchedule({
          data: {
            studioId,
            staffId: selected.staff.id,
            startsAt: appt.starts_at,
            durationMin: appointmentDurationMinutes(selected),
            ignoreAppointmentIds,
          },
        }),
      ]);
      const combined = combineSchedulePreviews(firstPreview, secondPreview);
      const outsideAvailability =
        (!firstPreview.withinAvailability && !appt.is_manual_fit) ||
        (!secondPreview.withinAvailability && !selected.is_manual_fit);
      if (combined.hardBlocked || outsideAvailability) {
        setConflictPreview(outsideAvailability ? { ...combined, hardBlocked: true } : combined);
        throw new Error(
          "Uma das marcações encontra um bloqueio, folga ou pagamento em processamento.",
        );
      }
      if (combined.hasConflict && !sameScheduleDecision(combined, conflictPreview)) {
        setConflictPreview(combined);
        return;
      }
      await swapAppointments({
        data: {
          studioId,
          firstAppointmentId: appt.id,
          secondAppointmentId: selected.id,
          confirmOverlap: combined.hasConflict,
          expectedConflictIds: combined.conflicts.map((conflict) => conflict.appointmentId),
        },
      });
      toast.success("Horários trocados de forma atómica.");
      onSaved();
    } catch (error) {
      toast.error(scheduleChangeMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell title="Trocar horários" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <ModalField label="Trocar com *">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className={selectTriggerCls}>
              <SelectValue placeholder="Escolher outra marcação" />
            </SelectTrigger>
            <SelectContent className={modalSelectContentCls}>
              {candidates.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  {formatShortAppointment(candidate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ModalField>
        {selected && (
          <div
            className="rounded-2xl border border-border bg-muted/20 p-3"
            data-testid="agenda-swap-preview"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
              Antes → Depois
            </p>
            <SwapPreviewRow appointment={appt} nextStartsAt={selected.starts_at} />
            <SwapPreviewRow appointment={selected} nextStartsAt={appt.starts_at} />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Cliente, serviço, profissional, preço e pagamentos permanecem nas marcações originais.
            </p>
          </div>
        )}
        {conflictPreview && <ScheduleConflictWarning preview={conflictPreview} mode="swap" />}
      </div>
      <ModalFooter
        onClose={onClose}
        onSave={handleSwap}
        saving={saving}
        disabled={!selected || Boolean(conflictPreview?.hardBlocked)}
        label={conflictPreview?.hasConflict ? "Confirmar troca com encaixe" : "Confirmar troca"}
      />
    </ModalShell>
  );
}

function AppointmentDurationModal({
  studioId,
  appt,
  onClose,
  onSaved,
}: {
  studioId: string;
  appt: Appt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const previewSchedule = useServerFn(previewStudioScheduleChange);
  const moveAppointment = useServerFn(moveStudioAppointment);
  const originalDuration = appointmentDurationMinutes(appt);
  const [duration, setDuration] = useState(String(originalDuration));
  const [saving, setSaving] = useState(false);
  const [conflictPreview, setConflictPreview] = useState<StudioSchedulePreview | null>(null);
  const durationMin = Number(duration);

  useEffect(() => setConflictPreview(null), [duration]);

  async function handleSave() {
    if (!appt.staff?.id || !Number.isInteger(durationMin) || durationMin < 5 || durationMin > 720) {
      toast.error("Indique uma duração entre 5 e 720 minutos.");
      return;
    }
    setSaving(true);
    try {
      const startsAt = normalizeAppointmentStart(appt.starts_at);
      const preview = await previewSchedule({
        data: {
          studioId,
          staffId: appt.staff.id,
          startsAt,
          durationMin,
          ignoreAppointmentIds: [appt.id],
        },
      });
      if (preview.hardBlocked || (!preview.withinAvailability && !appt.is_manual_fit)) {
        setConflictPreview(
          !preview.withinAvailability ? { ...preview, hardBlocked: true } : preview,
        );
        throw new Error("A nova duração encontra um bloqueio ou pagamento em processamento.");
      }
      const decisionPreview = !preview.withinAvailability
        ? { ...preview, hasConflict: true, canOverride: true }
        : preview;
      if (decisionPreview.hasConflict && !sameScheduleDecision(decisionPreview, conflictPreview)) {
        setConflictPreview(decisionPreview);
        return;
      }
      await moveAppointment({
        data: {
          studioId,
          appointmentId: appt.id,
          startsAt,
          durationMin,
          confirmOverlap: preview.hasConflict,
          expectedConflictIds: preview.conflicts.map((conflict) => conflict.appointmentId),
          operation: "duration",
        },
      });
      toast.success("Duração desta marcação atualizada.");
      onSaved();
    } catch (error) {
      toast.error(scheduleChangeMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const nextEnd = Number.isFinite(durationMin)
    ? new Date(new Date(appt.starts_at).getTime() + durationMin * 60_000).toISOString()
    : appt.ends_at;

  return (
    <ModalShell title="Ajustar duração" onClose={onClose}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="rounded-xl border border-border bg-muted/25 px-3 py-2.5">
          <p className="text-sm font-black">{appt.clients?.name ?? "Cliente"}</p>
          <p className="text-xs text-muted-foreground">{appointmentServiceLabel(appt)}</p>
        </div>
        <ModalField label="Duração desta marcação">
          <div className="relative">
            <input
              type="number"
              min={5}
              max={720}
              step={5}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              className={`${inputCls} pr-14`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
              min
            </span>
          </div>
        </ModalField>
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-blue-500/25 bg-blue-500/8 p-3 text-xs">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Antes
            </p>
            <p className="mt-1 font-black">
              {formatScheduleTime(appt.starts_at)}–{formatScheduleTime(appt.ends_at)}
            </p>
          </div>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
              Depois
            </p>
            <p className="mt-1 font-black">
              {formatScheduleTime(appt.starts_at)}–{formatScheduleTime(nextEnd)}
            </p>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          A duração padrão do serviço não será alterada. Preço e pagamentos também permanecem
          iguais.
        </p>
        {conflictPreview && <ScheduleConflictWarning preview={conflictPreview} mode="duration" />}
      </div>
      <ModalFooter
        onClose={onClose}
        onSave={handleSave}
        saving={saving}
        disabled={
          !Number.isInteger(durationMin) ||
          durationMin < 5 ||
          durationMin > 720 ||
          Boolean(conflictPreview?.hardBlocked)
        }
        label={conflictPreview?.hasConflict ? "Confirmar duração com encaixe" : "Guardar duração"}
      />
    </ModalShell>
  );
}

function ScheduleConflictWarning({
  preview,
  mode,
}: {
  preview: StudioSchedulePreview;
  mode: "move" | "swap" | "duration" | "create";
}) {
  const title = preview.hardBlocked
    ? "Este horário não pode ser utilizado"
    : !preview.withinAvailability
      ? "Fora do horário habitual da profissional"
      : mode === "create"
        ? "Já existe uma marcação neste período"
        : "Este horário já está ocupado";
  return (
    <div
      className={`rounded-2xl border p-3 ${preview.hardBlocked ? "border-rose-300/70 bg-rose-50/80 dark:border-rose-500/30 dark:bg-rose-500/10" : "border-amber-300/70 bg-amber-50/80 dark:border-amber-500/30 dark:bg-amber-500/10"}`}
      data-testid="agenda-schedule-conflict"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">{title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {preview.hardBlocked
              ? "Bloqueios, folgas e pagamentos em processamento não podem ser ignorados."
              : "A Bellza não fará a alteração silenciosamente. Reveja o impacto e confirme apenas se consegue atender as duas marcações."}
          </p>
        </div>
      </div>
      {preview.conflicts.map((conflict) => (
        <div
          key={`${conflict.appointmentId}-${conflict.overlapStartsAt}`}
          className="mt-2 rounded-xl border border-current/10 bg-background/65 px-3 py-2 text-xs"
        >
          <p className="break-words font-black">
            {conflict.clientName} · {conflict.serviceName}
          </p>
          <p className="mt-0.5 break-words text-muted-foreground">
            {conflict.professionalName} · ocupado{" "}
            {formatScheduleRange(conflict.startsAt, conflict.endsAt)}
          </p>
          <p className="mt-1 font-bold text-amber-800 dark:text-amber-200">
            Sobreposição: {formatScheduleRange(conflict.overlapStartsAt, conflict.overlapEndsAt)}
          </p>
        </div>
      ))}
      {preview.blocks.map((block) => (
        <p
          key={block.blockId}
          className="mt-2 rounded-xl bg-background/65 px-3 py-2 text-xs font-semibold"
        >
          Bloqueio: {block.reason || "indisponível"} ·{" "}
          {formatScheduleRange(block.startsAt, block.endsAt)}
        </p>
      ))}
      {preview.paymentHolds.length > 0 && (
        <p className="mt-2 rounded-xl bg-background/65 px-3 py-2 text-xs font-semibold">
          {mode === "create" && !preview.hardBlocked
            ? "Existe um pagamento online sem confirmação neste período. Ao confirmar, o checkout será encerrado e a reserva temporária libertada."
            : "Existe um pagamento online em processamento neste período."}
        </p>
      )}
      {!preview.withinAvailability && !preview.hardBlocked && (
        <p className="mt-2 rounded-xl bg-background/65 px-3 py-2 text-xs font-semibold">
          Este encaixe fica fora da disponibilidade recorrente configurada.
        </p>
      )}
      {!preview.hardBlocked && preview.hasConflict && (
        <p className="mt-2 text-xs font-black">Deseja criar um encaixe mesmo assim?</p>
      )}
    </div>
  );
}

function SwapPreviewRow({
  appointment,
  nextStartsAt,
}: {
  appointment: Appt;
  nextStartsAt: string;
}) {
  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-background/70 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-black">{appointment.clients?.name ?? "Cliente"}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {appointmentServiceLabel(appointment)}
        </p>
      </div>
      <p className="shrink-0 font-mono text-xs font-black tabular-nums">
        {formatScheduleTime(appointment.starts_at)} → {formatScheduleTime(nextStartsAt)}
      </p>
    </div>
  );
}

function combineSchedulePreviews(
  first: StudioSchedulePreview,
  second: StudioSchedulePreview,
): StudioSchedulePreview {
  return {
    ...first,
    conflicts: [...first.conflicts, ...second.conflicts],
    blocks: [...first.blocks, ...second.blocks],
    paymentHolds: [...first.paymentHolds, ...second.paymentHolds],
    staffAvailable: first.staffAvailable && second.staffAvailable,
    withinAvailability: first.withinAvailability && second.withinAvailability,
    hasConflict: first.hasConflict || second.hasConflict,
    hardBlocked: first.hardBlocked || second.hardBlocked,
    canOverride: first.canOverride || second.canOverride,
  };
}

function mergeSchedulePreviews(
  previews: StudioSchedulePreview[],
  startsAt: string,
  durationMin: number,
): StudioSchedulePreview {
  const uniqueBy = <T,>(items: T[], key: (item: T) => string) =>
    [...new Map(items.map((item) => [key(item), item])).values()];
  const conflicts = uniqueBy(
    previews.flatMap((preview) => preview.conflicts),
    (conflict) =>
      `${conflict.appointmentId}:${conflict.overlapStartsAt}:${conflict.overlapEndsAt}`,
  );
  const blocks = uniqueBy(
    previews.flatMap((preview) => preview.blocks),
    (block) => block.blockId,
  );
  const paymentHolds = uniqueBy(
    previews.flatMap((preview) => preview.paymentHolds),
    (hold) => hold.requestId,
  );
  const hardBlocked = previews.some((preview) => preview.hardBlocked);
  return {
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + durationMin * 60_000).toISOString(),
    durationMin,
    conflicts,
    blocks,
    paymentHolds,
    staffAvailable: previews.every((preview) => preview.staffAvailable),
    withinAvailability: previews.every((preview) => preview.withinAvailability),
    hasConflict: conflicts.length > 0,
    hardBlocked,
    canOverride: !hardBlocked,
  };
}

function sameScheduleDecision(
  current: StudioSchedulePreview,
  previous: StudioSchedulePreview | null,
) {
  if (!previous) return false;
  const signature = (preview: StudioSchedulePreview) =>
    JSON.stringify({
      withinAvailability: preview.withinAvailability,
      staffAvailable: preview.staffAvailable,
      conflicts: preview.conflicts.map((conflict) => [
        conflict.appointmentId,
        conflict.overlapStartsAt,
        conflict.overlapEndsAt,
      ]),
      blocks: preview.blocks.map((block) => [block.blockId, block.startsAt, block.endsAt]),
      paymentHolds: preview.paymentHolds.map((hold) => [
        hold.requestId,
        hold.startsAt,
        hold.endsAt,
      ]),
    });
  return signature(current) === signature(previous);
}

async function findClearDuration(
  original: number,
  preview: (durationMin: number) => Promise<StudioSchedulePreview>,
) {
  const fits = (result: StudioSchedulePreview) =>
    !result.hardBlocked && !result.hasConflict && result.withinAvailability;
  if (fits(await preview(original))) return original;
  let low = 4;
  let high = original - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (!fits(await preview(mid))) high = mid - 1;
    else low = mid;
  }
  return low >= 5 && fits(await preview(low)) ? low : 0;
}

function appointmentDurationMinutes(appointment: Appt) {
  return Math.max(
    5,
    Math.round(
      (new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) /
        60_000,
    ),
  );
}

function formatShortAppointment(appointment: Appt) {
  return `${appointment.clients?.name ?? "Cliente"} · ${formatStudioDate(appointment.starts_at, null, { day: "2-digit", month: "2-digit", year: undefined })} ${formatScheduleTime(appointment.starts_at)}`;
}

function formatScheduleRange(startsAt: string, endsAt: string) {
  return `${formatScheduleTime(startsAt)}–${formatScheduleTime(endsAt)}`;
}

function formatScheduleTime(value: string) {
  return formatStudioTime(value);
}

function formatScheduleHistory(events: ScheduleEventRow[]) {
  return events.slice(0, 10).map((event) => {
    const previousStart = String(event.previous_state?.startsAt ?? "");
    const nextStart = String(event.next_state?.startsAt ?? "");
    const previousDuration = Number(event.previous_state?.durationMin ?? 0);
    const nextDuration = Number(event.next_state?.durationMin ?? 0);
    if (event.operation === "swap") {
      return {
        label: "Horário trocado",
        detail:
          previousStart && nextStart
            ? `${formatScheduleTime(previousStart)} → ${formatScheduleTime(nextStart)}`
            : "Troca atómica com outra marcação",
        createdAt: event.created_at,
      };
    }
    if (event.operation === "duration") {
      return {
        label: "Duração ajustada",
        detail: `${previousDuration || "—"} min → ${nextDuration || "—"} min`,
        createdAt: event.created_at,
      };
    }
    if (event.operation === "manual_fit") {
      return {
        label: event.overlap_confirmed ? "Encaixe manual confirmado" : "Encaixe manual criado",
        detail:
          previousStart && nextStart
            ? `${formatScheduleTime(previousStart)} → ${formatScheduleTime(nextStart)}`
            : "Criado pelo estúdio",
        createdAt: event.created_at,
      };
    }
    return {
      label: "Horário movido",
      detail:
        previousStart && nextStart
          ? `${formatScheduleTime(previousStart)} → ${formatScheduleTime(nextStart)}`
          : "Alterado pelo estúdio",
      createdAt: event.created_at,
    };
  });
}

function scheduleChangeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("schedule_hard_blocked"))
    return "O horário contém uma folga, bloqueio ou pagamento em processamento.";
  if (message.includes("schedule_conflict"))
    return "A agenda mudou. Reveja o conflito antes de confirmar novamente.";
  if (message.includes("appointment_not_reschedulable"))
    return "Esta marcação já não pode ser alterada.";
  if (message.includes("outside_staff_availability"))
    return "O horário está fora da disponibilidade da profissional.";
  if (message.includes("not_authorized")) return "Sem permissão para alterar esta marcação.";
  return message || "Não foi possível alterar a agenda.";
}

function AppointmentTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [hour = "00", minute = "00"] = value.split(":");
  return <div className="grid min-w-0 gap-1.5">
    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Hora *</span>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
      <Select value={hour} onValueChange={(next) => onChange(`${next}:${minute}`)}>
        <SelectTrigger aria-label="Hora" className={`${selectTriggerCls} gap-1 pl-2 pr-3 [&>svg]:size-3`}><SelectValue /></SelectTrigger>
        <SelectContent className={modalSelectContentCls}>
          {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map((item) =>
            <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
      <span aria-hidden="true" className="text-sm font-semibold text-muted-foreground">:</span>
      <Select value={minute} onValueChange={(next) => onChange(`${hour}:${next}`)}>
        <SelectTrigger aria-label="Minutos" className={`${selectTriggerCls} gap-1 pl-2 pr-3 [&>svg]:size-3`}><SelectValue /></SelectTrigger>
        <SelectContent className={modalSelectContentCls}>
          {Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")).map((item) =>
            <SelectItem key={item} value={item}>{item}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </div>;
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useModalScrollLock();

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto overscroll-contain bg-black/40 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-sm md:items-center md:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="relative flex min-h-0 max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-0.5rem)] w-full max-w-xl flex-col overflow-hidden overscroll-contain rounded-[1.25rem] border border-border bg-card/98 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 md:max-h-[min(88dvh,44rem)] md:rounded-2xl">
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
    </div>,
    document.body,
  );
}

function ModalFooter({
  onClose,
  onSave,
  saving,
  disabled,
  label = "Guardar marcação",
  cancelLabel = "Cancelar",
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  disabled?: boolean;
  label?: string;
  cancelLabel?: string;
}) {
  return (
    <div className="relative z-10 grid shrink-0 gap-2 border-t border-border bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] min-[380px]:grid-cols-[0.85fr_1.15fr]">
      <button
        type="button"
        onClick={onClose}
        className="h-10 rounded-xl border border-border text-sm font-semibold text-muted-foreground transition hover:bg-muted"
      >
        {cancelLabel}
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
// SelectContent is rendered in a portal. Keep modal dropdowns above ModalShell's z-[100]
// while preserving Radix's collision detection, viewport sizing and automatic top/bottom flip.
const modalSelectContentCls = "z-[120] rounded-2xl border-border/80 bg-popover/98 shadow-2xl";
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
            {canViewSensitiveDetails && a.is_manual_fit && (
              <span className="max-w-full rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-semibold leading-tight text-violet-700 dark:text-violet-300">
                Encaixe
              </span>
            )}
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
                <FinancialSplitLine
                  label={`Profissional (${split.commissionPercent}%)`}
                  value={formatEUR(split.serviceProfessional)}
                />
                <FinancialSplitLine
                  label={`Estúdio (${100 - split.commissionPercent}%)`}
                  value={formatEUR(split.serviceStudio)}
                />
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
              <FinancialMetricCard
                label="Recebido online"
                value={formatEUR(split.receivedOnline)}
              />
              <FinancialMetricCard
                label="Recebido presencial"
                value={formatEUR(split.receivedOnsite)}
              />
              <FinancialMetricCard label="Por receber" value={formatEUR(split.pending)} />
              <FinancialMetricCard
                label="Recebido total"
                value={formatEUR(split.confirmed)}
                muted={split.confirmed === 0}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FinancialMetricCard
                label="Estúdio recebe"
                value={formatEUR(split.serviceStudio)}
                detail={`${100 - split.commissionPercent}% do total`}
                featured
              />
              <FinancialMetricCard
                label="Profissional recebe"
                value={formatEUR(split.serviceProfessional)}
                detail={`${split.commissionPercent}% do total`}
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

function PresenceCorrectionDialog({
  appt, busy, canUndoManualReceipt, showStateCorrections, onCorrectPaymentMethod,
  onClose, onConfirm, onUndoReceipt,
}: {
  appt: Appt;
  busy: boolean;
  canUndoManualReceipt: boolean;
  showStateCorrections: boolean;
  onCorrectPaymentMethod?: () => void;
  onClose: () => void;
  onConfirm: (status: "confirmed" | "completed" | "no_show" | "cancelled", reason?: string) => void;
  onUndoReceipt: (reason: string) => void;
}) {
  useModalScrollLock();
  const [undoReason, setUndoReason] = useState("");
  const [noMoneyReceived, setNoMoneyReceived] = useState(false);
  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center overflow-y-auto overscroll-contain bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Corrigir ação">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h2 className="text-base font-bold">Corrigir estado ou recebimento</h2>
        {showStateCorrections && <p className="mt-1 text-xs text-muted-foreground">Ao corrigir apenas o estado, os recebimentos já registados mantêm-se.</p>}
        {showStateCorrections && <div className="mt-4 grid gap-2">
          {([
            ["completed", "Compareceu"],
            ["no_show", "Não compareceu"],
            ["confirmed", "Em aberto"],
          ] as const).map(([status, label]) => (
            <button key={status} type="button" disabled={busy || appt.status === status || (appt.status === "cancelled" && status !== "confirmed")}
              onClick={() => onConfirm(status)}
              className="min-h-11 rounded-xl border border-border px-3 text-left text-sm font-semibold hover:bg-muted disabled:opacity-45">
              {label}{status === "confirmed" && canUndoManualReceipt ? " · manter recebimento" : ""}{appt.status === status ? " (atual)" : ""}
            </button>
          ))}
        </div>}
        {onCorrectPaymentMethod && (
          <button type="button" disabled={busy} onClick={onCorrectPaymentMethod}
            className="mt-3 min-h-11 w-full rounded-xl border border-border px-3 text-left text-sm font-semibold hover:bg-muted disabled:opacity-45">
            Corrigir método de pagamento
          </button>
        )}
        {canUndoManualReceipt && (
          <div className="mt-4 space-y-2 rounded-xl border border-amber-300/70 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-sm font-bold">Desfazer recebimento lançado por engano</p>
            <p className="text-xs text-muted-foreground">Reabre esta marcação e volta a mostrar o valor por receber. O lançamento original fica anulado no histórico. Use apenas se nenhum dinheiro foi recebido.</p>
            <label className="block text-xs font-semibold">Motivo da correção
              <textarea value={undoReason} onChange={(event) => setUndoReason(event.target.value)} maxLength={500} rows={2}
                className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-sm" />
            </label>
            <label className="flex items-start gap-2 text-xs font-medium">
              <input type="checkbox" checked={noMoneyReceived} onChange={(event) => setNoMoneyReceived(event.target.checked)} className="mt-0.5" />
              Confirmo que este recebimento foi registado por engano e o dinheiro não foi recebido.
            </label>
            <button type="button" disabled={busy || undoReason.trim().length < 3 || !noMoneyReceived}
              onClick={() => onUndoReceipt(undoReason.trim())}
              className="min-h-11 w-full rounded-xl border border-amber-600/40 px-3 text-left text-sm font-bold hover:bg-amber-100 disabled:opacity-45 dark:hover:bg-amber-500/20">
              Reabrir e anular recebimento incorreto
            </button>
          </div>
        )}
        <button type="button" disabled={busy} onClick={onClose}
          className="mt-4 min-h-10 w-full rounded-xl border border-border text-sm font-semibold disabled:opacity-45">
          Fechar
        </button>
      </div>
    </div>,
    document.body,
  );
}

function PaymentMethodCorrectionDialog({ appt, movements, busy, onClose, onConfirm }: {
  appt: Appt;
  movements: CashPaymentRow[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (movementId: string, method: StudioPaymentMethod) => void;
}) {
  useModalScrollLock();
  const [movementId, setMovementId] = useState(movements[0]?.id ?? "");
  const currentMovement = movements.find((row) => row.id === movementId);
  const [method, setMethod] = useState<StudioPaymentMethod>((currentMovement?.payment_method as StudioPaymentMethod) ?? "cash");
  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center overflow-y-auto overscroll-contain bg-black/45 p-4" role="dialog" aria-modal="true" aria-label="Corrigir método de pagamento">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-sm space-y-4 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div>
          <h2 className="text-base font-bold">Corrigir método de pagamento</h2>
          <p className="mt-1 text-xs text-muted-foreground">{appt.clients?.name ?? "Cliente"} · O valor recebido e a transação original permanecem intactos.</p>
        </div>
        {movements.length > 1 && <label className="block text-xs font-semibold">Recebimento
          <select value={movementId} onChange={(event) => {
            setMovementId(event.target.value);
            setMethod((movements.find((row) => row.id === event.target.value)?.payment_method as StudioPaymentMethod) ?? "cash");
          }} className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-sm">
            {movements.map((row) => <option key={row.id} value={row.id ?? ""}>{formatEUR(row.amount)} · {row.payment_method === "bank_transfer" ? "Transferência bancária" : STUDIO_PAYMENT_METHODS.find((item) => item.value === row.payment_method)?.label ?? "Outro"}</option>)}
          </select>
        </label>}
        <label className="block text-xs font-semibold">Método correto
          <select value={method} onChange={(event) => setMethod(event.target.value as StudioPaymentMethod)}
            className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-sm">
            {STUDIO_PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            <option value="bank_transfer">Transferência bancária</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="min-h-11 flex-1 rounded-xl border border-border text-sm font-semibold">Fechar</button>
          <button type="button" onClick={() => onConfirm(movementId, method)} disabled={busy || !movementId || method === currentMovement?.payment_method}
            className="min-h-11 flex-1 rounded-xl bg-foreground text-sm font-semibold text-background disabled:opacity-45">Guardar</button>
        </div>
      </div>
    </div>, document.body,
  );
}


function StudioPaymentDialog({
  appt,
  amount,
  busy,
  jointPaymentLabel,
  enableInPersonMbWay,
  onClose,
  onConfirm,
}: {
  appt: Appt;
  amount: number;
  busy: boolean;
  jointPaymentLabel?: string;
  enableInPersonMbWay: boolean;
  onClose: () => void;
  onConfirm: (method: StudioPaymentMethod, options?: { phone?: string; mbWayAction?: "charge" | "received" }) => void;
}) {
  useModalScrollLock();
  const [paymentMethod, setPaymentMethod] = useState<StudioPaymentMethod>("cash");
  const [clientAttended, setClientAttended] = useState(true);
  const [mbWayPhone, setMbWayPhone] = useState(appt.clients?.phone ?? "");
  const [mbWayAction, setMbWayAction] = useState<"charge" | "received">("received");
  const isStripeMbWay = enableInPersonMbWay && paymentMethod === "mb_way" && mbWayAction === "charge";
  const normalizedMbWayPhone = normalizeInternationalPhone(mbWayPhone);
  const canSendMbWayCharge = !isStripeMbWay || isValidInternationalPhone(normalizedMbWayPhone);
  const primaryLabel = paymentMethod === "mb_way"
    ? isStripeMbWay ? "Enviar cobrança" : "Registrar como recebido"
    : "Confirmar pagamento";

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center overflow-y-auto overscroll-contain bg-black/45 p-3 backdrop-blur-sm sm:items-center">
      <button type="button" aria-label="Fechar" className="absolute inset-0" onClick={onClose} />
      <div className="relative max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200">
        <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Receber pagamento</p>
            <p className="truncate text-xs text-muted-foreground">
              {appt.clients?.name ?? "Cliente"} · {jointPaymentLabel ? `${jointPaymentLabel} · ` : ""}{formatEUR(amount)}
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

          {paymentMethod === "mb_way" && (
            <div className="space-y-2" role="group" aria-label="Ação MB WAY presencial">
              <div className="grid grid-cols-2 gap-2">
              {([
                ["received", "Registrar como recebido"],
                ["charge", "Enviar cobrança"],
              ] as const).map(([action, label]) => (
                <button
                  key={action}
                  type="button"
                  disabled={busy || (action === "charge" && !enableInPersonMbWay)}
                  aria-pressed={(enableInPersonMbWay ? mbWayAction : "received") === action}
                  onClick={() => setMbWayAction(action)}
                  className={`w-full rounded-xl border px-3 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                    (enableInPersonMbWay ? mbWayAction : "received") === action
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
              </div>
              {!isStripeMbWay && (
                <p className="text-xs text-muted-foreground">
                  {jointPaymentLabel
                    ? "Registra apenas o valor recebido, sem concluir os serviços."
                    : "Registra o valor já recebido presencialmente e finaliza o atendimento, sem enviar cobrança."}
                </p>
              )}
            </div>
          )}

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

          {!jointPaymentLabel && <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-2.5 text-sm font-medium">
            <input
              type="checkbox"
              checked={clientAttended}
              onChange={(event) => setClientAttended(event.target.checked)}
              className="size-4 accent-emerald-600"
            />
            Cliente compareceu.
          </label>}
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
              onConfirm(paymentMethod, paymentMethod === "mb_way"
                ? { mbWayAction: isStripeMbWay ? "charge" : "received", ...(isStripeMbWay ? { phone: normalizedMbWayPhone } : {}) }
                : undefined)
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
      cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
    },
    completed: {
      label: "Concluída",
      cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
    },
    cancelled: { label: "Cancelada", cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
    no_show: { label: "Falta", cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
    pending: { label: "Pendente", cls: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
    pending_payment: {
      label: "Aguarda pagamento",
      cls: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
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

function getAppointmentFinancialSummary(
  a: Appt,
  split: ReturnType<typeof computeAppointmentSplit>,
  paidAmount: number,
  hasPendingOnlinePayment = false,
): AgendaPaymentPresentation {
  return buildAgendaPaymentPresentation({
    appointmentStatus: a.status,
    totalAmount: split.serviceTotal,
    paidAmount,
    hasPendingOnlinePayment,
  });
}

function FinancialStatusChip({
  summary,
  size = "sm",
}: {
  summary: AgendaPaymentPresentation;
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
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false);
  const clientSuggestions = options.clients.filter((client) => {
    const term = normalizeFilterText(filters.client);
    return normalizeFilterText(client.name).includes(term) || clientPhoneMatches(client.phone, filters.client);
  }).slice(0, 8);
  return (
    <div className={`grid gap-3 ${mobile ? "" : "md:grid-cols-2 xl:grid-cols-4"}`}>
      <FilterField label="Data">
        <PremiumFilterSelect
          mobile={mobile}
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
          portalLayer={mobile ? "modal" : "default"}
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
            mobile={mobile}
            value={filters.staffId}
            onValueChange={(v) => onChange("staffId", v)}
            options={[["all", "Todos"], ...options.professionals]}
          />
        </FilterField>
      )}
      <FilterField label="Serviço">
        <PremiumFilterSelect
          mobile={mobile}
          value={filters.service}
          onValueChange={(v) => onChange("service", v)}
          options={[["all", "Todos"], ...options.services.map((s) => [s, s] as [string, string])]}
        />
      </FilterField>
      <FilterField label="Estado">
        <PremiumFilterSelect
          mobile={mobile}
          value={filters.status}
          onValueChange={(v) => onChange("status", v)}
          options={[
            ["all", "Todos"],
            ...options.statuses.map((s) => [s, formatAppointmentStatus(s)] as [string, string]),
          ]}
        />
      </FilterField>
      <div className="grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cliente / Telefone</span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Cliente / Telefone"
            value={filters.client}
            onFocus={() => setClientSuggestionsOpen(true)}
            onChange={(e) => {
              onChange("client", e.target.value);
              onChange("clientId", "");
              setClientSuggestionsOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setClientSuggestionsOpen(false);
            }}
            placeholder="Nome ou telefone"
            className={`w-full rounded-xl border border-border bg-background/70 pl-9 pr-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/8 ${mobile ? "h-12" : "h-10"}`}
          />
          {clientSuggestionsOpen && !filters.clientId && filters.client.trim() && clientSuggestions.length > 0 && (
            <div className={`${mobile ? "relative mt-2" : "absolute inset-x-0 top-full z-30 mt-1"} max-h-48 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 shadow-lg`}>
              {clientSuggestions.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => {
                    onChange("client", client.name);
                    onChange("clientId", client.id);
                    setClientSuggestionsOpen(false);
                  }}
                  className={`flex w-full justify-between gap-2 rounded-lg px-3 text-left text-xs hover:bg-muted ${mobile ? "min-h-12 items-center" : "py-1.5"}`}
                >
                  <span className="truncate">{client.name}</span>
                  <span className="shrink-0 text-muted-foreground">{client.phone}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <FilterField label="Pagamento">
        <PremiumFilterSelect
          mobile={mobile}
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
          mobile={mobile}
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
  mobile,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: [string, string][];
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (mobile) {
    const selectedLabel = options.find(([optionValue]) => optionValue === value)?.[1] ?? "Selecionar";
    return (
      <div className="min-w-0">
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border bg-background px-4 text-left text-sm font-semibold shadow-sm transition active:scale-[0.99] ${open ? "border-foreground/30 ring-2 ring-foreground/10" : "border-border"}`}
        >
          <span className="min-w-0 truncate">{selectedLabel}</span>
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div role="listbox" className="mt-2 max-h-60 space-y-1 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card p-1.5 shadow-sm">
            {options.map(([optionValue, label]) => {
              const selected = value === optionValue;
              return (
                <button
                  key={optionValue}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onValueChange(optionValue);
                    setOpen(false);
                  }}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm transition active:scale-[0.99] ${selected ? "bg-foreground text-background" : "text-foreground hover:bg-muted"}`}
                >
                  <span className="min-w-0 break-words">{label}</span>
                  {selected && <Check className="size-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
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
  const clients = new Map<string, StudioClient>();
  for (const a of appts) {
    if (a.clients?.id) clients.set(a.clients.id, a.clients);
    if (a.staff?.id) professionals.set(a.staff.id, a.staff.name);
    a.appointment_services?.forEach((line) => {
      if (line.staff?.id) professionals.set(line.staff.id, line.staff.name);
      if (line.services?.name) services.add(line.services.name);
    });
    if (a.status) statuses.add(a.status);
  }
  return {
    clients: Array.from(clients.values()).sort((a, b) =>
      normalizeFilterText(a.name).localeCompare(normalizeFilterText(b.name), "pt-PT"),
    ),
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
  paymentFacts: Map<string, AppointmentPaymentFacts>,
  timeZone?: string | null,
) {
  const start = new Date(a.starts_at);
  const now = new Date();
  const facts = paymentFacts.get(a.id);
  const ledger = computeAppointmentLedger(a.id, a.total_price, a.status, facts);
  const svcNames = a.appointment_services?.map((l) => l.services?.name).filter(Boolean) as
    | string[]
    | undefined;
  if (
    filters.dateMode === "today" &&
    getStudioDateKey(start, timeZone) !== getStudioDateKey(now, timeZone)
  )
    return false;
  if (filters.dateMode === "upcoming" && start.getTime() < now.getTime()) return false;
  if (
    filters.dateMode === "specific" &&
    filters.date &&
    getStudioDateKey(start, timeZone) !== filters.date
  )
    return false;
  if (filters.staffId !== "all" && !appointmentIncludesStaff(a, filters.staffId)) return false;
  if (filters.service !== "all" && !svcNames?.includes(filters.service)) return false;
  if (filters.status !== "all" && a.status !== filters.status) return false;
  if (filters.clientId && a.clients?.id !== filters.clientId) return false;
  if (!filters.clientId && filters.client.trim()) {
    const q = normalizeFilterText(filters.client);
    const name = normalizeFilterText(a.clients?.name ?? "");
    if (!name.includes(q) && !clientPhoneMatches(a.clients?.phone, filters.client)) return false;
  }
  if (filters.payment === "online" && ledger.onlineNetCents <= 0) return false;
  if (filters.payment === "studio" && ledger.onsiteNetCents <= 0) return false;
  if (filters.payment === "pending" && ledger.pendingCents <= 0) return false;
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
    !!filters.client.trim() || !!filters.clientId,
    filters.payment !== "all",
    filters.confirmation !== "all",
    filters.attendance !== "all",
  ].filter(Boolean).length;
}

function normalizeFilterText(v: string) {
  return v.trim().replace(/\s+/g, " ").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}
function clientPhoneMatches(phone: string | null | undefined, query: string) {
  const digits = query.replace(/\D/g, "");
  return digits.length >= 2 && String(phone ?? "").replace(/\D/g, "").includes(digits);
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
  return formatStudioDate(value);
}
function formatBlockTime(value: string) {
  return formatStudioTime(value);
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

function validSearchUuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined;
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
function canViewSensitiveAppointment(
  _a: Appt,
  studio: { role: string; staff_id: string | null } | null,
) {
  return Boolean(studio);
}
function appointmentServiceLabel(a: Appt) {
  return (
    [...(a.appointment_services ?? [])]
      .sort(compareAppointmentServiceLines)
      ?.map((s) => s.services?.name)
      .filter(Boolean)
      .join(", ") || "-"
  );
}

function appointmentIncludesStaff(a: Appt, staffId: string | null | undefined) {
  if (!staffId) return false;
  return (
    a.staff?.id === staffId ||
    Boolean(a.appointment_services?.some((line) => line.staff?.id === staffId))
  );
}

function compareAppointmentServiceLines(
  first: NonNullable<Appt["appointment_services"]>[number],
  second: NonNullable<Appt["appointment_services"]>[number],
) {
  const firstPosition = Number(first.position ?? Number.MAX_SAFE_INTEGER);
  const secondPosition = Number(second.position ?? Number.MAX_SAFE_INTEGER);
  if (firstPosition !== secondPosition) return firstPosition - secondPosition;
  return String(first.starts_at ?? "").localeCompare(String(second.starts_at ?? ""));
}

function getAppointmentServiceSegments(a: Appt) {
  return [...(a.appointment_services ?? [])]
    .filter(
      (line) =>
        Boolean(line.staff?.id) &&
        Boolean(line.starts_at) &&
        Boolean(line.ends_at) &&
        new Date(line.ends_at!).getTime() > new Date(line.starts_at!).getTime(),
    )
    .sort(compareAppointmentServiceLines);
}

function appointmentProfessionalLabel(a: Appt) {
  const names = getAppointmentServiceSegments(a)
    .map((line) => line.staff?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return a.staff?.name ?? "Não definido";
  return [...new Set(names)].join(", ");
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
function sortAppointmentsChronologically(items: Appt[], mode: "future" | "history" = "future") {
  return sortAppointmentsChronologicallyShared(items, mode);
}

function formatManualAppointmentError(message?: string) {
  const value = String(message ?? "");
  if (value.includes("appointment_not_editable")) {
    return "Esta marcação já foi concluída, cancelada ou marcada como falta e não pode ser editada. Atualize a agenda.";
  }
  if (value.includes("price_below_recorded_receipts"))
    return "O novo valor é inferior ao já recebido. Corrija ou reembolse o recebimento antes de guardar.";
  if (value.includes("received_reservation_financial_fields_locked"))
    return "Para preservar o pagamento e a comissão já registados, estes campos não podem ser alterados após o recebimento.";
  if (value.includes("appointment_changed_reload"))
    return "O estado desta marcação mudou. Atualize a Agenda antes de editar.";
  if (value.includes("resolved_joint_service_edit_unsupported"))
    return "A edição financeira de serviços conjuntos exige correção individual; aqui pode editar as notas.";
  if (value.includes("settled_multi_service_edit_requires_reconciliation"))
    return "Esta reserva tem vários serviços com recebimentos registados. A alteração exige reconciliação financeira; aqui pode editar as notas.";
  if (value.includes("settled_financial_edit_requires_reconciliation"))
    return "Serviço, profissional e valor estão bloqueados após recebimento. É necessária uma correção financeira explícita.";
  if (value.includes("slot_unavailable")) return "Este horário já não está disponível.";
  if (value.includes("schedule_hard_blocked")) {
    return "O horário contém um bloqueio, folga ou pagamento em processamento.";
  }
  if (value.includes("staff_unavailable"))
    return "A profissional não está disponível neste horário.";
  if (value.includes("staff_service_unavailable")) {
    return "A profissional selecionada não realiza este serviço.";
  }
  if (value.includes("multi_service_edit_not_supported")) {
    return "Marcações com vários serviços devem ser reagendadas sem alterar o serviço aqui.";
  }
  if (value.includes("outside_staff_availability")) {
    return "O horário está fora da disponibilidade da profissional.";
  }
  return value || "Não foi possível guardar a marcação.";
}

function computeAppointmentSplit(
  a: Appt,
  studio: (FinancialRuleSource & { deposit_percent: number; payment_policy: string }) | null,
  payment: AppointmentPaymentFacts | number | null,
) {
  const facts =
    typeof payment === "number"
      ? {
          appointmentId: a.id,
          onlineGrossCents: toCents(payment),
          onsiteGrossCents: 0,
          refundedCents: 0,
          onlineNetCents: toCents(payment),
          onsiteNetCents: 0,
          receivedCents: toCents(payment),
        }
      : payment;
  return computeAppointmentFinancialSplit(a.id, a, studio?.commission_percent ?? 0, facts);
}

function formatPaymentState(a: Appt, paid: number, hasPendingOnlinePayment = false) {
  if (paid > 0) {
    if (a.status === "completed") return "Pago + atendido";
    if (a.status === "no_show") return "Pago (mantido)";
    return "Pago";
  }
  if (a.status === "pending_payment" || hasPendingOnlinePayment) {
    return "Aguardando pagamento online";
  }
  if (a.status === "cancelled" || a.status === "no_show") return "Sem pagamento";
  return "No estudio";
}

function paymentAttribution(appointmentId: string, online: PaidRow[], onsite: CashPaymentRow[], refunds: RefundRow[] = []) {
  const methodLabels: Record<string, string> = {
    mb_way: "MB WAY",
    card: "Cartão",
    cash: "Dinheiro",
    bank_transfer: "Transferência",
    other: "Outro",
    multibanco: "Multibanco",
  };
  const seen = new Set<string>();
  const records = [
    ...online.filter((row) => {
      if (row.appointment_id !== appointmentId || row.status !== "succeeded") return false;
      const paymentRefunds = refunds.filter((refund) =>
        refund.appointment_id === appointmentId && refund.payment_intent_id === row.id,
      );
      return (buildAppointmentPaymentFacts([row], [], paymentRefunds).get(appointmentId)?.onlineNetCents ?? 0) > 0;
    }).map((row) => ({ id: row.id, source: "online", method: row.method })),
    ...onsite.filter((row) => row.appointment_id === appointmentId && row.movement_type === "service_payment" && Number(row.amount) > 0)
      .map((row) => ({ id: row.id, source: "onsite", method: row.payment_method })),
  ];
  const labels = records.filter((row) => {
    const key = row.id ? `${row.source}:${row.id}` : null;
    if (!key || !seen.has(key)) {
      if (key) seen.add(key);
      return true;
    }
    return false;
  }).map((row) => methodLabels[row.method ?? ""] ?? "Não registado");
  return [...new Set(labels)];
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

function undoReceiptErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("confirmed_external_payment_must_be_preserved")) return "Há um pagamento online confirmado. O recebimento real não pode ser anulado por esta ação.";
  if (message.includes("other_real_receipt_must_be_preserved")) return "Há outro recebimento nesta marcação. Revise os valores antes de desfazer.";
  if (message.includes("attendance_correction_requires_loyalty_review")) return "Esta marcação já gerou fidelização ou indicação e precisa de revisão manual.";
  if (message.includes("joint_services_require_individual_resolution")) return "Corrija os serviços conjuntos individualmente.";
  if (message.includes("onsite_receipt_not_found")) return "Não há recebimento manual elegível para anular.";
  return "Não foi possível desfazer o recebimento. Atualize a agenda e tente novamente.";
}

function attendanceResolutionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("attendance_correction_requires_loyalty_review"))
    return "Esta marcação já gerou benefícios de fidelização. Peça uma revisão antes de alterar a presença.";
  if (message.includes("cash_register_not_open"))
    return "Abra o caixa antes de confirmar atendimentos com saldo presencial.";
  if (message.includes("appointment_cancelled")) return "Esta marcação está cancelada.";
    if (message.includes("attendance_already_resolved"))
      return "A presença deste atendimento já foi resolvida.";
    if (message.includes("attendance_changed_reload"))
      return "Este atendimento foi alterado. A agenda foi atualizada.";
  if (message.includes("appointment_not_confirmed"))
    return "Este atendimento já não está aguardando confirmação.";
  if (message.includes("forbidden")) return "Sem permissão para resolver este atendimento.";
  return "Não foi possível atualizar a presença. Atualize a Agenda e tente novamente.";
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
