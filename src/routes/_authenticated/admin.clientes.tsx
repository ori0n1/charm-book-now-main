import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  MessageCircle,
  Search,
  ShieldAlert,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { computeAttendanceRevenue, formatEUR, isFinanciallyRelevantAppointment } from "@/lib/utils";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin/clientes")({
  head: () => ({ meta: [{ title: "Clientes - Painel" }] }),
  component: ClientsPage,
});

type AppointmentRow = {
  id: string;
  starts_at: string;
  status: string;
  total_price: number;
  clients: {
    id: string;
    name: string;
    phone: string;
    booking_status?: ClientBookingStatus;
    suspended_until?: string | null;
    block_reason?: string | null;
  } | null;
  appointment_services?: { services: { name: string } | null }[];
};

type PaymentRow = {
  appointment_id: string | null;
  amount_cents: number;
  status: string;
};

type ClientSummary = {
  id: string;
  name: string;
  phone: string;
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  totalPaid: number;
  lastAppointmentAt: string;
  lastService: string;
  bookingStatus: ClientBookingStatus;
  suspendedUntil: string | null;
  blockReason: string | null;
};

type ClientBookingStatus = "active" | "suspended" | "blocked";
type SortMode = "recent" | "value" | "appointments";

function ClientsPage() {
  const { studio } = useCurrentStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["admin-clients", studio?.id],
    enabled: !!studio?.id,
    staleTime: 20 * 1000,
    queryFn: async () => {
      const db = supabase as any;
      const [appointmentsResult, paymentsResult] = await Promise.all([
        db
          .from("appointments")
          .select(
            "id,starts_at,status,total_price,clients(id,name,phone,booking_status,suspended_until,block_reason),appointment_services(services(name))",
          )
          .eq("studio_id", studio!.id)
          .order("starts_at", { ascending: false }),
        supabase
          .from("payment_intents")
          .select("appointment_id,amount_cents,status")
          .eq("studio_id", studio!.id),
      ]);

      if (appointmentsResult.error) throw appointmentsResult.error;
      if (paymentsResult.error) throw paymentsResult.error;

      return buildClientSummaries(
        (appointmentsResult.data ?? []) as AppointmentRow[],
        (paymentsResult.data ?? []) as PaymentRow[],
      );
    },
  });

  const clients = clientsQuery.data ?? [];
  const selectedClient = clients.find((client) => client.id === selectedClientId) ?? null;
  const filteredClients = useMemo(() => {
    const term = query.trim().toLowerCase();
    const filtered = clients.filter((client) => {
      if (!term) return true;
      return (
        client.name.toLowerCase().includes(term) ||
        client.phone.toLowerCase().includes(term) ||
        cleanPhone(client.phone).includes(cleanPhone(term))
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === "value") return b.totalPaid - a.totalPaid;
      if (sort === "appointments") return b.totalAppointments - a.totalAppointments;
      return new Date(b.lastAppointmentAt).getTime() - new Date(a.lastAppointmentAt).getTime();
    });
  }, [clients, query, sort]);

  const totals = clients.reduce(
    (acc, client) => ({
      appointments: acc.appointments + client.totalAppointments,
      paid: acc.paid + client.totalPaid,
    }),
    { appointments: 0, paid: 0 },
  );

  if (!studio || clientsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">A carregar clientes...</p>;
  }

  return (
    <div className="space-y-4">
      <header className="overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-400">
              Clientes
            </p>
            <h1 className="mt-2 text-2xl font-light tracking-tight md:text-3xl">
              Histórico de clientes
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Consulte clientes que marcaram pelo link público, acompanhe o valor confirmado e abra
              o WhatsApp com uma mensagem pronta.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="Clientes" value={String(clients.length)} />
            <MiniMetric label="Pago confirmado" value={formatEUR(totals.paid)} money />
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-border bg-card p-3 shadow-sm md:p-4">
        <div className="grid gap-2 md:grid-cols-[1fr_14rem]">
          <label className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-background/80 px-4 text-sm shadow-sm transition focus-within:ring-2 focus-within:ring-ring/15">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar por nome ou WhatsApp"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </label>

          <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
            <SelectTrigger className="h-12 rounded-2xl border-border bg-background/80 px-4 text-sm shadow-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-3xl border-border/80 p-2 shadow-xl">
              <SelectItem value="recent" className="rounded-2xl py-2.5">
                Cliente recente
              </SelectItem>
              <SelectItem value="value" className="rounded-2xl py-2.5">
                Maior valor gerado
              </SelectItem>
              <SelectItem value="appointments" className="rounded-2xl py-2.5">
                Mais agendamentos
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {selectedClient && (
        <ClientDetails
          client={selectedClient}
          studioId={studio.id}
          onClose={() => setSelectedClientId(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-clients", studio.id] })}
        />
      )}

      <section className="hidden md:grid gap-3">
        {filteredClients.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card">
            <EmptyState />
          </div>
        ) : (
          filteredClients.map((client) => (
            <ClientDesktopCard
              key={client.id}
              client={client}
              onDetails={() => setSelectedClientId(client.id)}
            />
          ))
        )}
      </section>

      <section className="space-y-3 md:hidden">
        {filteredClients.length === 0 ? (
          <div className="rounded-3xl border border-border bg-card">
            <EmptyState />
          </div>
        ) : (
          filteredClients.map((client) => (
            <ClientCard
              key={client.id}
              client={client}
              onDetails={() => setSelectedClientId(client.id)}
            />
          ))
        )}
      </section>
    </div>
  );
}

function buildClientSummaries(appointments: AppointmentRow[], payments: PaymentRow[]) {
  const paidByAppointment = new Map<string, number>();
  for (const payment of payments) {
    if (!payment.appointment_id || payment.status !== "succeeded") continue;
    paidByAppointment.set(
      payment.appointment_id,
      (paidByAppointment.get(payment.appointment_id) ?? 0) +
        Number(payment.amount_cents || 0) / 100,
    );
  }

  const map = new Map<string, ClientSummary>();
  for (const appointment of appointments) {
    if (!appointment.clients?.id) continue;
    const existing = map.get(appointment.clients.id);
    const serviceName =
      appointment.appointment_services?.map((line) => line.services?.name).filter(Boolean)[0] ??
      "serviço";
    const paid = paidByAppointment.get(appointment.id) ?? 0;
    const confirmedValue = computeAttendanceRevenue(
      appointment.total_price,
      paid,
      appointment.status,
    ).confirmed;
    const clientValue = isFinanciallyRelevantAppointment(appointment.status, paid)
      ? confirmedValue
      : 0;

    if (!existing) {
      map.set(appointment.clients.id, {
        id: appointment.clients.id,
        name: appointment.clients.name,
        phone: appointment.clients.phone,
        totalAppointments: 1,
        completedAppointments: appointment.status === "completed" ? 1 : 0,
        cancelledAppointments: appointment.status === "cancelled" ? 1 : 0,
        noShowAppointments: appointment.status === "no_show" ? 1 : 0,
        totalPaid: clientValue,
        lastAppointmentAt: appointment.starts_at,
        lastService: serviceName,
        bookingStatus: normalizeBookingStatus(
          appointment.clients.booking_status,
          appointment.clients.suspended_until,
        ),
        suspendedUntil: appointment.clients.suspended_until ?? null,
        blockReason: appointment.clients.block_reason ?? null,
      });
      continue;
    }

    existing.totalAppointments += 1;
    if (appointment.status === "completed") existing.completedAppointments += 1;
    if (appointment.status === "cancelled") existing.cancelledAppointments += 1;
    if (appointment.status === "no_show") existing.noShowAppointments += 1;
    existing.totalPaid += clientValue;
    if (
      new Date(appointment.starts_at).getTime() > new Date(existing.lastAppointmentAt).getTime()
    ) {
      existing.lastAppointmentAt = appointment.starts_at;
      existing.lastService = serviceName;
    }
  }

  return Array.from(map.values());
}

function ClientTableRow({ client, onDetails }: { client: ClientSummary; onDetails: () => void }) {
  return (
    <div className="box-border grid grid-cols-[minmax(11rem,1.2fr)_minmax(7rem,0.9fr)_minmax(6rem,0.65fr)_minmax(7rem,0.75fr)_minmax(7.5rem,0.85fr)_20rem] items-center gap-4 border-b border-border/70 px-4 py-3 text-sm last:border-b-0 hover:bg-muted/20">
      <ClientIdentity client={client} />
      <a href={whatsAppUrl(client)} target="_blank" rel="noreferrer" className="hover:underline">
        {client.phone}
      </a>
      <span className="text-right">{client.totalAppointments}</span>
      <MoneyText value={client.totalPaid} className="text-right" />
      <span className="text-right text-muted-foreground">
        {formatDate(client.lastAppointmentAt)}
      </span>
      <div className="flex min-w-0 justify-end gap-2 items-center">
        <button
          type="button"
          onClick={onDetails}
          className="shrink-0 whitespace-nowrap rounded-2xl border border-border px-3 py-2 text-xs font-bold uppercase tracking-wide transition hover:bg-muted"
        >
          Ficha
        </button>
        <WhatsAppButton client={client} compact />
      </div>
    </div>
  );
}

function ClientDesktopCard({ client, onDetails }: { client: ClientSummary; onDetails: () => void }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-border/90 bg-card px-4 py-3 shadow-sm">
      <div className="grid gap-4 md:grid-cols-[minmax(12rem,1fr)_minmax(17rem,0.9fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
              <UserRound className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 text-sm font-semibold leading-tight">{client.name}</p>
                {client.bookingStatus !== "active" && <StatusDot status={client.bookingStatus} />}
              </div>
              <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                {client.lastService}
              </p>
            </div>
          </div>
          <a
            href={whatsAppUrl(client)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full border border-border/80 bg-background/40 px-3 py-1.5 text-xs font-medium leading-none text-muted-foreground transition hover:border-emerald-700/50"
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            <span>{client.phone}</span>
          </a>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-3 gap-2">
            <div className="min-w-0 rounded-xl border border-border/80 bg-background/45 px-3 py-2">
              <p className="whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Agend.
              </p>
              <p className="mt-1 whitespace-nowrap text-sm font-semibold leading-none">
                {client.totalAppointments}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-border/80 bg-background/45 px-3 py-2">
              <p className="whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Valor
              </p>
              <MoneyText
                value={client.totalPaid}
                className="mt-1 block whitespace-nowrap text-sm leading-none"
              />
            </div>
            <div className="min-w-0 rounded-xl border border-border/80 bg-background/45 px-3 py-2">
              <p className="whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Último
              </p>
              <p className="mt-1 whitespace-nowrap text-sm font-semibold leading-none">
                {formatDate(client.lastAppointmentAt)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-border px-4 text-xs font-bold uppercase tracking-wide transition hover:bg-muted"
          >
            Ficha
          </button>
          <WhatsAppButton client={client} compact className="h-9 min-w-[7.5rem] rounded-xl px-3 py-0" />
        </div>
      </div>
    </article>
  );
}

function ClientCard({ client, onDetails }: { client: ClientSummary; onDetails: () => void }) {
  return (
    <article className="rounded-3xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <ClientIdentity client={client} />
        <MoneyText value={client.totalPaid} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <InfoPill
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          label="Último"
          value={formatDate(client.lastAppointmentAt)}
        />
        <InfoPill
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Agendamentos"
          value={String(client.totalAppointments)}
        />
      </div>
      <button
        type="button"
        onClick={onDetails}
        className="mt-4 h-11 w-full rounded-2xl border border-border text-xs font-bold uppercase tracking-wide transition hover:bg-muted"
      >
        Ver ficha do cliente
      </button>
      <WhatsAppButton client={client} />
    </article>
  );
}

function ClientIdentity({ client }: { client: ClientSummary }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          <UserRound className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{client.name}</p>
            {client.bookingStatus !== "active" && <StatusDot status={client.bookingStatus} />}
          </div>
          <p className="truncate text-xs text-muted-foreground">{client.lastService}</p>
        </div>
      </div>
    </div>
  );
}

function ClientDetails({
  client,
  studioId,
  onClose,
  onSaved,
}: {
  client: ClientSummary;
  studioId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<ClientBookingStatus>(client.bookingStatus);
  const [until, setUntil] = useState(client.suspendedUntil ?? "");
  const [reason, setReason] = useState(client.blockReason ?? "");
  const [saving, setSaving] = useState(false);

  async function saveStatus() {
    if (status === "suspended" && !until) return;
    setSaving(true);
    const payload = {
      booking_status: status,
      suspended_until: status === "suspended" ? until || null : null,
      block_reason: status === "active" ? null : reason.trim() || null,
    };
    const { error } = await (supabase as any)
      .from("clients")
      .update(payload)
      .eq("id", client.id)
      .eq("studio_id", studioId);
    setSaving(false);
    if (!error) {
      onSaved();
    }
  }

  const faltasWarning = client.noShowAppointments >= 2;

  return (
    <section className="overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-sm md:p-5 max-w-full">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Ficha do cliente
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{client.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{client.phone}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-2xl border border-border px-4 text-xs font-bold uppercase tracking-wide transition hover:bg-muted"
        >
          Fechar
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <MiniMetric label="Marcacoes" value={String(client.totalAppointments)} />
        <MiniMetric label="Concluidas" value={String(client.completedAppointments)} />
        <MiniMetric label="Canceladas" value={String(client.cancelledAppointments)} />
        <MiniMetric label="Faltas" value={String(client.noShowAppointments)} />
      </div>

      {faltasWarning && (
        <div className="mt-4 flex items-start gap-2 rounded-3xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Cliente com historico de faltas. Avaliar suspensao.</p>
        </div>
      )}

      <div className="mt-4 overflow-x-hidden rounded-3xl border border-border bg-background/60 p-4 min-w-0 max-w-full">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Status do cliente</p>
        </div>
        <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-3">
          <StatusOption
            active={status === "active"}
            title="Ativo"
            description="Pode fazer marcações normalmente."
            onClick={() => {
              setStatus("active");
              setUntil("");
            }}
          />
          <StatusOption
            active={status === "suspended"}
            title="Suspenso temporariamente"
            description="Bloqueado ate uma data definida."
            onClick={() => setStatus("suspended")}
          />
          <StatusOption
            active={status === "blocked"}
            title="Bloqueado definitivamente"
            description="Não pode fazer novas marcações."
            onClick={() => {
              setStatus("blocked");
              setUntil("");
            }}
          />
        </div>

        {status === "suspended" && (
          <label className="mt-3 block w-full min-w-0 max-w-full overflow-hidden">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Suspenso até
            </span>
            <PremiumDatePicker
              value={until}
              onChange={setUntil}
              placeholder="dd/mm/aaaa"
              className="mt-1.5"
            />
          </label>
        )}

        {status !== "active" && (
          <label className="mt-3 block min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Motivo interno opcional
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Nota visivel apenas no painel."
              className="mt-1.5 w-full min-w-0 max-w-full resize-none rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-ring/20 box-border"
            />
          </label>
        )}

        <button
          type="button"
          onClick={saveStatus}
          disabled={saving || (status === "suspended" && !until)}
          className="mt-4 h-12 w-full rounded-2xl bg-foreground text-sm font-bold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 md:w-auto md:px-6"
        >
          {saving ? "A guardar..." : "Guardar status"}
        </button>
      </div>
    </section>
  );
}

function StatusOption({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full min-w-0 max-w-full rounded-2xl border p-3 text-left transition ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
          : "border-border bg-card hover:bg-muted/50"
      }`}
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

function StatusDot({ status }: { status: ClientBookingStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
        status === "blocked"
          ? "bg-red-500/10 text-red-700 dark:text-red-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
      }`}
    >
      {status === "blocked" ? "Bloqueado" : "Suspenso"}
    </span>
  );
}

function WhatsAppButton({
  client,
  compact = false,
  className = "",
}: {
  client: ClientSummary;
  compact?: boolean;
  className?: string;
}) {
  return (
    <a
      href={whatsAppUrl(client)}
      target="_blank"
      rel="noreferrer"
      className={
        compact
          ? `inline-flex min-w-[8rem] whitespace-nowrap items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg shadow-emerald-950/10 transition hover:bg-emerald-700 ${className}`
          : `mt-4 w-full inline-flex min-w-0 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-emerald-950/10 transition hover:bg-emerald-700 ${className}`
      }
    >
      <MessageCircle className="h-4 w-4 flex-shrink-0" />
      <span className="truncate">WhatsApp</span>
    </a>
  );
}

function MiniMetric({
  label,
  value,
  money = false,
}: {
  label: string;
  value: string;
  money?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background/75 p-3 shadow-sm">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tracking-tight ${
          money ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function InfoPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background/70 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <p className="px-4 py-10 text-center text-sm text-muted-foreground">
      Ainda não existem clientes com agendamentos neste estúdio.
    </p>
  );
}

function MoneyText({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span
      className={`font-semibold tracking-tight text-emerald-700 dark:text-emerald-400 ${className}`}
    >
      {formatEUR(value)}
    </span>
  );
}

function whatsAppUrl(client: ClientSummary) {
  const text = `Olá, ${client.name}. O seu agendamento está confirmado para ${formatDate(
    client.lastAppointmentAt,
  )} às ${formatTime(client.lastAppointmentAt)}, com o serviço ${client.lastService}. Qualquer dúvida, estamos à disposição.`;
  return `https://wa.me/${phoneForWhatsApp(client.phone)}?text=${encodeURIComponent(text)}`;
}

function cleanPhone(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeBookingStatus(
  status?: ClientBookingStatus | string | null,
  suspendedUntil?: string | null,
): ClientBookingStatus {
  if (status === "blocked") return "blocked";
  if (status === "suspended") {
    if (!suspendedUntil) return "suspended";
    const end = new Date(`${suspendedUntil}T23:59:59`);
    return end.getTime() >= Date.now() ? "suspended" : "active";
  }
  return "active";
}

function phoneForWhatsApp(phone: string) {
  const digits = cleanPhone(phone);
  if (digits.startsWith("351") || digits.length > 9) return digits;
  return `351${digits}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
