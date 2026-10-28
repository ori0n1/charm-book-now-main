import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { Gift, QrCode, Share2, Sparkles } from "lucide-react";
import { toast } from "sonner";

type Reward = { id: string; type: "percent" | "fixed"; value: number; stampsRequired: number; code: string; createdAt: string };
type UsedReward = { id: string; type: "percent" | "fixed"; value: number; usedAt: string };
type ExpiredReward = { id: string; type: "percent" | "fixed"; value: number };

function benefit(type: "percent" | "fixed", value: number) {
  return `${new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 }).format(value)}${type === "percent" ? "%" : " €"} de desconto`;
}

function brandHex(value?: string | null) {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#BD836F";
}

function brandRgb(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function drawCenteredLines(ctx: CanvasRenderingContext2D, text: string, y: number, maxWidth: number, lineHeight: number) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.length - 1;
    if (last >= 0 && ctx.measureText(`${lines[last]} ${word}`).width <= maxWidth) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  if (lines.length > 2) {
    lines.length = 2;
    while (ctx.measureText(`${lines[1]}…`).width > maxWidth) lines[1] = lines[1].slice(0, -1);
    lines[1] += "…";
  }
  lines.forEach((line, index) => ctx.fillText(line, 540, y + index * lineHeight, maxWidth));
}

export function CustomerLoyaltyAchievements({ studioId, studioName, logoUrl, brandColor, rewards, usedRewards, expiredRewards = [], vipBadge }: {
  studioId: string;
  studioName: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  rewards: Reward[];
  usedRewards: UsedReward[];
  expiredRewards?: ExpiredReward[];
  vipBadge: string | null;
  progress: number;
  nextAt: number;
}) {
  const [qrRewardId, setQrRewardId] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [visibleGroups, setVisibleGroups] = useState(4);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [visibleInGroup, setVisibleInGroup] = useState(5);
  const [visibleUsed, setVisibleUsed] = useState(5);
  const [shareTarget, setShareTarget] = useState<string | null>(null);
  const [shareImage, setShareImage] = useState<{ file: File; url: string } | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const shareRequest = useRef(0);
  const [celebrate, setCelebrate] = useState(false);
  const [usedCelebrate, setUsedCelebrate] = useState(false);
  const activeReward = rewards.find((reward) => reward.id === qrRewardId);
  const latestUsed = usedRewards[0];
  const rewardIds = rewards.map((reward) => reward.id).join(":");
  const color = brandHex(brandColor);
  const groups = useMemo(() => {
    const byBenefit = new Map<string, Reward[]>();
    for (const reward of rewards) {
      const key = `${reward.type}:${reward.value}`;
      const group = byBenefit.get(key) ?? [];
      group.push(reward);
      byBenefit.set(key, group);
    }
    return [...byBenefit.entries()];
  }, [rewards]);

  useEffect(() => () => { if (shareImage) URL.revokeObjectURL(shareImage.url); }, [shareImage]);

  useEffect(() => {
    if (!qrRewardId && !shareTarget) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setQrRewardId(null);
      setShareTarget(null);
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [qrRewardId, shareTarget]);

  useEffect(() => {
    if (!rewardIds || !studioId) return;
    try {
      const unseen = rewards.filter((reward) => !localStorage.getItem(`bellza:loyalty:seen:${studioId}:${reward.id}`));
      if (!unseen.length) return;
      unseen.forEach((reward) => localStorage.setItem(`bellza:loyalty:seen:${studioId}:${reward.id}`, "1"));
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setCelebrate(true);
      const timer = window.setTimeout(() => setCelebrate(false), 2400);
      return () => window.clearTimeout(timer);
    } catch { /* Storage restrictions never hide a benefit. */ }
  }, [rewardIds, studioId]);

  useEffect(() => {
    if (!latestUsed || !studioId) return;
    const key = `bellza:loyalty:used-seen:${studioId}:${latestUsed.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setUsedCelebrate(true);
      const timer = window.setTimeout(() => setUsedCelebrate(false), 2400);
      return () => window.clearTimeout(timer);
    } catch { /* Storage restrictions never hide a benefit. */ }
  }, [latestUsed?.id, studioId]);

  async function createShareCard(headline: string, subtitle: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080; canvas.height = 1920;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas_unavailable");
    const background = ctx.createLinearGradient(0, 0, 1080, 1920);
    background.addColorStop(0, "#17131B"); background.addColorStop(0.5, "#2B2028"); background.addColorStop(1, "#100F17");
    ctx.fillStyle = background; ctx.fillRect(0, 0, 1080, 1920);
    const glow = ctx.createRadialGradient(540, 900, 100, 540, 900, 830);
    glow.addColorStop(0, brandRgb(color, 0.5)); glow.addColorStop(1, brandRgb(color, 0));
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 1080, 1920);
    ctx.strokeStyle = brandRgb(color, 0.65); ctx.lineWidth = 3; ctx.strokeRect(52, 52, 976, 1816);
    ctx.strokeStyle = "rgba(255,245,232,.18)"; ctx.strokeRect(68, 68, 944, 1784);
    // Decorative particles are static in the shared PNG; no code or personal data is drawn.
    for (let index = 0; index < 42; index++) {
      const x = 104 + ((index * 379) % 872), y = 300 + ((index * 683) % 1260);
      ctx.save(); ctx.translate(x, y); ctx.rotate((index * 43 * Math.PI) / 180);
      ctx.fillStyle = index % 3 === 0 ? "rgba(255,242,213,.82)" : brandRgb(color, 0.72);
      ctx.fillRect(-2, -8, 4, 16); ctx.restore();
    }
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,247,235,.9)"; ctx.font = "600 30px Arial";
    ctx.fillText("BELLZA  ·  FIDELIDADE", 540, 160);
    ctx.fillStyle = brandRgb(color, 0.32); ctx.beginPath(); ctx.roundRect(435, 214, 210, 210, 48); ctx.fill();
    let logoDrawn = false;
    if (logoUrl) {
      try {
        const response = await fetch(logoUrl, { mode: "cors" });
        if (response.ok) {
          const image = await createImageBitmap(await response.blob());
          ctx.save(); ctx.beginPath(); ctx.roundRect(449, 228, 182, 182, 38); ctx.clip();
          const scale = Math.max(182 / image.width, 182 / image.height);
          ctx.drawImage(image, 540 - image.width * scale / 2, 319 - image.height * scale / 2, image.width * scale, image.height * scale);
          ctx.restore(); image.close(); logoDrawn = true;
        }
      } catch { /* Monogram fallback for a blocked image. */ }
    }
    if (!logoDrawn) {
      ctx.fillStyle = "#FFF7EB"; ctx.font = "bold 96px Georgia";
      ctx.fillText(studioName.trim().slice(0, 1).toUpperCase() || "B", 540, 357);
    }
    ctx.fillStyle = "#FFF7EB"; ctx.font = "bold 54px Georgia";
    drawCenteredLines(ctx, studioName, 495, 830, 60);
    const panel = ctx.createLinearGradient(110, 650, 970, 1390);
    panel.addColorStop(0, "rgba(255,249,240,.18)"); panel.addColorStop(1, brandRgb(color, 0.35));
    ctx.fillStyle = panel; ctx.beginPath(); ctx.roundRect(110, 655, 860, 705, 66); ctx.fill();
    ctx.strokeStyle = "rgba(255,238,214,.62)"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#FFE2AC"; ctx.font = "600 31px Arial";
    ctx.fillText("✦  CONQUISTA DESBLOQUEADA  ✦", 540, 770);
    ctx.fillStyle = "#FFF9F0"; ctx.font = "bold 96px Georgia";
    drawCenteredLines(ctx, headline, 1010, 750, 112);
    ctx.strokeStyle = brandRgb(color, 0.95); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(380, 1165); ctx.lineTo(700, 1165); ctx.stroke();
    ctx.fillStyle = "#FBEAD8"; ctx.font = "40px Arial";
    drawCenteredLines(ctx, subtitle, 1240, 700, 48);
    ctx.fillStyle = "#FFF7EB"; ctx.font = "bold 43px Georgia";
    ctx.fillText("Um momento para celebrar", 540, 1505);
    ctx.fillStyle = "rgba(255,247,235,.78)"; ctx.font = "30px Arial";
    ctx.fillText("A tua conquista merece brilhar.", 540, 1570);
    ctx.fillStyle = brandRgb(color, 0.9); ctx.fillRect(430, 1640, 220, 4);
    ctx.fillStyle = "rgba(255,247,235,.7)"; ctx.font = "26px Arial";
    ctx.fillText("BELLZA · A BELEZA DE CONQUISTAR", 540, 1780);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("image_unavailable");
    return new File([blob], "bellza-conquista.png", { type: "image/png" });
  }

  async function prepareShare(id: string, headline: string, subtitle: string) {
    const request = ++shareRequest.current;
    setShareTarget(id);
    setShareImage(null);
    setShareLoading(true);
    try {
      const file = await createShareCard(headline, subtitle);
      if (request === shareRequest.current) setShareImage({ file, url: URL.createObjectURL(file) });
    } catch {
      if (request === shareRequest.current) toast.error("Não foi possível criar a imagem. Tenta novamente.");
    } finally {
      if (request === shareRequest.current) setShareLoading(false);
    }
  }

  function closeShare() {
    shareRequest.current++;
    setShareTarget(null);
    setShareImage(null);
    setShareLoading(false);
  }

  function downloadShare() {
    if (!shareImage) return;
    const link = document.createElement("a");
    link.href = shareImage.url;
    link.download = shareImage.file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function sendShare() {
    if (!shareImage) return;
    if (navigator.canShare?.({ files: [shareImage.file] }) && navigator.share) {
      // Share is invoked directly by this tap; Safari requires its transient activation.
      navigator.share({ files: [shareImage.file], title: "Conquista Bellza" }).catch((error: DOMException) => {
        if (error.name !== "AbortError") toast.error("Não foi possível partilhar. Podes guardar a imagem.");
      });
    } else downloadShare();
  }

  return <div className="relative">
    {celebrate && <div aria-hidden="true" className="bellza-confetti pointer-events-none absolute inset-x-0 top-0 z-10 h-44 overflow-hidden">{Array.from({ length: 22 }, (_, i) => <span key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.1}s`, backgroundColor: i % 2 ? color : "#EBC484" }} />)}</div>}
    {(rewards.length > 0 || usedRewards.length > 0 || expiredRewards.length > 0 || vipBadge) && <section className="overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-card shadow-sm" aria-label="Minhas recompensas">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-200"><Gift className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black text-foreground">Minhas recompensas</p>
          <p className="truncate text-[11px] text-muted-foreground">{rewards.length} benefício{rewards.length === 1 ? "" : "s"} disponível{rewards.length === 1 ? "" : "eis"} · {studioName}</p>
        </div>
        {vipBadge && <span className="max-w-24 truncate rounded-full bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-800 dark:text-amber-200" title={vipBadge}>{vipBadge}</span>}
        <button type="button" aria-expanded={walletOpen} onClick={() => setWalletOpen(!walletOpen)} className="shrink-0 rounded-full bg-foreground px-3 py-2 text-[11px] font-bold text-background">{walletOpen ? "Fechar" : "Ver recompensas"}</button>
      </div>
      {walletOpen && <div className="space-y-2 border-t border-border/60 px-3 py-3">
        {groups.slice(0, visibleGroups).map(([key, items]) => <div key={key} className="rounded-xl border border-border/70 bg-card/90 px-2.5 py-2">
          <div className="flex min-h-8 items-center gap-2">
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-foreground">{benefit(items[0].type, items[0].value)}{items.length > 1 ? ` · ${items.length} disponíveis` : ""}</p><p className="truncate text-[10px] text-muted-foreground">{studioName} · Disponível</p></div>
            <button type="button" aria-expanded={expandedGroup === key} onClick={() => { setExpandedGroup(expandedGroup === key ? null : key); setVisibleInGroup(5); }} className="shrink-0 rounded-full border border-border px-2.5 py-1.5 text-[11px] font-bold text-foreground">{expandedGroup === key ? "Fechar" : items.length === 1 ? "Aceder" : "Ver"}</button>
          </div>
          {expandedGroup === key && <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
            {items.slice(0, visibleInGroup).map((reward, index) => <div key={reward.id} className="flex items-center gap-2 rounded-lg bg-muted/45 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{items.length > 1 ? `Recompensa ${index + 1}` : `${reward.stampsRequired} carimbos`} · Disponível</span>
              <button type="button" onClick={() => setQrRewardId(reward.id)} className="shrink-0 rounded-full bg-foreground px-2 py-1.5 text-[10px] font-bold text-background"><QrCode className="mr-1 inline size-3" />Ver QR code</button>
              <button type="button" onClick={() => prepareShare(reward.id, benefit(reward.type, reward.value), `${reward.stampsRequired} carimbos de fidelidade`)} className="shrink-0 rounded-full border border-border px-2 py-1.5 text-[10px] font-bold text-foreground"><Share2 className="mr-1 inline size-3" />Partilhar</button>
            </div>)}
            {items.length > visibleInGroup && <button type="button" onClick={() => setVisibleInGroup(visibleInGroup + 5)} className="w-full py-1.5 text-xs font-bold text-foreground">Carregar mais</button>}
          </div>}
        </div>)}
        {groups.length > visibleGroups && <button type="button" onClick={() => setVisibleGroups(visibleGroups + 4)} className="w-full rounded-full border border-border py-2 text-xs font-bold text-foreground">Carregar mais recompensas</button>}
        {usedRewards.length > 0 && <details className="rounded-xl border border-border bg-card px-2.5 py-2"><summary className="cursor-pointer text-xs font-bold text-muted-foreground">Benefícios utilizados ({usedRewards.length}){usedCelebrate ? " · ✨" : ""}</summary><div className="mt-2 space-y-1">{usedRewards.slice(0, visibleUsed).map((reward) => <div key={reward.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1.5 text-xs"><span className="truncate font-semibold text-foreground">{benefit(reward.type, reward.value)}</span><span className="shrink-0 text-muted-foreground">Utilizado</span></div>)}{usedRewards.length > visibleUsed && <button type="button" onClick={() => setVisibleUsed(visibleUsed + 5)} className="w-full py-1.5 text-xs font-bold">Carregar mais</button>}</div></details>}
        {expiredRewards.length > 0 && <details className="rounded-xl border border-border bg-card px-2.5 py-2"><summary className="cursor-pointer text-xs font-bold text-muted-foreground">Benefícios expirados ({expiredRewards.length})</summary><div className="mt-2 space-y-1">{expiredRewards.slice(0, visibleUsed).map((reward) => <div key={reward.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1.5 text-xs"><span className="truncate font-semibold text-foreground">{benefit(reward.type, reward.value)}</span><span className="shrink-0 text-muted-foreground">Expirado</span></div>)}{expiredRewards.length > visibleUsed && <button type="button" onClick={() => setVisibleUsed(visibleUsed + 5)} className="w-full py-1.5 text-xs font-bold">Carregar mais</button>}</div></details>}
        {vipBadge && <button type="button" onClick={() => prepareShare("vip", vipBadge, "Reconhecimento especial")} className="flex w-full items-center justify-between rounded-xl border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-xs font-bold text-amber-800 dark:text-amber-200"><span className="flex items-center gap-1.5"><Sparkles className="size-3.5" />{vipBadge}</span><span>Partilhar selo</span></button>}
      </div>}
    </section>}
    {typeof document !== "undefined" && activeReward && createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 py-6" onClick={() => setQrRewardId(null)}><div role="dialog" aria-modal="true" aria-label="Apresentar benefício" className="w-full max-w-sm rounded-2xl bg-background p-4 text-center shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-start justify-between gap-2 text-left"><div><h2 className="text-base font-bold">Apresentar benefício</h2><p className="text-xs text-muted-foreground">{benefit(activeReward.type, activeReward.value)} · {studioName}</p></div><button type="button" onClick={() => setQrRewardId(null)} aria-label="Fechar QR code" className="rounded-full px-2 text-xl">×</button></div><div className="inline-block rounded-xl bg-white p-3"><QRCodeSVG value={activeReward.code} size={205} level="H" /></div><p className="mt-3 break-all font-mono text-sm font-bold tracking-wider">{activeReward.code.match(/.{1,4}/g)?.join(" ")}</p><button type="button" onClick={() => { if (!navigator.clipboard?.writeText) { toast.error("Não foi possível copiar o código."); return; } navigator.clipboard.writeText(activeReward.code).then(() => toast.success("Código copiado.")).catch(() => toast.error("Não foi possível copiar o código.")); }} className="mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-bold">Copiar código</button><p className="mt-2 text-xs text-muted-foreground">Mostra este código no estúdio para utilizares o teu benefício.</p></div></div>, document.body)}
    {typeof document !== "undefined" && shareTarget && createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 py-6" onClick={closeShare}><div role="dialog" aria-modal="true" aria-label="Partilhar conquista" className="max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl bg-background p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-bold">Partilhar conquista</h2><button type="button" onClick={closeShare} aria-label="Fechar partilha" className="rounded-full px-2 text-xl">×</button></div>{shareLoading && <p role="status" className="py-8 text-center text-sm">A preparar imagem…</p>}{shareImage && <><img src={shareImage.url} alt="Pré-visualização da conquista" className="mx-auto max-h-[55dvh] rounded-xl object-contain" /><div className="mt-3 flex gap-2"><button type="button" onClick={sendShare} className="flex-1 rounded-full bg-foreground px-3 py-2 text-xs font-bold text-background">Partilhar imagem</button><button type="button" onClick={downloadShare} className="rounded-full border border-border px-3 py-2 text-xs font-bold">Guardar</button></div></>}{!shareLoading && !shareImage && <button type="button" onClick={() => { const reward = rewards.find((item) => item.id === shareTarget); void prepareShare(shareTarget, reward ? benefit(reward.type, reward.value) : vipBadge ?? "Conquista", reward ? `${reward.stampsRequired} carimbos de fidelidade` : "Reconhecimento especial"); }} className="w-full rounded-full border border-border px-3 py-2 text-xs font-bold">Tentar novamente</button>}</div></div>, document.body)}
    <style>{`@keyframes bellza-fall{0%{transform:translateY(-25px) rotate(0);opacity:1}100%{transform:translateY(220px) rotate(560deg);opacity:0}}.bellza-confetti span{position:absolute;top:0;width:6px;height:11px;animation:bellza-fall 2.4s ease-out forwards}@media(prefers-reduced-motion:reduce){.bellza-confetti{display:none}}`}</style>
  </div>;
}
