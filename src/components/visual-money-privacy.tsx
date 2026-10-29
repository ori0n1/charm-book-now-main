import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useCurrentStudio, type CurrentStudio } from "@/hooks/use-current-studio";

const MASK = "•••• €";
const EVENT = "bellza-visual-money-privacy";
const validPin = (value: string) => /^\d{4}$/.test(value);

type SavedPreference = { version: 1; hidden: boolean; salt: string; hash: string };
type PrivacyState = {
  hidden: boolean;
  owner: boolean;
  open: () => void;
};

const PrivacyContext = createContext<PrivacyState>({ hidden: false, owner: false, open: () => {} });

function storageKey(studio: CurrentStudio) {
  return `bellza:visual-money-privacy:v1:${studio.user_id}:${studio.id}`;
}

function readPreference(key: string): SavedPreference | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null") as SavedPreference | null;
    return value?.version === 1 && typeof value.hidden === "boolean" &&
      /^[0-9a-f]{32}$/.test(value.salt) && /^[0-9a-f]{64}$/.test(value.hash) ? value : null;
  } catch { return null; }
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashPin(pin: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: Uint8Array.from(salt.match(/../g)!, (part) => parseInt(part, 16)), iterations: 120_000, hash: "SHA-256" }, key, 256);
  return hex(new Uint8Array(bits));
}

function VisualPrivacyProvider({ studio, children }: { studio: CurrentStudio | null; children: ReactNode }) {
  const owner = studio?.role === "studio_owner" || studio?.role === "saas_owner";
  const key = owner && studio ? storageKey(studio) : null;
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<SavedPreference | null>(null);
  const [dialog, setDialog] = useState<"create" | "reveal" | null>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!key) { setReady(true); return; }
    const update = () => setSaved(readPreference(key));
    update();
    setReady(true);
    window.addEventListener("storage", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener(EVENT, update);
    };
  }, [key]);

  function save(value: SavedPreference) {
    if (!key) return;
    localStorage.setItem(key, JSON.stringify(value));
    setSaved(value);
    window.dispatchEvent(new Event(EVENT));
  }

  function open() {
    if (!owner || !key) return;
    if (saved?.hidden) {
      setPin("");
      setError("");
      setDialog("reveal");
    } else if (saved) {
      try { save({ ...saved, hidden: true }); }
      catch { setError("Não foi possível guardar a preferência neste navegador."); setDialog("reveal"); }
    } else {
      setPin("");
      setConfirm("");
      setError("");
      setDialog("create");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!key || !validPin(pin) || busy) return;
    setBusy(true);
    setError("");
    try {
      if (dialog === "create") {
        if (pin !== confirm) { setError("Os códigos não coincidem."); return; }
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        save({ version: 1, hidden: true, salt, hash: await hashPin(pin, salt) });
      } else if (dialog === "reveal" && saved) {
        const candidate = await hashPin(pin, saved.salt);
        let mismatch = 0;
        for (let index = 0; index < candidate.length; index++) mismatch |= candidate.charCodeAt(index) ^ saved.hash.charCodeAt(index);
        if (mismatch) { setError("Código incorreto."); return; }
        save({ ...saved, hidden: false });
      }
      setPin("");
      setConfirm("");
      setDialog(null);
    } catch { setError("Não foi possível guardar a preferência neste navegador."); }
    finally { setBusy(false); }
  }

  if (owner && !ready) return <p className="p-4 text-sm text-muted-foreground">A carregar privacidade visual...</p>;

  return (
    <PrivacyContext.Provider value={{ hidden: Boolean(owner && saved?.hidden), owner: Boolean(owner), open }}>
      {children}
      {dialog && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
        <form role="dialog" aria-modal="true" aria-label={dialog === "create" ? "Criar código de privacidade visual" : "Revelar valores"}
          onSubmit={(event) => void submit(event)} className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-5 shadow-xl">
          <h2 className="text-lg font-semibold">{dialog === "create" ? "Criar código de 4 dígitos" : "Revelar valores"}</h2>
          <p className="text-xs text-muted-foreground">Apenas oculta valores nesta interface e neste navegador. Os dados continuam acessíveis pelas APIs.</p>
          <label className="block text-sm">Código de 4 dígitos
            <input autoFocus type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off"
              value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              className="mt-1 block h-11 w-full rounded-xl border bg-background px-3" />
          </label>
          {dialog === "create" && <label className="block text-sm">Confirmar código
            <input type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off"
              value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ""))}
              className="mt-1 block h-11 w-full rounded-xl border bg-background px-3" />
          </label>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className="rounded-xl border px-4 py-2 text-sm">Cancelar</button>
            <button type="submit" disabled={busy || !validPin(pin) || (dialog === "create" && !validPin(confirm))}
              className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
              {dialog === "create" ? "Ocultar valores" : "Revelar"}
            </button>
          </div>
        </form>
      </div>}
    </PrivacyContext.Provider>
  );
}

export function VisualPrivacyBoundary({ children }: { children: ReactNode }) {
  const { studio, loading } = useCurrentStudio();
  if (loading) return <p className="p-4 text-sm text-muted-foreground">A carregar estúdio...</p>;
  return <VisualPrivacyProvider key={studio ? `${studio.user_id}:${studio.id}` : "loading"} studio={studio}>{children}</VisualPrivacyProvider>;
}

export function VisualPrivacyButton() {
  const { hidden, owner, open } = useContext(PrivacyContext);
  if (!owner) return null;
  return <button type="button" onClick={open} aria-label={hidden ? "Revelar valores" : "Ocultar valores"}
    title={hidden ? "Revelar valores" : "Ocultar valores"} aria-pressed={hidden}
    className="grid size-10 shrink-0 place-items-center rounded-full border border-border/60 bg-background/70 text-muted-foreground transition hover:border-emerald-600/35 hover:bg-background hover:text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50 dark:hover:text-emerald-400">
    {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
  </button>;
}

export function VisualMoney({ value, force = false }: { value: string; force?: boolean }) {
  const { hidden } = useContext(PrivacyContext);
  return <>{hidden && (force || value.includes("€")) ? MASK : value}</>;
}

export function useVisualMoneyHidden() {
  return useContext(PrivacyContext).hidden;
}
