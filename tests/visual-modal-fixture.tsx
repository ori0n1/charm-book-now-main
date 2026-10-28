import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TimelineAppointmentDrawer } from "@/components/agenda/timeline-appointment-drawer";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function App() {
  const [windowType, setWindowType] = useState<"drawer" | "dialog" | null>(null);
  const close = () => setWindowType(null);
  return <>
    <main style={{ minHeight: 2600, padding: 24, background: "#f3f4f6" }}>
      <h1>Bellza: validação visual das janelas</h1>
      <button onClick={() => setWindowType("drawer")}>Abrir detalhes</button>
      <button onClick={() => setWindowType("dialog")}>Abrir diálogo</button>
      <p style={{ marginTop: 800 }}>Conteúdo da página de fundo</p>
    </main>
    {windowType === "drawer" && <TimelineAppointmentDrawer
      timeZone="Europe/Lisbon"
      onClose={close}
      actions={[]}
      details={{
        clientName: "Cliente de teste",
        serviceName: "Serviço sintético",
        professionalName: "Profissional de teste",
        startsAt: "2026-10-27T10:00:00Z",
        endsAt: "2026-10-27T11:00:00Z",
        durationLabel: "1 hora",
        statusLabel: "Concluído", status: "completed",
        paymentLabel: "Recebido",
        paymentDetails: Array.from({ length: 45 }, (_, index) => "Detalhe do pagamento " + (index + 1)),
        notes: "Nota de teste ".repeat(100),
        valueLabel: "25,00 €",
      }}
    />}
    <Dialog open={windowType === "dialog"} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent>
        <DialogTitle>Diálogo de teste</DialogTitle>
        <div>{Array.from({ length: 80 }, (_, index) => <p key={index}>Linha do diálogo {index + 1}</p>)}</div>
      </DialogContent>
    </Dialog>
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
