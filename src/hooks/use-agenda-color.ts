import { useEffect, useState } from "react";

export const agendaColors = ["sky", "teal", "lavender", "peach"] as const;
export type AgendaColor = typeof agendaColors[number];

export function isAgendaColor(value: unknown): value is AgendaColor {
  return agendaColors.includes(value as AgendaColor);
}

export function useAgendaColor(studioId?: string) {
  const [color, setColor] = useState<AgendaColor>("sky");
  const storageKey = studioId ? `bellza:agenda-color:${studioId}` : null;

  useEffect(() => {
    if (!storageKey) { setColor("sky"); return; }
    const read = () => {
      try {
        const stored = localStorage.getItem(storageKey);
        setColor(isAgendaColor(stored) ? stored : "sky");
      } catch { setColor("sky"); }
    };
    read();
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey) read(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey]);

  const saveColor = (value: AgendaColor) => {
    if (!storageKey) return false;
    try {
      localStorage.setItem(storageKey, value);
      setColor(value);
      return true;
    } catch { return false; }
  };
  return { color, saveColor };
}
