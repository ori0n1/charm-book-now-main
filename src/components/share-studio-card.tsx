import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Check, Copy, Download, ExternalLink, QrCode, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  studioName: string;
  studioSlug: string;
  variant?: "panel" | "compact";
  className?: string;
};

export function ShareStudioCard({ studioName, studioSlug, variant, className }: Props) {
  const compact = variant === "compact";
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const url = useMemo(
    () => (origin ? `${origin}/s/${studioSlug}` : `/s/${studioSlug}`),
    [origin, studioSlug],
  );
  const shortUrl = url.replace(/^https?:\/\//, "");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copiado");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  async function onShare() {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: studioName, text: `Marque online no ${studioName}`, url });
      } catch {
        /* dismissed */
      }
    } else {
      void onCopy();
    }
  }

  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-border bg-card",
        compact ? "gap-2 px-2.5 py-2" : "gap-3 px-3 py-2.5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p
            className={cn(
              "truncate uppercase tracking-[0.25em] text-muted-foreground",
              compact ? "text-[8px]" : "text-[9px]",
            )}
          >
            Link público
          </p>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Ativa
          </span>
        </div>
        <p
          className={cn(
            "mt-0.5 truncate font-mono text-foreground/85",
            compact ? "text-[11px]" : "text-[12px]",
          )}
        >
          {shortUrl}
        </p>
      </div>
      <div className={cn("flex items-center", compact ? "gap-1" : "gap-1")}> 
        <IconBtn compact={compact} label="Copiar" onClick={onCopy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </IconBtn>
        <IconBtn compact={compact} label="Abrir página" onClick={() => { window.location.href = url; }}>
          <ExternalLink className="size-3.5" />
        </IconBtn>
        <IconBtn compact={compact} label="Partilhar" onClick={onShare}>
          <Share2 className="size-3.5" />
        </IconBtn>
        <IconBtn compact={compact} label="QR Code" onClick={() => setQrOpen(true)}>
          <QrCode className="size-3.5" />
        </IconBtn>
      </div>

      {qrOpen && (
        <QrModal
          url={url}
          studioName={studioName}
          studioSlug={studioSlug}
          onClose={() => setQrOpen(false)}
        />
      )}
    </div>
  );
}

function IconBtn({
  children,
  compact,
  label,
  onClick,
}: {
  children: React.ReactNode;
  compact?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "grid place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground",
        compact ? "size-7" : "size-8",
      )}
    >
      {children}
    </button>
  );
}

function QrModal({
  url,
  studioName,
  studioSlug,
  onClose,
}: {
  url: string;
  studioName: string;
  studioSlug: string;
  onClose: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  function downloadPng() {
    const canvas = wrapRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${studioSlug}-qrcode.png`;
    a.click();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-background p-6 ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">QR Code</p>
            <h3 className="mt-1 text-lg font-light">{studioName}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-8 place-items-center rounded-full border border-border"
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          ref={wrapRef}
          className="mx-auto mt-5 grid aspect-square w-56 place-items-center rounded-xl bg-white p-4 ring-1 ring-border"
        >
          <QRCodeCanvas value={url} size={208} level="H" bgColor="#ffffff" fgColor="#0a0a0a" />
        </div>
        <p className="mt-3 truncate text-center text-[11px] text-muted-foreground">
          {url.replace(/^https?:\/\//, "")}
        </p>
        <button
          onClick={downloadPng}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-foreground py-2.5 text-sm font-medium text-background"
        >
          <Download className="size-4" /> Descarregar PNG
        </button>
      </div>
    </div>
  );
}
