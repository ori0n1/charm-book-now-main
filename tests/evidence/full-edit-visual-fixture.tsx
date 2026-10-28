import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { EditAppointmentModal } from "./.full-edit-visual.generated";

declare global { interface Window { __editorSaves: unknown[] } }
window.__editorSaves = [];
const studioId = "11111111-1111-4111-8111-111111111111";
const serviceA = { id:"44444444-4444-4444-8444-444444444444", name:"Serviço A" };
const serviceB = { id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name:"Serviço B" };
const staffA = { id:"33333333-3333-4333-8333-333333333333", name:"Profissional A", commission_percent:30 };
const staffB = { id:"99999999-9999-4999-8999-999999999999", name:"Profissional B", commission_percent:30 };
type Case = "completed"|"no_show"|"multi"|"joint"|"paid"|"paid_multi"|"paid_joint"|"paid_confirmed";
function App() {
  const [selected,setSelected] = useState<Case|null>(null);
  const multiple = selected==="multi" || selected==="joint" || selected==="paid_multi" || selected==="paid_joint";
  const appointment = {
    id:"55555555-5555-4555-8555-555555555555",
    starts_at:"2030-10-29T10:00:00Z", ends_at:multiple?"2030-10-29T11:30:00Z":"2030-10-29T11:00:00Z",
    status:selected==="no_show"?"no_show":selected==="paid_confirmed"?"confirmed":"completed", total_price:multiple?80:50,
    total_duration_min:multiple?90:60, notes:"", is_manual_fit:false,
    clients:{name:"Cliente sintético"}, staff:staffA, studio_commission_percent_snapshot:25,
    appointment_services:[
      {id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",price:50,duration_min:60,service_state:selected==="joint" || selected==="paid_joint"?"completed":null,
        staff:staffA,services:serviceA,starts_at:"2030-10-29T10:00:00Z",ends_at:"2030-10-29T11:00:00Z"},
      ...(multiple?[{id:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",price:30,duration_min:30,
        service_state:selected==="joint" || selected==="paid_joint"?"no_show":null,staff:staffB,services:serviceB,
        starts_at:"2030-10-29T11:00:00Z",ends_at:"2030-10-29T11:30:00Z"}]:[])
    ],
  };
  return <>
    <button onClick={()=>setSelected("completed")}>Editar Compareceu</button>
    <button onClick={()=>setSelected("no_show")}>Editar Faltou</button>
    <button onClick={()=>setSelected("multi")}>Editar vários serviços</button>
    <button onClick={()=>setSelected("joint")}>Editar serviço conjunto</button>
    <button onClick={()=>setSelected("paid")}>Editar com comissão liquidada</button>
    <button onClick={()=>setSelected("paid_multi")}>Editar vários serviços recebidos</button>
    <button onClick={()=>setSelected("paid_joint")}>Editar conjunto recebido</button>
    <button onClick={()=>setSelected("paid_confirmed")}>Editar confirmação recebida</button>
    {selected && <EditAppointmentModal studioId={studioId} appt={appointment as any}
      receivedAmount={["paid","paid_multi","paid_joint","paid_confirmed"].includes(selected)?50:0} ownerCanEditResolved={true} studioTimezone="Europe/Lisbon"
      onClose={()=>setSelected(null)} onSaved={()=>setSelected(null)} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<App/>);
