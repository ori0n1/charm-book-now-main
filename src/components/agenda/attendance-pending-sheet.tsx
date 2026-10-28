import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Check, Clock3, Loader2, X } from "lucide-react";
import { formatStudioTime } from "@/lib/studio-time";

export type AttendancePendingSheetItem = {
  id: string;
  startsAt: string;
  clientName: string;
  serviceName: string;
  professionalName: string;
};

type AttendanceOutcome = "completed" | "no_show";

export function AttendancePendingSheet({ items, mode, closingReview, savingId, timeZone, onResolve, onResolveMany, onClose }: {
  items: AttendancePendingSheetItem[];
  mode: "single" | "group";
  closingReview: boolean;
  savingId: string | null;
  timeZone?: string | null;
  onResolve: (item: AttendancePendingSheetItem, outcome: AttendanceOutcome) => void;
  onResolveMany: (items: AttendancePendingSheetItem[], outcome: AttendanceOutcome) => void;
  onClose: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const busy = savingId !== null;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (items.length === 0) onClose();
  }, [items.length, onClose]);

  useEffect(() => {
    const available = new Set(items.map((item) => item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  if (items.length === 0) return null;
  const title = mode === "single" ? "O cliente compareceu?" : closingReview ? "Fechar o dia" : "Atendimentos por confirmar";
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const allSelected = items.length > 0 && selectedItems.length === items.length;

  return createPortal(
    <div className="fixed inset-0 z-[10000]" role="dialog" aria-modal="true" aria-labelledby="attendance-review-title" data-testid="attendance-pending-sheet">
      <button type="button" aria-label="Fechar confirmações de atendimento" onClick={onClose} className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" />
      <aside className="absolute inset-x-0 bottom-0 flex max-h-[min(86dvh,42rem)] flex-col overflow-hidden rounded-t-[1.5rem] border-t border-border bg-card shadow-2xl animate-in slide-in-from-bottom-3 duration-200 md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[25rem] md:rounded-none md:rounded-l-[1.5rem] md:border-l md:border-t-0 md:slide-in-from-right-3">
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted-foreground/20 md:hidden" />
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5 md:px-5 md:py-4">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">{mode === "single" ? "Confirmação rápida" : `${items.length} pendentes`}</p>
            <h2 id="attendance-review-title" className="mt-0.5 text-base font-black tracking-tight">{title}</h2>
            {mode === "group" && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Selecione um ou vários atendimentos e resolva-os com a mesma regra financeira.</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
        </header>

        {mode === "group" && (
          <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2.5 border-b border-border/70 px-4 text-xs font-black md:px-5">
            <input type="checkbox" checked={allSelected} disabled={busy} onChange={() => setSelectedIds(allSelected ? new Set() : new Set(items.map((item) => item.id)))} className="size-4 rounded border-border accent-emerald-600" data-testid="attendance-select-all" />
            Selecionar todos
            <span className="ml-auto font-semibold text-muted-foreground">{selectedItems.length} de {items.length}</span>
          </label>
        )}

        <div className="min-h-0 flex-1 divide-y divide-border/65 overflow-y-auto overscroll-contain px-4 md:px-5">
          {items.map((item) => {
            const saving = savingId === item.id;
            return (
              <article key={item.id} className="py-3.5" data-testid="attendance-pending-item">
                <div className="flex min-w-0 items-start gap-2.5">
                  {mode === "group" && <input type="checkbox" aria-label={`Selecionar ${item.clientName}`} checked={selectedIds.has(item.id)} disabled={busy} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} className="mt-1 size-4 shrink-0 rounded border-border accent-emerald-600" />}
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-muted px-2 py-1 font-mono text-[11px] font-black tabular-nums"><Clock3 className="size-3" />{formatStudioTime(item.startsAt, timeZone)}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{item.clientName}</p><p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">{item.serviceName} · {item.professionalName}</p></div>
                </div>
                {mode === "single" && <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy} onClick={() => onResolve(item, "completed")} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-emerald-300/70 bg-emerald-50/70 px-3 text-xs font-black text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Compareceu</button>
                  <button type="button" disabled={busy} onClick={() => onResolve(item, "no_show")} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-rose-300/70 bg-background px-3 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-500/25 dark:text-rose-300 dark:hover:bg-rose-500/10"><X className="size-3.5" />Faltou</button>
                </div>}
              </article>
            );
          })}
        </div>

        {mode === "group" && (
          <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-border/70 bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 md:px-5 md:pb-4">
            <button type="button" disabled={busy || selectedItems.length === 0} onClick={() => onResolveMany(selectedItems, "completed")} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-45" data-testid="attendance-bulk-completed">{savingId === "bulk" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Compareceram</button>
            <button type="button" disabled={busy || selectedItems.length === 0} onClick={() => onResolveMany(selectedItems, "no_show")} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-rose-300/70 bg-background px-3 text-xs font-black text-rose-700 transition hover:bg-rose-50 disabled:opacity-45 dark:border-rose-500/25 dark:text-rose-300 dark:hover:bg-rose-500/10" data-testid="attendance-bulk-no-show"><X className="size-3.5" />Faltaram</button>
          </footer>
        )}
      </aside>
    </div>,
    document.body,
  );
}
