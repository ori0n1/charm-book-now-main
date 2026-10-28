import { useEffect, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";

const storageKey = "studio-pwa-install-guide";

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export function PwaInstallGuide() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const preference = localStorage.getItem(storageKey);
    if (preference === "never") return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    const wasLater = preference ? Number(preference) : 0;
    const canShowAfterLater = !wasLater || Date.now() - wasLater > 1000 * 60 * 60 * 24 * 3;

    if (isDesktop && canShowAfterLater) {
      const timer = window.setTimeout(() => setVisible(true), 2200);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      };
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function installNow() {
    if (!installPrompt) {
      setExpanded(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      localStorage.setItem(storageKey, "never");
      setVisible(false);
    }
    setInstallPrompt(null);
  }

  function remindLater() {
    localStorage.setItem(storageKey, String(Date.now()));
    setVisible(false);
  }

  function dismissForever() {
    localStorage.setItem(storageKey, "never");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-lg md:bottom-6 md:left-auto md:right-6 md:mx-0">
      <div className="overflow-hidden rounded-[1.5rem] border border-border/80 bg-card/98 shadow-2xl shadow-black/25 backdrop-blur-2xl">
        <div className="flex items-start gap-3 p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-3xl bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
            <Smartphone className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Aplicação no telemóvel
            </p>
            <h2 className="mt-1 text-base font-semibold">Use o painel como app</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Pode adicionar o painel ao ecrã principal para abrir mais rápido no dia a dia.
            </p>
          </div>
          <button
            type="button"
            onClick={dismissForever}
            className="grid size-9 shrink-0 place-items-center rounded-2xl text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {expanded && (
          <div className="border-t border-border/70 px-4 py-3">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <div className="rounded-3xl bg-muted/45 p-3">
                <p className="font-semibold">iPhone / Safari</p>
                <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li>1. Abra o painel no Safari.</li>
                  <li>2. Toque em Partilhar.</li>
                  <li>3. Escolha “Adicionar ao ecrã principal”.</li>
                </ol>
              </div>
              <div className="rounded-3xl bg-muted/45 p-3">
                <p className="font-semibold">Android / Chrome</p>
                <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li>1. Abra o painel no Chrome.</li>
                  <li>2. Toque no menu de três pontos.</li>
                  <li>3. Escolha “Instalar app” ou “Adicionar ao ecrã”.</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border/70 p-3 sm:flex-row">
          <button
            type="button"
            onClick={installNow}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            {installPrompt ? "Instalar agora" : "Ver passo a passo"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="min-h-11 rounded-2xl border border-border px-4 text-sm font-semibold transition hover:bg-muted"
          >
            Ver passo a passo
          </button>
          <button
            type="button"
            onClick={remindLater}
            className="min-h-11 rounded-2xl px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Lembrar depois
          </button>
        </div>
      </div>
    </div>
  );
}
