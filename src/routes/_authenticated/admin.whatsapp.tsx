import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getWhatsAppSettings,
  saveWhatsAppSettings,
  testWhatsAppMessage,
} from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/admin/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp - Painel" }] }),
  component: WhatsAppPage,
});

type WhatsAppSettings = {
  studioId: string;
  autoSendEnabled: boolean;
  messageTemplate: string;
  provider: string;
  sandboxNumber: string;
  lastError: string | null;
};

const DEFAULT_TEMPLATE =
  "Olá, {nome_cliente}. Confirmamos a sua marcação de {serviço} com {profissional} para {data} às {hora}.\n\nPode consultar os detalhes, remarcar, cancelar ou solicitar reembolso pelo link abaixo:\n{link_agendamento}";

function WhatsAppPage() {
  const { studio, loading: studioLoading, error: studioError } = useCurrentStudio();
  const loadSettings = useServerFn(getWhatsAppSettings);
  const saveSettings = useServerFn(saveWhatsAppSettings);
  const testMessage = useServerFn(testWhatsAppMessage);

  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  useEffect(() => {
    if (studioLoading) return;
    if (!studio) {
      setSettings(null);
      setLoading(false);
      return;
    }
    void load();
  }, [studio?.id, studioLoading]);

  async function load() {
    if (!studio) return;
    setLoading(true);
    try {
      const result = (await loadSettings({ data: { studioId: studio.id } })) as WhatsAppSettings;
      setSettings(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao carregar WhatsApp.";
      if (message !== "studio_not_found") toast.error(message);
      setSettings(emptySettings(studio.id));
    } finally {
      setLoading(false);
    }
  }

  async function save(next: { autoSendEnabled?: boolean; messageTemplate?: string }) {
    if (!studio || !settings) return;
    const previous = settings;
    const merged = { ...settings, ...next };
    setSettings(merged);
    try {
      await saveSettings({ data: { studioId: studio.id, ...next } });
      toast.success("Configurações guardadas.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao guardar.");
      setSettings(previous);
    }
  }

  async function sendTest() {
    if (!studio) return;
    setBusy(true);
    try {
      await testMessage({ data: { studioId: studio.id, phone: testPhone } });
      toast.success("Mensagem de teste enviada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha no teste.");
    } finally {
      setBusy(false);
    }
  }

  if (studioLoading || loading) {
    return <p className="text-sm text-muted-foreground">A carregar WhatsApp...</p>;
  }

  if (studioError || !studio) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Nenhum estúdio vinculado à sua conta.
      </div>
    );
  }

  const currentSettings = settings ?? emptySettings(studio.id);

  return (
    <div className="space-y-4 md:space-y-6">
      <header className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-6">
        <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Configurações
        </p>
        <h1 className="mt-2 text-2xl font-light tracking-tight md:text-3xl">WhatsApp</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Envie uma confirmação simples e cuidada quando o sinal online ficar registado.
        </p>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">Envio por WhatsApp</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Número de envio: {currentSettings.sandboxNumber}. Use esta área para afinar a
                mensagem antes de ativar o envio automático.
              </p>
            </div>
          </div>

          <label className="flex h-14 items-center justify-between gap-3 rounded-2xl border border-border bg-background/70 px-4 text-sm font-medium">
            <span>Ativar envio</span>
            <input
              type="checkbox"
              checked={currentSettings.autoSendEnabled}
              onChange={(event) => save({ autoSendEnabled: event.target.checked })}
              className="size-4 accent-emerald-600"
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Mensagem padrão
          </span>
          <textarea
            value={currentSettings.messageTemplate}
            rows={4}
            onChange={(event) =>
              setSettings((current) =>
                current ? { ...current, messageTemplate: event.target.value } : current,
              )
            }
            onBlur={(event) => save({ messageTemplate: event.target.value || DEFAULT_TEMPLATE })}
            className="box-border w-full min-w-0 resize-y rounded-2xl border border-border bg-background/85 px-4 py-3 text-sm leading-relaxed shadow-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
          />
        </label>

        <div className="mt-4 grid gap-3 rounded-2xl border border-border bg-background/55 p-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Testar envio
            </span>
            <input
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="+351912345678"
              className="box-border h-12 w-full min-w-0 rounded-2xl border border-border bg-background/85 px-4 text-sm shadow-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
            />
          </label>
          <button
            type="button"
            onClick={sendTest}
            disabled={busy || !testPhone.trim()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Testar
          </button>
        </div>
      </section>
    </div>
  );
}

function emptySettings(studioId: string): WhatsAppSettings {
  return {
    studioId,
    autoSendEnabled: false,
    messageTemplate:
      DEFAULT_TEMPLATE,
    provider: "twilio_whatsapp_sandbox",
    sandboxNumber: "whatsapp:+14155238886",
    lastError: null,
  };
}
