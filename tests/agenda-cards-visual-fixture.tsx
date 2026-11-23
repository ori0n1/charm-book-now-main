import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import { ProfessionalTimeline } from "../src/components/agenda/professional-timeline";

const professionals = [
  { id: "ana", name: "Ana" },
  { id: "bea", name: "Bea" },
  { id: "carla", name: "Carla" },
];
const appointment = (id: string, start: string, end: string, serviceName: string,
  clientName: string, extras: Record<string, unknown> = {}) => ({
  id, staffId: "ana", startsAt: `2026-10-30T${start}:00Z`, endsAt: `2026-10-30T${end}:00Z`,
  status: "confirmed", serviceName, clientName, professionalName: "Ana",
  durationLabel: "30 min", privateDetails: true, valueLabel: "25 €", ...extras,
});
const appointments = [
  appointment("short", "09:00", "09:15", "Corte feminino", "Maria Silva"),
  appointment("half", "09:30", "10:00", "Manicure gel", "Sofia Martins"),
  appointment("fit", "10:15", "11:00", "Coloração e reflexos", "Carolina Ferreira", { manualFit: true }),
  appointment("long", "11:15", "12:15", "Tratamento capilar", "Joana Costa", { status: "completed", durationLabel: "60 min" }),
];

document.body.replaceChildren(document.createElement("div"));
createRoot(document.body.firstElementChild!).render(<ProfessionalTimeline
  date={new Date("2026-10-30T12:00:00Z")}
  now={new Date("2026-10-30T08:00:00Z")}
  professionals={professionals}
  appointments={appointments}
  availability={professionals.map(person => ({ staffId: person.id, startMinutes: 540, endMinutes: 780 }))}
  timeZone="Europe/Lisbon"
  onOpenAppointment={() => {}}
  onOpenBlock={() => {}}
  onCreateAtSlot={() => {}}
  onBlockAtSlot={() => {}}
/>);
