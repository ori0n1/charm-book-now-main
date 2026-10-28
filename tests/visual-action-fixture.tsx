import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TimelineAppointmentDrawer, type TimelineDrawerAction } from "@/components/agenda/timeline-appointment-drawer";

type Status = "confirmed" | "completed" | "no_show" | "cancelled";
const labels: Record<Status, string> = {
  confirmed: "Em aberto", completed: "Concluído", no_show: "Não compareceu", cancelled: "Cancelado",
};

function App() {
  const [open, setOpen] = useState(false);
  const [joint, setJoint] = useState(false);
  const [status, setStatus] = useState<Status>("confirmed");
  const [paid, setPaid] = useState(false);
  const [stripe, setStripe] = useState(false);
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [receiptUndoCount, setReceiptUndoCount] = useState(0);
  const [editCount, setEditCount] = useState(0);
  const [correctionCount, setCorrectionCount] = useState(0);
  const [fitCount, setFitCount] = useState(0);
  const [cancellationHistoryCount, setCancellationHistoryCount] = useState(0);
  const appointmentId = "synthetic-appointment-1";
  const actions: TimelineDrawerAction[] = [
    ...(!joint ? [{ id: "edit", label: status === "cancelled" ? "Reabrir e editar" : "Editar reserva", icon: "✎", onClick: () => {
      if (status === "cancelled") setStatus("confirmed");
      setEditCount((count) => count + 1);
    } }] : []),
    ...(joint && status === "confirmed" ? [
      { id: "fit", label: "Encaixar", icon: "✦", onClick: () => setFitCount((count) => count + 1) },
    ] : []),
    { id: "whatsapp", label: "Contactar no WhatsApp", icon: "✉", onClick: () => undefined },
    ...(!joint && status !== "cancelled" ? [
      { id: "cancel", label: "Cancelar marcação", icon: "×", danger: true, onClick: () => undefined },
    ] : []),
  ];
  return <>
    <button onClick={() => { setJoint(false); setStatus("confirmed"); setPaid(false); setStripe(false); setMethod("cash"); setOpen(true); }}>Abrir marcação</button>
    <button onClick={() => { setJoint(true); setStatus("confirmed"); setPaid(false); setStripe(false); setOpen(true); }}>Abrir serviço conjunto</button>
    <button onClick={() => { setJoint(false); setStatus("completed"); setPaid(true); setStripe(true); setOpen(true); }}>Abrir pagamento Stripe</button>
    <button onClick={() => setOpen(true)}>Reabrir marcação</button>
    <p data-testid="fixture-status">{labels[status]} · {paid ? "Pago manualmente" : "Por receber"}</p>
    <p data-testid="fixture-agenda-status">{labels[status]}</p>
    <p data-testid="fixture-edit-count">{editCount}</p>
    <p data-testid="fixture-correction-count">{correctionCount}</p>
    <p data-testid="fixture-fit-count">{fitCount}</p>
    <p data-testid="fixture-undo-count">{receiptUndoCount}</p>
    <p data-testid="fixture-appointment-id">{appointmentId}</p>
    <p data-testid="fixture-appointment-count">1</p>
    <p data-testid="fixture-cancellation-history">{cancellationHistoryCount}</p>
    {open && <TimelineAppointmentDrawer
      timeZone="Europe/Lisbon" onClose={() => setOpen(false)} actions={actions}
      onChangeAttendance={!joint ? async (nextStatus) => {
        if (status !== "confirmed") setCorrectionCount((count) => count + 1);
        await Promise.resolve();
        setStatus(nextStatus);
        return true;
      } : undefined}
      onConfirmCancel={async () => { setStatus("cancelled"); setCancellationHistoryCount((count) => count + 1); return true; }}
      payment={!paid ? {
        busy: false, enableInPersonMbWay: false,
        prepare: async () => ({ amount: 50, label: joint ? "Saldo da reserva" : undefined }),
        confirm: async () => { setPaid(true); if (!joint) setStatus("completed"); return true; },
        close: () => undefined,
      } : undefined}
      canUndoManualReceipt={paid && !stripe && !joint}
      onUndoManualReceipt={paid && !stripe && !joint ? async () => {
        setPaid(false); setStatus("confirmed"); setReceiptUndoCount((count) => count + 1); return true;
      } : undefined}
      paymentMovements={paid && !stripe ? [{ id: "movement-1", amount: 50, method }] : []}
      onCorrectPaymentMethod={paid && !stripe ? async (_movementId, nextMethod) => { setMethod(nextMethod === "card" ? "card" : "cash"); return true; } : undefined}
      cancellationReasonRequired={status === "completed"}
      cancellationFinancialNotice={status === "completed" ? "Sai da receita do caixa. Sem reembolso automático." : undefined}
      details={{
        clientName: "Cliente sintético", serviceName: joint ? "Serviço conjunto" : "Corte",
        professionalName: "Profissional", jointBooking: joint,
        serviceAssignments: joint ? [{ serviceId: "line-1", serviceName: "Corte", professionalId: "staff-1",
          professionalName: "Profissional", startsAt: "2026-10-27T10:00:00Z",
          endsAt: "2026-10-27T11:00:00Z", valueLabel: "50,00 €", serviceState: "confirmed" }] : undefined,
        startsAt: "2026-10-27T10:00:00Z", endsAt: "2026-10-27T11:00:00Z",
        durationLabel: "1 hora", statusLabel: labels[status], status,
        paymentLabel: paid ? "Pago" : "Por receber",
        paymentDetails: paid ? [stripe ? "Stripe · pagamento confirmado" : `${method === "card" ? "Cartão" : "Dinheiro"} · pagamento manual`] : undefined,
        valueLabel: "50,00 €",
      }}
    />}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
