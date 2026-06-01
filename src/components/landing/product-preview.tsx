import { useState } from "react";
import { CalendarCheck, CreditCard, MessageCircle, UsersRound } from "lucide-react";
import { BellzaLogo } from "@/components/bellza-logo";
import { APP_BRAND } from "@/lib/app-brand";
import {
  PREVIEW_AGENDA,
  PREVIEW_CLIENTS,
  PREVIEW_FINANCE,
  PREVIEW_STUDIO,
  exampleBookingUrl,
} from "@/lib/landing-content";
import { cn } from "@/lib/utils";

type PreviewTab = "agenda" | "financeiro" | "clientes" | "whatsapp";

const TABS: { id: PreviewTab; label: string; icon: typeof CalendarCheck }[] = [
  { id: "agenda", label: "Agenda", icon: CalendarCheck },
  { id: "financeiro", label: "Financeiro", icon: CreditCard },
  { id: "clientes", label: "Clientes", icon: UsersRound },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
];

export function ProductPreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>("agenda");
  const bookingUrl = exampleBookingUrl();

  return (
    <div id="produto" className="scroll-mt-28">
      <div className="relative">
        <div className="absolute -inset-4 rounded-[2rem] bg-[radial-gradient(circle_at_20%_20%,color-mix(in_oklch,var(--accent)_22%,transparent),transparent_34%),radial-gradient(circle_at_80%_10%,color-mix(in_oklch,var(--foreground)_12%,transparent),transparent_30%)] blur-2xl" />
        <div className="relative overflow-hidden rounded-[1.35rem] border border-border/80 bg-card/80 p-2 shadow-[0_24px_80px_oklch(0_0_0/0.12)] backdrop-blur">
          <div className="overflow-hidden rounded-[1rem] border border-white/10 bg-[#101218] text-white dark:bg-[#080a0e]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-3">
                <BellzaLogo variant="icon" showWordmark={false} href={null} className="pointer-events-none" />
                <div>
                  <p className="text-[10px] font-semibold uppercase text-white/40">Painel Bellza</p>
                  <p className="text-sm font-semibold">{PREVIEW_STUDIO.name}</p>
                </div>
              </div>
              <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                Online
              </span>
            </div>

            <div className="grid min-h-[29rem] lg:grid-cols-[8.5rem_1fr]">
              <div className="flex gap-1 overflow-x-auto border-b border-white/10 p-2 lg:flex-col lg:border-b-0 lg:border-r">
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      aria-pressed={activeTab === tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-semibold transition",
                        activeTab === tab.id
                          ? "bg-white text-[#101218]"
                          : "text-white/55 hover:bg-white/[0.06] hover:text-white",
                      )}
                    >
                      <Icon className="size-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="p-4 sm:p-5">
                {activeTab === "agenda" && (
                  <div className="animate-fade-in space-y-4">
                    <PanelHeader title="Agenda de hoje" eyebrow="Sexta-feira, 31 de maio" metric="3 marcações" />
                    <ul className="space-y-2.5">
                      {PREVIEW_AGENDA.map((row) => (
                        <li
                          key={row.time}
                          className={cn(
                            "rounded-xl border p-3",
                            row.tone === "emerald" && "border-emerald-300/20 bg-emerald-400/8",
                            row.tone === "accent" && "border-amber-200/25 bg-amber-300/10",
                            row.tone === "amber" && "border-sky-200/20 bg-sky-300/8",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold text-white/50">{row.time}</p>
                              <p className="mt-1 text-sm font-semibold">{row.service}</p>
                              <p className="text-xs text-white/50">
                                {row.client} · {row.professional}
                              </p>
                            </div>
                            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/70">
                              {row.status}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {activeTab === "financeiro" && (
                  <div className="animate-fade-in space-y-4">
                    <PanelHeader title="Resumo financeiro" eyebrow="Maio · visão de gestão" metric="+18%" />
                    <div className="grid gap-2 sm:grid-cols-3">
                      {PREVIEW_FINANCE.map((item) => (
                        <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                          <p className="text-[10px] font-semibold uppercase text-white/40">{item.label}</p>
                          <p className="mt-2 text-xl font-semibold">{item.value}</p>
                          <p className="text-[11px] text-white/42">{item.hint}</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="flex items-end gap-2">
                        {[46, 58, 42, 72, 64, 88, 78].map((height, index) => (
                          <span
                            key={height + index}
                            className="flex-1 rounded-t-md bg-gradient-to-t from-amber-200/35 to-white/85"
                            style={{ height }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "clientes" && (
                  <div className="animate-fade-in space-y-4">
                    <PanelHeader title="Clientes" eyebrow="Histórico e preferências" metric="124 ativos" />
                    <div className="grid gap-2">
                      {PREVIEW_CLIENTS.map((client) => (
                        <div key={client.name} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-semibold">{client.name}</p>
                            <span className="text-[11px] text-white/42">{client.visits}</span>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-white/55">{client.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "whatsapp" && (
                  <div className="animate-fade-in space-y-4">
                    <PanelHeader title="WhatsApp automático" eyebrow="Confirmações e lembretes" metric="Ativo" />
                    <div className="mx-auto max-w-xs rounded-[1.5rem] border-[7px] border-white/10 bg-[#0d1117] p-3 shadow-2xl">
                      <div className="flex justify-between border-b border-white/10 pb-2 text-[10px] text-white/40">
                        <span>WhatsApp</span>
                        <span className="font-semibold text-amber-100">{APP_BRAND.name}</span>
                      </div>
                      <div className="py-3">
                        <div className="max-w-[94%] rounded-2xl bg-[#1f2c34] p-3 text-xs leading-relaxed">
                          <p>
                            Olá <strong>Sofia</strong>, a sua marcação está confirmada para amanhã às 10:30.
                          </p>
                          <p className="mt-2 break-all font-semibold text-amber-100">{bookingUrl}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Pré-visualização ilustrativa baseada no painel Bellza.
      </p>
    </div>
  );
}

function PanelHeader({ title, eyebrow, metric }: { title: string; eyebrow: string; metric: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase text-white/38">{eyebrow}</p>
        <h3 className="mt-1 text-base font-semibold">{title}</h3>
      </div>
      <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/70">
        {metric}
      </span>
    </div>
  );
}
