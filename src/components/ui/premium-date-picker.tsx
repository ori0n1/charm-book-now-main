"use client";

import { CalendarDays } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type PremiumDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
  startYear?: number;
  endYear?: number;
  showTodayButton?: boolean;
  portalLayer?: "default" | "modal";
};

export function PremiumDatePicker({
  value,
  onChange,
  placeholder = "dd/mm/aaaa",
  className,
  disabled,
  allowClear = true,
  startYear = 1900,
  endYear = new Date().getFullYear() + 5,
  showTodayButton = true,
  portalLayer = "default",
}: PremiumDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;
  const startMonth = new Date(startYear, 0, 1);
  const endMonth = new Date(endYear, 11, 31);
  const initialMonth = selected ?? new Date(Math.min(Date.now(), endMonth.getTime()));
  const [displayedMonth, setDisplayedMonth] = useState(() =>
    clampMonth(initialMonth, startMonth, endMonth),
  );
  const years = useMemo(
    () => Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index),
    [endYear, startYear],
  );

  useEffect(() => {
    if (selected) setDisplayedMonth(clampMonth(selected, startMonth, endMonth));
  }, [selected?.getTime(), startMonth.getTime(), endMonth.getTime()]);

  function changeDisplayedMonth(monthIndex: number) {
    setDisplayedMonth((current) =>
      clampMonth(new Date(current.getFullYear(), monthIndex, 1), startMonth, endMonth),
    );
  }

  function changeDisplayedYear(year: number) {
    setDisplayedMonth((current) =>
      clampMonth(new Date(year, current.getMonth(), 1), startMonth, endMonth),
    );
  }

  function selectDate(date: Date | undefined) {
    if (!date) return;
    onChange(toDateValue(date));
    setOpen(false);
  }

  function selectToday() {
    onChange(toDateValue(new Date()));
    setOpen(false);
  }

  function clearDate() {
    onChange("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "box-border flex h-12 w-full min-w-0 max-w-full items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 text-left text-sm shadow-sm outline-none transition",
            "hover:border-foreground/20 hover:bg-background focus:border-foreground/30 focus:ring-2 focus:ring-foreground/10",
            "data-[state=open]:border-foreground/30 data-[state=open]:bg-background data-[state=open]:ring-2 data-[state=open]:ring-foreground/10",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span
            className={cn("min-w-0 truncate", value ? "text-foreground" : "text-muted-foreground")}
          >
            {value ? formatDatePt(value) : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          "w-[min(calc(100vw-1.5rem),22rem)] rounded-3xl border-border bg-popover/98 p-2 shadow-2xl shadow-black/20",
          portalLayer === "modal" && "z-[120]",
        )}
      >
        <div className="mb-2 grid grid-cols-[minmax(0,1fr)_6.75rem] gap-2 px-1">
          <Select
            value={String(displayedMonth.getMonth())}
            onValueChange={(next) => changeDisplayedMonth(Number(next))}
          >
            <SelectTrigger className="h-10 min-h-10 rounded-2xl bg-background/80 px-3 text-sm font-bold shadow-sm">
              <SelectValue aria-label="Escolher mês" />
            </SelectTrigger>
            <SelectContent className={cn("max-h-72", portalLayer === "modal" && "z-[130]")}>
              {MONTHS_PT.map((month, index) => (
                <SelectItem key={month} value={String(index)}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(displayedMonth.getFullYear())}
            onValueChange={(next) => changeDisplayedYear(Number(next))}
          >
            <SelectTrigger className="h-10 min-h-10 rounded-2xl bg-background/80 px-3 text-sm font-bold shadow-sm">
              <SelectValue aria-label="Escolher ano" />
            </SelectTrigger>
            <SelectContent className={cn("max-h-72", portalLayer === "modal" && "z-[130]")}>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Calendar
          mode="single"
          selected={selected}
          onSelect={selectDate}
          weekStartsOn={1}
          captionLayout="label"
          startMonth={startMonth}
          endMonth={endMonth}
          month={displayedMonth}
          onMonthChange={(month) => setDisplayedMonth(clampMonth(month, startMonth, endMonth))}
          className="bellza-premium-calendar mx-auto rounded-2xl bg-transparent"
          classNames={{
            nav: "hidden",
            month_caption: "sr-only",
            day_button:
              "hover:bg-muted focus:bg-muted data-[selected-single=true]:bg-foreground data-[selected-single=true]:text-background",
            today: "rounded-md bg-muted text-foreground",
          }}
        />
        <div className={cn("mt-2 grid gap-2", showTodayButton ? "grid-cols-2" : "grid-cols-1")}>
          {showTodayButton && (
            <button
              type="button"
              onClick={selectToday}
              className="h-10 rounded-2xl border border-border bg-background/70 px-3 text-xs font-bold uppercase tracking-wide text-foreground transition hover:bg-muted"
            >
              Hoje
            </button>
          )}
          <button
            type="button"
            onClick={clearDate}
            disabled={!allowClear || !value}
            className="h-10 rounded-2xl border border-border bg-background/70 px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            Limpar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const MONTHS_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function formatDatePt(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampMonth(date: Date, startMonth: Date, endMonth: Date) {
  const month = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = new Date(startMonth.getFullYear(), startMonth.getMonth(), 1);
  const end = new Date(endMonth.getFullYear(), endMonth.getMonth(), 1);

  if (month < start) return start;
  if (month > end) return end;
  return month;
}
