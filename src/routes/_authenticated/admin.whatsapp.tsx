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
      const result = await testMessage({ data: { studioId: studio.id, phone: testPhone } });
      if (result.delivered) {
        toast.success("Mensagem de teste entregue no WhatsApp.");
      } else {
        toast.info("Mensagem aceite pela operadora. A aguardar confirmação de entrega.");
      }
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
        toast.info(
          "Já foi enviado um aviso deste tipo há pouco tempo. Tente novamente mais tarde.",
        );
      } else if ((result as any)?.skipped === "no_followers") {
        toast.info("Ainda não existem clientes seguidores para este estúdio.");
      } else if ((result as any)?.sent === 0) {
        toast.success(
          "Aviso guardado na central dos seguidores. Ative as permissões push para receber fora do app.",
        );
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
    <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-2.5 pb-24 md:gap-4 md:pb-6">
      <header className="overflow-hidden rounded-[1.35rem] border border-border/80 bg-card shadow-sm lg:grid lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-center lg:gap-x-5 lg:px-5 lg:py-4">
        <p className="px-4 pt-4 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground md:px-5 md:pt-5 lg:px-0 lg:pt-0">
          Configurações
        </p>
        <h1 className="mt-1.5 px-4 text-2xl font-semibold tracking-tight md:px-5 md:text-3xl lg:px-0">
          Comunicação
        </h1>
        <p className="max-w-2xl px-4 pb-4 pt-2 text-sm leading-relaxed text-muted-foreground md:px-5 md:pb-5 lg:px-0 lg:pb-0">
          Envie avisos para seguidores do app do estúdio e mantenha as confirmações por WhatsApp.
        </p>
        <div className="grid grid-cols-3 gap-2 border-t border-border/70 bg-muted/20 p-3 md:p-4 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:border-t-0 lg:bg-transparent lg:p-0">
          <div className="flex min-h-[4.4rem] min-w-0 flex-col justify-center rounded-2xl border border-border/70 bg-background/70 p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Canais
            </p>
            <p className="mt-1 text-lg font-semibold leading-none">2</p>
          </div>
          <div className="flex min-h-[4.4rem] min-w-0 flex-col justify-center rounded-2xl border border-border/70 bg-background/70 p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Avisos
            </p>
            <p className="mt-1 text-lg font-semibold leading-none">{communityCampaigns.length}</p>
          </div>
          <div className="flex min-h-[4.4rem] min-w-0 flex-col justify-center rounded-2xl border border-border/70 bg-background/70 p-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              WhatsApp
            </p>
            <p className="mt-1 text-sm font-semibold leading-none">
              {currentSettings.autoSendEnabled ? "Ativo" : "Pausado"}
            </p>
          </div>
        </div>
      </header>

      <section className="overflow-hidden rounded-[1.35rem] bg-card shadow-sm ring-1 ring-border/60">
        <div className="grid gap-3 bg-muted/10 p-3 md:gap-4 md:p-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-sky-600/10 text-sky-700 dark:text-sky-300">
              <Users className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Notificações inteligentes
              </p>
              <h2 className="mt-1 text-base font-semibold tracking-tight md:text-lg">
                Comunidade privada do estúdio
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground md:text-sm">
                Envie avisos relevantes para clientes seguidores, com histórico no app e push apenas
                para quem autorizou.
              </p>
            </div>
          </div>
          <div className="min-w-0 rounded-2xl bg-background/55 p-2.5 text-xs leading-relaxed text-muted-foreground ring-1 ring-border/45 md:p-3">
            <BellRing className="mb-1.5 h-4 w-4 text-foreground/80" />
            Promoções, horários vagos, vagas liberadas, novos serviços e horários disponíveis.
          </div>
        </div>

        <div className="grid gap-3 p-3 md:gap-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="grid min-w-0 gap-3 md:gap-4">
            <div className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] sm:gap-2.5">
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
                    className={`group flex h-full min-h-[6.25rem] w-full min-w-0 flex-col items-start gap-2 rounded-xl px-2.5 py-2.5 text-left ring-1 transition sm:min-h-[3.9rem] sm:flex-row sm:items-center sm:gap-2.5 sm:rounded-2xl sm:px-3 ${
                      active
                        ? "bg-muted/45 text-foreground shadow-sm shadow-black/5 ring-foreground/20"
                        : "bg-muted/15 text-foreground ring-border/45 hover:bg-muted/25 hover:ring-foreground/15"
                    }`}
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-lg sm:size-9 sm:rounded-xl ${
                        active ? `${item.tone} ring-1 ring-current/10` : item.tone
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 self-stretch">
                      <span
                        className={`block overflow-hidden text-[9px] font-bold uppercase tracking-[0.1em] sm:text-[10px] sm:tracking-[0.14em] ${
                          active ? "text-muted-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {item.eyebrow}
                      </span>
                      <span className="mt-0.5 block min-h-[2rem] min-w-0 whitespace-normal break-normal text-[12px] font-semibold leading-[1.2] hyphens-none sm:min-h-0 sm:text-[13px] sm:leading-snug md:text-sm">
                        {item.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid min-w-0 gap-3 rounded-2xl bg-background/45 p-3.5 ring-1 ring-border/45 md:grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)] md:p-4">
              <label className="block min-w-0">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Título
                </span>
                <input
                  value={communityTitle}
                  maxLength={80}
                  onChange={(event) => setCommunityTitle(event.target.value)}
                  className="box-border h-11 w-full min-w-0 rounded-xl border border-border/70 bg-card/90 px-3.5 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
                />
              </label>
              <label className="block min-w-0">
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
                  className="box-border min-h-[7rem] w-full min-w-0 resize-none rounded-xl border border-border/70 bg-card/90 px-3.5 py-3 text-sm leading-relaxed outline-none transition placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:ring-2 focus:ring-ring/15"
                />
              </label>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl bg-muted/10 p-3 text-xs leading-relaxed text-muted-foreground ring-1 ring-border/35 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                Para evitar spam, avisos repetidos do mesmo tipo ficam limitados por um curto
                intervalo.
              </span>
              <span className="w-fit shrink-0 rounded-full bg-background/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Envio com consentimento
              </span>
            </div>
          </div>

          <aside className="flex min-w-0 flex-col justify-between self-start rounded-[1.15rem] bg-background/60 p-3 ring-1 ring-border/50 md:p-4 xl:sticky xl:top-24">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Pré-visualização
              </p>
              <div className="mt-2.5 rounded-[1.15rem] bg-card p-3.5 shadow-sm ring-1 ring-border/45">
                <div className="flex items-start gap-3">
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-xl ${selectedCommunityKind.tone}`}
                  >
                    <SelectedCommunityIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="line-clamp-2 break-normal text-sm font-semibold leading-snug hyphens-none">
                      {communityTitle || selectedCommunityKind.title}
                    </p>
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {communityBody || selectedCommunityKind.body}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground/85">
                O aviso aparece na central do cliente e, quando permitido pelo navegador, também
                chega como push no PWA.
              </p>
            </div>

            <button
              type="button"
              onClick={sendCommunityNotification}
              disabled={
                communityBusy || communityTitle.trim().length < 3 || communityBody.trim().length < 8
              }
              className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 text-xs font-bold uppercase tracking-[0.08em] text-background shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {communityBusy ? "A enviar..." : "Enviar aviso"}
            </button>
          </aside>
        </div>
      </section>

      <section className="rounded-[1.35rem] border border-border/80 bg-card p-3 shadow-sm md:p-4">
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[1fr_auto_auto] lg:items-center lg:gap-3">
          <div className="col-span-2 flex items-start gap-3 lg:col-span-1">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
              <MessageCircle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Envio por WhatsApp</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Canal de envio gerido pela Send.dm. Use esta área para afinar a mensagem antes de
                ativar o envio automático.
              </p>
            </div>
          </div>

          <label className="flex h-10 min-w-0 items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/70 px-2.5 text-xs font-medium sm:h-11 sm:rounded-2xl sm:px-3.5 sm:text-sm lg:min-w-44">
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
            className="inline-flex h-10 min-w-0 items-center justify-center rounded-xl border border-border/80 bg-background/70 px-2.5 text-[11px] font-bold uppercase tracking-wide text-foreground transition hover:border-foreground/20 sm:h-11 sm:rounded-2xl sm:px-4 sm:text-xs"
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
    messageTemplate: DEFAULT_TEMPLATE,
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
