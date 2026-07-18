import { createFileRoute } from "@tanstack/react-router";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import {
  CalendarCheck,
  CalendarDays,
  CalendarOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { getSegmentConfig } from "@/lib/segments";
import { supabase } from "@/integrations/supabase/client";
import { normalizeStaffStatus } from "@/data/studio";
import { updateStaffPresenceStatus } from "@/lib/staff-presence.functions";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import { PremiumTimeSelect } from "@/components/ui/premium-time-select";
import { ExpandableList } from "@/components/ui/expandable-list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/horarios")({
  component: HoursPage,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS       = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS_PT      = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab        = "agenda" | "bloqueios" | "regras";
type StaffStatus = "online" | "busy" | "absent";
type RawStaffStatus = StaffStatus | "available";
type Staff       = { id: string; name: string; current_status: StaffStatus };
type Slot        = { id: string; staff_id: string; weekday: number; start_time: string; end_time: string };
type TimeOff     = { id: string; staff_id: string; starts_at: string; ends_at: string; reason: string | null };

const LEGACY_STATUS_OPTIONS = [
  {
    value: "online",
    label: "Agenda disponível",
    desc: "Aceitando agendamentos e horários disponíveis.",
    detail: "Este modo indica que a agenda está disponível. Os clientes poderão consultar horários livres e receber notificações se seguirem o estúdio.",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "busy",
    label: "Agenda disponivel",
    desc: "Em atendimento no momento.",
    detail: "Você está em atendimento. Apenas horários futuros continuarão disponíveis.",
    dot: "bg-zinc-950 dark:bg-zinc-200",
    text: "text-zinc-700 dark:text-zinc-300",
  },
  {
    value: "absent",
    label: "Folga/Férias",
    desc: "Agenda suspensa temporariamente.",
    detail: "Profissional em folga ou férias. Enquanto este estado estiver ativo, a agenda cadastrada fica suspensa e nenhuma nova marcação ou encaixe pode ser realizado.",
    dot: "bg-zinc-300 dark:bg-zinc-600",
    text: "text-amber-700 dark:text-amber-300",
  },
];

const STATUS_OPTIONS: { value: Exclude<StaffStatus, "busy">; label: string; desc: string; icon: "available" | "away"; tone: "emerald" | "amber"; detail?: string; dot?: string; text?: string }[] = [
  {
    value: "online",
    label: "Agenda disponível",
    desc: "Ativa",
    icon: "available",
    tone: "emerald",
  },
  {
    value: "absent",
    label: "Folga/Férias",
    desc: "Pausada",
    icon: "away",
    tone: "amber",
  },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

function HoursPage() {
  const { studio }  = useCurrentStudio();
  const labels      = getSegmentConfig(studio?.business_segment).labels;

  const [staff,      setStaff]      = useState<Staff[]>([]);
  const [slots,      setSlots]      = useState<Slot[]>([]);
  const [timeOff,    setTimeOff]    = useState<TimeOff[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [staffId,    setStaffId]    = useState("");
  const [minBookingNoticeMin, setMinBookingNoticeMin] = useState(30);

  // UI state
  const [activeTab,      setActiveTab]      = useState<Tab>("agenda");
  const [expandedDays,   setExpandedDays]   = useState<Set<number>>(new Set());
  const [blockModalOpen, setBlockModalOpen] = useState(false);

  // Reset expanded days when staff changes
  useEffect(() => { setExpandedDays(new Set()); }, [staffId]);

  // ── Data loading ─────────────────────────────────────────────────────────

  async function load() {
    if (!studio) return;
    const ownStaffId = studio.role === "staff" ? studio.staff_id : null;
    const [{ data: st }, { data: av }, { data: to }] = await Promise.all([
      supabase.from("staff").select("id,name,current_status").eq("studio_id", studio.id).eq("is_active", true).match(ownStaffId ? { id: ownStaffId } : {}).order("name"),
      supabase.from("staff_availability").select("*").eq("studio_id", studio.id).match(ownStaffId ? { staff_id: ownStaffId } : {}),
      supabase.from("staff_time_off").select("*").eq("studio_id", studio.id).match(ownStaffId ? { staff_id: ownStaffId } : {}).order("starts_at", { ascending: false }),
    ]);
    setStaff(
      (st ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        current_status: normalizeStaffStatus((s.current_status ?? "online") as RawStaffStatus),
      })),
    );
    setSlots((av ?? []) as Slot[]);
    setTimeOff((to ?? []) as TimeOff[]);
    if (st && st.length && (!staffId || ownStaffId)) setStaffId(st[0].id);
    setLoading(false);
  }

  useEffect(() => {
    if (studio) setMinBookingNoticeMin(studio.min_booking_notice_min ?? 30);
    void load();
  }, [studio]);

  // ── Mutations ────────────────────────────────────────────────────────────

  async function saveMinBookingNotice(value: number) {
    if (!studio) return;
    const normalized = Math.max(0, Math.min(10080, value));
    setMinBookingNoticeMin(normalized);
    const { error } = await supabase.from("studios").update({ min_booking_notice_min: normalized }).eq("id", studio.id);
    if (error) return toast.error(error.message);
    toast.success("Antecedência mínima guardada");
  }

  async function addSlot(weekday: number) {
    if (!studio || !staffId) return;
    const { error } = await supabase.from("staff_availability").insert({
      studio_id: studio.id, staff_id: staffId, weekday, start_time: "09:00", end_time: "18:00",
    });
    if (error) return toast.error(error.message);
    setExpandedDays(prev => new Set([...prev, weekday]));
    void load();
  }

  async function updateSlot(id: string, field: "start_time" | "end_time", value: string) {
    const patch = field === "start_time" ? { start_time: value } : { end_time: value };
    const { error } = await supabase.from("staff_availability").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setSlots(slots.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  async function removeSlot(id: string) {
    const { error } = await supabase.from("staff_availability").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }

  async function addTimeOff(starts: string, ends: string, reason: string) {
    if (!studio || !staffId) return;
    const { error } = await supabase.from("staff_time_off").insert({
      studio_id: studio.id, staff_id: staffId, starts_at: starts, ends_at: ends, reason: reason || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Bloqueio adicionado");
    void load();
  }

  async function removeTimeOff(id: string) {
    const { error } = await supabase.from("staff_time_off").delete().eq("id", id);
    if (error) return toast.error(error.message);
    void load();
  }

  async function saveStatus(newStatus: StaffStatus) {
    if (!staffId) return;
    // Optimistic update
    setStaff((prev) =>
      prev.map((s) => (s.id === staffId ? { ...s, current_status: newStatus } : s)),
    );
    try {
      const result = await updateStaffPresenceStatus({ data: { staffId, status: newStatus } });
      if (newStatus === "online") {
        if (result.notification?.sent) {
          toast.success("Agenda disponível. Seguidores com notificações ativas foram avisados.");
        } else if (result.notification?.skipped === "cooldown") {
          toast.success("Agenda disponível. Notificação recente evitada para não incomodar clientes.");
        } else {
          toast.success("Agenda disponível.");
        }
      } else {
        toast.success("Status atualizado.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o status.");
      void load(); // revert on failure
    }
  }

  // ── Loading + empty states ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
    );
  }

  if (staff.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center shadow-sm">
        <p className="text-sm font-medium">Ainda não existem {labels.professionalPlural} ativos.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Adicione {labels.professionalPlural} antes de configurar horários.
        </p>
      </div>
    );
  }

  // ── Derived ──────────────────────────────────────────────────────────────

  const selectedStaff  = staff.find((s) => s.id === staffId);
  const visibleTabs = (studio!.role === "staff" ? ["agenda", "bloqueios"] : ["agenda", "bloqueios", "regras"]) as Tab[];
  const selectedStatus = selectedStaff?.current_status ?? "online";
  const visibleStatus = selectedStatus === "absent" ? "absent" : "online";
  const isStaffOnDayOff = selectedStatus === "absent";
  const selectedStatusCopy = STATUS_OPTIONS.find((opt) => opt.value === visibleStatus) ?? STATUS_OPTIONS[0]!;
  const slotsByDay     = (weekday: number) => slots.filter((s) => s.staff_id === staffId && s.weekday === weekday);
  const staffTimeOff   = timeOff.filter((t) => t.staff_id === staffId);

  const activeDays = WEEKDAYS.filter((_, i) => slotsByDay(i).length > 0).length;
  const totalMinutes = slots
    .filter((s) => s.staff_id === staffId)
    .reduce((sum, s) => {
      const [sh = 0, sm = 0] = s.start_time.split(":").map(Number);
      const [eh = 0, em = 0] = s.end_time.split(":").map(Number);
      return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
    }, 0);
  const hoursLabel     = totalMinutes === 0 ? "0h" : `${(totalMinutes / 60).toFixed(1).replace(".0", "")}h`;
  const upcomingBlocks = staffTimeOff.filter((t) => new Date(t.ends_at) >= new Date()).length;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-4 pb-6 lg:space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
        <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)] lg:items-start lg:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Disponibilidade
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              Horários e disponibilidade
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Defina a semana de trabalho, bloqueios e pausas sem perder clareza no dia a dia.
            </p>
          </div>

          {/* Staff selector — only if multiple */}
          <div className="min-w-0 lg:justify-self-end">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Profissional
            </p>
          {staff.length > 1 ? (
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger className="h-11 w-full rounded-xl border-border/70 bg-background/65 px-3 text-sm shadow-none focus:ring-2 focus:ring-ring lg:w-[22rem]">
                <SelectValue placeholder={`Selecionar ${labels.professional}`} />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="rounded-xl px-3 py-2 text-sm">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="inline-flex h-11 w-full items-center gap-2 rounded-xl border border-border/70 bg-background/65 px-3 text-sm font-medium text-foreground lg:w-[22rem]">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{selectedStaff?.name}</span>
            </div>
          )}
          </div>
        </div>

        {/* ── Status selector ────────────────────────────────────────────── */}
        {selectedStaff && (
          <div className="border-t border-border/50 bg-muted/10 px-4 py-3 sm:px-5 lg:px-6">
            {/* Header row — wraps on very narrow screens */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Estado da agenda
              </p>
              <span className="rounded-full bg-background/65 px-2.5 py-1 text-[11px] font-medium text-muted-foreground ring-1 ring-border/50">
                {selectedStatusCopy.label}
              </span>
            </div>
            {/* 1 col on 320–429 px, 2 cols on 430–639 px, 4 cols on 640 px+ */}
            <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-background/45 p-1.5">
              {STATUS_OPTIONS.map((opt) => {
                const isCurrent = visibleStatus === opt.value;
                const Icon = opt.icon === "available" ? CalendarCheck : CalendarOff;
                const iconClass =
                  opt.tone === "emerald"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300";
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => void saveStatus(opt.value)}
                    className={[
                      "flex min-h-11 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-all duration-200 active:scale-[0.99] sm:min-h-12 sm:px-3",
                      isCurrent
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    ].join(" ")}
                  >
                    {/* Dot — vertically centered with the label */}
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${isCurrent ? "bg-background/15 text-background" : iconClass}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold leading-tight">{opt.label}</span>
                      <span className={`mt-0.5 block text-xs leading-tight ${isCurrent ? "text-background/75" : "text-muted-foreground"}`}>{opt.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {/* ── Summary bar ────────────────────────────────────────────────── */}
      {isStaffOnDayOff && (
        <div className="rounded-2xl border border-amber-500/15 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:text-amber-200 lg:px-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">Em folga</p>
            <p className="text-xs leading-relaxed text-amber-800/80 dark:text-amber-100/80">
              Os horários configurados ficam suspensos e não serão exibidos para novas marcações.
            </p>
          </div>
        </div>
      )}

      <SummaryBar activeDays={activeDays} hoursLabel={hoursLabel} upcomingBlocks={upcomingBlocks} />

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border/60 bg-card/70 p-1.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] lg:mx-auto lg:w-full lg:max-w-2xl">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`relative h-10 rounded-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === tab
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              {tab === "agenda" ? "Agenda" : tab === "bloqueios" ? "Bloqueios" : "Regras"}
            </button>
          ))}
        </div>
      </div>

      {/* ══ TAB: Agenda ═══════════════════════════════════════════════════ */}
      {activeTab === "agenda" && (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/75 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between border-b border-border/50 bg-muted/10 px-4 py-3 lg:px-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Semana de
              </p>
              <p className="text-sm font-semibold">{selectedStaff?.name}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {activeDays} {activeDays === 1 ? "dia ativo" : "dias ativos"}
            </p>
          </div>

          <div className="divide-y divide-border/50 md:hidden">
            {WEEKDAYS.map((label, weekday) => (
              <DayRow
                key={weekday}
                weekday={weekday}
                label={label}
                labelShort={WEEKDAYS_SHORT[weekday]!}
                slots={slotsByDay(weekday)}
                isDayOff={isStaffOnDayOff}
                isExpanded={expandedDays.has(weekday)}
                onToggle={() =>
                  setExpandedDays((prev) => {
                    const next = new Set(prev);
                    if (next.has(weekday)) next.delete(weekday);
                    else next.add(weekday);
                    return next;
                  })
                }
                onAddSlot={() => addSlot(weekday)}
                onUpdateSlot={updateSlot}
                onRemoveSlot={removeSlot}
              />
            ))}
          </div>
          <div className="hidden gap-2.5 p-3 md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 lg:gap-3 lg:p-4">
            {WEEKDAYS.map((label, weekday) => (
              <DayColumn
                key={weekday}
                weekday={weekday}
                label={label}
                labelShort={WEEKDAYS_SHORT[weekday]!}
                slots={slotsByDay(weekday)}
                isDayOff={isStaffOnDayOff}
                onAddSlot={() => addSlot(weekday)}
                onUpdateSlot={updateSlot}
                onRemoveSlot={removeSlot}
              />
            ))}
          </div>
        </div>
      )}

      {/* ══ TAB: Bloqueios ════════════════════════════════════════════════ */}
      {activeTab === "bloqueios" && (
        <div className="space-y-3">
          {/* Section header + CTA */}
          <div className="grid gap-3 rounded-2xl border border-border/60 bg-card/75 px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center lg:px-5">
            <div>
              <p className="text-sm font-semibold">Bloqueios e folgas</p>
              <p className="text-xs text-muted-foreground">
                {selectedStaff?.name} · {upcomingBlocks} ativo{upcomingBlocks !== 1 ? "s" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBlockModalOpen(true)}
              className="bellza-panel-action bellza-panel-action-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Novo bloqueio</span>
            </button>
          </div>

          {/* Mini calendar */}
          <BlockCalendar timeOff={staffTimeOff} />

          {/* Block list */}
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/75 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
            <div className="border-b border-border/50 bg-muted/10 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Todos os bloqueios
              </p>
            </div>

            {staffTimeOff.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <div className="mb-3 grid size-10 place-items-center rounded-2xl bg-muted">
                  <CalendarOff className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Sem bloqueios</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Não há indisponibilidades para {selectedStaff?.name}.
                </p>
              </div>
            ) : (
              <ExpandableList
                items={staffTimeOff}
                initialCount={5}
                className="divide-y divide-border/50"
                getKey={(t) => t.id}
                moreLabel={(hidden) => `Ver mais ${hidden} bloqueio${hidden !== 1 ? "s" : ""}`}
                renderItem={(t) => {
                  const isPast = new Date(t.ends_at) < new Date();
                  return (
                    <div
                      className={`flex items-center gap-3 px-4 py-3 transition-colors ${isPast ? "opacity-50" : "hover:bg-muted/20"}`}
                    >
                      <div
                        className={`shrink-0 grid size-8 place-items-center rounded-xl ${
                          isPast ? "bg-muted" : "bg-amber-500/10"
                        }`}
                      >
                        <CalendarOff
                          className={`h-3.5 w-3.5 ${
                            isPast ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"
                          }`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight">
                          {fmtDateTime(t.starts_at)} → {fmtDateTime(t.ends_at)}
                        </p>
                        {t.reason && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.reason}</p>
                        )}
                        {isPast && (
                          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                            Passado
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTimeOff(t.id)}
                        aria-label="Remover bloqueio"
                        className="grid size-8 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: Regras ═══════════════════════════════════════════════════ */}
      {activeTab === "regras" && (
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/75 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-3 border-b border-border/50 bg-muted/10 px-4 py-3">
            <div className="grid size-8 place-items-center rounded-xl bg-muted">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold">Antecedência mínima</p>
              <p className="text-xs text-muted-foreground">
                Tempo mínimo antes de aceitar novas marcações
              </p>
            </div>
          </div>

          <div className="px-4 py-4 space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
              <Select
                value={isPresetNotice(minBookingNoticeMin) ? String(minBookingNoticeMin) : "custom"}
                onValueChange={(value) => {
                  if (value !== "custom") void saveMinBookingNotice(Number(value));
                }}
              >
                <SelectTrigger className="h-10 rounded-xl border-border bg-background/70 px-3 text-sm shadow-none focus:ring-2 focus:ring-foreground/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
                  <SelectItem value="30"    className="rounded-xl px-3 py-2">30 minutos</SelectItem>
                  <SelectItem value="60"    className="rounded-xl px-3 py-2">1 hora</SelectItem>
                  <SelectItem value="120"   className="rounded-xl px-3 py-2">2 horas</SelectItem>
                  <SelectItem value="custom" className="rounded-xl px-3 py-2">Personalizado</SelectItem>
                </SelectContent>
              </Select>

              <label className="inline-flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2">
                <input
                  type="number"
                  min={0}
                  max={10080}
                  step={5}
                  value={minBookingNoticeMin}
                  onChange={(e) => setMinBookingNoticeMin(Number(e.target.value))}
                  onBlur={(e)   => void saveMinBookingNotice(Number(e.target.value))}
                  className="h-7 w-16 bg-transparent text-sm tabular-nums outline-none"
                />
                <span className="text-xs text-muted-foreground">min</span>
              </label>
            </div>

            <div className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Atualmente:{" "}
              <span className="font-semibold text-foreground">{formatNotice(minBookingNoticeMin)}</span>{" "}
              de antecedência obrigatória para novas marcações online.
            </div>
          </div>
        </div>
      )}

      {/* ── Block Modal ───────────────────────────────────────────────── */}
      {blockModalOpen && (
        <BlockModal
          staffName={selectedStaff?.name ?? ""}
          onClose={() => setBlockModalOpen(false)}
          onAdd={async (starts, ends, reason) => {
            await addTimeOff(starts, ends, reason);
            setBlockModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ─── Summary Chip ─────────────────────────────────────────────────────────────

function SummaryBar({
  activeDays,
  hoursLabel,
  upcomingBlocks,
}: {
  activeDays: number;
  hoursLabel: string;
  upcomingBlocks: number;
}) {
  const items = [
    {
      icon: <CalendarDays className="h-4 w-4" />,
      label: "Dias ativos",
      value: `${activeDays}/7`,
      tone: activeDays > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
    },
    {
      icon: <Clock className="h-4 w-4" />,
      label: "Horas semanais",
      value: hoursLabel,
      tone: "text-blue-700 dark:text-blue-400",
    },
    {
      icon: <CalendarOff className="h-4 w-4" />,
      label: "Bloqueios",
      value: String(upcomingBlocks),
      tone: upcomingBlocks > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
    },
  ];

  return (
    <div className="grid gap-1.5 rounded-2xl border border-border/60 bg-card/75 p-1.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2">
          <span className={`grid size-8 shrink-0 place-items-center rounded-lg bg-muted/55 ${item.tone}`}>
            {item.icon}
          </span>
          <div className="min-w-0">
            <p className="text-lg font-semibold tabular-nums leading-none text-foreground">{item.value}</p>
            <p className="mt-1 truncate text-xs font-medium leading-tight text-muted-foreground">{item.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Day Row ──────────────────────────────────────────────────────────────────

function DayColumn({
  weekday, label, labelShort, slots, isDayOff, onAddSlot, onUpdateSlot, onRemoveSlot,
}: {
  weekday: number; label: string; labelShort: string; slots: Slot[];
  isDayOff: boolean;
  onAddSlot:   () => void;
  onUpdateSlot: (id: string, field: "start_time" | "end_time", value: string) => void;
  onRemoveSlot: (id: string) => void;
}) {
  const hasSlots = slots.length > 0;
  const isToday = new Date().getDay() === weekday;

  return (
    <div className={`group flex min-h-[12.5rem] flex-col rounded-2xl border px-2.5 py-2.5 transition-colors ${
      isDayOff
        ? "border-amber-500/20 bg-amber-500/[0.06]"
        : isToday
          ? "border-primary/35 bg-primary/[0.05]"
          : hasSlots
            ? "border-border/60 bg-background/45"
            : "border-dashed border-border/45 bg-muted/10"
    }`}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{labelShort}</p>
          <p className="truncate text-sm font-semibold text-foreground">{isToday ? `Hoje · ${label}` : label}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
          isDayOff
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
            : hasSlots
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
        }`}>
          {isDayOff ? "Folga" : hasSlots ? "Ativo" : "Inativo"}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {slots.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-xl bg-background/25 px-2 text-center text-sm text-muted-foreground">
            {isDayOff ? "Folga ativa" : "Sem atendimento"}
          </div>
        ) : (
          slots.map((slot) => (
            <div key={slot.id} className="rounded-xl bg-card/70 p-2 ring-1 ring-border/50">
              <p className="mb-2 truncate text-sm font-semibold tabular-nums text-foreground">
                {slot.start_time.slice(0, 5)} — {slot.end_time.slice(0, 5)}
              </p>
              <div className="grid gap-1.5">
                <TimeInput
                  label="Início"
                  value={slot.start_time.slice(0, 5)}
                  onChange={(value) => onUpdateSlot(slot.id, "start_time", value)}
                />
                <TimeInput
                  label="Fim"
                  value={slot.end_time.slice(0, 5)}
                  onChange={(value) => onUpdateSlot(slot.id, "end_time", value)}
                />
              </div>
              <button
                type="button"
                onClick={() => onRemoveSlot(slot.id)}
                className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-semibold text-muted-foreground opacity-80 transition hover:bg-red-500/10 hover:text-red-600 hover:opacity-100 focus-visible:bg-red-500/10 focus-visible:text-red-600 focus-visible:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remover
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={onAddSlot}
        className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/55 px-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-background/70 hover:text-foreground focus-visible:border-primary/40 focus-visible:bg-background/70 focus-visible:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Adicionar
      </button>
    </div>
  );
}

function DayRow({
  weekday, label, labelShort, slots, isDayOff, isExpanded,
  onToggle, onAddSlot, onUpdateSlot, onRemoveSlot,
}: {
  weekday: number; label: string; labelShort: string; slots: Slot[];
  isDayOff: boolean;
  isExpanded: boolean;
  onToggle:    () => void;
  onAddSlot:   () => void;
  onUpdateSlot: (id: string, field: "start_time" | "end_time", value: string) => void;
  onRemoveSlot: (id: string) => void;
}) {
  const hasSlots = slots.length > 0;
  const summary  = hasSlots
    ? slots.map((s) => `${s.start_time.slice(0, 5)} — ${s.end_time.slice(0, 5)}`).join(", ")
    : null;

  return (
    <div>
      {/* Collapsed row header — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => e.key === "Enter" && onToggle()}
        className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/25 ${
          isDayOff ? "bg-amber-500/[0.06]" : hasSlots ? "" : "bg-muted/10"
        }`}
      >
        {/* Day badge */}
        <div
          className={`grid h-9 w-11 shrink-0 place-items-center rounded-xl text-center text-[11px] font-semibold leading-none ${
            isDayOff
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : hasSlots
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {labelShort}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-foreground">{label}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {isDayOff ? "Em folga · horários suspensos" : summary ?? "Sem atendimento"}
          </p>
        </div>

        {/* Slot count */}
        {(hasSlots || isDayOff) && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            isDayOff
              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          }`}>
            {isDayOff ? "Folga" : `${slots.length} ${slots.length === 1 ? "turno" : "turnos"}`}
          </span>
        )}

        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-250 ${
            isExpanded ? "rotate-180" : ""
          }`}
        />
      </div>

      {/* Expandable body — CSS-grid smooth animation */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: isExpanded ? "1fr" : "0fr",
          transition: "grid-template-rows 250ms cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        <div className="overflow-hidden">
          <div className="space-y-2 border-t border-border/40 bg-muted/20 px-4 py-3">
            <ExpandableList
              items={slots}
              initialCount={4}
              className="space-y-2"
              getKey={(slot) => slot.id}
              moreLabel={(hidden) => `Ver mais ${hidden} turno${hidden !== 1 ? "s" : ""}`}
              renderItem={(s) => (
              <div className="flex items-end gap-2">
                <TimeInput
                  label="Início"
                  value={s.start_time.slice(0, 5)}
                  onChange={(v) => onUpdateSlot(s.id, "start_time", v)}
                />
                <span className="mb-2.5 shrink-0 text-xs text-muted-foreground">—</span>
                <TimeInput
                  label="Fim"
                  value={s.end_time.slice(0, 5)}
                  onChange={(v) => onUpdateSlot(s.id, "end_time", v)}
                />
                <button
                  type="button"
                  onClick={() => onRemoveSlot(s.id)}
                  aria-label="Remover turno"
                  className="mb-0 grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-red-500/10 hover:text-red-600 focus-visible:bg-red-500/10 focus-visible:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              )}
            />

            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onAddSlot(); }}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:bg-background/70 hover:text-foreground focus-visible:border-primary/40 focus-visible:bg-background/70 focus-visible:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar turno
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Block Modal ──────────────────────────────────────────────────────────────

function BlockModal({
  staffName, onClose, onAdd,
}: {
  staffName: string;
  onClose: () => void;
  onAdd:   (starts: string, ends: string, reason: string) => Promise<void>;
}) {
  const [starts, setStarts] = useState("");
  const [ends,   setEnds]   = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!starts || !ends) { toast.error("Preencha as datas de início e fim."); return; }
    if (new Date(ends) <= new Date(starts)) { toast.error("A data de fim deve ser posterior ao início."); return; }
    setSaving(true);
    try { await onAdd(new Date(starts).toISOString(), new Date(ends).toISOString(), reason); }
    finally { setSaving(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center">
      <div className="relative w-full max-w-lg overflow-hidden rounded-t-[1.5rem] border border-border bg-card shadow-2xl md:rounded-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Novo bloqueio
            </p>
            <p className="text-sm font-semibold">{staffName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 place-items-center rounded-xl border border-border bg-background/70 text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <DateTimeField label="Início do bloqueio" value={starts} onChange={setStarts} />
          <DateTimeField label="Fim do bloqueio"    value={ends}   onChange={setEnds}   />
          <Field label="Motivo (opcional)">
            <input
              placeholder="Férias, formação, feriado..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-foreground/8"
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-border text-sm font-semibold text-muted-foreground transition hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !starts || !ends}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <><span className="h-4 w-4 animate-spin rounded-full border-2 border-background/30 border-t-background" />A guardar...</>
            ) : (
              "Adicionar bloqueio"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Block Calendar ───────────────────────────────────────────────────────────

function BlockCalendar({ timeOff }: { timeOff: TimeOff[] }) {
  const today = new Date();
  const [calYear,  setCalYear]  = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  // Week starts Monday: offset from Mon=0
  const startOffset = (new Date(calYear, calMonth, 1).getDay() + 6) % 7;

  function isBlocked(day: number): boolean {
    const dayStart = new Date(calYear, calMonth, day).getTime();
    const dayEnd   = dayStart + 86400000 - 1;
    return timeOff.some((t) => {
      const ts = new Date(t.starts_at).getTime();
      const te = new Date(t.ends_at).getTime();
      return ts <= dayEnd && te >= dayStart;
    });
  }

  function isToday(day: number) {
    return calYear === today.getFullYear() && calMonth === today.getMonth() && day === today.getDate();
  }

  function prev() {
    if (calMonth === 0) { setCalYear((y) => y - 1); setCalMonth(11); }
    else setCalMonth((m) => m - 1);
  }
  function next() {
    if (calMonth === 11) { setCalYear((y) => y + 1); setCalMonth(0); }
    else setCalMonth((m) => m + 1);
  }

  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/75 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      {/* Calendar nav */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/10 px-4 py-3">
        <p className="text-sm font-semibold">
          {MONTHS_PT[calMonth]} {calYear}
        </p>
        <div className="flex gap-1">
          <button type="button" onClick={prev} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={next} className="grid size-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday headers — Mon-first */}
      <div className="grid grid-cols-7 border-b border-border/40">
        {["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"].map((d) => (
          <div key={d} className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-0.5 p-2">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const blocked = isBlocked(day);
          const todayMark = isToday(day);
          return (
            <div
              key={i}
              className={`flex aspect-square items-center justify-center rounded-lg text-xs font-medium
                ${blocked  ? "bg-amber-500/15 text-amber-700 font-semibold ring-1 ring-amber-400/20 dark:text-amber-400" : ""}
                ${todayMark && !blocked ? "bg-foreground text-background font-semibold" : ""}
                ${!blocked && !todayMark ? "text-foreground hover:bg-muted" : ""}
              `}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 border-t border-border/40 px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-2.5 rounded-sm bg-amber-500/30" />
          Bloqueado
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="size-2.5 rounded-sm bg-foreground" />
          Hoje
        </span>
      </div>
    </div>
  );
}

// ─── Time Input ───────────────────────────────────────────────────────────────

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <PremiumTimeSelect value={value} onChange={onChange} className="h-9 rounded-xl" />
    </label>
  );
}

// ─── DateTimeField ────────────────────────────────────────────────────────────

function DateTimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const time = value ? value.slice(11, 16) : "09:00";
  const date = value ? new Date(value) : undefined;

  return (
    <Field label={label}>
      <div className="grid gap-2 sm:grid-cols-[1fr_6.5rem]">
        <PremiumDatePicker
          value={value ? value.slice(0, 10) : ""}
          onChange={(selectedDate) => {
            if (!selectedDate) return;
            onChange(mergeDateAndTime(new Date(`${selectedDate}T12:00:00`), time));
          }}
          placeholder="Escolher data"
          className="h-10 rounded-xl px-3 shadow-none bg-background/70 border-border"
          allowClear={false}
        />
        <PremiumTimeSelect
          value={time}
          onChange={(nextTime) => {
            const base = date ?? new Date();
            onChange(mergeDateAndTime(base, nextTime));
          }}
          className="h-10 rounded-xl"
        />
      </div>
    </Field>
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isPresetNotice(v: number) { return v === 30 || v === 60 || v === 120; }

function formatNotice(min: number): string {
  if (min < 60) return `${min} minutos`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-PT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function mergeDateAndTime(date: Date, time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  const next = new Date(date);
  next.setHours(Number(hours), Number(minutes), 0, 0);
  const yyyy = next.getFullYear();
  const mm   = String(next.getMonth() + 1).padStart(2, "0");
  const dd   = String(next.getDate()).padStart(2, "0");
  const hh   = String(next.getHours()).padStart(2, "0");
  const min  = String(next.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
