import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  CalendarOff,
  Clock,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { getSegmentConfig } from "@/lib/segments";
import { supabase } from "@/integrations/supabase/client";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
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

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

type Staff = { id: string; name: string };
type Slot = { id: string; staff_id: string; weekday: number; start_time: string; end_time: string };
type TimeOff = {
  id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
};

function HoursPage() {
  const { studio } = useCurrentStudio();
  const labels = getSegmentConfig(studio?.business_segment).labels;
  const [staff, setStaff] = useState<Staff[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [staffId, setStaffId] = useState<string>("");
  const [minBookingNoticeMin, setMinBookingNoticeMin] = useState(30);

  async function load() {
    if (!studio) return;
    const [{ data: st }, { data: av }, { data: to }] = await Promise.all([
      supabase
        .from("staff")
        .select("id,name")
        .eq("studio_id", studio.id)
        .eq("is_active", true)
        .order("name"),
      supabase.from("staff_availability").select("*").eq("studio_id", studio.id),
      supabase
        .from("staff_time_off")
        .select("*")
        .eq("studio_id", studio.id)
        .order("starts_at", { ascending: false }),
    ]);
    setStaff((st ?? []) as Staff[]);
    setSlots((av ?? []) as Slot[]);
    setTimeOff((to ?? []) as TimeOff[]);
    if (st && st.length && !staffId) setStaffId(st[0].id);
    setLoading(false);
  }

  useEffect(() => {
    if (studio) setMinBookingNoticeMin(studio.min_booking_notice_min ?? 30);
    void load();
  }, [studio]);

  async function saveMinBookingNotice(value: number) {
    if (!studio) return;
    const normalized = Math.max(0, Math.min(10080, value));
    setMinBookingNoticeMin(normalized);
    const { error } = await supabase
      .from("studios")
      .update({ min_booking_notice_min: normalized })
      .eq("id", studio.id);
    if (error) return toast.error(error.message);
    toast.success("Antecedência mínima guardada");
  }

  async function addSlot(weekday: number) {
    if (!studio || !staffId) return;
    const { error } = await supabase.from("staff_availability").insert({
      studio_id: studio.id,
      staff_id: staffId,
      weekday,
      start_time: "09:00",
      end_time: "18:00",
    });
    if (error) return toast.error(error.message);
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
      studio_id: studio.id,
      staff_id: staffId,
      starts_at: starts,
      ends_at: ends,
      reason: reason || null,
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

  if (loading) return <p className="text-sm text-muted-foreground">A carregar horários...</p>;

  if (staff.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center shadow-sm">
        <p className="text-sm font-medium">
          Ainda não existem {labels.professionalPlural} ativos.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Adicione {labels.professionalPlural} antes de configurar horários.
        </p>
      </div>
    );
  }

  const selectedStaff = staff.find((s) => s.id === staffId);
  const slotsByDay = (weekday: number) =>
    slots.filter((s) => s.staff_id === staffId && s.weekday === weekday);
  const staffTimeOff = timeOff.filter((t) => t.staff_id === staffId);

  return (
    <div className="max-w-full space-y-6 overflow-x-hidden">
      <header className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Horários e bloqueios
        </p>
        <h1 className="mt-2 text-3xl font-light tracking-tight">Disponibilidade</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Defina a agenda semanal de cada {labels.professional} e bloqueie períodos de folga, férias ou
          indisponibilidade.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <UserRound className="h-4 w-4" />
              <p className="text-[10px] uppercase tracking-[0.2em]">
                {labels.professional}
              </p>
            </div>
            <label className="mt-2 block text-sm font-medium" htmlFor="staff-hours">
              Escolha quem pretende configurar
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Os horários abaixo serão aplicados apenas ao perfil selecionado.
            </p>
          </div>
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger
              id="staff-hours"
              className="h-12 w-full rounded-2xl border-border bg-background/80 px-4 pr-3 text-sm shadow-sm transition focus:ring-2 focus:ring-ring/20 md:w-72 [&>svg]:ml-3 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-60"
            >
              <SelectValue placeholder={`Selecionar ${labels.professional}`} />
            </SelectTrigger>
            <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
              {staff.map((s) => (
                <SelectItem
                  key={s.id}
                  value={s.id}
                  className="rounded-xl px-3 py-2.5 text-sm focus:bg-muted"
                >
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              <p className="text-[10px] uppercase tracking-[0.2em]">Regras de marcação</p>
            </div>
            <h3 className="mt-1 text-base font-medium">Antecedência mínima</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Bloqueia marcações em cima da hora e mostra apenas horários com tempo real para
              preparação de {labels.professional}.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <Select
              value={isPresetNotice(minBookingNoticeMin) ? String(minBookingNoticeMin) : "custom"}
              onValueChange={(value) => {
                if (value === "custom") return;
                void saveMinBookingNotice(Number(value));
              }}
            >
              <SelectTrigger className="h-12 rounded-2xl border-border bg-background/80 px-4 pr-3 text-sm shadow-sm transition focus:ring-2 focus:ring-ring/20 [&>svg]:ml-3 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
                <SelectItem value="30" className="rounded-xl px-3 py-2.5">
                  30 minutos
                </SelectItem>
                <SelectItem value="60" className="rounded-xl px-3 py-2.5">
                  1 hora
                </SelectItem>
                <SelectItem value="120" className="rounded-xl px-3 py-2.5">
                  2 horas
                </SelectItem>
                <SelectItem value="custom" className="rounded-xl px-3 py-2.5">
                  Personalizado
                </SelectItem>
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
              <input
                type="number"
                min={0}
                max={10080}
                step={5}
                value={minBookingNoticeMin}
                onChange={(event) => setMinBookingNoticeMin(Number(event.target.value))}
                onBlur={(event) => void saveMinBookingNotice(Number(event.target.value))}
                className="h-7 w-20 bg-transparent text-sm outline-none"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </label>
          </div>
        </div>
      </section>

      <section className="max-w-full overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4" />
              <p className="text-[10px] uppercase tracking-[0.2em]">Agenda semanal</p>
            </div>
            <h3 className="mt-1 text-base font-medium">Semana de {selectedStaff?.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Adicione um ou mais turnos por dia. Dias sem turnos aparecem como fechados.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {WEEKDAYS.map((label, weekday) => {
            const daySlots = slotsByDay(weekday);
            return (
              <div
                key={weekday}
                className="max-w-full overflow-hidden rounded-[1.25rem] border border-border bg-background/65 p-3 md:rounded-2xl md:p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">
                      {daySlots.length === 0
                        ? "Sem atendimento configurado."
                        : `${daySlots.length} turno${daySlots.length > 1 ? "s" : ""} ativo${daySlots.length > 1 ? "s" : ""}.`}
                    </p>
                  </div>
                  <button
                    onClick={() => addSlot(weekday)}
                    className="flex shrink-0 items-center gap-1 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar
                  </button>
                </div>

                {daySlots.length > 0 && (
                  <div className="mt-4 grid min-w-0 gap-2">
                    {daySlots.map((s) => (
                      <div
                        key={s.id}
                        className="grid min-w-0 max-w-full gap-2 overflow-hidden rounded-[1.15rem] bg-muted/30 p-2.5 text-sm sm:grid-cols-[1fr_auto_1fr_2.5rem] sm:items-end md:rounded-2xl md:p-3"
                      >
                        <TimeInput
                          label="Início"
                          value={s.start_time.slice(0, 5)}
                          onChange={(value) => updateSlot(s.id, "start_time", value)}
                        />
                        <span className="hidden text-muted-foreground sm:block">até</span>
                        <TimeInput
                          label="Fim"
                          value={s.end_time.slice(0, 5)}
                          onChange={(value) => updateSlot(s.id, "end_time", value)}
                        />
                        <button
                          onClick={() => removeSlot(s.id)}
                          className="flex h-10 w-full items-center justify-center self-end rounded-xl border border-border text-muted-foreground transition hover:bg-background hover:text-foreground sm:w-10"
                          aria-label="Remover turno"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="max-w-full overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarOff className="h-4 w-4" />
            <p className="text-[10px] uppercase tracking-[0.2em]">Indisponibilidades</p>
          </div>
          <h3 className="mt-1 text-base font-medium">Bloqueios e folgas</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Use esta área para férias, pausas, formações ou qualquer período sem atendimento.
          </p>
        </div>
        <div className="mt-4">
          <TimeOffForm onAdd={addTimeOff} />
        </div>
        <div className="mt-4 space-y-2">
          {staffTimeOff.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Sem bloqueios para {selectedStaff?.name}.
            </p>
          ) : (
            staffTimeOff.map((t) => (
              <div
                key={t.id}
                className="flex max-w-full items-center gap-3 overflow-hidden rounded-2xl border border-border bg-background/65 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="leading-relaxed">
                    {new Date(t.starts_at).toLocaleString("pt-PT")} até{" "}
                    {new Date(t.ends_at).toLocaleString("pt-PT")}
                  </p>
                  {t.reason && <p className="mt-1 text-xs text-muted-foreground">{t.reason}</p>}
                </div>
                <button onClick={() => removeTimeOff(t.id)} aria-label="Remover bloqueio">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0 max-w-full overflow-hidden">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="box-border h-10 w-full min-w-0 max-w-full appearance-none rounded-xl border border-border bg-background px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
      />
    </label>
  );
}

function isPresetNotice(value: number) {
  return value === 30 || value === 60 || value === 120;
}

function TimeOffForm({ onAdd }: { onAdd: (s: string, e: string, r: string) => void }) {
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="grid min-w-0 max-w-full gap-3 overflow-hidden rounded-[1.35rem] border border-dashed border-border bg-background/60 p-3 md:grid-cols-[1.15fr_1.15fr_1fr_auto] md:items-end md:rounded-3xl md:p-4">
      <DateTimeField label="Início" value={starts} onChange={setStarts} />
      <DateTimeField label="Fim" value={ends} onChange={setEnds} />
      <Field label="Motivo">
        <input
          placeholder="Opcional"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="box-border h-11 w-full min-w-0 max-w-full appearance-none rounded-2xl border border-border bg-background px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
        />
      </Field>
      <button
        onClick={() => {
          if (!starts || !ends) return;
          onAdd(new Date(starts).toISOString(), new Date(ends).toISOString(), reason);
          setStarts("");
          setEnds("");
          setReason("");
        }}
        className="h-11 w-full min-w-0 rounded-2xl bg-foreground px-4 text-xs font-medium uppercase tracking-wide text-background transition hover:opacity-90 md:w-auto"
      >
        Adicionar
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block min-w-0 max-w-full overflow-hidden">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const date = value ? new Date(value) : undefined;
  const time = value ? value.slice(11, 16) : "09:00";

  return (
    <Field label={label}>
      <div className="grid min-w-0 max-w-full gap-2 sm:grid-cols-[1fr_6.25rem]">
        <PremiumDatePicker
          value={value ? value.slice(0, 10) : ""}
          onChange={(selectedDate) => {
            if (!selectedDate) return;
            onChange(mergeDateAndTime(new Date(`${selectedDate}T12:00:00`), time));
          }}
          placeholder="Escolher data"
          className="h-11 bg-background"
          allowClear={false}
        />
        <input
          type="time"
          value={time}
          onChange={(event) => {
            const base = date ?? new Date();
            onChange(mergeDateAndTime(base, event.target.value));
          }}
          className="box-border h-11 w-full min-w-0 max-w-full appearance-none rounded-2xl border border-border bg-background px-3 text-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
        />
      </div>
    </Field>
  );
}

function mergeDateAndTime(date: Date, time: string) {
  const [hours = "0", minutes = "0"] = time.split(":");
  const next = new Date(date);
  next.setHours(Number(hours), Number(minutes), 0, 0);
  const yyyy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, "0");
  const dd = String(next.getDate()).padStart(2, "0");
  const hh = String(next.getHours()).padStart(2, "0");
  const min = String(next.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
