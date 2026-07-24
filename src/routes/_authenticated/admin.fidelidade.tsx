import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  BadgePercent,
  ChevronDown,
  Gift,
  Loader2,
  Save,
  Sparkles,
  Stamp,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import {
  getCustomerLoyaltyAdminSummary,
  updateCustomerLoyaltySettings,
  type CustomerLoyaltyAdminSummary,
  type CustomerLoyaltySettings,
} from "@/lib/customer-loyalty.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/fidelidade")({
  component: AdminLoyaltyPage,
});

function AdminLoyaltyPage() {
  const { studio } = useCurrentStudio();
  const loadSummary = useServerFn(getCustomerLoyaltyAdminSummary);
  const saveSettings = useServerFn(updateCustomerLoyaltySettings);
  const [summary, setSummary] = useState<CustomerLoyaltyAdminSummary | null>(null);
  const [draft, setDraft] = useState<CustomerLoyaltySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!studio?.id) return;
    let alive = true;
    setLoading(true);
    loadSummary({ data: { studioId: studio.id } })
      .then((payload) => {
        if (!alive) return;
        const next = payload as CustomerLoyaltyAdminSummary;
        setSummary(next);
        setDraft(next.settings);
      })
      .catch((error) => {
        console.error("[customer-loyalty] admin_load_failed", error);
        toast.error("Não foi possível carregar a fidelidade.");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [loadSummary, studio?.id]);

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
      toast.success("Fidelidade atualizada.");
    } catch (error) {
      console.error("[customer-loyalty] admin_save_failed", error);
      toast.error("Não foi possível guardar a fidelidade.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft) {
    return (
      <main className="mx-auto flex min-h-[55vh] w-full max-w-5xl items-center justify-center px-4">
        <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          A carregar fidelidade...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[88rem] space-y-3 px-3 pb-24 pt-3 sm:px-4 md:px-0 md:pb-10">
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
              Clientes
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-foreground">
              Fidelidade
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-snug text-muted-foreground">
              Carimbos, benefícios e indicações deste estúdio.
            </p>
          </div>
          <Button
            onClick={save}
            disabled={!hasChanges || saving}
            className="h-10 shrink-0 gap-2 rounded-full px-4"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Guardar
          </Button>
        </div>

        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric icon={<Users className="size-4" />} label="Clientes" value={String(summary?.totalClientsWithStamps ?? 0)} />
          <Metric icon={<Gift className="size-4" />} label="Indicações" value={String(summary?.totalCompletedReferrals ?? 0)} />
          <Metric icon={<BadgePercent className="size-4" />} label="Benefícios" value={String(summary?.totalAvailableRewards ?? 0)} />
          <Metric icon={<Sparkles className="size-4" />} label="Estado" value={draft.enabled ? "Ativa" : "Pausada"} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <SettingsCard
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
            <NumberField
              label="Carimbos para benefício"
              value={draft.stampsRequiredForReward}
              min={1}
              onChange={(stampsRequiredForReward) => setDraft({ ...draft, stampsRequiredForReward })}
            />
            <NumberField
              label={draft.rewardType === "percent" ? "Desconto (%)" : "Desconto (€)"}
              value={draft.rewardValue}
              min={0}
              step={draft.rewardType === "percent" ? 1 : 0.5}
              onChange={(rewardValue) => setDraft({ ...draft, rewardValue })}
            />
          </div>
        </SettingsCard>

        <SettingsCard title="Benefício" icon={<BadgePercent className="size-4" />}>
          <div className="space-y-1.5">
            <Label>Tipo de desconto</Label>
            <Select
              value={draft.rewardType}
              onValueChange={(rewardType) => setDraft({ ...draft, rewardType: rewardType as "percent" | "fixed" })}
            >
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentagem</SelectItem>
                <SelectItem value="fixed">Valor fixo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-2xl bg-muted/60 p-3 text-sm leading-snug text-muted-foreground">
            A cliente recebe o benefício quando atingir os carimbos definidos.
          </div>
        </SettingsCard>
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
      className="flex min-h-[4.25rem] w-full items-center justify-between gap-3 rounded-2xl border border-border bg-background/60 p-3 text-left"
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
    <div className="min-w-0 rounded-2xl border border-border bg-background/60 p-3">
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <p className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.12em]">{label}</p>
      </div>
      <p className="mt-2 truncate text-xl font-black tracking-tight text-foreground">{value}</p>
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
