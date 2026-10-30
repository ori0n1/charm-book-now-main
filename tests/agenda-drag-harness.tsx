import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { ProfessionalTimeline } from "../src/components/agenda/professional-timeline";
import { TimelineAppointmentDrawer } from "../src/components/agenda/timeline-appointment-drawer";
import { useAgendaColor } from "../src/hooks/use-agenda-color";

const page = window as typeof window & { __drops: Array<{ id: string; staffId: string; minutes: number }>; __opened: number };
page.__drops = [];
page.__opened = 0;
const people = [{ id: "staff-a", name: "Ana" }, { id: "staff-b", name: "Bea" }];
const appointment = {
  id: "appointment-a:line-a", sourceId: "appointment-a", staffId: "staff-a",
  startsAt: "2026-10-30T10:00:00Z", endsAt: "2026-10-30T11:00:00Z",
  status: "confirmed", clientName: "Cliente sintética", serviceName: "Serviço sintético",
  professionalName: "Ana", durationLabel: "60 min", privateDetails: true,
};
document.body.replaceChildren(document.createElement("div"));
const root = createRoot(document.body.firstElementChild!);
const params = new URLSearchParams(location.search);
const drawerMode = params.get("drawer");
const colorStudio = params.get("color");
function ColorHarness({ studioId }: { studioId: string }) {
  const { color, saveColor } = useAgendaColor(studioId);
  return <div><span data-testid="agenda-color-value">{color}</span>
    <button type="button" onClick={() => saveColor("teal")}>Verde água</button></div>;
}
function DrawerHarness() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return <TimelineAppointmentDrawer
    details={{ clientName: "Cliente sintética", serviceName: "Serviço sintético", professionalName: "Ana",
      startsAt: appointment.startsAt, endsAt: appointment.endsAt, durationLabel: "60 min",
      statusLabel: "Confirmada", status: "confirmed", paymentLabel: "Pendente", valueLabel: "10 €" }}
    actions={[{ id: "cancel", label: "Cancelar marcação", icon: null, onClick: () => {} }]}
    timeZone="Europe/Lisbon" onClose={() => { setOpen(false); }}
    onChangeAttendance={async () => drawerMode !== "failure"}
    onConfirmCancel={async () => drawerMode !== "failure"}
  />;
}
root.render(drawerMode ? <DrawerHarness /> : colorStudio ? <ColorHarness studioId={colorStudio} /> : <ProfessionalTimeline
  date={new Date("2026-10-30T12:00:00Z")} now={new Date("2026-10-30T08:00:00Z")}
  professionals={people} appointments={[appointment]}
  availability={people.map(person => ({ staffId: person.id, startMinutes: 540, endMinutes: 1020 }))}
  timeZone="Europe/Lisbon" onOpenAppointment={() => { page.__opened++; }}
  onOpenBlock={() => {}} onCreateAtSlot={() => {}} onBlockAtSlot={() => {}}
  onDropAppointment={(entry, staffId, minutes) => page.__drops.push({ id: entry.id, staffId, minutes })}
/>);
