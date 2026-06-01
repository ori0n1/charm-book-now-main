"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PremiumDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  allowClear?: boolean;
};

export function PremiumDatePicker({
  value,
  onChange,
  placeholder = "dd/mm/aaaa",
  className,
  disabled,
  allowClear = true,
}: PremiumDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00:00`) : undefined;

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
          <span className={cn("min-w-0 truncate", value ? "text-foreground" : "text-muted-foreground")}>
            {value ? formatDatePt(value) : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(calc(100vw-1.5rem),22rem)] rounded-3xl border-border bg-popover/98 p-2 shadow-2xl shadow-black/20"
      >
        <Calendar
          mode="single"
          selected={selected}
          onSelect={selectDate}
          weekStartsOn={1}
          className="mx-auto rounded-2xl bg-transparent"
          classNames={{
            day_button:
              "hover:bg-muted focus:bg-muted data-[selected-single=true]:bg-foreground data-[selected-single=true]:text-background",
            today: "rounded-md bg-muted text-foreground",
          }}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={selectToday}
            className="h-10 rounded-2xl border border-border bg-background/70 px-3 text-xs font-bold uppercase tracking-wide text-foreground transition hover:bg-muted"
          >
            Hoje
          </button>
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
