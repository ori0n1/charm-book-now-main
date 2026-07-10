"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type PhoneCountry = {
  code: string;
  dial: string;
  name: string;
  minDigits: number;
  maxDigits: number;
  placeholder: string;
};

const phoneCountries: PhoneCountry[] = [
  { code: "PT", dial: "+351", name: "Portugal", minDigits: 9, maxDigits: 9, placeholder: "912 345 678" },
  { code: "BR", dial: "+55", name: "Brasil", minDigits: 10, maxDigits: 11, placeholder: "11 91234 5678" },
  { code: "ES", dial: "+34", name: "Espanha", minDigits: 9, maxDigits: 9, placeholder: "612 345 678" },
  { code: "FR", dial: "+33", name: "Franca", minDigits: 9, maxDigits: 9, placeholder: "6 12 34 56 78" },
  { code: "GB", dial: "+44", name: "Reino Unido", minDigits: 10, maxDigits: 11, placeholder: "7400 123456" },
  { code: "US", dial: "+1", name: "Estados Unidos", minDigits: 10, maxDigits: 10, placeholder: "202 555 0123" },
];

const defaultPhoneCountry = phoneCountries[0];

export function inferPhoneCountry(value: string) {
  const compact = value.replace(/\s/g, "");
  return phoneCountries.find((country) => compact.startsWith(country.dial)) ?? defaultPhoneCountry;
}

export function getNationalPhoneDigits(value: string, country = inferPhoneCountry(value)) {
  const digits = value.replace(/\D/g, "");
  const dialDigits = country.dial.replace(/\D/g, "");
  const withoutDial =
    digits.startsWith(dialDigits) && digits.length > dialDigits.length
      ? digits.slice(dialDigits.length)
      : digits;
  return withoutDial.slice(0, country.maxDigits);
}

export function formatPhoneInput(value: string) {
  if (value.includes("@")) return "";
  const cleaned = value.replace(/[^\d+\s]/g, "").replace(/\s+/g, " ");
  if (!cleaned.includes("+")) return cleaned.trimStart();
  return `+${cleaned.replace(/\+/g, "").trimStart()}`;
}

export function normalizeInternationalPhone(value?: string | null, country = inferPhoneCountry(String(value ?? ""))) {
  const raw = String(value ?? "");
  if (raw.includes("@")) return "";
  const nationalDigits = getNationalPhoneDigits(raw, country);
  return nationalDigits ? `${country.dial}${nationalDigits}` : "";
}

export function normalizePhoneE164(value?: string | null, country = inferPhoneCountry(String(value ?? ""))) {
  const nationalDigits = getNationalPhoneDigits(String(value ?? ""), country);
  return nationalDigits ? `${country.dial}${nationalDigits}` : "";
}

export function isValidInternationalPhone(value?: string | null) {
  const raw = String(value ?? "");
  const country = inferPhoneCountry(raw);
  const digits = getNationalPhoneDigits(raw, country);
  return digits.length >= country.minDigits && digits.length <= country.maxDigits;
}

type InternationalPhoneInputProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  disabled?: boolean;
};

export function InternationalPhoneInput({
  value,
  onChange,
  label,
  className,
  inputClassName,
  required,
  disabled,
}: InternationalPhoneInputProps) {
  const inferredCountry = inferPhoneCountry(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState(inferredCountry);
  const nationalDigits = getNationalPhoneDigits(value, country);
  const valid = nationalDigits.length >= country.minDigits && nationalDigits.length <= country.maxDigits;
  const filteredCountries = phoneCountries.filter((item) => {
    const haystack = `${item.name} ${item.dial} ${item.code}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  useEffect(() => {
    setCountry(inferredCountry);
  }, [inferredCountry]);

  function updatePhone(nextCountry = country, digits = nationalDigits) {
    onChange(digits ? formatPhoneInput(`${nextCountry.dial} ${digits}`) : "");
  }

  return (
    <label className={cn("block min-w-0", className)}>
      {label && (
        <span className="mb-1.5 block font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
          {required ? " *" : ""}
        </span>
      )}
      <div
        className={cn(
          "flex h-12 min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition focus-within:border-foreground/25 focus-within:ring-2 focus-within:ring-foreground/10",
          disabled && "opacity-60",
          inputClassName,
        )}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="flex h-full min-w-[6.5rem] shrink-0 items-center justify-center gap-1.5 border-r border-border bg-background/80 px-2.5 text-sm font-extrabold transition hover:bg-muted disabled:cursor-not-allowed"
              aria-label="Selecionar pais"
            >
              <FlagBadge countryCode={country.code} />
              <span>{country.dial}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={8}
            className="z-[140] w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border-border bg-popover/98 p-2 shadow-2xl"
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar pais ou codigo"
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold outline-none transition focus:ring-2 focus:ring-foreground/10"
            />
            <div className="mt-2 max-h-[min(17rem,45vh)] overflow-y-auto pr-1">
              {filteredCountries.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setCountry(item);
                    updatePhone(item, nationalDigits);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex h-11 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm font-semibold transition hover:bg-muted",
                    item.code === country.code && "bg-muted text-foreground",
                  )}
                >
                  <span className="grid h-7 w-9 shrink-0 place-items-center rounded-lg bg-background ring-1 ring-border">
                    <FlagBadge countryCode={item.code} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-muted-foreground">{item.dial}</span>
                </button>
              ))}
              {filteredCountries.length === 0 && (
                <p className="px-2 py-5 text-center text-xs font-semibold text-muted-foreground">
                  Nenhum indicativo encontrado.
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <input
          value={nationalDigits}
          onChange={(event) => updatePhone(country, event.target.value.replace(/[^\d]/g, ""))}
          placeholder={country.placeholder}
          type="tel"
          autoComplete="tel"
          disabled={disabled}
          required={required}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed"
        />
        <span
          className={cn(
            "grid h-full w-12 shrink-0 place-items-center text-[10px] font-black uppercase",
            valid ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground",
          )}
        >
          {valid ? "OK" : "-"}
        </span>
      </div>
    </label>
  );
}

function FlagBadge({ countryCode }: { countryCode: string }) {
  return (
    <span
      className={cn(
        "relative block h-4 w-6 shrink-0 overflow-hidden rounded-[0.28rem] bg-muted shadow-sm ring-1 ring-black/10",
        countryCode === "PT" && "bg-[linear-gradient(90deg,#046a38_0_42%,#da291c_42%_100%)]",
        countryCode === "BR" && "bg-[#009b3a]",
        countryCode === "ES" && "bg-[linear-gradient(180deg,#aa151b_0_25%,#f1bf00_25%_75%,#aa151b_75%_100%)]",
        countryCode === "FR" && "bg-[linear-gradient(90deg,#0055a4_0_33%,#ffffff_33%_66%,#ef4135_66%_100%)]",
        countryCode === "GB" && "bg-[#012169]",
        countryCode === "US" && "bg-[repeating-linear-gradient(180deg,#b22234_0_2px,#ffffff_2px_4px)]",
      )}
      aria-hidden="true"
    >
      {countryCode === "PT" && (
        <span className="absolute left-[36%] top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#ffcc00] ring-1 ring-white/70" />
      )}
      {countryCode === "BR" && (
        <>
          <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-[#ffdf00]" />
          <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#002776]" />
        </>
      )}
      {countryCode === "GB" && (
        <>
          <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-white" />
          <span className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-white" />
          <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-[#c8102e]" />
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-[#c8102e]" />
        </>
      )}
      {countryCode === "US" && <span className="absolute left-0 top-0 h-2.5 w-2.5 bg-[#3c3b6e]" />}
    </span>
  );
}
