import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

const STORAGE_KEY = "lumiere.cookies.preferences";
const LEGACY_KEY = "lumiere.cookies.accepted";

type CookiePreferences = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  savedAt: string;
};

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [managing, setManaging] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY) && !localStorage.getItem(LEGACY_KEY)) {
        const t = setTimeout(() => setVisible(true), 400);
        return () => clearTimeout(t);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const save = (prefs: Omit<CookiePreferences, "essential" | "savedAt">) => {
    try {
      const payload: CookiePreferences = {
        essential: true,
        analytics: prefs.analytics,
        marketing: prefs.marketing,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* noop */
    }
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 w-auto max-w-none md:inset-x-auto md:left-1/2 md:w-[calc(100vw-1.5rem)] md:max-w-xl md:-translate-x-1/2">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/95 p-4 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <button
          onClick={() => setVisible(false)}
          aria-label="Fechar"
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
        <p className="pr-6 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Cookies
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">
          Utilizamos cookies essenciais para manter a plataforma segura. Cookies analíticos e de
          marketing só são usados com o seu consentimento.
        </p>

        {managing && (
          <div className="mt-3 space-y-2 rounded-xl border border-border bg-background/55 p-3">
            <CookieOption label="Essenciais" description="Obrigatórios para segurança, sessão e marcação." checked disabled />
            <CookieOption
              label="Analíticos"
              description="Ajudam a perceber utilização agregada e melhorar a experiência."
              checked={analytics}
              onChange={setAnalytics}
            />
            <CookieOption
              label="Marketing"
              description="Permitem medir campanhas e comunicações promocionais."
              checked={marketing}
              onChange={setMarketing}
            />
          </div>
        )}

        <div className="mt-3 grid gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <Link to="/privacidade" className="underline underline-offset-2 hover:text-foreground">
              Privacidade
            </Link>
            <Link to="/cookies" className="underline underline-offset-2 hover:text-foreground">
              Cookies
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button
              onClick={() => save({ analytics: false, marketing: false })}
              className="min-w-0 rounded-full border border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-foreground transition active:scale-95 sm:px-4 sm:text-xs sm:tracking-wider"
            >
              Rejeitar
            </button>
            <button
              onClick={() => (managing ? save({ analytics, marketing }) : setManaging(true))}
              className="min-w-0 rounded-full border border-border px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-foreground transition active:scale-95 sm:px-4 sm:text-xs sm:tracking-wider"
            >
              {managing ? "Guardar" : "Gerir"}
            </button>
            <button
              onClick={() => save({ analytics: true, marketing: true })}
              className="col-span-2 min-w-0 rounded-full bg-foreground px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-background transition active:scale-95 sm:col-span-1 sm:px-5 sm:text-xs sm:tracking-wider"
            >
              Aceitar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CookieOption({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 text-xs">
      <span>
        <span className="block font-semibold text-foreground">{label}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-1 size-4 accent-foreground disabled:opacity-60"
      />
    </label>
  );
}
