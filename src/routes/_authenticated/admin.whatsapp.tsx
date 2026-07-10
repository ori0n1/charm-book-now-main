import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BellRing,
  CalendarClock,
  Gift,
  MessageCircle,
  Scissors,
  Send,
  Sparkles,
  UserCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { sendFollowerNotification } from "@/lib/studio-follows.functions";
import {
  getWhatsAppSettings,
  saveWhatsAppSettings,
  testWhatsAppMessage,
} from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/admin/whatsapp")({
  head: () => ({ meta: [{ title: "Comunicação - Painel" }] }),
  component: WhatsAppPage,
});

type WhatsAppSettings = {
  studioId: string;
  autoSendEnabled: boolean;
  messageTemplate: string;
  provider: string;
  fromNumber: string;
  lastError: string | null;
};

type FollowerNotificationKind =
  | "promotion"
  | "new_service"
  | "open_slot"
  | "cancellation"
  | "news"
  | "staff_available"
  | "birthday"
  | "return_reminder"
  | "client_at_risk"
  | "personal_offer";

const DEFAULT_TEMPLATE =
  "Olá, {nome_cliente}. Confirmamos a sua marcação de {serviço} com {profissional} para {data} às {hora}.\n\nPode consultar os detalhes, remarcar, cancelar ou solicitar reembolso pelo link abaixo:\n{link_agendamento}";

const FOLLOWER_NOTIFICATION_KINDS: Array<{
  kind: FollowerNotificationKind;
  label: string;
  eyebrow: string;
  title: string;
  body: string;
  icon: LucideIcon;
  tone: string;
}> = [
  {
    kind: "birthday",
    label: "Feliz aniversário",
    eyebrow: "Cliente",
    title: "Feliz aniversário",
    body: "Hoje é um bom dia para cuidar de si. Temos um mimo especial à sua espera no estúdio.",
    icon: Gift,
    tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    kind: "return_reminder",
    label: "Lembrete de retorno",
    eyebrow: "Retorno",
    title: "Está na altura de voltar",
    body: "Já passou algum tempo desde a sua última visita. Pode reservar o próximo horário pelo app.",
    icon: CalendarClock,
    tone: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    kind: "client_at_risk",
    label: "Cliente em risco",
    eyebrow: "Reativação",
    title: "Sentimos a sua falta",
    body: "Preparámos uma sugestão especial para o seu próximo atendimento no estúdio.",
    icon: Users,
    tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  {
    kind: "personal_offer",
    label: "Oferta personalizada",
    eyebrow: "Oferta",
    title: "Sugestão especial para si",
    body: "Com base no serviço que costuma fazer, temos uma sugestão especial para a próxima visita.",
    icon: Sparkles,
    tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    kind: "open_slot",
    label: "Horário vago",
    eyebrow: "Agenda",
    title: "Horário vago disponível",
    body: "Temos um horário livre para atendimento. Abra o app do estúdio para reservar.",
    icon: CalendarClock,
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    kind: "staff_available",
    label: "Horários disponíveis",
    eyebrow: "Agenda",
    title: "Agenda disponível",
    body: "Há horários disponíveis na agenda. Abra o app do estúdio para reservar.",
    icon: UserCheck,
    tone: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    kind: "promotion",
    label: "Promoção",
    eyebrow: "Campanha",
    title: "Promoção disponível",
    body: "Temos uma novidade especial para clientes que seguem o estúdio.",
    icon: Gift,
    tone: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  {
    kind: "new_service",
    label: "Novo serviço",
    eyebrow: "Catálogo",
    title: "Novo serviço no estúdio",
    body: "Já pode conhecer o novo serviço disponível no app do estúdio.",
    icon: Scissors,
    tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    kind: "cancellation",
    label: "Vaga liberada",
    eyebrow: "Cancelamento",
    title: "Vaga aberta por cancelamento",
    body: "Uma vaga ficou disponível por cancelamento. Abra o app do estúdio para reservar.",
    icon: XCircle,
    tone: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    kind: "news",
    label: "Novidade",
    eyebrow: "Comunidade",
    title: "Novidade do estúdio",
    body: "Há uma novidade para a comunidade do estúdio. Abra o app para ver os detalhes.",
    icon: Sparkles,
    tone: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
];

function WhatsAppPage() {
  const { studio, loading: studioLoading, error: studioError } = useCurrentStudio();
  const loadSettings = useServerFn(getWhatsAppSettings);
  const saveSettings = useServerFn(saveWhatsAppSettings);
  const testMessage = useServerFn(testWhatsAppMessage);
  const notifyFollowers = useServerFn(sendFollowerNotification);

  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [communityBusy, setCommunityBusy] = useState(false);
  const [communityKind, setCommunityKind] = useState<FollowerNotificationKind>("open_slot");
  const [communityTitle, setCommunityTitle] = useState("Horário vago disponível");
  const [communityBody, setCommunityBody] = useState(
    "Temos um horário livre para atendimento. Abra o app do estúdio para reservar.",
  );
  const [showWhatsAppDetails, setShowWhatsAppDetails] = useState(false);
  const communityBodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    resizeTextarea(communityBodyRef.current);
  }, [communityBody]);

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

  async function sendCommunityNotification() {
    if (!studio) return;
    setCommunityBusy(true);
    try {
      const result = await notifyFollowers({
        data: {
          studioId: studio.id,
          kind: communityKind,
          title: communityTitle,
          body: communityBody,
        },
      });
      if ((result as any)?.skipped === "cooldown") {
        toast.info("Já foi enviado um aviso deste tipo há pouco tempo. Tente novamente mais tarde.");
      } else if ((result as any)?.skipped === "no_followers") {
        toast.info("Ainda não existem clientes seguidores para este estúdio.");
      } else if ((result as any)?.sent === 0) {
        toast.success("Aviso guardado na central dos seguidores. Ative as permissões push para receber fora do app.");
      } else {
        toast.success("Aviso enviado à comunidade do estúdio.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o aviso.");
    } finally {
      setCommunityBusy(false);
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
  const communityCampaigns = FOLLOWER_NOTIFICATION_KINDS.filter(
    (item) => item.kind !== "birthday" && item.kind !== "return_reminder",
  );
  const selectedCommunityKind =
    communityCampaigns.find((item) => item.kind === communityKind) ?? communityCampaigns[0];
  const SelectedCommunityIcon = selectedCommunityKind.icon;

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-3 pb-24 md:gap-4 md:pb-6">
      <header className="overflow-hidden rounded-[1.35rem] border border-border/80 bg-card shadow-sm">
        <p className="px-4 pt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground md:px-5 md:pt-5">
          Configurações
        </p>
        <h1 className="mt-1.5 px-4 text-2xl font-semibold tracking-tight md:px-5 md:text-3xl">Comunicação</h1>
        <p className="max-w-2xl px-4 pb-4 pt-2 text-sm leading-relaxed text-muted-foreground md:px-5 md:pb-5">
          Envie avisos para seguidores do app do estúdio e mantenha as confirmações por WhatsApp.
        </p>
        <div className="grid grid-cols-3 gap-2 border-t border-border/70 bg-muted/20 p-3 md:p-4">
          <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Canais</p>
            <p className="mt-1 text-lg font-semibold leading-none">2</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Avisos</p>
            <p className="mt-1 text-lg font-semibold leading-none">{communityCampaigns.length}</p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-background/70 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">WhatsApp</p>
            <p className="mt-1 text-sm font-semibold leading-none">
              {currentSettings.autoSendEnabled ? "Ativo" : "Pausado"}
            </p>
          </div>
        </div>
      </header>

      <section className="overflow-hidden rounded-[1.35rem] border border-border/80 bg-card shadow-sm">
        <div className="grid gap-3 border-b border-border/70 bg-muted/15 p-3.5 md:grid-cols-[minmax(0,1fr)_17rem] md:p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sky-600/10 text-sky-700 dark:text-sky-300">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Notificações inteligentes
              </p>
              <h2 className="mt-1 text-base font-semibold tracking-tight md:text-lg">Comunidade privada do estúdio</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground md:text-sm">
                Envie avisos relevantes para clientes seguidores, com histórico no app e push apenas para quem autorizou.
              </p>
            </div>
          </div>
          <div className="rounded-2xl border border-border/80 bg-background/75 p-3 text-xs leading-relaxed text-muted-foreground">
            <BellRing className="mb-1.5 h-4 w-4 text-foreground" />
            Promoções, horários vagos, vagas liberadas, novos serviços e horários disponíveis.
          </div>
        </div>

        <div className="grid gap-3 p-3.5 md:p-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid gap-3">
            <div className="grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(8.75rem,1fr))] gap-2">
              {communityCampaigns.map((item) => {
                const Icon = item.icon;
                const active = communityKind === item.kind;
                return (
                  <button
                    key={item.kind}
                    type="button"
                    onClick={() => {
                      setCommunityKind(item.kind);
                      setCommunityTitle(item.title);
                      setCommunityBody(item.body);
                    }}
                    className={`group flex h-full min-h-[4.25rem] w-full min-w-0 items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-foreground/70 bg-foreground text-background shadow-sm"
                        : "border-border/80 bg-background/70 text-foreground hover:border-foreground/20 hover:bg-background"
                    }`}
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                        active ? "bg-background/15 text-background" : item.tone
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block overflow-hidden text-[10px] font-bold uppercase tracking-[0.14em] ${
                          active ? "text-background/70" : "text-muted-foreground"
                        }`}
                      >
                        {item.eyebrow}
                      </span>
                      <span className="mt-0.5 block whitespace-normal break-words text-[13px] font-semibold leading-snug md:text-sm">
                        {item.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 rounded-2xl border border-border/80 bg-background/55 p-3 md:grid-cols-[minmax(0,15rem)_1fr]">
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Título
                </span>
                <input
                  value={communityTitle}
                  maxLength={80}
                  onChange={(event) => setCommunityTitle(event.target.value)}
                  className="box-border h-10 w-full min-w-0 rounded-2xl border border-border bg-background/90 px-3.5 text-sm shadow-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>Mensagem</span>
                  <span className="tracking-normal">{communityBody.length}/220</span>
                </span>
                <textarea
                  ref={communityBodyRef}
                  value={communityBody}
                  maxLength={220}
                  rows={4}
                  onChange={(event) => {
                    setCommunityBody(event.target.value);
                    resizeTextarea(event.currentTarget);
                  }}
                  placeholder="Escreva como se fosse uma conversa curta com a cliente."
                  className="box-border min-h-[7rem] w-full min-w-0 resize-none rounded-2xl border border-border bg-background/90 px-3.5 py-3 text-sm leading-relaxed shadow-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-border/80 bg-muted/15 p-2.5 text-xs leading-relaxed text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>
                Para evitar spam, avisos repetidos do mesmo tipo ficam limitados por um curto intervalo.
              </span>
              <span className="shrink-0 rounded-full bg-background px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Envio com consentimento
              </span>
            </div>
          </div>

          <aside className="flex flex-col justify-between rounded-[1.15rem] border border-border/80 bg-background/80 p-3.5 shadow-sm">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Pré-visualização</p>
              <div className="mt-2.5 rounded-2xl border border-border/80 bg-card p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${selectedCommunityKind.tone}`}>
                    <SelectedCommunityIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug">{communityTitle || selectedCommunityKind.title}</p>
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {communityBody || selectedCommunityKind.body}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                O aviso aparece na central do cliente e, quando permitido pelo navegador, também chega como push no PWA.
              </p>
            </div>

            <button
              type="button"
              onClick={sendCommunityNotification}
              disabled={communityBusy || communityTitle.trim().length < 3 || communityBody.trim().length < 8}
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background shadow-lg shadow-black/10 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {communityBusy ? "A enviar..." : "Enviar aviso"}
            </button>
          </aside>
        </div>
      </section>

      <section className="rounded-[1.35rem] border border-border/80 bg-card p-3.5 shadow-sm md:p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Envio por WhatsApp</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Número de envio: {currentSettings.fromNumber || "Send.dm"}. Use esta área para afinar a
                mensagem antes de ativar o envio automático.
              </p>
            </div>
          </div>

          <label className="flex h-11 items-center justify-between gap-3 rounded-2xl border border-border/80 bg-background/70 px-3.5 text-sm font-medium lg:min-w-44">
            <span>Ativar envio</span>
            <input
              type="checkbox"
              checked={currentSettings.autoSendEnabled}
              onChange={(event) => save({ autoSendEnabled: event.target.checked })}
              className="size-4 accent-emerald-600"
            />
          </label>
          <button
            type="button"
            onClick={() => setShowWhatsAppDetails((current) => !current)}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-border/80 bg-background/70 px-4 text-xs font-bold uppercase tracking-wide text-foreground transition hover:border-foreground/20"
          >
            {showWhatsAppDetails ? "Ver menos" : "Ver mais"}
          </button>
        </div>
      </section>

      {showWhatsAppDetails && (
        <section className="rounded-[1.35rem] border border-border/80 bg-card p-3.5 shadow-sm md:p-4">
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
            className="box-border w-full min-w-0 resize-y rounded-2xl border border-border bg-background/85 px-3.5 py-2.5 text-sm leading-relaxed shadow-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
          />
        </label>

        <div className="mt-3 grid gap-3 rounded-2xl border border-border/80 bg-background/55 p-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Testar envio
            </span>
            <input
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="+351912345678"
              className="box-border h-10 w-full min-w-0 rounded-2xl border border-border bg-background/85 px-3.5 text-sm shadow-sm outline-none transition focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
            />
          </label>
          <button
            type="button"
            onClick={sendTest}
            disabled={busy || !testPhone.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            Testar
          </button>
        </div>
        </section>
      )}
    </div>
  );
}

function emptySettings(studioId: string): WhatsAppSettings {
  return {
    studioId,
    autoSendEnabled: false,
    messageTemplate:
      DEFAULT_TEMPLATE,
    provider: "senddm_whatsapp",
    fromNumber: "Send.dm",
    lastError: null,

  };
}

function resizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
}
