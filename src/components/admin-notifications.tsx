import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  BellRing,
  CalendarCheck,
  CreditCard,
  RefreshCcw,
  Settings,
  Star,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { reconcileStudioBookingPayments } from "@/lib/payments.functions";
import {
  getStudioPushHealth,
  savePushSubscription,
  sendTestPushNotification,
} from "@/lib/push-subscriptions.functions";
import {
  requestPushSubscription,
  shouldRefreshStoredPushSubscription,
} from "@/lib/pwa-push";
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
    | "appointment_rescheduled"
    | "appointment_cancelled"
    | "new_client"
    | "new_review"
    | "refund_request"
    | "withdrawal_requested"
    | "critical_request";
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

type AdminNotificationsProps = {
  studioId: string;
  studioName: string;
};

const permissionStorageKey = "studio-notification-permission-asked";
const PUSH_RECONCILE_TTL_MS = 5 * 60 * 1000;

export function AdminNotifications({ studioId, studioName }: AdminNotificationsProps) {
  const [items, setItems] = useState<StudioNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const reconcilePayments = useServerFn(reconcileStudioBookingPayments);
  const syncPushNotifications = useServerFn(syncStudioPushNotifications);
  const persistPushSubscription = useServerFn(savePushSubscription);
  const sendTestPush = useServerFn(sendTestPushNotification);
  const loadPushHealth = useServerFn(getStudioPushHealth);
  const pushRegistrationRef = useRef<Promise<boolean> | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );
  const [pushNeedsAttention, setPushNeedsAttention] = useState(false);

  const registerStudioPush = useCallback(
    async (options: { forceRenew?: boolean } = {}): Promise<boolean> => {
      if (pushRegistrationRef.current) return pushRegistrationRef.current;

      const registration: Promise<boolean> = (async (): Promise<boolean> => {
        let forceRenew = Boolean(options.forceRenew);
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await requestPushSubscription({ forceRenew });
          setPermission(
            result.permission === "granted" ||
              result.permission === "denied" ||
              result.permission === "default"
              ? result.permission
              : "unsupported",
          );
          if (result.permission !== "granted" || !result.subscription) {
            setPushNeedsAttention(true);
            return false;
          }

          const saved = (await persistPushSubscription({
            data: {
              audience: "studio",
              studioId,
              subscription: result.subscription,
            },
          })) as { ok: boolean; requiresRenewal?: boolean };

          if (saved.requiresRenewal && !forceRenew) {
            forceRenew = true;
            continue;
          }

          setPushNeedsAttention(!saved.ok);
          return saved.ok;
        }
        setPushNeedsAttention(true);
        return false;
      })()
        .catch((error: unknown) => {
          setPushNeedsAttention(true);
          console.warn("studio_push_registration_failed", error);
          return false;
        })
        .finally(() => {
          pushRegistrationRef.current = null;
        });

      pushRegistrationRef.current = registration;
      return registration;
    },
    [persistPushSubscription, studioId],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || !studioId) return;
    setPermission(Notification.permission);
    setPushNeedsAttention(Notification.permission !== "granted");
    if (Notification.permission === "granted") {
      void loadPushHealth({ data: { studioId } })
        .then((health) =>
          registerStudioPush({
            forceRenew: Number(health.activeDevices ?? 0) === 0,
          }),
        )
        .catch((error) => {
          console.warn("studio_push_health_check_failed", error);
          return registerStudioPush();
        });
    }
  }, [loadPushHealth, registerStudioPush, studioId]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("Notification" in window) ||
      !studioId
    ) {
      return;
    }

    const reconcileWhenUsable = () => {
      if (Notification.permission !== "granted") {
        setPermission(Notification.permission);
        setPushNeedsAttention(true);
        return;
      }
      if (
        shouldRefreshStoredPushSubscription(
          `studio:${studioId}`,
          PUSH_RECONCILE_TTL_MS,
        )
      ) {
        void registerStudioPush();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "BELLZA_PUSH_SUBSCRIPTION_CHANGED") return;
      void registerStudioPush({ forceRenew: !event.data?.subscription });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") reconcileWhenUsable();
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    navigator.serviceWorker.addEventListener("controllerchange", reconcileWhenUsable);
    window.addEventListener("online", reconcileWhenUsable);
    window.addEventListener("pageshow", reconcileWhenUsable);
    window.addEventListener("focus", reconcileWhenUsable);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", reconcileWhenUsable);
      window.removeEventListener("online", reconcileWhenUsable);
      window.removeEventListener("pageshow", reconcileWhenUsable);
      window.removeEventListener("focus", reconcileWhenUsable);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [registerStudioPush, studioId]);

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
      const [historyResult, unreadResult] = await Promise.all([
        (supabase as any)
          .from("studio_notifications")
          .select("id,studio_id,kind,title,body,payload,action_url,read_at,created_at")
          .eq("studio_id", studioId)
          .order("created_at", { ascending: false })
          .limit(100),
        (supabase as any)
          .from("studio_notifications")
          .select("id", { count: "exact", head: true })
          .eq("studio_id", studioId)
          .is("read_at", null),
      ]);

      if (!cancelled && !historyResult.error) {
        setItems(
          ((historyResult.data ?? []) as StudioNotification[]).map(normalizeNotification),
        );
      }
      if (!cancelled && !unreadResult.error) {
        setUnreadCount(Number(unreadResult.count ?? 0));
      }
    }

    async function syncAndLoadNotifications() {
      await loadNotifications();
      void Promise.allSettled([
        reconcilePayments({ data: { studioId } }).catch((error) => {
          console.warn("studio_payment_reconcile_skipped", error);
        }),
        syncPushNotifications({ data: { studioId } }).catch((error) => {
          console.warn("studio_push_sync_skipped", error);
        }),
      ]).then(() => {
        if (!cancelled) void loadNotifications();
      });
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
          setItems((current) => {
            const alreadyLoaded = current.some((item) => item.id === next.id);
            if (!alreadyLoaded && !next.read_at) {
              setUnreadCount((count) => count + 1);
            }
            return [next, ...current.filter((item) => item.id !== next.id)].slice(0, 100);
          });
          if (shouldShowRealtimeToast(studioId, next.id)) {
            toast(next.title, {
              description: next.body,
              action: {
                label: "Abrir",
                onClick: () => window.location.assign(notificationActionUrl(next)),
              },
            });
          }
          void syncPushNotifications({ data: { studioId } }).catch((error) => {
            console.warn("studio_push_realtime_dispatch_failed", error);
          });
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
          setItems((current) => {
            const existing = current.find((item) => item.id === next.id);
            if (!existing && next.read_at) {
              setUnreadCount((count) => Math.max(0, count - 1));
            }
            return current.map((item) => {
              if (item.id !== next.id) return item;
              if (!item.read_at && next.read_at) {
                setUnreadCount((count) => Math.max(0, count - 1));
              } else if (item.read_at && !next.read_at) {
                setUnreadCount((count) => count + 1);
              }
              return next;
            });
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void loadNotifications();
      });

    const recoverNotifications = () => {
      if (document.visibilityState === "hidden") return;
      void syncAndLoadNotifications();
    };
    window.addEventListener("online", recoverNotifications);
    document.addEventListener("visibilitychange", recoverNotifications);

    return () => {
      cancelled = true;
      window.removeEventListener("online", recoverNotifications);
      document.removeEventListener("visibilitychange", recoverNotifications);
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
      const saved = (await persistPushSubscription({
        data: {
          audience: "studio",
          studioId,
          subscription: result.subscription,
        },
      })) as { ok: boolean; requiresRenewal?: boolean };
      const activated = saved.requiresRenewal
        ? await registerStudioPush({ forceRenew: true })
        : saved.ok;
      setPushNeedsAttention(!activated);
      if (activated) {
        toast.success("Avisos push ativados neste dispositivo.");
        void sendTestPush({ data: { audience: "studio", studioId } });
      } else {
        toast.message("Não foi possível concluir a ativação. Tente novamente.");
      }
    } else if (next === "denied") {
      setPushNeedsAttention(true);
      toast.message(
        "As notificações estão bloqueadas. Autorize a Bellza nas definições do navegador.",
      );
    }
  }

  async function markAsRead(id: string) {
    const wasUnread = items.some((item) => item.id === id && !item.read_at);
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, read_at: item.read_at ?? readAt } : item)),
    );
    if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));

    const { error } = await (supabase as any)
      .from("studio_notifications")
      .update({ read_at: readAt })
      .eq("id", id)
      .eq("studio_id", studioId)
      .is("read_at", null);
    if (error) {
      await reloadNotificationState();
      toast.error("Não foi possível marcar a notificação como lida.");
    }
  }

  async function markAllRead() {
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at ?? readAt })));
    setUnreadCount(0);
    const { error } = await (supabase as any)
      .from("studio_notifications")
      .update({ read_at: readAt })
      .eq("studio_id", studioId)
      .is("read_at", null);
    if (error) {
      await reloadNotificationState();
      toast.error("Não foi possível marcar todas como lidas.");
    }
  }

  async function reloadNotificationState() {
    const [historyResult, unreadResult] = await Promise.all([
      (supabase as any)
        .from("studio_notifications")
        .select("id,studio_id,kind,title,body,payload,action_url,read_at,created_at")
        .eq("studio_id", studioId)
        .order("created_at", { ascending: false })
        .limit(100),
      (supabase as any)
        .from("studio_notifications")
        .select("id", { count: "exact", head: true })
        .eq("studio_id", studioId)
        .is("read_at", null),
    ]);
    if (!historyResult.error) {
      setItems(
        ((historyResult.data ?? []) as StudioNotification[]).map(normalizeNotification),
      );
    }
    if (!unreadResult.error) setUnreadCount(Number(unreadResult.count ?? 0));
  }

  const panel = (
    <>
      <div className="border-b border-border/70 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Central</p>
            <h2 className="mt-1 text-base font-semibold" title={`Notificações de ${studioName}`}>
              Notificações
            </h2>
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
              Marcações, pagamentos, clientes, avaliações e solicitações aparecem aqui.
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
                  : item.kind === "new_client"
                    ? UserPlus
                    : item.kind === "new_review"
                      ? Star
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
                  onClick={async () => {
                    await markAsRead(item.id);
                    setOpen(false);
                    const target = notificationActionUrl(item);
                    if (`${window.location.pathname}${window.location.search}` !== target) {
                      window.location.assign(target);
                    }
                  }}
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
          pushNeedsAttention={pushNeedsAttention}
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
        <NotificationBell
          unreadCount={unreadCount}
          open={open}
          pushNeedsAttention={pushNeedsAttention}
        />
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
  pushNeedsAttention?: boolean;
};

const NotificationBell = forwardRef<HTMLButtonElement, NotificationBellProps>(function NotificationBell(
  { unreadCount, open, pushNeedsAttention, className = "", ...props },
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
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
      {unreadCount === 0 && pushNeedsAttention && (
        <span
          className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-background"
          aria-hidden="true"
        />
      )}
    </button>
  );
});

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

function notificationActionUrl(item: StudioNotification) {
  const candidate =
    item.action_url ?? readPayloadString(item.payload, "action_url") ?? "/admin";
  if (!candidate.startsWith("/admin")) return "/admin";
  try {
    const url = new URL(candidate, window.location.origin);
    return url.origin === window.location.origin && url.pathname.startsWith("/admin")
      ? `${url.pathname}${url.search}${url.hash}`
      : "/admin";
  } catch {
    return "/admin";
  }
}

function shouldShowRealtimeToast(studioId: string, notificationId: string) {
  if (typeof window === "undefined") return false;
  const key = `bellza:studio-notification-toast:${studioId}:${notificationId}`;
  if (window.localStorage.getItem(key)) return false;
  window.localStorage.setItem(key, String(Date.now()));
  return true;
}

function adminNotificationTitle(kind: string) {
  if (kind === "new_appointment") return "Nova marcação recebida";
  if (kind === "appointment_rescheduled") return "Marcação remarcada";
  if (kind === "appointment_cancelled") return "Marcação cancelada";
  if (kind === "payment_confirmed") return "Pagamento confirmado";
  if (kind === "payment_failed") return "Falha no pagamento";
  if (kind === "new_client") return "Novo cliente cadastrado";
  if (kind === "new_review") return "Nova avaliação recebida";
  if (kind === "refund_request") return "Pedido de reembolso recebido";
  if (kind === "withdrawal_requested") return "Pedido financeiro recebido";
  return "Notificação do painel";
}

function adminNotificationBody(kind: string) {
  if (kind === "new_appointment") return "Tem uma nova marcação para acompanhar no painel.";
  if (kind === "payment_confirmed") return "Um pagamento foi confirmado.";
  if (kind === "payment_failed") return "Um pagamento precisa de atenção.";
  if (kind === "appointment_rescheduled") return "Uma marcação foi remarcada.";
  if (kind === "appointment_cancelled") return "Uma marcação foi cancelada.";
  if (kind === "new_client") return "Um novo cliente foi adicionado ao estúdio.";
  if (kind === "new_review") return "O estúdio recebeu uma nova avaliação.";
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
