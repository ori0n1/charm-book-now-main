import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TimelineAppointmentDrawer } from "@/components/agenda/timeline-appointment-drawer";

function App() {
  const [open, setOpen] = useState(false);
  const [rescheduled, setRescheduled] = useState(false);
  const [invalid, setInvalid] = useState(false);
  return <>
    <main className="p-4">
      <button onClick={() => setOpen(true)}>Abrir marcação</button>
      <button onClick={() => setRescheduled(true)}>Remarcar</button>
      <button onClick={() => setInvalid(true)}>Invalidar telefone</button>
      <p>Notificações automáticas WhatsApp: desligadas</p>
    </main>
    {open && <TimelineAppointmentDrawer
      timeZone="Europe/Lisbon"
      onClose={() => setOpen(false)}
      actions={[]}
      details={{
        clientName: "Ana Silva",
        clientPhone: invalid ? "123" : "+351 912 345 678",
        studioName: "Bellza Centro",
        serviceName: "Manicure gel",
        professionalName: "Rita",
        startsAt: rescheduled ? "2026-12-04T15:30:00Z" : "2026-12-03T10:00:00Z",
        endsAt: rescheduled ? "2026-12-04T16:30:00Z" : "2026-12-03T11:00:00Z",
        durationLabel: "1 hora",
        statusLabel: "Confirmada",
        status: "confirmed",
        paymentLabel: "Pendente",
        valueLabel: "30,00 €",
      }}
    />}
  </>;
}

createRoot(document.getElementById("root")!).render(<App />);
