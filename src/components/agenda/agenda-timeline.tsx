import { AlertTriangle, Clock, UserRound } from "lucide-react";
import {
  buildTimelineLayout,
  type AgendaTimelineItem,
  type TimelineLayoutItem,
} from "./agenda-timeline-utils";

const HOUR_HEIGHT = 76;

export function AgendaTimeline({
  date,
  items,
  now,
  onOpen,
}: {
  date: Date;
  items: AgendaTimelineItem[];
  now: Date;
  onOpen: (item: AgendaTimelineItem, anchor: HTMLElement) => void;
}) {
  const bounds = getTimelineBounds(items);
  const layout = buildTimelineLayout(items, bounds.startHour, HOUR_HEIGHT);
  const hours = Array.from(
    { length: bounds.endHour - bounds.startHour + 1 },
    (_, index) => bounds.startHour + index,
  );
  const isToday = sameLocalDay(date, now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMinutes - bounds.startHour * 60) / 60) * HOUR_HEIGHT;
  const showNow = isToday && nowTop >= 0 && nowTop <= (bounds.endHour - bounds.startHour) * HOUR_HEIGHT;

  if (items.length === 0) {
    return (
      <div className="grid min-h-[22rem] place-items-center rounded-[1.4rem] border border-dashed border-border bg-card/60 px-6 text-center">
        <div>
          <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
            <Clock className="h-4.5 w-4.5" />
          </span>
          <p className="mt-3 text-sm font-semibold">Dia livre</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Não existem marcações para esta data e seleção.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="agenda-timeline relative overflow-hidden rounded-[1.4rem] border border-border/80 bg-card shadow-sm"
      data-testid="agenda-day-timeline"
    >
      <div
        className="relative"
        style={{ height: Math.max(22 * 16, (bounds.endHour - bounds.startHour) * HOUR_HEIGHT) }}
      >
        {hours.map((hour) => {
          const top = (hour - bounds.startHour) * HOUR_HEIGHT;
          return (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border/55"
              style={{ top }}
            >
              <span className="absolute left-2 top-1.5 w-11 text-right font-mono text-[10px] font-semibold tabular-nums text-muted-foreground/75">
                {String(hour).padStart(2, "0")}:00
              </span>
            </div>
          );
        })}

        {showNow && (
          <div
            className="pointer-events-none absolute left-12 right-0 z-30 border-t border-rose-500/80"
            style={{ top: nowTop }}
            aria-label="Horário atual"
          >
            <span className="absolute -left-1 -top-1.5 size-3 rounded-full border-2 border-card bg-rose-500" />
            <span className="absolute left-2 -top-3 rounded-full bg-rose-500 px-1.5 py-0.5 font-mono text-[8px] font-bold tabular-nums text-white">
              {formatTime(now.toISOString())}
            </span>
          </div>
        )}

        <div className="absolute bottom-0 left-[4.15rem] right-1 top-0">
          {layout.map((item) => (
            <TimelineCard
              key={item.id}
              item={item}
              onOpen={(anchor) => onOpen(item, anchor)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AgendaWeekBoard({
  weekDays,
  items,
  selectedDate,
  onSelectDate,
  onOpen,
}: {
  weekDays: Date[];
  items: AgendaTimelineItem[];
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
  onOpen: (item: AgendaTimelineItem, anchor: HTMLElement) => void;
}) {
  return (
    <div
      className="overflow-x-auto rounded-[1.4rem] border border-border/80 bg-card shadow-sm [scrollbar-width:thin]"
      data-testid="agenda-week-board"
    >
      <div className="grid min-w-[58rem] grid-cols-7 divide-x divide-border/60">
        {weekDays.map((day) => {
          const dayItems = items.filter((item) => sameLocalDay(new Date(item.startsAt), day));
          const selected = sameLocalDay(day, selectedDate);
          return (
            <section key={day.toISOString()} className="min-h-[32rem]">
              <button
                type="button"
                onClick={() => onSelectDate(day)}
                className={`sticky top-0 z-10 flex w-full items-center justify-between border-b border-border/60 px-3 py-3 text-left backdrop-blur ${
                  selected ? "bg-foreground text-background" : "bg-card/95 hover:bg-muted"
                }`}
              >
                <span>
                  <span className="block text-[9px] font-bold uppercase tracking-[0.16em] opacity-70">
                    {day.toLocaleDateString("pt-PT", { weekday: "short" })}
                  </span>
                  <span className="mt-0.5 block text-lg font-black tabular-nums">{day.getDate()}</span>
                </span>
                <span className="grid size-6 place-items-center rounded-full bg-background/15 text-[10px] font-bold">
                  {dayItems.length}
                </span>
              </button>
              <div className="space-y-2 p-2">
                {dayItems.length === 0 ? (
                  <p className="px-2 py-5 text-center text-[10px] text-muted-foreground">Livre</p>
                ) : (
                  dayItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={(event) => onOpen(item, event.currentTarget)}
                      className={`w-full overflow-hidden rounded-xl border px-2.5 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${statusTone(item.status)}`}
                    >
                      <span className="block whitespace-nowrap font-mono text-[10px] font-black tabular-nums">
                        {formatTime(item.startsAt)}
                      </span>
                      <span className="mt-1 block truncate text-[11px] font-bold">
                        {item.clientName}
                      </span>
                      <span className="mt-0.5 block truncate text-[9px] opacity-70">
                        {item.serviceName}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TimelineCard({
  item,
  onOpen,
}: {
  item: TimelineLayoutItem;
  onOpen: (anchor: HTMLElement) => void;
}) {
  const left = (item.lane / item.laneCount) * 100;
  const width = 100 / item.laneCount;
  const compact = item.height < 58;
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      className={`absolute overflow-hidden rounded-xl border px-2.5 py-2 text-left shadow-sm transition duration-150 hover:z-20 hover:-translate-y-0.5 hover:shadow-md focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${statusTone(item.status)}`}
      style={{
        top: item.top + 3,
        height: Math.max(34, item.height - 6),
        left: `calc(${left}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      data-conflict={item.conflict ? "true" : undefined}
      aria-label={`${formatTime(item.startsAt)}, ${item.clientName}, ${item.serviceName}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-black tabular-nums">
          {formatTime(item.startsAt)}
        </span>
        {!compact && (
          <span className="truncate text-[9px] font-semibold opacity-60">
            {item.durationLabel}
          </span>
        )}
        {item.conflict && (
          <AlertTriangle className="ml-auto h-3 w-3 shrink-0 text-rose-600" aria-label="Conflito" />
        )}
      </span>
      <span className="mt-0.5 block truncate text-[11px] font-bold leading-tight sm:text-xs">
        {item.clientName}
      </span>
      {!compact && (
        <>
          <span className="mt-0.5 block truncate text-[9px] font-medium opacity-75 sm:text-[10px]">
            {item.serviceName}
          </span>
          {item.staffName && (
            <span className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[8px] opacity-65 sm:text-[9px]">
              <UserRound className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{item.staffName}</span>
            </span>
          )}
        </>
      )}
    </button>
  );
}

function getTimelineBounds(items: AgendaTimelineItem[]) {
  const starts = items.map((item) => new Date(item.startsAt).getHours());
  const ends = items.map((item) => {
    const end = new Date(item.endsAt);
    return end.getHours() + (end.getMinutes() > 0 ? 1 : 0);
  });
  return {
    startHour: Math.max(0, Math.min(8, ...starts) - 1),
    endHour: Math.min(24, Math.max(20, ...ends) + 1),
  };
}

function statusTone(status: string) {
  if (status === "cancelled" || status === "no_show") {
    return "border-rose-300/70 bg-rose-50 text-rose-950 opacity-75 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-100";
  }
  if (status === "completed") {
    return "border-emerald-300/70 bg-emerald-50 text-emerald-950 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-100";
  }
  if (status === "pending" || status === "pending_payment") {
    return "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100";
  }
  return "border-sky-300/70 bg-sky-50 text-sky-950 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-100";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
