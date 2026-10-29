import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  Euro,
  Loader2,
  Pencil,
  Phone,
  UserRound,
  X,
} from "lucide-react";
import { ClientAvatar } from "@/components/client-avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatStudioTime, normalizeStudioTimeZone } from "@/lib/studio-time";
import { useModalScrollLock } from "@/lib/modal-scroll-lock";
import { isValidInternationalPhone, normalizeInternationalPhone } from "@/components/ui/international-phone-input";

export type DrawerPaymentMethod = "cash" | "card" | "mb_way" | "bank_transfer" | "other";
type PaymentSummary = { amount: number; label?: string };
const paymentMethods: Array<{ value: DrawerPaymentMethod; label: string }> = [
  { value: "cash", label: "Dinheiro" }, { value: "card", label: "Cartão" },
  { value: "mb_way", label: "MB WAY" }, { value: "other", label: "Outro" },
];

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
  jointBooking?: boolean;
  serviceAssignments?: Array<{
    serviceId?: string;
    serviceName: string;
    professionalId?: string;
    professionalName: string;
    startsAt: string;
    endsAt: string;
    valueLabel?: string;
    statusLabel?: string;
    serviceState?: string | null;
    potentialRefundLabel?: string | null;
  }>;
  startsAt: string;
  endsAt: string;
  durationLabel: string;
  statusLabel: string;
  status: string;
  paymentLabel: string;
  paymentBreakdown?: Array<{ label: string; value: string }>;
  paymentDetails?: string[];
  messageLabel?: string | null;
  notes?: string | null;
  valueLabel: string;
  scheduleHistory?: Array<{
    label: string;
    detail: string;
    createdAt: string;
  }>;
};

export function TimelineAppointmentDrawer({
  details,
  actions,
  onClose,
  onChangeAttendance,
  onConfirmCancel,
  cancellationReasonRequired = false,
  cancellationFinancialNotice,
  cancelling,
  onServiceState,
  onServiceReschedule,
  onServicePayment,
  payment,
  canUndoManualReceipt = false,
  onUndoManualReceipt,
  paymentMovements = [],
  onCorrectPaymentMethod,
  correctingPaymentMethod = false,
  updatingServiceId,
  timeZone,
}: {
  details: TimelineDrawerDetails;
  actions: TimelineDrawerAction[];
  onClose: () => void;
  onChangeAttendance?: (status: "confirmed" | "completed" | "no_show") => Promise<boolean>;
  onConfirmCancel?: (reason: string) => Promise<boolean>;
  cancellationReasonRequired?: boolean;
  cancellationFinancialNotice?: string;
  cancelling?: boolean;
  onServiceState?: (serviceId: string, state: "completed" | "no_show" | "cancelled") => void;
  onServiceReschedule?: (serviceId: string) => void;
  onServicePayment?: (serviceId: string) => Promise<PaymentSummary | null>;
  payment?: {
    busy: boolean;
    enableInPersonMbWay: boolean;
    phone?: string | null;
    prepare: () => Promise<PaymentSummary | null>;
    confirm: (method: DrawerPaymentMethod, options?: { phone?: string; mbWayAction?: "charge" | "received" }) => Promise<boolean>;
    close: () => void;
  };
  canUndoManualReceipt?: boolean;
  onUndoManualReceipt?: (reason: string) => Promise<boolean>;
  paymentMovements?: Array<{ id: string; amount: number; method: string }>;
  onCorrectPaymentMethod?: (movementId: string, method: DrawerPaymentMethod) => Promise<boolean>;
  correctingPaymentMethod?: boolean;
  updatingServiceId?: string | null;
  timeZone: string;
}) {
  const [initialActions] = useState(actions);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [changingAttendance, setChangingAttendance] = useState(false);
  const [notice, setNotice] = useState<{ status: string; text: string } | null>(null);
  const [confirmingServiceCancelId, setConfirmingServiceCancelId] = useState<string | null>(null);
  const [jointAction, setJointAction] = useState<"completed" | "no_show" | "cancelled" | null>(null);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null);
  const [preparingPayment, setPreparingPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<DrawerPaymentMethod>("cash");
  const [mbWayAction, setMbWayAction] = useState<"charge" | "received">("received");
  const [mbWayPhone, setMbWayPhone] = useState(payment?.phone ?? "");
  const [clientAttended, setClientAttended] = useState(true);
  const [undoReceiptOpen, setUndoReceiptOpen] = useState(false);
  const [undoReason, setUndoReason] = useState("");
  const [noMoneyReceived, setNoMoneyReceived] = useState(false);
  const [undoingReceipt, setUndoingReceipt] = useState(false);
  const [movementId, setMovementId] = useState(paymentMovements[0]?.id ?? "");
  const currentMovement = paymentMovements.find((movement) => movement.id === movementId);
  const [correctedMethod, setCorrectedMethod] = useState<DrawerPaymentMethod>((currentMovement?.method as DrawerPaymentMethod) ?? "cash");
  const [paymentCorrectionOpen, setPaymentCorrectionOpen] = useState(false);
  const detailsScrollRef = useRef<HTMLDivElement>(null);
  const currentActions = new Map(actions.map((action) => [action.id, action]));
  const initialAction = (id: string) => initialActions.find((action) => action.id === id);
  const actionFor = (id: string) => currentActions.get(id) ?? initialAction(id);
  const editAction = actionFor("edit");
  const otherActionIds = ["fit"]
    .filter((id) => currentActions.has(id));
  const contactAction = initialAction("whatsapp");
  const primaryActions = [
    { id: "complete", status: "completed", label: "Compareceu",
      icon: <Check className="size-3.5" />,
      tone: "border-emerald-500/45 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/20 dark:text-emerald-200" },
    { id: "no-show", status: "no_show", label: "Faltou",
      icon: <AlertTriangle className="size-3.5" />,
      tone: "border-amber-500/50 bg-amber-500/10 text-amber-900 hover:bg-amber-500/20 dark:text-amber-200" },
    { id: "cancel", status: "cancelled", label: "Cancelar marcação",
      icon: <X className="size-3.5" />,
      tone: "border-rose-500/50 bg-rose-500/10 text-rose-800 hover:bg-rose-500/20 dark:text-rose-200" },
  ];
  const runAction = (id: string) => {
    const action = currentActions.get(id);
    if (!action || action.disabled) return;
    if (id === "cancel") setConfirmingCancel(true);
    else action.onClick();
  };
  const changeAttendance = async (status: "confirmed" | "completed" | "no_show") => {
    if (!onChangeAttendance || changingAttendance) return;
    setChangingAttendance(true);
    try {
      if (await onChangeAttendance(status)) {
        setNotice({ status, text: status === "confirmed" ? "Estado reposto." : "Estado atualizado." });
      }
    } finally {
      setChangingAttendance(false);
    }
  };
  const openPayment = async (serviceId?: string) => {
    if (!payment || preparingPayment) return;
    setPreparingPayment(true);
    try {
      const summary = serviceId && onServicePayment
        ? await onServicePayment(serviceId) : await payment.prepare();
      if (summary) {
        setPaymentSummary(summary);
        requestAnimationFrame(() => detailsScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
      }
    } finally {
      setPreparingPayment(false);
    }
  };
  const closePayment = () => { setPaymentSummary(null); payment?.close(); };
  const normalizedMbWayPhone = normalizeInternationalPhone(mbWayPhone);
  const sendingMbWayCharge = payment?.enableInPersonMbWay && paymentMethod === "mb_way" && mbWayAction === "charge";
  const groupedAssignments = new Map<string, NonNullable<TimelineDrawerDetails["serviceAssignments"]>>();
  const actionableJointServices = (details.serviceAssignments ?? []).filter((assignment) =>
    assignment.serviceId && assignment.serviceState === "confirmed");
  if (details.jointBooking) {
    for (const assignment of details.serviceAssignments ?? []) {
      const key = assignment.professionalId ?? assignment.professionalName;
      const group = groupedAssignments.get(key);
      if (group) group.push(assignment);
      else groupedAssignments.set(key, [assignment]);
    }
  }

  useModalScrollLock();
  useEffect(() => {
    if (!paymentMovements.some((movement) => movement.id === movementId)) {
      setMovementId(paymentMovements[0]?.id ?? "");
      setCorrectedMethod((paymentMovements[0]?.method as DrawerPaymentMethod) ?? "cash");
    }
  }, [paymentMovements, movementId]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
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
      <aside className="absolute inset-x-0 bottom-0 flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden rounded-t-[1.6rem] border-t border-border bg-card shadow-2xl animate-in slide-in-from-bottom-3 duration-200 md:inset-y-0 md:left-auto md:right-0 md:h-auto md:max-h-none md:w-[27rem] md:rounded-none md:rounded-l-[1.6rem] md:border-l md:border-t-0 md:slide-in-from-right-3">
        <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-3.5 md:px-5">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
              Detalhes da marcação
            </p>
            <p className="mt-0.5 break-words text-base font-black">
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

        <div className="shrink-0 space-y-2 border-b border-border/70 px-4 py-2.5 md:px-5" data-testid="appointment-quick-actions">
          <div className="grid grid-cols-3 gap-1.5" aria-label="Ações principais da marcação">
            {primaryActions.map(({ id, status, label, icon, tone }) => {
              const applied = details.status === status;
              const cancelAction = currentActions.get("cancel");
              const disabled = changingAttendance || (details.jointBooking
                ? !onServiceState || details.status === "cancelled" || actionableJointServices.length === 0 || Boolean(updatingServiceId)
                : id === "cancel"
                  ? applied ? !onChangeAttendance : !cancelAction || Boolean(cancelAction.disabled)
                  : !onChangeAttendance || details.status === "cancelled");
              return <button key={id} type="button"
                aria-pressed={details.jointBooking ? jointAction === status : applied}
                disabled={disabled}
                onClick={() => {
                  if (details.jointBooking) {
                    setJointAction((current) => current === status ? null : status as "completed" | "no_show" | "cancelled");
                    setConfirmingServiceCancelId(null);
                    return;
                  }
                  if (id === "cancel") {
                    if (applied) void changeAttendance("confirmed");
                    else setConfirmingCancel(true);
                  } else {
                    void changeAttendance(applied ? "confirmed" : status as "completed" | "no_show");
                  }
                }}
                className={`flex h-14 min-w-0 flex-col items-center justify-center rounded-xl border px-1 text-center text-[10px] font-bold leading-tight transition disabled:cursor-not-allowed disabled:opacity-45 ${tone} ${applied ? "ring-2 ring-current ring-offset-2 ring-offset-card" : ""}`}>
                <span className="flex items-center justify-center gap-1">{icon}<span>{label}</span></span>
              </button>;
            })}
          </div>
          {details.jointBooking && jointAction && onServiceState && (
            <div className="rounded-xl border border-border/70 bg-muted/25 p-2.5" data-testid="joint-service-action-picker">
              <p className="mb-2 text-[11px] font-bold">
                {jointAction === "completed" ? "Escolha o serviço que compareceu" :
                  jointAction === "no_show" ? "Escolha o serviço cuja cliente faltou" :
                    "Escolha o serviço a cancelar"}
              </p>
              <div className="max-h-36 space-y-1.5 overflow-y-auto">
                {actionableJointServices.map((assignment) => (
                  <button key={assignment.serviceId} type="button"
                    disabled={Boolean(updatingServiceId)}
                    onClick={() => {
                      if (jointAction === "cancelled") {
                        setConfirmingServiceCancelId(assignment.serviceId!);
                      } else {
                        onServiceState(assignment.serviceId!, jointAction);
                        setJointAction(null);
                      }
                    }}
                    className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 text-left text-xs font-semibold disabled:opacity-45">
                    <span>{assignment.serviceName} · {assignment.professionalName}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(assignment.startsAt, timeZone)}</span>
                  </button>
                ))}
              </div>
              {jointAction === "cancelled" && confirmingServiceCancelId && (
                <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2.5 text-xs dark:bg-rose-500/10">
                  <p>Cancelar apenas este serviço? O pagamento original permanece; a proprietária decide o reembolso depois.</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => setConfirmingServiceCancelId(null)} className="min-h-9 rounded-lg border px-3 font-semibold">Manter</button>
                    <button type="button" disabled={updatingServiceId === confirmingServiceCancelId}
                      onClick={() => {
                        onServiceState(confirmingServiceCancelId, "cancelled");
                        setConfirmingServiceCancelId(null);
                        setJointAction(null);
                      }}
                      className="min-h-9 rounded-lg bg-rose-600 px-3 font-bold text-white disabled:opacity-45">Confirmar cancelamento</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {payment && <button type="button" onClick={() => void openPayment()}
            disabled={preparingPayment || payment.busy}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/50 bg-emerald-500/10 text-sm font-bold text-emerald-800 hover:bg-emerald-500/20 disabled:opacity-45 dark:text-emerald-200">
            {preparingPayment ? <Loader2 className="size-4 animate-spin" /> : <Euro className="size-4" />}
            Receber pagamento
          </button>}
          {notice?.status === details.status && (
            <div role="status" className="flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground">
              <span>{notice.text}</span>
              {details.status !== "confirmed" && onChangeAttendance && (
                <button type="button" disabled={changingAttendance} onClick={() => void changeAttendance("confirmed")}
                  className="text-primary underline disabled:opacity-45">Desfazer</button>
              )}
            </div>
          )}
          {confirmingCancel && (
            <div data-testid="cancel-confirmation" className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3">
              <p className="text-sm font-black">Cancelar esta marcação?</p>
              {cancellationFinancialNotice && <p className="mt-1 text-xs text-muted-foreground">{cancellationFinancialNotice}</p>}
              {cancellationReasonRequired && (
                <label className="mt-2 block text-xs font-semibold">Motivo do cancelamento
                  <input type="text" value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)}
                    maxLength={500} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2 text-sm" />
                </label>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmingCancel(false)}
                  className="h-9 rounded-lg border border-border text-xs font-bold">Voltar</button>
                <button type="button" disabled={cancelling || (cancellationReasonRequired && cancellationReason.trim().length < 3)}
                  onClick={() => {
                    if (!onConfirmCancel) return;
                    void onConfirmCancel(cancellationReason.trim()).then((saved) => {
                      if (saved) {
                        setConfirmingCancel(false);
                        setNotice({ status: "cancelled", text: "Marcação cancelada." });
                      }
                    });
                  }}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-rose-600 px-2 text-[11px] font-bold text-white disabled:opacity-45">
                  {cancelling && <Loader2 className="size-3 animate-spin" />} Confirmar cancelamento
                </button>
              </div>
            </div>
          )}
          {editAction && <div className="border-t border-border/70 pt-2">
            <button type="button" disabled={!currentActions.has("edit") || Boolean(currentActions.get("edit")?.disabled)}
              onClick={() => runAction("edit")}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/70 px-3 text-sm font-bold text-foreground transition hover:bg-muted disabled:opacity-45">
              <span className="shrink-0">{editAction.icon}</span><span>{editAction.label}</span>
            </button>
          </div>}
          {otherActionIds.length > 0 && <div className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            {otherActionIds.map((id) => {
              const action = currentActions.get(id)!;
              return <button key={id} type="button" disabled={Boolean(action.disabled)}
                onClick={() => runAction(id)}
                className="inline-flex min-h-7 items-center gap-1 text-[10px] font-semibold text-primary hover:underline disabled:opacity-45">
                {action.icon}{action.label}
              </button>;
            })}
          </div>}
        </div>

        <div ref={detailsScrollRef} className="appointment-modal-scrollbar premium-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable] md:px-5">
          {paymentSummary && payment && <div data-testid="inline-payment" className="mb-3 space-y-2 rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3">
            <p className="text-sm font-black">Receber pagamento · {new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(paymentSummary.amount)}</p>
            {paymentSummary.label && <p className="text-xs text-muted-foreground">{paymentSummary.label}</p>}
            <div className="space-y-1 text-xs font-semibold"><p>Método de pagamento</p>
              <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as DrawerPaymentMethod)}>
                <SelectTrigger aria-label="Método de pagamento" className="h-10 rounded-lg border-border bg-card pl-3 pr-4 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[10010] rounded-xl">
                  {paymentMethods.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {paymentMethod === "mb_way" && <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Ação MB WAY presencial">
                <button type="button" aria-pressed={mbWayAction === "received"} onClick={() => setMbWayAction("received")} className="min-h-9 rounded-lg border border-border px-2">Registar recebido</button>
                <button type="button" disabled={!payment.enableInPersonMbWay} aria-pressed={mbWayAction === "charge"} onClick={() => setMbWayAction("charge")} className="min-h-9 rounded-lg border border-border px-2 disabled:opacity-45">Enviar cobrança</button>
              </div>
              {sendingMbWayCharge && <label className="block font-semibold">Telemóvel MB WAY
                <input type="tel" value={mbWayPhone} onChange={(event) => setMbWayPhone(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-border bg-card px-2" />
              </label>}
            </div>}
            {!details.jointBooking && <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={clientAttended} onChange={(event) => setClientAttended(event.target.checked)} />Cliente compareceu.</label>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={closePayment} className="h-9 rounded-lg border border-border text-xs font-bold">Voltar</button>
              <button type="button" disabled={payment.busy || (!details.jointBooking && !clientAttended) || (sendingMbWayCharge && !isValidInternationalPhone(normalizedMbWayPhone))}
                onClick={() => void payment.confirm(paymentMethod, paymentMethod === "mb_way" ? { mbWayAction: sendingMbWayCharge ? "charge" : "received", ...(sendingMbWayCharge ? { phone: normalizedMbWayPhone } : {}) } : undefined).then((saved) => { if (saved) closePayment(); })}
                className="h-9 rounded-lg bg-emerald-700 px-2 text-xs font-bold text-white disabled:opacity-45">{sendingMbWayCharge ? "Enviar cobrança" : "Confirmar recebimento"}</button>
            </div>
          </div>}
          <div className="rounded-2xl border border-border/70 bg-muted/25 p-3.5">
            <div className="flex items-start gap-3">
              <ClientAvatar
                name={details.clientName}
                avatarUrl={details.clientAvatarUrl}
                className="size-10 shrink-0 text-xs"
              />
              <div className="min-w-0">
                {!details.serviceAssignments?.length && <p className="break-words text-xs text-muted-foreground">{details.serviceName}</p>}
                {details.clientPhone && (
                  <a
                    href={`tel:${details.clientPhone}`}
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 break-all text-xs font-bold text-foreground hover:underline"
                  >
                    <Phone className="h-3 w-3" />
                    {details.clientPhone}
                  </a>
                )}
                {contactAction && (
                  <button type="button"
                    disabled={!currentActions.has("whatsapp") || Boolean(currentActions.get("whatsapp")?.disabled)}
                    onClick={() => runAction("whatsapp")}
                    className="mt-2 block text-left text-xs font-semibold text-primary hover:underline disabled:opacity-45">
                    {contactAction.label}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <DetailTile
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label="Data"
              value={formatDate(details.startsAt, timeZone)}
            />
            <DetailTile
              icon={<Clock3 className="h-3.5 w-3.5" />}
              label="Horário"
              value={`${formatTime(details.startsAt, timeZone)}–${formatTime(details.endsAt, timeZone)}`}
            />
            {!details.serviceAssignments?.length && <DetailTile
              icon={<UserRound className="h-3.5 w-3.5" />}
              label="Profissional"
              value={details.professionalName || "Não definido"}
            />}
            <DetailTile
              icon={<CreditCard className="h-3.5 w-3.5" />}
              label="Pagamento"
              value={details.paymentLabel}
            />
          </div>
          {details.paymentDetails && (
            <div className="mt-2 rounded-2xl border border-border/70 bg-muted/15 px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Método de pagamento</p>
              {details.paymentDetails.map((line, index) => (
                <p key={`${index}-${line}`} className="mt-1 break-words text-xs font-semibold">{line}</p>
              ))}
              {canUndoManualReceipt && onUndoManualReceipt && <button type="button" onClick={() => setUndoReceiptOpen((open) => !open)} className="mt-2 text-xs font-bold text-amber-700 underline dark:text-amber-300">Desfazer recebimento</button>}
              {undoReceiptOpen && canUndoManualReceipt && onUndoManualReceipt && <div data-testid="undo-receipt-confirmation" className="mt-2 space-y-2 rounded-xl border border-amber-500/40 p-2 text-xs">
                <p className="font-bold">Desfazer recebimento manual?</p>
                <p>Reabre a marcação. O lançamento original fica anulado no histórico.</p>
                <label className="block font-semibold">Motivo da correção
                  <input value={undoReason} onChange={(event) => setUndoReason(event.target.value)} maxLength={500} className="mt-1 h-9 w-full rounded-lg border border-border bg-card px-2" />
                </label>
                <label className="flex items-start gap-2"><input type="checkbox" checked={noMoneyReceived} onChange={(event) => setNoMoneyReceived(event.target.checked)} />Confirmo que o dinheiro não foi recebido.</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setUndoReceiptOpen(false)} className="h-9 rounded-lg border border-border">Voltar</button>
                  <button type="button" disabled={undoingReceipt || undoReason.trim().length < 3 || !noMoneyReceived} onClick={() => { setUndoingReceipt(true); void onUndoManualReceipt(undoReason.trim()).then((saved) => { if (saved) setUndoReceiptOpen(false); }).finally(() => setUndoingReceipt(false)); }} className="h-9 rounded-lg bg-amber-600 px-2 font-bold text-white disabled:opacity-45">Confirmar anulação</button>
                </div>
              </div>}
            </div>
          )}
          {onCorrectPaymentMethod && paymentMovements.length > 0 && <div className="mt-2 rounded-xl border border-border/70 p-2 text-xs">
            <button type="button" aria-expanded={paymentCorrectionOpen} onClick={() => setPaymentCorrectionOpen((open) => !open)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-left text-sm font-bold text-primary hover:bg-primary/20">
              <Pencil className="size-4 shrink-0" />Corrigir método de pagamento
            </button>
            {paymentCorrectionOpen && <div data-testid="payment-method-editor" className="space-y-2 px-1 pb-1 pt-2">
            <p className="text-muted-foreground">Altera apenas o método; o valor e o registro do pagamento são mantidos.</p>
            {paymentMovements.length > 1 && <div className="space-y-1 font-semibold"><p>Recebimento</p>
              <Select value={movementId} onValueChange={(value) => { setMovementId(value); setCorrectedMethod((paymentMovements.find((item) => item.id === value)?.method as DrawerPaymentMethod) ?? "cash"); }}>
                <SelectTrigger aria-label="Recebimento" className="h-9 rounded-lg border-border bg-card pl-3 pr-4"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[10010] rounded-xl">
                  {paymentMovements.map((item) => <SelectItem key={item.id} value={item.id}>{new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(item.amount)} · {item.method}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>}
            <div className="space-y-1 font-semibold"><p>Método correto</p>
              <Select value={correctedMethod} onValueChange={(value) => setCorrectedMethod(value as DrawerPaymentMethod)}>
                <SelectTrigger aria-label="Método correto" className="h-9 rounded-lg border-border bg-card pl-3 pr-4"><SelectValue /></SelectTrigger>
                <SelectContent className="z-[10010] rounded-xl">
                  {paymentMethods.map((method) => <SelectItem key={method.value} value={method.value}>{method.label}</SelectItem>)}
                  <SelectItem value="bank_transfer">Transferência bancária</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPaymentCorrectionOpen(false)} className="h-10 rounded-lg border border-border font-semibold">Voltar</button>
              <button type="button" disabled={correctingPaymentMethod || !movementId || correctedMethod === currentMovement?.method}
                onClick={() => void onCorrectPaymentMethod(movementId, correctedMethod).then((saved) => { if (saved) setPaymentCorrectionOpen(false); })}
                className="h-10 rounded-lg bg-foreground px-2 font-bold text-background disabled:opacity-45">Guardar correção</button>
            </div>
            </div>}
          </div>}

          {details.serviceAssignments && details.serviceAssignments.length > 0 && (
            <div className="mt-3 rounded-2xl border border-border/70 px-3.5 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                {details.jointBooking ? "Atendimento conjunto" : "Serviços e profissionais"}
              </p>
              {details.jointBooking ? (
                <div className="mt-2 space-y-3">
                  {[...groupedAssignments.entries()].map(([professionalId, assignments]) => (
                    <div key={professionalId} className="border-t border-border/60 pt-2 first:border-t-0 first:pt-0">
                      <p className="truncate text-xs font-black">{assignments[0].professionalName}</p>
                      <div className="mt-1 space-y-2">
                        {assignments.map((assignment, index) => (
                          <div key={assignment.serviceId ?? index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 text-[11px]">
                            <span className="min-w-0 break-words font-semibold">{assignment.serviceName}</span>
                            <span className="whitespace-nowrap font-mono text-[10px] tabular-nums text-muted-foreground">
                              {formatTime(assignment.startsAt, timeZone)}–{formatTime(assignment.endsAt, timeZone)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{assignment.statusLabel ?? details.statusLabel}</span>
                            <span className="text-right text-[10px] font-bold">{assignment.valueLabel}</span>
                            {assignment.potentialRefundLabel && (
                              <p className="col-span-2 text-[10px] text-amber-700 dark:text-amber-300">
                                Potencial reembolso manual: {assignment.potentialRefundLabel}
                              </p>
                            )}
                            {assignment.serviceId && assignment.serviceState === "confirmed" &&
                              (onServiceState || onServiceReschedule || onServicePayment) && (
                              <div className="col-span-2 mt-1 flex flex-wrap gap-1.5">
                                {onServicePayment && <button type="button" className="rounded-lg border px-2 py-1 text-[10px] font-bold" onClick={() => void openPayment(assignment.serviceId!)}>Receber serviço</button>}
                                {onServiceReschedule && <button type="button" className="rounded-lg border px-2 py-1 text-[10px] font-bold" onClick={() => onServiceReschedule(assignment.serviceId!)}>Reagendar</button>}
                                {onServiceState && <button type="button" disabled={updatingServiceId === assignment.serviceId} className="rounded-lg border px-2 py-1 text-[10px] font-bold disabled:opacity-50" onClick={() => onServiceState(assignment.serviceId!, "completed")}>Concluir</button>}
                                {onServiceState && <button type="button" disabled={updatingServiceId === assignment.serviceId} className="rounded-lg border border-rose-300 px-2 py-1 text-[10px] font-bold text-rose-700 disabled:opacity-50" onClick={() => setConfirmingServiceCancelId(assignment.serviceId!)}>Cancelar</button>}
                              </div>
                            )}
                            {assignment.serviceId && assignment.serviceState === "completed" && onServicePayment && (
                              <button type="button" className="col-span-2 mt-1 justify-self-start rounded-lg border px-2 py-1 text-[10px] font-bold" onClick={() => onServicePayment(assignment.serviceId!)}>Receber serviço</button>
                            )}
                            {confirmingServiceCancelId === assignment.serviceId && onServiceState && (
                              <div className="col-span-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-[10px] dark:bg-rose-500/10">
                                <p>Cancelar apenas {assignment.serviceName}? O pagamento original permanece; a proprietária decide o reembolso depois.</p>
                                <div className="mt-2 flex gap-2">
                                  <button type="button" className="rounded border px-2 py-1" onClick={() => setConfirmingServiceCancelId(null)}>Manter</button>
                                  <button type="button" disabled={updatingServiceId === assignment.serviceId} className="rounded bg-rose-600 px-2 py-1 font-bold text-white disabled:opacity-50" onClick={() => { setConfirmingServiceCancelId(null); onServiceState(assignment.serviceId!, "cancelled"); }}>Confirmar cancelamento</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
              <div className="mt-2 space-y-2">
                {details.serviceAssignments.map((assignment, index) => (
                  <div
                    key={`${assignment.serviceName}:${assignment.startsAt}:${index}`}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-border/60 pt-2 first:border-t-0 first:pt-0"
                  >
                    <p className="break-words text-xs font-black">{assignment.serviceName}</p>
                    <p className="whitespace-nowrap text-right font-mono text-[10px] font-bold tabular-nums text-muted-foreground">
                      {formatTime(assignment.startsAt, timeZone)}–
                      {formatTime(assignment.endsAt, timeZone)}
                    </p>
                    <p className="col-span-2 break-words text-[11px] text-muted-foreground">
                      {assignment.professionalName}
                    </p>
                  </div>
                ))}
              </div>
              )}
            </div>
          )}

          <div className="mt-3 rounded-2xl border border-border/70 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Duração
              </span>
              <span className="whitespace-nowrap text-xs font-black">{details.durationLabel}</span>
            </div>
            {details.paymentBreakdown ? (
              details.paymentBreakdown.map((item) => (
                <div
                  key={item.label}
                  className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2"
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    {item.label}
                  </span>
                  <span className="whitespace-nowrap text-sm font-black text-emerald-700 dark:text-emerald-400">
                    {item.value}
                  </span>
                </div>
              ))
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Valor
                </span>
                <span className="whitespace-nowrap text-sm font-black text-emerald-700 dark:text-emerald-400">
                  {details.valueLabel}
                </span>
              </div>
            )}
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

          {details.scheduleHistory && details.scheduleHistory.length > 0 && (
            <details className="mt-3 rounded-2xl border border-border/70 bg-muted/15 px-3.5 py-3">
              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                Histórico de alterações
              </summary>
              <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
                {details.scheduleHistory.map((event) => (
                  <div key={`${event.createdAt}-${event.label}`} className="min-w-0 text-xs">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 break-words font-black">{event.label}</p>
                      <time className="shrink-0 text-[10px] text-muted-foreground">
                        {new Date(event.createdAt).toLocaleString("pt-PT", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p className="mt-0.5 break-words text-muted-foreground">{event.detail}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

function DetailTile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background/60 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 whitespace-normal break-words text-xs font-black">
        {value}
      </p>
    </div>
  );
}

function formatDate(value: string, timeZone: string) {
  return new Date(value).toLocaleDateString("pt-PT", {
    timeZone: normalizeStudioTimeZone(timeZone),
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatTime(value: string, timeZone: string) {
  return formatStudioTime(value, timeZone);
}
