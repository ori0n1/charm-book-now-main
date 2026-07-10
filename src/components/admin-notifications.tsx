import { forwardRef, useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellRing, CalendarCheck, CreditCard, RefreshCcw, Settings, X } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { reconcileStudioBookingPayments } from "@/lib/payments.functions";
import { savePushSubscription, sendTestPushNotification } from "@/lib/push-subscriptions.functions";
import { requestPushSubscription, shouldRefreshStoredPushSubscription } from "@/lib/pwa-push";
import { syncStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import { ClientAvatar } from "@/components/client-avatar";
import { ExpandableList } from "@/components/ui/expandable-list";

type StudioNotification = {
  id: string;
  studio_id: string;
  kind:
    | "new_appointment"
    | "payment_confirmed"
    | "payment_failed"
    | "refund_request"
    | "withdrawal_requested";
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type AdminNotificationsProps = {
  studioId: string;
  studioName: string;
};

const permissionStorageKey = "studio-notification-permission-asked";

export function AdminNotifications({ studioId, studioName }: AdminNotificationsProps) {
  const [items, setItems] = useState<StudioNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const reconcilePayments = useServerFn(reconcileStudioBookingPayments);
  const syncPushNotifications = useServerFn(syncStudioPushNotifications);
  const persistPushSubscription = useServerFn(savePushSubscription);
  const sendTestPush = useServerFn(sendTestPushNotification);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted" || !studioId) return;
    let cancelled = false;
    requestPushSubscription({ forceRenew: shouldRefreshStoredPushSubscription(`studio:${studioId}`) })
      .then((result) => {
        if (cancelled || result.permission !== "granted" || !result.subscription) return;
        return persistPushSubscription({
          data: {
            audience: "studio",
            studioId,
            subscription: result.subscription,
          },
        });
      })
      .catch((error) => console.warn("studio_push_auto_register_failed", error));
    return () => {
      cancelled = true;
    };
  }, [persistPushSubscription, studioId]);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator) || !studioId) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "BELLZA_PUSH_SUBSCRIPTION_CHANGED") return;
      void requestPushSubscription({ forceRenew: true })
        .then((result) => {
          if (result.permission !== "granted" || !result.subscription) return;
          return persistPushSubscription({
            data: {
              audience: "studio",
              studioId,
              subscription: result.subscription,
            },
          });
        })
        .catch((error) => console.warn("studio_push_subscription_refresh_failed", error));
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [persistPushSubscription, studioId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();

    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!studioId) return;
    let cancelled = false;

    async function loadNotifications() {
      const { data, error } = await (supabase as any)
        .from("studio_notifications")
        .select("id,studio_id,kind,title,body,payload,read_at,created_at")
        .eq("studio_id", studioId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (!cancelled && !error) {
        setItems(((data ?? []) as StudioNotification[]).map(normalizeNotification));
      }
    }

    async function syncAndLoadNotifications() {
      try {
        await reconcilePayments({ data: { studioId } });
      } catch (error) {
        console.warn("studio_payment_reconcile_skipped", error);
      }
      try {
        await syncPushNotifications({ data: { studioId } });
      } catch (error) {
        console.warn("studio_push_sync_skipped", error);
      }
      await loadNotifications();
    }

    void syncAndLoadNotifications();

    const channel = supabase
      .channel(`studio-notifications-${studioId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "studio_notifications",
          filter: `studio_id=eq.${studioId}`,
        },
        (payload) => {
          const next = normalizeNotification(payload.new as StudioNotification);
          setItems((current) =>
            [next, ...current.filter((item) => item.id !== next.id)].slice(0, 20),
          );
          toast(next.title, { description: next.body });
          showBrowserNotification(next, studioName);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "studio_notifications",
          filter: `studio_id=eq.${studioId}`,
        },
        (payload) => {
          const next = normalizeNotification(payload.new as StudioNotification);
          setItems((current) => current.map((item) => (item.id === next.id ? next : item)));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [reconcilePayments, studioId, studioName, syncPushNotifications]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const unreadCount = useMemo(() => items.filter((item) => !item.read_at).length, [items]);

  async function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await requestPushSubscription();
    const next = result.permission;
    localStorage.setItem(permissionStorageKey, "true");
    if (next === "missing_vapid_key") {
      toast.message("Não foi possível ativar notificações agora. Tente novamente em instantes.");
      return;
    }
    if (next === "unsupported") {
      toast.message("As notificações push não estão disponíveis neste navegador.");
      return;
    }
    if (next === "insecure_context") {
      toast.message("As notificações push exigem HTTPS. Abra pelo domínio oficial da Bellza.");
      return;
    }
    if (next === "push_unsupported") {
      toast.message("Este navegador não suporta push neste modo. No iPhone, use o PWA instalado.");
      return;
    }
    setPermission(next);
    if (next === "granted" && result.subscription) {
      await persistPushSubscription({
        data: {
          audience: "studio",
          studioId,
          subscription: result.subscription,
        },
      });
      toast.success("Avisos push ativados neste dispositivo.");
      void sendTestPush({ data: { audience: "studio", studioId } });
    }
  }

  async function markAsRead(id: string) {
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read_at: item.read_at ?? readAt } : item)),
    );

    await (supabase as any)
      .from("studio_notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .eq("studio_id", studioId)
      .is("read_at", null);
  }

  async function markAllRead() {
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    await (supabase as any)
      .from("studio_notifications")
      .update({ read_at: readAt })
      .eq("studio_id", studioId)
      .is("read_at", null);
  }

  const panel = (
    <>
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Central</p>
            <h2 className="mt-1 text-base font-semibold">Notificações</h2>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border px-2.5 text-center text-[10px] font-semibold leading-none text-muted-foreground transition hover:bg-muted hover:text-foreground sm:px-3 sm:text-[11px]"
            >
              Marcar todas como lidas
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border/80 bg-background/60 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="Fechar notificações"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {permission !== "granted" && (
          <button
            type="button"
            onClick={requestPermission}
            className="mt-3 flex w-full items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-left text-xs text-emerald-700 transition hover:bg-emerald-500/15 dark:text-emerald-300"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" />
            Ativar avisos do navegador neste dispositivo
          </button>
        )}
      </div>

      <div className="max-h-[min(70vh,26rem)] overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-3xl bg-muted text-muted-foreground">
              <Bell className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-semibold">Sem notificações</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Novas marcações e pagamentos aparecem aqui.
            </p>
          </div>
        ) : (
          <ExpandableList
            items={items}
            initialCount={5}
            className="space-y-1.5"
            getKey={(item) => item.id}
            moreLabel={(hidden) => `Ver mais (${hidden})`}
            renderItem={(item) => {
              const Icon =
                item.kind === "payment_confirmed"
                  ? CreditCard
                  : item.kind === "payment_failed" ||
                      item.kind === "refund_request" ||
                      item.kind === "withdrawal_requested"
                    ? RefreshCcw
                    : CalendarCheck;
              const clientName =
                readPayloadString(item.payload, "clientName") ??
                readPayloadString(item.payload, "client_name") ??
                null;
              const clientAvatarUrl =
                readPayloadString(item.payload, "clientAvatarUrl") ??
                readPayloadString(item.payload, "client_avatar_url") ??
                null;
              return (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => markAsRead(item.id)}
                  className={`flex w-full gap-3 rounded-3xl px-3 py-3 text-left transition ${
                    item.read_at
                      ? "hover:bg-muted/65"
                      : "bg-emerald-500/10 ring-1 ring-emerald-500/15 hover:bg-emerald-500/15"
                  }`}
                >
                  {clientName || clientAvatarUrl ? (
                    <ClientAvatar
                      name={clientName ?? item.title}
                      avatarUrl={clientAvatarUrl}
                      className="mt-0.5 size-9 text-xs"
                    />
                  ) : (
                    <span
                      className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-2xl ${
                        item.kind === "payment_confirmed"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                          : item.kind === "payment_failed" ||
                              item.kind === "refund_request" ||
                              item.kind === "withdrawal_requested"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-300"
                            : "bg-primary/10 text-primary"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{item.title}</span>
                      {!item.read_at && (
                        <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
                      )}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                      {item.body}
                    </span>
                    <span className="mt-2 block text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {formatNotificationTime(item.created_at)}
                    </span>
                  </span>
                </button>
              );
            }}
          />
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <>
        <NotificationBell
          unreadCount={unreadCount}
          onClick={() => setOpen((current) => !current)}
        />
        {open && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-background/10 backdrop-blur-[1px]"
              aria-label="Fechar notificações"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-4 right-4 top-[calc(env(safe-area-inset-top)+5.65rem)] max-h-[calc(100vh-8rem)] overflow-hidden rounded-[1.35rem] border border-border/80 bg-popover/98 text-popover-foreground shadow-2xl shadow-black/20 duration-200 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2">
              {panel}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <NotificationBell unreadCount={unreadCount} open={open} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        sideOffset={12}
        className="z-[80] w-[min(calc(100vw-1rem),24.5rem)] overflow-hidden rounded-[1.35rem] border-border/80 bg-popover/98 p-0 shadow-2xl shadow-black/18 backdrop-blur-xl duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1"
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}

type NotificationBellProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  unreadCount: number;
  open?: boolean;
};

const NotificationBell = forwardRef<HTMLButtonElement, NotificationBellProps>(function NotificationBell(
  { unreadCount, open, className = "", ...props },
  ref,
) {
  return (
    <button
      type="button"
      ref={ref}
      className={`relative grid h-9 w-9 place-items-center rounded-2xl border border-border bg-card text-foreground shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-muted hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${open ? "bg-muted shadow-md ring-1 ring-border" : ""} ${className}`}
      aria-label="Abrir notificações"
      aria-pressed={open}
      {...props}
    >
      {unreadCount > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {unreadCount > 0 && (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-background">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </button>
  );
});

function showBrowserNotification(item: StudioNotification, studioName: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const title = normalizeDisplayText(sanitizeNotificationText(item.title, adminNotificationTitle(item.kind)));
  const body = normalizeDisplayText(sanitizeNotificationText(item.body, adminNotificationBody(item.kind)));
  const notification = new Notification("Bellza", {
    body: [title, body].filter(Boolean).join("\n"),
    tag: item.id,
    icon: "/pwa-icon.svg",
    badge: "/pwa-icon.svg",
    data: { studioName, url: "/admin" },
  });

  notification.onclick = () => {
    window.focus();
    if (window.location.pathname !== "/admin") window.location.assign("/admin");
    notification.close();
  };
}

function readPayloadString(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNotification(item: StudioNotification): StudioNotification {
  return {
    ...item,
    title: normalizeDisplayText(sanitizeNotificationText(item.title, adminNotificationTitle(item.kind))),
    body: normalizeDisplayText(sanitizeNotificationText(item.body, adminNotificationBody(item.kind))),
  };
}

function adminNotificationTitle(kind: string) {
  if (kind === "new_appointment") return "Nova marcação recebida";
  if (kind === "payment_confirmed") return "Pagamento confirmado";
  if (kind === "payment_failed") return "Falha no pagamento";
  if (kind === "refund_request") return "Pedido de reembolso recebido";
  if (kind === "withdrawal_requested") return "Pedido financeiro recebido";
  return "Notificação do painel";
}

function adminNotificationBody(kind: string) {
  if (kind === "new_appointment") return "Tem uma nova marcação para acompanhar no painel.";
  if (kind === "payment_confirmed") return "Um pagamento foi confirmado.";
  if (kind === "payment_failed") return "Um pagamento precisa de atenção.";
  if (kind === "refund_request") return "Existe um pedido de reembolso para analisar.";
  if (kind === "withdrawal_requested") return "Existe uma nova atualização financeira para analisar.";
  return "Tem uma nova ação importante no painel.";
}

function sanitizeNotificationText(value: string, fallback: string) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const technicalPattern =
    /\b(from|insert|update|delete|upsert|select|payload|schema|table|row|uuid|endpoint|subscription|webhook)\b|notifications_log|studio_notifications|push_subscriptions|appointment_created|update_professional_status|push_client|push_studio|[_{}[\]"`]/i;
  if (technicalPattern.test(text)) return fallback;
  return text.replace(/\s+from\s+\S+$/i, "").trim() || fallback;
}

function normalizeDisplayText(value: string) {
  const broken = (...codes: number[]) => String.fromCharCode(...codes);
  const replacements: Array<[string, string]> = [
    [broken(0x53, 0x65, 0x72, 0x76, 0x69, 0xc3, 0xa7, 0x6f), "Serviço"],
    [broken(0x73, 0x65, 0x72, 0x76, 0x69, 0xc3, 0xa7, 0x6f), "serviço"],
    [broken(0x6d, 0x61, 0x72, 0x63, 0x61, 0xc3, 0xa7, 0xc3, 0xa3, 0x6f), "marcação"],
    [broken(0x6d, 0x61, 0x72, 0x63, 0x61, 0xc3, 0xa7, 0xc3, 0xb5, 0x65, 0x73), "marcações"],
    [broken(0x4d, 0x61, 0x72, 0x63, 0x61, 0xc3, 0xa7, 0xc3, 0xa3, 0x6f), "Marcação"],
    [
      broken(0x4e, 0x6f, 0x76, 0x61, 0x20, 0x6d, 0x61, 0x72, 0x63, 0x61, 0xc3, 0xa7, 0xc3, 0xa3, 0x6f, 0x20, 0x72, 0x65, 0x63, 0x65, 0x62, 0x69, 0x64, 0x61),
      "Nova marcação recebida",
    ],
    [broken(0x4e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63, 0x61, 0xc3, 0xa7, 0xc3, 0xb5, 0x65, 0x73), "Notificações"],
    [broken(0x6e, 0x6f, 0x74, 0x69, 0x66, 0x69, 0x63, 0x61, 0xc3, 0xa7, 0xc3, 0xb5, 0x65, 0x73), "notificações"],
    [broken(0x64, 0x69, 0x73, 0x70, 0x6f, 0x6e, 0xc3, 0xad, 0x76, 0x65, 0x6c), "disponível"],
    [broken(0x43, 0x6f, 0x6e, 0x63, 0x6c, 0x75, 0xc3, 0xad, 0x64, 0x6f), "Concluída"],
    [broken(0x4e, 0xc3, 0xa3, 0x6f), "Não"],
    [broken(0x6e, 0xc3, 0xa3, 0x6f), "não"],
    [broken(0x76, 0xc3, 0xa1, 0x6c, 0x69, 0x64, 0x6f), "válido"],
    [broken(0x74, 0x72, 0x61, 0x6e, 0x73, 0x66, 0x65, 0x72, 0xc3, 0xaa, 0x6e, 0x63, 0x69, 0x61), "transferência"],
    [broken(0x54, 0x72, 0x61, 0x6e, 0x73, 0x66, 0x65, 0x72, 0xc3, 0xaa, 0x6e, 0x63, 0x69, 0x61), "Transferência"],
    [broken(0xe2, 0x201a, 0xac), "€"],
    [broken(0xc2, 0xb7), "·"],
  ];

  return replacements.reduce(
    (current, [broken, clean]) => current.replaceAll(broken, clean),
    value,
  );
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
