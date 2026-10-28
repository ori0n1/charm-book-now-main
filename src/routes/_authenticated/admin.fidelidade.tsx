import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BadgePercent,
  Camera,
  ChevronDown,
  Gift,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Stamp,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  adjustCustomerLoyaltyStamps,
  decideCustomerReferral,
  findCustomerLoyaltyClients,
  getCustomerLoyaltyAdminSummary,
  lookupCustomerLoyaltyReward,
  redeemCustomerLoyaltyReward,
  updateCustomerLoyaltySettings,
  type CustomerLoyaltyAdminSummary,
  type CustomerLoyaltySettings,
} from "@/lib/customer-loyalty.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/fidelidade")({
  component: AdminLoyaltyPage,
});

function AdminLoyaltyPage() {
  const { studio, loading: studioLoading, error: studioError, refetch: refetchStudio } = useCurrentStudio();
  const loadSummary = useServerFn(getCustomerLoyaltyAdminSummary);
  const saveSettings = useServerFn(updateCustomerLoyaltySettings);
  const lookupReward = useServerFn(lookupCustomerLoyaltyReward);
  const redeemReward = useServerFn(redeemCustomerLoyaltyReward);
  const findClients = useServerFn(findCustomerLoyaltyClients);
  const adjustStamps = useServerFn(adjustCustomerLoyaltyStamps);
  const decideReferral = useServerFn(decideCustomerReferral);
  const [summary, setSummary] = useState<CustomerLoyaltyAdminSummary | null>(null);
  const [draft, setDraft] = useState<CustomerLoyaltySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [stampsOpen, setStampsOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [code, setCode] = useState("");
  const [foundReward, setFoundReward] = useState<{ id: string; status: string; type: "percent" | "fixed"; value: number; clientName: string } | null>(null);
  const [validating, setValidating] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  const [clients, setClients] = useState<Array<{ id: string; name: string; stamps: number }>>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [stampDelta, setStampDelta] = useState(1);
  const [stampNote, setStampNote] = useState("");
  const [managementBusy, setManagementBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<{ stop: () => void } | null>(null);
  const scannerRunRef = useRef(0);
  const pendingStampActionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!studio?.id) {
      if (!studioLoading) setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setLoadError(null);
    const timeout = window.setTimeout(() => {
      if (!alive) return;
      setLoadError("A consulta demorou demasiado. Tenta novamente.");
      setLoading(false);
      alive = false;
    }, 20000);
    loadSummary({ data: { studioId: studio.id } })
      .then((payload) => {
        if (!alive) return;
        const next = payload as CustomerLoyaltyAdminSummary;
        setSummary(next);
        setDraft(next.settings);
      })
      .catch((error) => {
        if (!alive) return;
        console.error("[customer-loyalty] admin_load_failed", error);
        setLoadError("Não foi possível carregar a Fidelidade. Tenta novamente.");
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      window.clearTimeout(timeout);
    };
  }, [loadSummary, studio?.id, studioLoading, retryKey]);

  const hasChanges = useMemo(
    () => JSON.stringify(summary?.settings ?? null) !== JSON.stringify(draft ?? null),
    [draft, summary],
  );

  async function save() {
    if (!studio?.id || !draft) return;
    setSaving(true);
    try {
      const next = (await saveSettings({
        data: {
          studioId: studio.id,
          ...draft,
        },
      })) as CustomerLoyaltyAdminSummary;
      setSummary(next);
      setDraft(next.settings);
      setRulesOpen(true);
      toast.success("Fidelidade atualizada.");
    } catch (error) {
      console.error("[customer-loyalty] admin_save_failed", error);
      toast.error("Não foi possível confirmar a gravação. Tenta novamente; as regras não serão duplicadas.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => () => scannerRef.current?.stop(), []);
  useEffect(() => {
    if (!validationOpen) {
      scannerRunRef.current += 1;
      scannerRef.current?.stop();
      scannerRef.current = null;
    }
  }, [validationOpen]);

  async function startScanner() {
    const run = ++scannerRunRef.current;
    try {
      scannerRef.current?.stop();
      if (!videoRef.current) return;
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        videoRef.current,
        (result, _error, controls) => {
          if (!result) return;
          setCode(result.getText().trim().toUpperCase());
          setFoundReward(null);
          controls.stop();
          scannerRef.current = null;
        },
      );
      if (run !== scannerRunRef.current) controls.stop();
      else scannerRef.current = controls;
    } catch {
      if (run !== scannerRunRef.current) return;
      scannerRef.current?.stop();
      scannerRef.current = null;
      toast.error("Leitor indisponível. Introduza o código manualmente.");
    }
  }

  async function checkCode() {
    if (!studio?.id || !code.trim()) return;
    setValidating(true);
    try {
      const result = await lookupReward({ data: { studioId: studio.id, code: code.trim() } });
      setFoundReward(result as typeof foundReward);
      if (!result) toast.error("Código não encontrado neste estúdio.");
    } catch {
      toast.error("Não foi possível validar o código.");
    } finally { setValidating(false); }
  }

  async function confirmUse() {
    if (!studio?.id || !foundReward || foundReward.status !== "available") return;
    setValidating(true);
    try {
      await redeemReward({ data: { studioId: studio.id, code: code.trim() } });
      setFoundReward({ ...foundReward, status: "used" });
      setSummary(await loadSummary({ data: { studioId: studio.id } }) as CustomerLoyaltyAdminSummary);
      toast.success("Benefício utilizado.");
    } catch {
      toast.error("Benefício indisponível ou já utilizado.");
      await checkCode();
    } finally { setValidating(false); }
  }

  async function searchClients() {
    if (!studio?.id) return;
    try {
      setClients(await findClients({ data: { studioId: studio.id, query: clientQuery } }));
    } catch {
      toast.error("Não foi possível pesquisar clientes.");
    }
  }

  async function submitStampAdjustment() {
    if (!studio?.id || !selectedClientId || !stampNote.trim() || !stampDelta || managementBusy) return;
    setManagementBusy(true);
    try {
      const actionId = pendingStampActionRef.current ?? crypto.randomUUID();
      pendingStampActionRef.current = actionId;
      await adjustStamps({ data: { studioId: studio.id, clientId: selectedClientId,
        delta: stampDelta, note: stampNote.trim(), actionId } });
      pendingStampActionRef.current = null;
      setSummary(await loadSummary({ data: { studioId: studio.id } }) as CustomerLoyaltyAdminSummary);
      setClients(await findClients({ data: { studioId: studio.id, query: clientQuery } }));
      setStampNote("");
      toast.success("Ajuste de carimbos registado.");
    } catch (error) {
      console.error("[customer-loyalty] stamp_adjustment_failed", error);
      toast.error("Não foi possível ajustar os carimbos. Confere o saldo e tenta novamente.");
    } finally { setManagementBusy(false); }
  }

  async function reviewReferral(referralId: string, approve: boolean) {
    if (!studio?.id || managementBusy) return;
    setManagementBusy(true);
    try {
      const result = await decideReferral({ data: { studioId: studio.id, referralId, approve } });
      setSummary(await loadSummary({ data: { studioId: studio.id } }) as CustomerLoyaltyAdminSummary);
      toast.success(result.status === "completed" ? "Indicação validada." : "Indicação recusada.");
    } catch (error) {
      console.error("[customer-loyalty] referral_review_failed", error);
      toast.error("Só é possível aprovar após atendimento, presença e pagamento confirmados.");
    } finally { setManagementBusy(false); }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[55vh] w-full max-w-5xl items-center justify-center px-4">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          A carregar fidelidade...
        </div>
      </main>
    );
  }

  if (!draft) {
    return <main className="mx-auto flex min-h-[55vh] w-full max-w-xl items-center justify-center px-4">
      <div role="alert" className="w-full rounded-2xl border border-border bg-card p-5 text-center shadow-sm">
        <p className="text-sm font-bold text-foreground">{loadError ?? (studioError ? "Não foi possível identificar o estúdio." : "Não foi encontrado um estúdio para esta conta.")}</p>
        <Button className="mt-3" onClick={() => { if (studio?.id) setRetryKey((value) => value + 1); else void refetchStudio(); }}>Tentar novamente</Button>
      </div>
    </main>;
  }

  return (
    <main className="mx-auto w-full max-w-[88rem] space-y-2 px-3 pb-28 pt-2 sm:px-4 md:px-0 md:pb-10">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4 sm:py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
              Clientes
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">
              Fidelidade
            </h1>
            <p className="mt-0.5 hidden max-w-2xl text-sm leading-snug text-muted-foreground sm:block">
              Carimbos, benefícios e indicações deste estúdio.
            </p>
          </div>
          <Button
            onClick={save}
            disabled={!hasChanges || saving}
            className="h-9 shrink-0 gap-1 rounded-full px-3"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-1.5 p-2 sm:gap-2 sm:p-3 lg:grid-cols-4">
          <Metric icon={<Users className="size-4" />} label="Clientes" value={String(summary?.totalClientsWithStamps ?? 0)} />
          <Metric icon={<Gift className="size-4" />} label="Indicações" value={String(summary?.totalCompletedReferrals ?? 0)} />
          <Metric icon={<BadgePercent className="size-4" />} label="Benefícios" value={String(summary?.totalAvailableRewards ?? 0)} />
          <Metric icon={<Sparkles className="size-4" />} label="Estado" value={draft.enabled ? "Ativa" : "Pausada"} />
        </div>
      </section>

      <Button type="button" variant="outline" onClick={() => setValidationOpen((value) => !value)} className="w-full sm:w-auto">
        <Camera className="mr-2 size-4" /> Validar benefício
      </Button>
      {validationOpen && <section className="space-y-3 rounded-2xl border border-border bg-card p-3">
        <video ref={videoRef} playsInline muted className="mx-auto max-h-56 w-full rounded-xl bg-black" />
        <Button type="button" variant="outline" onClick={startScanner}>Abrir câmara</Button>
        <div className="flex gap-2"><Input aria-label="Código do benefício" placeholder="Código do benefício" value={code} onChange={(event) => { setCode(event.target.value.toUpperCase()); setFoundReward(null); }} />
          <Button type="button" disabled={validating || code.trim().length < 8} onClick={checkCode}>Verificar</Button></div>
        {foundReward && <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <p className="font-bold">{foundReward.clientName}</p>
          <p>{foundReward.type === "percent" ? `${foundReward.value}%` : `${foundReward.value} €`} de desconto</p>
          <p className="font-semibold">{foundReward.status === "used" ? "Utilizado" : foundReward.status === "available" ? "Disponível" : "Indisponível"}</p>
          {foundReward.status === "available" && <div className="mt-2 flex gap-2"><Button type="button" disabled={validating} onClick={confirmUse}>Aprovar utilização</Button><Button type="button" variant="outline" disabled={validating} onClick={() => { setFoundReward(null); setCode(""); }}>Recusar</Button></div>}
        </div>}
      </section>}

      <section className="space-y-2">
        <button type="button" onClick={() => setStampsOpen((value) => !value)} className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-3 py-2 text-left text-sm font-black">
          Carimbos e programa <ChevronDown className={cn("size-4 transition", stampsOpen && "rotate-180")} />
        </button>
        {stampsOpen && <SettingsCard
          title="Regras principais"
          description="Defina quando a cliente ganha carimbos e quando recebe benefício."
          icon={<Stamp className="size-4" />}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <ToggleRow
              title="Programa ativo"
              description="Mostra fidelidade na conta da cliente."
              checked={draft.enabled}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
            />
            <ToggleRow
              title="Carimbo por reserva"
              description="Conta após atendimento concluído e pago."
              checked={draft.bookingStampsEnabled}
              onChange={(bookingStampsEnabled) => setDraft({ ...draft, bookingStampsEnabled })}
            />
            <ToggleRow
              title="Carimbo por indicação"
              description="Conta quando a indicada conclui a reserva."
              checked={draft.referralStampsEnabled}
              onChange={(referralStampsEnabled) => setDraft({ ...draft, referralStampsEnabled })}
            />
            <InfoStrip>
              Cada link pertence a um cliente e a um estúdio. Não gera carimbos noutro estúdio.
            </InfoStrip>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
            <NumberField
              label="Por reserva"
              value={draft.stampsPerCompletedBooking}
              onChange={(stampsPerCompletedBooking) => setDraft({ ...draft, stampsPerCompletedBooking })}
            />
            <NumberField
              label="Por indicação"
              value={draft.stampsPerCompletedReferral}
              onChange={(stampsPerCompletedReferral) => setDraft({ ...draft, stampsPerCompletedReferral })}
            />
          </div>
        </SettingsCard>}

        <button type="button" onClick={() => setRulesOpen((value) => !value)} className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-3 py-2 text-left text-sm font-black">
          Recompensas ({draft.rewardRules.length}) <ChevronDown className={cn("size-4 transition", rulesOpen && "rotate-180")} />
        </button>
        {rulesOpen && <SettingsCard title="Recompensas" icon={<BadgePercent className="size-4" />}>
          {draft.rewardRules.map((rule, index) => <div key={rule.id} className="grid gap-2 rounded-xl border border-border p-2 sm:grid-cols-[7rem_9rem_8rem_auto] sm:items-end">
            <div className="space-y-1 sm:col-span-4"><Label className="text-xs">Nome do programa</Label><Input maxLength={60} value={rule.name ?? ""} placeholder={`Programa ${index + 1}`} onChange={(event) => setDraft({ ...draft, rewardRules: draft.rewardRules.map((item, i) => i === index ? { ...item, name: event.target.value || undefined } : item) })} /></div>
            <NumberField label="Carimbos" value={rule.stampsRequired} min={1} onChange={(stampsRequired) => setDraft({ ...draft, rewardRules: draft.rewardRules.map((item, i) => i === index ? { ...item, stampsRequired } : item) })} />
            <div className="space-y-1"><Label className="text-xs">Desconto</Label><Select value={rule.type} onValueChange={(type) => setDraft({ ...draft, rewardRules: draft.rewardRules.map((item, i) => i === index ? { ...item, type: type as "percent" | "fixed" } : item) })}>
              <SelectTrigger className="h-9 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percent">Percentagem</SelectItem><SelectItem value="fixed">Valor fixo</SelectItem></SelectContent>
            </Select></div>
            <NumberField label={rule.type === "percent" ? "Desconto (%)" : "Desconto (€)"} value={rule.value} min={0} step={rule.type === "percent" ? 1 : 0.5} onChange={(value) => setDraft({ ...draft, rewardRules: draft.rewardRules.map((item, i) => i === index ? { ...item, value } : item) })} />
            <div className="flex items-center gap-1">
              <Button type="button" className="min-w-0 flex-1" variant={rule.enabled ? "default" : "outline"} onClick={() => setDraft({ ...draft, rewardRules: draft.rewardRules.map((item, i) => i === index ? { ...item, enabled: !item.enabled } : item) })}>{rule.enabled ? "Ativa" : "Inativa"}</Button>
              <Button type="button" variant="ghost" size="icon" disabled={saving} title="Excluir recompensa" aria-label={`Excluir recompensa ${index + 1}`} onClick={() => {
                if (!window.confirm("Excluir esta recompensa? Os benefícios já conquistados mantêm-se. A remoção será aplicada ao guardar.")) return;
                setDraft((current) => current && { ...current, rewardRules: current.rewardRules.filter((item) => item.id !== rule.id) });
                toast.info("Recompensa removida. Carrega em Guardar para aplicar.");
              }}><Trash2 className="size-4" /></Button>
            </div>
          </div>)}
          <Button type="button" variant="outline" disabled={draft.rewardRules.length >= 12} onClick={() => setDraft({ ...draft, rewardRules: [...draft.rewardRules, { id: crypto.randomUUID(), name: `Programa ${draft.rewardRules.length + 1}`, stampsRequired: 5, type: "percent", value: 10, enabled: true, startedAt: null }] })}>
            <Plus className="mr-2 size-4" /> Adicionar recompensa
          </Button>
          <p className="text-xs text-muted-foreground">Novas regras contam apenas carimbos acumulados após guardar. Benefícios já conquistados mantêm-se.</p>
        </SettingsCard>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <button
          type="button"
          onClick={() => setDetailsOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <div className="min-w-0">
            <p className="text-sm font-black text-foreground">Níveis e clientes</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Ajustes avançados e clientes com mais carimbos.
            </p>
          </div>
          <ChevronDown className={cn("size-4 shrink-0 transition", detailsOpen && "rotate-180")} />
        </button>

        {detailsOpen && (
          <div className="grid gap-4 border-t border-border p-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl bg-muted text-foreground">
                  <Sparkles className="size-4" />
                </span>
                <h2 className="text-sm font-black text-foreground">Níveis</h2>
              </div>
              <div className="space-y-2">
                {draft.levels.map((level, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_5.25rem] gap-2">
                    <Input
                      value={level.name}
                      aria-label={`Nome do nível ${index + 1}`}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          levels: draft.levels.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: event.target.value } : item,
                          ),
                        })
                      }
                      className="h-10 min-w-0 rounded-xl"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={level.threshold}
                      aria-label={`Carimbos do nível ${index + 1}`}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          levels: draft.levels.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, threshold: Number(event.target.value) || 0 } : item,
                          ),
                        })
                      }
                      className="h-10 rounded-xl"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="grid size-8 place-items-center rounded-xl bg-muted text-foreground">
                  <Users className="size-4" />
                </span>
                <h2 className="text-sm font-black text-foreground">Clientes em destaque</h2>
              </div>
              {(summary?.topClients ?? []).length === 0 ? (
                <div className="rounded-2xl bg-muted/50 px-4 py-4 text-sm text-muted-foreground">
                  Ainda não existem carimbos ou indicações concluídas.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border">
                  {summary!.topClients.map((client) => (
                    <div
                      key={client.id}
                      className="grid gap-1 border-b border-border px-3 py-3 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <p className="min-w-0 break-words font-bold text-foreground">{client.name}</p>
                      <p className="text-xs font-semibold text-muted-foreground sm:text-right">
                        {client.stamps} carimbos · {client.completedReferrals} indicações · {client.availableRewards} benefícios
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-black">Gerir carimbos e indicações</h2>
        <p className="text-xs text-muted-foreground">Os ajustes ficam registados com motivo. Benefícios já conquistados mantêm-se.</p>
        <div className="flex gap-2">
          <Input aria-label="Pesquisar cliente" placeholder="Pesquisar cliente pelo nome" value={clientQuery}
            onChange={(event) => setClientQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchClients(); }} />
          <Button type="button" variant="outline" onClick={searchClients}>Pesquisar</Button>
        </div>
        {clients.length > 0 && <Select value={selectedClientId} onValueChange={(value) => { pendingStampActionRef.current = null; setSelectedClientId(value); }}>
          <SelectTrigger aria-label="Cliente para ajuste"><SelectValue placeholder="Selecionar cliente" /></SelectTrigger>
          <SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name} · {client.stamps} carimbos</SelectItem>)}</SelectContent>
        </Select>}
        <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
          <Input type="number" min={-20} max={20} step={1} value={stampDelta} aria-label="Ajuste de carimbos"
            onChange={(event) => { pendingStampActionRef.current = null; setStampDelta(Number(event.target.value)); }} />
          <Input maxLength={300} value={stampNote} aria-label="Motivo do ajuste" placeholder="Motivo do ajuste (mínimo 5 caracteres)"
            onChange={(event) => { pendingStampActionRef.current = null; setStampNote(event.target.value); }} />
          <Button type="button" disabled={managementBusy || !selectedClientId || Math.abs(stampDelta) > 20 || stampDelta === 0 || stampNote.trim().length < 5}
            onClick={submitStampAdjustment}>Registar ajuste</Button>
        </div>
        <p className="text-xs text-muted-foreground">Use um valor positivo para creditar ou negativo para corrigir. O saldo não pode ficar negativo.</p>
        <div className="space-y-2">
          <h3 className="text-xs font-black uppercase tracking-wide">Indicações recentes</h3>
          {(summary?.recentReferrals ?? []).length === 0 && <p className="text-xs text-muted-foreground">Sem indicações registadas.</p>}
          {(summary?.recentReferrals ?? []).map((referral) => <div key={referral.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3 text-sm">
            <div><p className="font-semibold">{referral.referrerName} → {referral.referredName}</p>
              <p className="text-xs text-muted-foreground">{referral.status === "pending_completion" ? "Pendente" : referral.status === "completed" ? "Concluída" : "Recusada"}</p></div>
            {referral.status === "pending_completion" && <div className="flex gap-2">
              <Button type="button" size="sm" disabled={managementBusy} onClick={() => reviewReferral(referral.id, true)}>Aprovar</Button>
              <Button type="button" size="sm" variant="outline" disabled={managementBusy} onClick={() => reviewReferral(referral.id, false)}>Recusar</Button>
            </div>}
          </div>)}
        </div>
      </section>
      <div className="sticky bottom-20 z-20 rounded-full bg-background/90 p-1 shadow-lg backdrop-blur sm:hidden">
        <Button onClick={save} disabled={!hasChanges || saving} className="h-10 w-full rounded-full">
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Save className="mr-2 size-4" />} Guardar
        </Button>
      </div>
    </main>
  );
}

function SettingsCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-foreground">{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-black text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border border-border bg-background/60 p-2 text-left sm:min-h-[4.25rem] sm:p-3"
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-extrabold leading-snug text-foreground">{title}</span>
        <span className="mt-0.5 block break-words text-xs leading-snug text-muted-foreground">{description}</span>
      </span>
      <span
        className={cn(
          "h-6 w-11 shrink-0 rounded-full p-1 transition",
          checked ? "bg-emerald-500" : "bg-muted-foreground/20",
        )}
      >
        <span className={cn("block size-4 rounded-full bg-white transition", checked && "translate-x-5")} />
      </span>
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="block min-h-[2rem] whitespace-normal break-normal text-xs font-bold leading-tight hyphens-none">
        {label}
      </Label>
      <Input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="h-10 min-w-0 rounded-xl text-sm font-bold tabular-nums"
      />
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/60 p-2 sm:p-3">
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className="mt-1 truncate text-lg font-black tracking-tight text-foreground sm:mt-2 sm:text-xl">{value}</p>
    </div>
  );
}

function InfoStrip({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[4.25rem] items-center rounded-2xl bg-muted/60 p-3 text-xs leading-snug text-muted-foreground">
      <p className="break-words">{children}</p>
    </div>
  );
}
