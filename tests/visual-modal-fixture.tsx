import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { TimelineAppointmentDrawer } from "@/components/agenda/timeline-appointment-drawer";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

function App() {
  const autoClose = new URLSearchParams(window.location.search).has("auto-close");
  const joint = new URLSearchParams(window.location.search).has("joint");
  const [windowType, setWindowType] = useState<"drawer" | "dialog" | null>(null);
  const [failNext, setFailNext] = useState(false);
  const [cardStatus, setCardStatus] = useState("confirmed");
  const close = () => setWindowType(null);
  const finish = async (status: string) => {
    if (failNext) { setFailNext(false); return false; }
    setCardStatus(status);
    return true;
  };
  return <>
    <main style={{ minHeight: 2600, padding: 24, background: "#f3f4f6" }}>
      <h1>Bellza: validação visual das janelas</h1>
      <button onClick={() => setWindowType("drawer")}>Abrir detalhes</button>
      <button onClick={() => setWindowType("dialog")}>Abrir diálogo</button>
      {autoClose && <><button onClick={() => setFailNext(true)}>Falhar próxima ação</button>
        <p data-testid="agenda-card-status">{cardStatus}</p></>}
      <p style={{ marginTop: 800 }}>Conteúdo da página de fundo</p>
    </main>
    {windowType === "drawer" && <TimelineAppointmentDrawer
      timeZone="Europe/Lisbon"
      onClose={close}
      actions={autoClose ? [{ id: "cancel", label: "Cancelar marcação", icon: null, onClick: () => {} }] : []}
      onChangeAttendance={autoClose && !joint ? (status) => finish(status) : undefined}
      onConfirmCancel={autoClose && !joint ? () => finish("cancelled") : undefined}
      onServiceState={autoClose && joint ? (_serviceId, status) => finish(status) : undefined}
      payment={autoClose ? {
        busy: false, enableInPersonMbWay: false,
        prepare: async () => ({ amount: 25 }),
        confirm: async () => finish("completed"),
        close: () => {},
      } : undefined}
      details={{
        clientName: "Cliente de teste",
        serviceName: "Serviço sintético",
        professionalName: "Profissional de teste",
        startsAt: "2026-10-27T10:00:00Z",
        endsAt: "2026-10-27T11:00:00Z",
        durationLabel: "1 hora",
        statusLabel: autoClose ? "Confirmado" : "Concluído", status: autoClose ? "confirmed" : "completed",
        jointBooking: joint,
        serviceAssignments: joint ? [{ serviceId: "synthetic-service", serviceName: "Serviço sintético", professionalName: "Profissional de teste", startsAt: "2026-10-27T10:00:00Z", endsAt: "2026-10-27T11:00:00Z", serviceState: "confirmed" }] : undefined,
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
