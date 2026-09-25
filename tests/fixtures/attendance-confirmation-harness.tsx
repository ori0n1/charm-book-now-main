import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AttendancePendingSheet,
  type AttendancePendingSheetItem,
} from "../../src/components/agenda/attendance-pending-sheet";

const initialItems: AttendancePendingSheetItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `pending-${index}`,
  startsAt: new Date(Date.UTC(2026, 8, 1, 9, index * 5)).toISOString(),
  clientName: `Cliente ${index + 1}`,
  serviceName: index % 2 === 0 ? "Brushing" : "Manicure",
  professionalName: index % 2 === 0 ? "Ana Silva" : "Maria Costa",
}));

export function Harness() {
  const [items, setItems] = useState(initialItems);
  return (
    <AttendancePendingSheet
      items={items}
      mode="group"
      closingReview={false}
      savingId={null}
      onClose={() => undefined}
      onResolve={(item) =>
        setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      }
      onResolveMany={(selected) => {
        const selectedIds = new Set(selected.map((item) => item.id));
        setItems((current) => current.filter((candidate) => !selectedIds.has(candidate.id)));
      }}
    />
  );
}

const root = document.getElementById("attendance-test-root");
if (!root) throw new Error("attendance_test_root_missing");
createRoot(root).render(<Harness />);
