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
  { code: "DE", dial: "+49", name: "Alemanha", minDigits: 10, maxDigits: 13, placeholder: "151 23456789" },
  { code: "IT", dial: "+39", name: "Itália", minDigits: 9, maxDigits: 11, placeholder: "312 345 6789" },
  { code: "CH", dial: "+41", name: "Suíça", minDigits: 9, maxDigits: 9, placeholder: "79 123 45 67" },
  { code: "BE", dial: "+32", name: "Bélgica", minDigits: 8, maxDigits: 9, placeholder: "470 12 34 56" },
  { code: "NL", dial: "+31", name: "Países Baixos", minDigits: 9, maxDigits: 9, placeholder: "6 12345678" },
  { code: "IE", dial: "+353", name: "Irlanda", minDigits: 9, maxDigits: 9, placeholder: "87 123 4567" },
  { code: "LU", dial: "+352", name: "Luxemburgo", minDigits: 8, maxDigits: 11, placeholder: "621 123 456" },
  { code: "AT", dial: "+43", name: "Áustria", minDigits: 7, maxDigits: 13, placeholder: "664 1234567" },
  { code: "PL", dial: "+48", name: "Polónia", minDigits: 9, maxDigits: 9, placeholder: "512 345 678" },
  { code: "DK", dial: "+45", name: "Dinamarca", minDigits: 8, maxDigits: 8, placeholder: "20 12 34 56" },
  { code: "SE", dial: "+46", name: "Suécia", minDigits: 7, maxDigits: 10, placeholder: "70 123 45 67" },
  { code: "NO", dial: "+47", name: "Noruega", minDigits: 8, maxDigits: 8, placeholder: "412 34 567" },
  { code: "FI", dial: "+358", name: "Finlândia", minDigits: 6, maxDigits: 12, placeholder: "40 123 4567" },
  { code: "AO", dial: "+244", name: "Angola", minDigits: 9, maxDigits: 9, placeholder: "923 123 456" },
  { code: "MZ", dial: "+258", name: "Moçambique", minDigits: 9, maxDigits: 9, placeholder: "84 123 4567" },
  { code: "CV", dial: "+238", name: "Cabo Verde", minDigits: 7, maxDigits: 7, placeholder: "991 23 45" },
];

const defaultPhoneCountry = phoneCountries[0];
const countriesWithNationalTrunkZero = new Set(["DE", "FR", "GB", "CH", "BE", "NL", "IE", "AT", "SE", "FI"]);

export function inferPhoneCountry(value: string) {
  const compact = value.replace(/\s/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  return phoneCountries.find((country) => international.startsWith(country.dial)) ?? defaultPhoneCountry;
}

export function getNationalPhoneDigits(value: string, country = inferPhoneCountry(value)) {
  const digits = value.replace(/\D/g, "");
  const dialDigits = country.dial.replace(/\D/g, "");
  const internationalPrefix = value.trim().startsWith("00") ? `00${dialDigits}` : dialDigits;
  const withoutDial =
    digits.startsWith(internationalPrefix) && digits.length > internationalPrefix.length
      ? digits.slice(internationalPrefix.length)
      : digits;
  const nationalDigits = countriesWithNationalTrunkZero.has(country.code) && withoutDial.startsWith("0")
    ? withoutDial.slice(1)
    : withoutDial;
  return nationalDigits.slice(0, country.maxDigits);
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
    const haystack = `${item.name} ${item.dial} ${item.code}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return haystack.includes(query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
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
  const additionalBackground = ({
    DE: "bg-[linear-gradient(180deg,#000000_0_33%,#dd0000_33%_66%,#ffce00_66%_100%)]",
    IT: "bg-[linear-gradient(90deg,#009246_0_33%,#ffffff_33%_66%,#ce2b37_66%_100%)]",
    CH: "bg-[#da291c]",
    BE: "bg-[linear-gradient(90deg,#000000_0_33%,#fdda24_33%_66%,#ef3340_66%_100%)]",
    NL: "bg-[linear-gradient(180deg,#ae1c28_0_33%,#ffffff_33%_66%,#21468b_66%_100%)]",
    IE: "bg-[linear-gradient(90deg,#169b62_0_33%,#ffffff_33%_66%,#ff883e_66%_100%)]",
    LU: "bg-[linear-gradient(180deg,#ed2939_0_33%,#ffffff_33%_66%,#00a1de_66%_100%)]",
    AT: "bg-[linear-gradient(180deg,#ed2939_0_33%,#ffffff_33%_66%,#ed2939_66%_100%)]",
    PL: "bg-[linear-gradient(180deg,#ffffff_0_50%,#dc143c_50%_100%)]",
    DK: "bg-[#c8102e]",
    SE: "bg-[#006aa7]",
    NO: "bg-[#ba0c2f]",
    FI: "bg-white",
    AO: "bg-[linear-gradient(180deg,#ce1126_0_50%,#000000_50%_100%)]",
    MZ: "bg-[linear-gradient(180deg,#007168_0_31%,#ffffff_31%_34%,#000000_34%_66%,#ffffff_66%_69%,#fce100_69%_100%)]",
    CV: "bg-[#003893]",
  } as Record<string, string>)[countryCode];
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
        additionalBackground,
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
      {countryCode === "CH" && (
        <>
          <span className="absolute left-1/2 top-1/2 h-2.5 w-1 -translate-x-1/2 -translate-y-1/2 bg-white" />
          <span className="absolute left-1/2 top-1/2 h-1 w-2.5 -translate-x-1/2 -translate-y-1/2 bg-white" />
        </>
      )}
      {(["DK", "SE", "FI"] as string[]).includes(countryCode) && (
        <>
          <span className={cn("absolute inset-y-0 left-[8px] w-[3px]", countryCode === "SE" ? "bg-[#fecc00]" : countryCode === "FI" ? "bg-[#002f6c]" : "bg-white")} />
          <span className={cn("absolute inset-x-0 top-[6px] h-[3px]", countryCode === "SE" ? "bg-[#fecc00]" : countryCode === "FI" ? "bg-[#002f6c]" : "bg-white")} />
        </>
      )}
      {countryCode === "NO" && (
        <>
          <span className="absolute inset-y-0 left-[8px] w-[5px] bg-white" />
          <span className="absolute inset-x-0 top-[5px] h-[5px] bg-white" />
          <span className="absolute inset-y-0 left-[9px] w-[3px] bg-[#00205b]" />
          <span className="absolute inset-x-0 top-[6px] h-[3px] bg-[#00205b]" />
        </>
      )}
      {countryCode === "AO" && <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#f7d618]" />}
      {countryCode === "MZ" && <span className="absolute inset-y-0 left-0 border-y-[8px] border-y-transparent border-l-[10px] border-l-[#d21034]" />}
      {countryCode === "CV" && (
        <>
          <span className="absolute inset-x-0 top-[7px] h-[5px] bg-white" />
          <span className="absolute inset-x-0 top-[9px] h-[1px] bg-[#cf2027]" />
          <span className="absolute left-[7px] top-[6px] h-1 w-1 rounded-full bg-[#f7d116]" />
        </>
      )}
    </span>
  );
}
