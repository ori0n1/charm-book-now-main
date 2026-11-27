import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProfessionalTimeline } from "../src/components/agenda/professional-timeline";
import { ManualWhatsAppDialog } from "../src/components/manual-whatsapp-dialog";
import { TimelineAppointmentDrawer } from "../src/components/agenda/timeline-appointment-drawer";

function App() {
  const [manual, setManual] = useState(true);
  const [sent, setSent] = useState(false);
  const [draft, setDraft] = useState(false);
  const [details, setDetails] = useState(false);
  return <main className="min-h-screen bg-stone-50 p-3">
    <button type="button" onClick={() => { setManual((value) => !value); setDraft(false); setDetails(false); setSent(false); }} data-testid="mode-toggle">Modo {manual ? "manual" : "automático"}</button>
    <p data-testid="sent-state">{sent ? "Enviada manualmente" : "Pendente"}</p>
    {details && <TimelineAppointmentDrawer
      details={{ clientName: "Jaqueline de Almeida Santos", clientPhone: "+351912345678", serviceName: "Brushing", professionalName: "Ana", startsAt: "2026-11-26T09:00:00Z", endsAt: "2026-11-26T10:00:00Z", durationLabel: "1 h", statusLabel: "Confirmada", status: "confirmed", paymentLabel: "Pendente", valueLabel: "25 €", messageLabel: sent ? "Lembrete enviado manualmente (entrega não verificada)" : null }}
      actions={[]}
      onClose={() => setDetails(false)}
      onManualWhatsApp={manual ? () => { setDetails(false); setDraft(true); } : undefined}
      manualReminderPending={manual && !sent}
      manualWhatsAppStatus={manual && sent ? "Lembrete enviado" : null}
      timeZone="Europe/Lisbon"
    />}
    <ProfessionalTimeline
      date={new Date("2026-11-26T12:00:00Z")}
      now={new Date("2026-11-26T08:00:00Z")}
      professionals={[{ id: "ana", name: "Ana" }]}
      appointments={[{
        id: "appointment", staffId: "ana", startsAt: "2026-11-26T09:00:00Z", endsAt: "2026-11-26T10:00:00Z",
        status: "confirmed", serviceName: "Brushing", clientName: "Jaqueline de Almeida Santos", professionalName: "Ana",
        durationLabel: "1 h", privateDetails: true, valueLabel: "25 €", manualWhatsAppPending: manual && !sent,
      }]}
      availability={[{ staffId: "ana", startMinutes: 540, endMinutes: 780 }]}
      timeZone="Europe/Lisbon"
      onOpenAppointment={() => setDetails(true)}
      onOpenBlock={() => {}}
      onCreateAtSlot={() => {}}
      onBlockAtSlot={() => {}}
    />
    <ManualWhatsAppDialog
      key={draft ? "open" : "closed"}
      draft={draft ? { name: "Jaqueline de Almeida Santos", phone: "351912345678", text: "Olá, Jaqueline! O seu Brushing é às 09:00." } : null}
      onClose={() => setDraft(false)}
      onOpen={() => setSent(true)}
      onViewDetails={() => { setDraft(false); setDetails(true); }}
      statusTarget="marcação"
    />
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
