import { forwardRef, useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { Bell, BellRing, CalendarCheck, CreditCard, RefreshCcw, Settings } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";

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
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

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

    void loadNotifications();

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
  }, [studioId, studioName]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (window.matchMedia("(max-width: 767px)").matches) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(permissionStorageKey) === "true") return;

    const timer = window.setTimeout(() => {
      localStorage.setItem(permissionStorageKey, "true");
      void Notification.requestPermission().then((next) => setPermission(next));
    }, 1400);

    return () => window.clearTimeout(timer);
  }, []);

  const unreadCount = useMemo(() => items.filter((item) => !item.read_at).length, [items]);

  async function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const next = await Notification.requestPermission();
    localStorage.setItem(permissionStorageKey, "true");
    setPermission(next);
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
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Central</p>
            <h2 className="mt-1 text-base font-semibold">Notificações</h2>
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Ler tudo
            </button>
          )}
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
          <div className="space-y-1.5">
            {items.map((item) => {
              const Icon =
                item.kind === "payment_confirmed"
                  ? CreditCard
                  : item.kind === "payment_failed" ||
                      item.kind === "refund_request" ||
                      item.kind === "withdrawal_requested"
                    ? RefreshCcw
                    : CalendarCheck;
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
            })}
          </div>
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
            <div className="absolute left-4 right-4 top-[calc(env(safe-area-inset-top)+5.65rem)] max-h-[calc(100vh-8rem)] overflow-hidden rounded-[1.35rem] border border-border/80 bg-popover/98 text-popover-foreground shadow-2xl shadow-black/20">
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
        className="z-[80] w-[min(calc(100vw-1rem),24.5rem)] overflow-hidden rounded-[1.35rem] border-border/80 bg-popover/98 p-0 shadow-2xl shadow-black/18 backdrop-blur-xl duration-200 data-[state=open]:slide-in-from-top-1"
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

  const notification = new Notification(item.title, {
    body: item.body,
    tag: item.id,
    icon: "/pwa-icon.svg",
    badge: "/pwa-icon.svg",
    data: { studioName },
  });

  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function normalizeNotification(item: StudioNotification): StudioNotification {
  return {
    ...item,
    title: normalizeDisplayText(item.title),
    body: normalizeDisplayText(item.body),
  };
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
    [broken(0x43, 0x6f, 0x6e, 0x63, 0x6c, 0x75, 0xc3, 0xad, 0x64, 0x6f), "Concluído"],
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
