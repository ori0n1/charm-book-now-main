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
        className="z-[10021] max-w-md rounded-3xl [&>button]:!absolute [&>button]:!right-3 [&>button]:!top-3"
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).focus({ preventScroll: true }); }}
      >
        <DialogHeader className="min-h-12 pr-16">
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
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" onClick={() => { onOpen(); onClose(); }} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-center text-sm font-semibold text-white">Abrir no WhatsApp do estúdio</a>
        ) : (
          <button type="button" disabled className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white opacity-40">Abrir no WhatsApp do estúdio</button>
        )}
        {onViewDetails && <button type="button" onClick={onViewDetails} className="text-sm font-medium text-foreground underline underline-offset-2">Ver detalhes da marcação</button>}
        <p className="text-[11px] text-muted-foreground">Ao abrir o WhatsApp, {statusTarget === "card" ? "o card indica envio manual" : "a marcação indica envio manual"}. Confirme o envio no aplicativo.</p>
      </DialogContent>
    </Dialog>
  );
}
