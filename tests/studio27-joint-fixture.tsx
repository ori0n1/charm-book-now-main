import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TimelineAppointmentDrawer } from "@/components/agenda/timeline-appointment-drawer";

type ServiceState = "confirmed" | "completed" | "no_show" | "cancelled";
const initialLines = [
  { serviceId: "gel-line", serviceName: "Gel / Blindagem", professionalId: "raysa", professionalName: "Raysa", startsAt: "2030-10-30T13:30:00Z", endsAt: "2030-10-30T15:00:00Z", valueLabel: "28,00 €", serviceState: "confirmed" as ServiceState },
  { serviceId: "lashes-line", serviceName: "Extensão de Pestanas", professionalId: "larissa", professionalName: "Larissa", startsAt: "2030-10-30T15:00:00Z", endsAt: "2030-10-30T16:30:00Z", valueLabel: "40,00 €", serviceState: "confirmed" as ServiceState },
];

function App() {
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState<"confirmed" | "completed" | "no_show" | "cancelled">("confirmed");
  const [lines, setLines] = useState(initialLines);
  const [paid, setPaid] = useState(false);
  const [editCount, setEditCount] = useState(0);
  const [wholeCancellationCount, setWholeCancellationCount] = useState(0);
  return <>
    <button onClick={() => { setManual(false); setLines(initialLines); setPaid(false); setOpen(true); }}>Abrir atendimento conjunto</button>
    <button onClick={() => { setManual(true); setAttendanceStatus("confirmed"); setLines(initialLines); setOpen(true); }}>Abrir conjunto manual</button>
    <span data-testid="edit-count">{editCount}</span>
    <span data-testid="whole-cancel-count">{wholeCancellationCount}</span>
    <span data-testid="attendance-status">{attendanceStatus}</span>
    <span data-testid="service-states">{lines.map((line) => line.serviceState).join(",")}</span>
    {open && <TimelineAppointmentDrawer
      timeZone="Europe/Lisbon"
      onClose={() => setOpen(false)}
      actions={[{ id: "edit", label: "Editar reserva", icon: "✎", onClick: () => setEditCount((n) => n + 1) },
        ...(manual ? [{ id: "cancel", label: "Cancelar marcação", icon: "×", onClick: () => undefined }] : [])]}
      onChangeAttendance={manual ? async (status) => { setAttendanceStatus(status); return true; } : undefined}
      onServiceState={manual ? undefined : (serviceId, state) => setLines((current) => current.map((line) => line.serviceId === serviceId ? { ...line, serviceState: state } : line))}
      onConfirmCancel={async () => { setWholeCancellationCount((n) => n + 1); if (manual) setAttendanceStatus("cancelled"); return true; }}
      payment={!manual && !paid ? { busy: false, enableInPersonMbWay: false, prepare: async () => ({ amount: 68, label: "Saldo da reserva" }), confirm: async () => { setPaid(true); return true; }, close: () => undefined } : undefined}
      details={{ clientName: "Cliente sintética", serviceName: "Gel + Pestanas", professionalName: "Raysa + Larissa", jointBooking: true,
        serviceLevelActions: !manual,
        serviceAssignments: manual ? lines.map((line) => ({ ...line, serviceState: null })) : lines,
        startsAt: "2030-10-30T13:30:00Z", endsAt: "2030-10-30T16:30:00Z", durationLabel: "3h", statusLabel: "Confirmada", status: manual ? attendanceStatus : "confirmed", paymentLabel: paid ? "Pago" : "Pendente", valueLabel: "68,00 €" }}
    />}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
