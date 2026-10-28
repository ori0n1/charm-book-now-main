import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PremiumTimeSelectProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
};

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
});

export function PremiumTimeSelect({
  value,
  onChange,
  className,
  placeholder = "Hora",
  disabled,
}: PremiumTimeSelectProps) {
  const options = TIME_OPTIONS.includes(value) || !value ? TIME_OPTIONS : [value, ...TIME_OPTIONS];

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={cn(
          "h-11 w-full rounded-2xl border-border bg-background/85 px-3 text-sm shadow-sm transition hover:bg-background focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-60",
          className,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-72 rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
        {options.map((time) => (
          <SelectItem key={time} value={time} className="rounded-xl px-3 py-2.5 text-sm">
            {time}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
