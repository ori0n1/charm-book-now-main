import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildWhatsAppComposeUrl } from "@/lib/appointment-whatsapp-message";

export type ManualWhatsAppDraft = {
  name: string;
  phone: string;
  text: string;
};

export function ManualWhatsAppDialog({
  draft,
  onClose,
  onOpen,
  onViewDetails,
  statusTarget = "card",
}: {
  draft: ManualWhatsAppDraft | null;
  onClose: () => void;
  onOpen: () => void;
  onViewDetails?: () => void;
  statusTarget?: "card" | "marcação";
}) {
  const [text, setText] = useState(draft?.text ?? "");
  const [studioAccountConfirmed, setStudioAccountConfirmed] = useState(false);
  const url = draft && studioAccountConfirmed && text.trim()
    ? buildWhatsAppComposeUrl(draft.phone, text)
    : null;

  return (
    <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="z-[10020]"
        className="z-[10021] max-w-md rounded-3xl [&>button:last-child]:!absolute [&>button:last-child]:!right-3 [&>button:last-child]:!top-3"
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).focus({ preventScroll: true }); }}
      >
        <DialogHeader className="pr-14">
          <DialogTitle className="break-words text-left leading-snug">Mensagem para {draft?.name}</DialogTitle>
          <DialogDescription className="text-left">Edite o texto antes de abrir a conversa. O envio é manual.</DialogDescription>
        </DialogHeader>
        <label className="text-sm font-medium">Mensagem
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring/20" />
        </label>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={studioAccountConfirmed} onChange={(event) => setStudioAccountConfirmed(event.target.checked)} className="mt-0.5" />
          Confirmo que a conta de WhatsApp aberta neste aparelho é a do estúdio.
        </label>
        <div className="min-w-0 space-y-3 border-t border-border/70 pt-3">
          <p className="text-[11px] text-muted-foreground">Ao abrir o WhatsApp, {statusTarget === "card" ? "o card indica envio manual" : "a marcação indica envio manual"}. O registo não confirma a entrega da mensagem.</p>
          <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {onViewDetails && <button type="button" onClick={onViewDetails} className="min-h-10 rounded-xl px-3 text-sm font-medium text-foreground underline underline-offset-2 sm:mr-auto">Ver detalhes da marcação</button>}
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" onClick={() => { onOpen(); onClose(); }} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-center text-sm font-semibold text-white sm:max-w-[15rem]">Abrir no WhatsApp do estúdio</a>
            ) : (
              <button type="button" disabled className="min-h-10 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white opacity-40 sm:max-w-[15rem]">Abrir no WhatsApp do estúdio</button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
