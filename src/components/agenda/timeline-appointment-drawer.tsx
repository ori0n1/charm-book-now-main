import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  CreditCard,
  Loader2,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import { ClientAvatar } from "@/components/client-avatar";

export type TimelineDrawerAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

export type TimelineDrawerDetails = {
  clientName: string;
  clientAvatarUrl?: string | null;
  clientPhone?: string | null;
  serviceName: string;
  professionalName: string;
  startsAt: string;
  endsAt: string;
  durationLabel: string;
  statusLabel: string;
  paymentLabel: string;
  messageLabel?: string | null;
  notes?: string | null;
  valueLabel: string;
};

export function TimelineAppointmentDrawer({
  details,
  actions,
  onClose,
  onConfirmCancel,
  cancelling,
}: {
  details: TimelineDrawerDetails;
  actions: TimelineDrawerAction[];
  onClose: () => void;
  onConfirmCancel?: () => void;
  cancelling?: boolean;
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[10000]">
      <button
        type="button"
        aria-label="Fechar detalhes"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <aside className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-[1.6rem] border-t border-border bg-card shadow-2xl animate-in slide-in-from-bottom-3 duration-200 md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[27rem] md:rounded-none md:rounded-l-[1.6rem] md:border-l md:border-t-0 md:slide-in-from-right-3">
        <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-3.5 md:px-5">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              Detalhes da marcação
            </p>
            <p className="mt-0.5 truncate text-base font-black" title={details.clientName}>
              {details.clientName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
          <div className="rounded-2xl border border-border/70 bg-muted/25 p-3.5">
            <div className="flex items-start gap-3">
              <ClientAvatar
                name={details.clientName}
                avatarUrl={details.clientAvatarUrl}
                className="size-10 shrink-0 text-xs"
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-black">{details.clientName}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {details.serviceName}
                </p>
                {details.clientPhone && (
                  <a
                    href={`tel:${details.clientPhone}`}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-foreground hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {details.clientPhone}
                  </a>
                )}
              </div>
              <span className="ml-auto shrink-0 rounded-full bg-background px-2 py-1 text-[9px] font-black uppercase tracking-wide text-muted-foreground ring-1 ring-border/70">
                {details.statusLabel}
              </span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <DetailTile
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label="Data"
              value={formatDate(details.startsAt)}
            />
            <DetailTile
              icon={<Clock3 className="h-3.5 w-3.5" />}
              label="Horário"
              value={`${formatTime(details.startsAt)}–${formatTime(details.endsAt)}`}
            />
            <DetailTile
              icon={<UserRound className="h-3.5 w-3.5" />}
              label="Profissional"
              value={details.professionalName || "Não definido"}
            />
            <DetailTile
              icon={<CreditCard className="h-3.5 w-3.5" />}
              label="Pagamento"
              value={details.paymentLabel}
            />
          </div>

          <div className="mt-3 rounded-2xl border border-border/70 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Duração
              </span>
              <span className="whitespace-nowrap text-xs font-black">{details.durationLabel}</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Valor
              </span>
              <span className="whitespace-nowrap text-sm font-black text-emerald-700 dark:text-emerald-400">
                {details.valueLabel}
              </span>
            </div>
            {details.messageLabel && (
              <div className="mt-2 flex items-start justify-between gap-3 border-t border-border/60 pt-2">
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Comunicação
                </span>
                <span className="text-right text-xs font-semibold">{details.messageLabel}</span>
              </div>
            )}
          </div>

          {details.notes && (
            <div className="mt-3 rounded-2xl border border-border/70 bg-muted/20 px-3.5 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                Observações
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-relaxed">
                {details.notes}
              </p>
            </div>
          )}

          {actions.length > 0 && !confirmingCancel && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={
                    action.id === "cancel" ? () => setConfirmingCancel(true) : action.onClick
                  }
                  disabled={action.disabled}
                  className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-center text-xs font-bold transition disabled:opacity-50 ${
                    action.id === "cancel" ? "col-span-2 w-full" : ""
                  } ${
                    action.danger
                      ? "border-rose-300/70 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
                      : "border-border bg-background/70 text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="shrink-0">{action.icon}</span>
                  <span className="min-w-0 leading-tight">{action.label}</span>
                </button>
              ))}
            </div>
          )}

          {confirmingCancel && (
            <div className="mt-4 rounded-2xl border border-rose-300/70 bg-rose-50 p-4 text-center dark:border-rose-500/25 dark:bg-rose-500/10">
              <AlertTriangle className="mx-auto h-5 w-5 text-rose-600 dark:text-rose-300" />
              <p className="mt-2 text-sm font-black">Cancelar esta marcação?</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Esta ação utiliza exatamente o cancelamento atual do painel.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  className="h-10 rounded-xl border border-border bg-card text-xs font-bold"
                >
                  Manter
                </button>
                <button
                  type="button"
                  onClick={onConfirmCancel}
                  disabled={cancelling}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-3 text-xs font-black text-white disabled:opacity-60"
                >
                  {cancelling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function DetailTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background/60 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-black" title={value}>
        {value}
      </p>
    </div>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-PT", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
