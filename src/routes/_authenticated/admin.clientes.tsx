import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  Eye,
  MessageCircle,
  MoreHorizontal,
  Search,
  ShieldAlert,
  TrendingUp,
  UserRound,
  X,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ClientAvatar } from "@/components/client-avatar";
import { ExpandableList } from "@/components/ui/expandable-list";
import {
  assessClientRisk,
  isActiveFutureAppointment,
  isClientAtRiskByCadence,
} from "@/lib/client-risk";

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
    auth_user_id?: string | null;
    avatar_url?: string | null;
    booking_status?: ClientBookingStatus;
    suspended_until?: string | null;
    block_reason?: string | null;
    date_of_birth?: string | null;
  } | null;
  appointment_services?: { services: { name: string } | null }[];
};

type PaymentRow = {
  appointment_id: string | null;
  amount_cents: number;
  status: string;
};

type StudioClientRow = {
  id: string;
  name: string;
  phone: string;
  auth_user_id?: string | null;
  avatar_url?: string | null;
  booking_status?: ClientBookingStatus;
  suspended_until?: string | null;
  block_reason?: string | null;
  date_of_birth?: string | null;
};

type ReturnReminderLogRow = {
  recipient: string | null;
  status: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
};

type ReturnReminderInsight = {
  sentAt: string;
  status: string | null;
};

type ClientSummary = {
  id: string;
  name: string;
  phone: string;
  authUserId: string | null;
  avatarUrl: string | null;
  totalAppointments: number;
  completedAppointments: number;
  cancelledAppointments: number;
  noShowAppointments: number;
  futureAppointments: number;
  hasFutureBooking: boolean;
  pendingAppointments: number;
  rescheduledAppointments: number;
  otherAppointments: number;
  totalPaid: number;
  lastAppointmentAt: string | null;
  lastService: string;
  bookingStatus: ClientBookingStatus;
  suspendedUntil: string | null;
  blockReason: string | null;
  dateOfBirth: string | null;
  favoriteServices: string[];
  averageSpend: number;
  avgIntervalDays: number | null;
  daysSinceLastVisit: number | null;
  suggestedReturnAt: string | null;
  attendanceRate: number | null;
  badges: ClientBadge[];
  returnReminder: ReturnReminderInsight | null;
};

type ClientBookingStatus = "active" | "suspended" | "blocked";
type SortMode = "recent" | "value" | "appointments";
type ClientBadge = {
  label: string;
  tone: "emerald" | "amber" | "blue" | "rose" | "violet";
};
type ClientPrimaryStatusInfo = {
  label: string;
  tone: ClientBadge["tone"] | "slate";
};

const CLIENT_WITHOUT_RETURN_BADGE = "Cliente sem retornar";

type ClientAccumulator = ClientSummary & {
  serviceCounts: Map<string, number>;
  completedDates: string[];
};

function ClientsPage() {
  const { studio } = useCurrentStudio();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const clientsQuery = useQuery({
    queryKey: ["admin-clients", studio?.id, studio?.role, studio?.staff_id],
    enabled: !!studio?.id,
    staleTime: 20 * 1000,
    queryFn: async () => {
      const [clientsResult, appointmentsResult, paymentsResult, returnRemindersResult] = await Promise.all([
        (supabase as any)
          .from("clients")
          .select(
            "id,name,phone,auth_user_id,avatar_url,booking_status,suspended_until,block_reason,date_of_birth",
          )
          .eq("studio_id", studio!.id),
        fetchClientAppointments(studio!.id, studio?.role === "staff" ? studio.staff_id : null),
        supabase
          .from("payment_intents")
          .select("appointment_id,amount_cents,status")
          .eq("studio_id", studio!.id),
        (supabase as any)
          .from("notifications_log")
          .select("recipient,status,created_at,payload")
          .eq("studio_id", studio!.id)
          .eq("kind", "return_reminder")
          .eq("channel", "client_center")
          .order("created_at", { ascending: false })
          .limit(1000),
      ]);

      if (clientsResult.error) throw clientsResult.error;
      if (appointmentsResult.error) throw appointmentsResult.error;
      if (paymentsResult.error) throw paymentsResult.error;
      if (returnRemindersResult.error) throw returnRemindersResult.error;

      return buildClientSummaries(
        (clientsResult.data ?? []) as StudioClientRow[],
        (appointmentsResult.data ?? []) as AppointmentRow[],
        (paymentsResult.data ?? []) as PaymentRow[],
        (returnRemindersResult.data ?? []) as ReturnReminderLogRow[],
      );
    },
  });

  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
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
      const bTime = b.lastAppointmentAt ? new Date(b.lastAppointmentAt).getTime() : 0;
      const aTime = a.lastAppointmentAt ? new Date(a.lastAppointmentAt).getTime() : 0;
      return bTime - aTime;
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
    <div className="space-y-3 md:space-y-4">
      <header className="border-b border-border/70 pb-3 md:pb-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-700 dark:text-emerald-400">
              Clientes
            </p>
            <h1 className="mt-1 text-xl font-light tracking-tight md:text-2xl">
              Histórico de clientes
            </h1>
            <p className="hidden">
              Consulte clientes que marcaram pelo link público, acompanhe o valor confirmado e abra
              o WhatsApp com uma mensagem pronta.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-[18rem]">
            <MiniMetric label="Clientes" value={String(clients.length)} />
            <MiniMetric label="Pago confirmado" value={formatEUR(totals.paid)} money />
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-border/80 bg-card/80 p-2.5 shadow-sm md:p-3">
        <div className="grid gap-2 md:grid-cols-[1fr_13.5rem]">
          <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-background/80 px-3 text-sm shadow-sm transition focus-within:ring-2 focus-within:ring-ring/15 md:h-11">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar por nome ou WhatsApp"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
          </label>

          <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
            <SelectTrigger className="h-10 rounded-xl border-border bg-background/80 px-3 text-sm shadow-sm md:h-11">
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
                Mais marcações
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {selectedClient && (
        <ClientDetails
          client={selectedClient}
          studioId={studio.id}
          studioName={studio.name}
          onClose={() => setSelectedClientId(null)}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["admin-clients", studio.id] })}
        />
      )}

      <section className="hidden lg:block">
        {filteredClients.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card">
            <EmptyState />
          </div>
        ) : (
          <ClientDesktopTable
            clients={filteredClients}
            onDetails={(clientId) => setSelectedClientId(clientId)}
          />
        )}
      </section>

      <section className="space-y-2 lg:hidden">
        {filteredClients.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card">
            <EmptyState />
          </div>
        ) : (
          <ExpandableList
            items={filteredClients}
            initialCount={5}
            className="space-y-2"
            getKey={(client) => client.id}
            moreLabel={(hidden) => `Mostrar mais ${hidden} cliente${hidden !== 1 ? "s" : ""}`}
            renderItem={(client) => (
              <ClientCompactCard
                client={client}
                onDetails={() => setSelectedClientId(client.id)}
              />
            )}
          />
        )}
      </section>
    </div>
  );
}

async function fetchClientAppointments(studioId: string, staffId?: string | null) {
  const db = supabase as any;
  const withAvatar = await db
    .from("appointments")
    .select(
      "id,starts_at,status,total_price,clients(id,name,phone,auth_user_id,avatar_url,booking_status,suspended_until,block_reason,date_of_birth),appointment_services(services(name))",
    )
    .eq("studio_id", studioId)
    .match(staffId ? { staff_id: staffId } : {})
    .order("starts_at", { ascending: false });
  if (!withAvatar.error) return withAvatar;

  return db
    .from("appointments")
    .select(
      "id,starts_at,status,total_price,clients(id,name,phone,auth_user_id,booking_status,suspended_until,block_reason,date_of_birth),appointment_services(services(name))",
    )
    .eq("studio_id", studioId)
    .match(staffId ? { staff_id: staffId } : {})
    .order("starts_at", { ascending: false });
}

function buildClientSummaries(
  studioClients: StudioClientRow[],
  appointments: AppointmentRow[],
  payments: PaymentRow[],
  returnReminderLogs: ReturnReminderLogRow[] = [],
) {
  const paidByAppointment = new Map<string, number>();
  for (const payment of payments) {
    if (!payment.appointment_id || payment.status !== "succeeded") continue;
    paidByAppointment.set(
      payment.appointment_id,
      (paidByAppointment.get(payment.appointment_id) ?? 0) +
      Number(payment.amount_cents || 0) / 100,
    );
  }
  const returnReminderByUser = buildReturnReminderMap(returnReminderLogs);

  const map = new Map<string, ClientAccumulator>();
  for (const client of studioClients) {
    map.set(client.id, {
      id: client.id,
      name: client.name,
      phone: client.phone,
      authUserId: client.auth_user_id ?? null,
      avatarUrl: client.avatar_url ?? null,
      totalAppointments: 0,
      completedAppointments: 0,
      cancelledAppointments: 0,
      noShowAppointments: 0,
      futureAppointments: 0,
      hasFutureBooking: false,
      pendingAppointments: 0,
      rescheduledAppointments: 0,
      otherAppointments: 0,
      totalPaid: 0,
      lastAppointmentAt: null,
      lastService: "Sem marcações",
      bookingStatus: normalizeBookingStatus(client.booking_status, client.suspended_until),
      suspendedUntil: client.suspended_until ?? null,
      blockReason: client.block_reason ?? null,
      dateOfBirth: client.date_of_birth ?? null,
      favoriteServices: [],
      averageSpend: 0,
      avgIntervalDays: null,
      daysSinceLastVisit: null,
      suggestedReturnAt: null,
      attendanceRate: null,
      badges: [],
      returnReminder: null,
      serviceCounts: new Map(),
      completedDates: [],
    });
  }
  for (const appointment of appointments) {
    if (!appointment.clients?.id) continue;
    const existing = map.get(appointment.clients.id);
    const appointmentBucket = getClientAppointmentBucket(appointment);
    const serviceNames = getAppointmentServiceNames(appointment);
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
        authUserId: appointment.clients.auth_user_id ?? null,
        avatarUrl: appointment.clients.avatar_url ?? null,
        totalAppointments: 1,
        completedAppointments: appointmentBucket === "completed" ? 1 : 0,
        cancelledAppointments: appointmentBucket === "cancelled" ? 1 : 0,
        noShowAppointments: appointmentBucket === "no_show" ? 1 : 0,
        futureAppointments: appointmentBucket === "future" ? 1 : 0,
        hasFutureBooking: isActiveFutureAppointment(appointment.status, appointment.starts_at),
        pendingAppointments: appointmentBucket === "pending" ? 1 : 0,
        rescheduledAppointments: appointmentBucket === "rescheduled" ? 1 : 0,
        otherAppointments: appointmentBucket === "other" ? 1 : 0,
        totalPaid: clientValue,
        lastAppointmentAt: appointment.starts_at,
        lastService: serviceName,
        bookingStatus: normalizeBookingStatus(
          appointment.clients.booking_status,
          appointment.clients.suspended_until,
        ),
        suspendedUntil: appointment.clients.suspended_until ?? null,
        blockReason: appointment.clients.block_reason ?? null,
        dateOfBirth: appointment.clients.date_of_birth ?? null,
        favoriteServices: [],
        averageSpend: 0,
        avgIntervalDays: null,
        daysSinceLastVisit: null,
        suggestedReturnAt: null,
        attendanceRate: null,
        badges: [],
        returnReminder: null,
        serviceCounts: new Map(),
        completedDates: [],
      });
      const created = map.get(appointment.clients.id);
      if (created) addClientHistory(created, appointment, appointmentBucket, serviceNames);
      continue;
    }

    existing.totalAppointments += 1;
    if (!existing.avatarUrl && appointment.clients.avatar_url) {
      existing.avatarUrl = appointment.clients.avatar_url;
    }
    if (!existing.authUserId && appointment.clients.auth_user_id) {
      existing.authUserId = appointment.clients.auth_user_id;
    }
    if (!existing.dateOfBirth && appointment.clients.date_of_birth) {
      existing.dateOfBirth = appointment.clients.date_of_birth;
    }
    if (appointmentBucket === "completed") existing.completedAppointments += 1;
    if (appointmentBucket === "cancelled") existing.cancelledAppointments += 1;
    if (appointmentBucket === "no_show") existing.noShowAppointments += 1;
    if (appointmentBucket === "future") existing.futureAppointments += 1;
    if (isActiveFutureAppointment(appointment.status, appointment.starts_at)) {
      existing.hasFutureBooking = true;
    }
    if (appointmentBucket === "pending") existing.pendingAppointments += 1;
    if (appointmentBucket === "rescheduled") existing.rescheduledAppointments += 1;
    if (appointmentBucket === "other") existing.otherAppointments += 1;
    existing.totalPaid += clientValue;
    if (
      !existing.lastAppointmentAt ||
      new Date(appointment.starts_at).getTime() > new Date(existing.lastAppointmentAt).getTime()
    ) {
      existing.lastAppointmentAt = appointment.starts_at;
      existing.lastService = serviceName;
    }
    addClientHistory(existing, appointment, appointmentBucket, serviceNames);
  }

  return Array.from(map.values()).map((client) =>
    finalizeClientSummary(client, returnReminderByUser),
  );
}

function buildReturnReminderMap(logs: ReturnReminderLogRow[]) {
  const map = new Map<string, ReturnReminderInsight>();
  for (const log of logs) {
    const userId =
      readPayloadText(log.payload, "recipient_user_id") ||
      String(log.recipient ?? "").replace(/^user:/, "");
    if (!userId || map.has(userId)) continue;
    map.set(userId, {
      sentAt: log.created_at,
      status: log.status ?? null,
    });
  }
  return map;
}

function readPayloadText(payload: Record<string, unknown> | null | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function addClientHistory(
  client: ClientAccumulator,
  appointment: AppointmentRow,
  appointmentBucket: string,
  serviceNames: string[],
) {
  if (appointmentBucket !== "completed") return;
  client.completedDates.push(appointment.starts_at);
  for (const serviceName of serviceNames) {
    client.serviceCounts.set(serviceName, (client.serviceCounts.get(serviceName) ?? 0) + 1);
  }
}

function finalizeClientSummary(
  client: ClientAccumulator,
  returnReminderByUser: Map<string, ReturnReminderInsight>,
): ClientSummary {
  const completedDates = client.completedDates
    .slice()
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const lastCompleted = completedDates.at(-1) ?? null;
  const risk = assessClientRisk({
    completedVisitDates: completedDates,
    hasFutureBooking: client.hasFutureBooking,
  });
  const avgIntervalDays = risk.averageIntervalDays;
  const daysSinceLastVisit = risk.daysSinceLastVisit;
  const suggestedReturnAt =
    lastCompleted && avgIntervalDays
      ? new Date(new Date(lastCompleted).getTime() + avgIntervalDays * 86400000).toISOString()
      : null;
  const closedVisits = client.completedAppointments + client.noShowAppointments;
  const attendanceRate =
    closedVisits > 0 ? Math.round((client.completedAppointments / closedVisits) * 100) : null;
  const favoriteServices = Array.from(client.serviceCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name]) => name);
  const averageSpend =
    client.completedAppointments > 0 ? client.totalPaid / client.completedAppointments : 0;
  const badges = buildClientBadges({
    ...client,
    favoriteServices,
    averageSpend,
    avgIntervalDays,
    daysSinceLastVisit,
    suggestedReturnAt,
    attendanceRate,
    badges: [],
  });
  const { serviceCounts, completedDates: _completedDates, ...summary } = client;
  return {
    ...summary,
    favoriteServices,
    averageSpend,
    avgIntervalDays,
    daysSinceLastVisit,
    suggestedReturnAt,
    attendanceRate,
    returnReminder: client.authUserId ? returnReminderByUser.get(client.authUserId) ?? null : null,
    badges,
  };
}

function buildClientBadges(client: ClientSummary): ClientBadge[] {
  const badges: ClientBadge[] = [];
  const hasFutureBooking = client.hasFutureBooking;
  const isReturnSeason =
    !hasFutureBooking &&
    client.avgIntervalDays !== null &&
    client.daysSinceLastVisit !== null &&
    client.daysSinceLastVisit >= Math.max(0, client.avgIntervalDays - Math.max(3, Math.round(client.avgIntervalDays * 0.2))) &&
    client.daysSinceLastVisit <= client.avgIntervalDays + Math.max(7, Math.round(client.avgIntervalDays * 0.25));
  const isAtRisk =
    client.bookingStatus === "active" &&
    isClientAtRiskByCadence({
      averageIntervalDays: client.avgIntervalDays,
      daysSinceLastVisit: client.daysSinceLastVisit,
      hasFutureBooking,
    });

  if (client.totalPaid >= 250 || client.completedAppointments >= 5) {
    badges.push({ label: "Cliente VIP", tone: "violet" });
  }
  if (client.completedAppointments >= 3 && (client.avgIntervalDays ?? 999) <= 45) {
    badges.push({ label: "Cliente frequente", tone: "emerald" });
  }
  if (isBirthdaySoon(client.dateOfBirth, 14)) {
    badges.push({ label: "Aniversário próximo", tone: "amber" });
  }
  if (isAtRisk) {
    badges.push({ label: CLIENT_WITHOUT_RETURN_BADGE, tone: "rose" });
  } else if (isReturnSeason) {
    badges.push({ label: "Em época de retorno", tone: "blue" });
  }
  return badges.slice(0, 3);
}

function getAppointmentServiceNames(appointment: AppointmentRow) {
  const names =
    appointment.appointment_services
      ?.map((line) => line.services?.name?.trim())
      .filter((name): name is string => Boolean(name)) ?? [];
  return names.length ? Array.from(new Set(names)) : ["Serviço"];
}

function getClientAppointmentBucket(appointment: AppointmentRow) {
  const status = appointment.status;
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "no_show") return "no_show";
  if (status === "pending" || status === "pending_payment") return "pending";
  if (status === "rescheduled") return "rescheduled";

  const startsAt = new Date(appointment.starts_at).getTime();
  if (Number.isFinite(startsAt) && startsAt >= Date.now() && status === "confirmed") {
    return "future";
  }
  return "other";
}

function ClientDesktopTable({
  clients,
  onDetails,
}: {
  clients: ClientSummary[];
  onDetails: (clientId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
      <div className="grid grid-cols-[minmax(13rem,1.35fr)_minmax(10rem,1fr)_8rem_8rem_7rem_3.5rem] items-center gap-3 border-b border-border/70 bg-muted/25 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        <span>Cliente</span>
        <span>Serviço/obs.</span>
        <span className="text-right">Valor</span>
        <span className="text-right">Última visita</span>
        <span className="text-right">Marcações</span>
        <span className="sr-only">Ações</span>
      </div>
      <ExpandableList
        items={clients}
        initialCount={5}
        className="divide-y divide-border/70"
        getKey={(client) => client.id}
        moreLabel={(hidden) => `Mostrar mais ${hidden} cliente${hidden !== 1 ? "s" : ""}`}
        renderItem={(client) => (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onDetails(client.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onDetails(client.id);
              }
            }}
            className="grid w-full grid-cols-[minmax(13rem,1.35fr)_minmax(10rem,1fr)_8rem_8rem_7rem_3.5rem] items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
          >
            <ClientIdentity client={client} compact />
            <span className="min-w-0 whitespace-normal text-muted-foreground">{client.lastService}</span>
            <MoneyText value={client.totalPaid} className="text-right text-sm" />
            <span className="text-right text-sm text-muted-foreground">
              {formatDate(client.lastAppointmentAt)}
            </span>
            <span className="text-right text-sm font-semibold">{client.totalAppointments}</span>
            <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
              <ClientActions client={client} onDetails={() => onDetails(client.id)} />
            </span>
          </div>
        )}
      />
    </div>
  );
}

function ClientCompactCard({
  client,
  onDetails,
}: {
  client: ClientSummary;
  onDetails: () => void;
}) {
  return (
    <article className="rounded-2xl border border-border/80 bg-card px-3 py-2.5 shadow-sm transition active:scale-[0.995]">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onDetails} className="min-w-0 flex-1 text-left">
          <ClientIdentity client={client} compact />
        </button>
        <button
          type="button"
          onClick={onDetails}
          className="shrink-0 text-right"
          aria-label={`Abrir ficha de ${client.name}`}
        >
          <MoneyText value={client.totalPaid} className="block text-sm" />
          <span className="mt-0.5 block whitespace-nowrap text-[11px] text-muted-foreground">
            {formatAppointmentCount(client.totalAppointments)}
          </span>
        </button>
        <ClientActions client={client} onDetails={onDetails} />
      </div>
      <button
        type="button"
        onClick={onDetails}
        className="mt-2 grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-muted/35 px-3 py-2 text-left text-xs"
      >
        <span className="min-w-0 whitespace-normal text-muted-foreground">{client.lastService}</span>
        <span className="whitespace-nowrap font-medium text-muted-foreground">
          {formatDate(client.lastAppointmentAt)}
        </span>
      </button>
    </article>
  );
}

function ClientActions({
  client,
  onDetails,
}: {
  client: ClientSummary;
  onDetails: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-background/80 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-label={`Ações de ${client.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={12} className="w-44 rounded-2xl">
        <DropdownMenuItem onSelect={onDetails} className="rounded-xl">
          <Eye className="mr-2 h-4 w-4" />
          Ver ficha
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="rounded-xl">
          <a href={whatsAppUrl(client)} target="_blank" rel="noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" />
            WhatsApp
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  const display = getClientDisplayInfo(client);

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
                <p className="min-w-0 truncate text-sm font-semibold leading-tight">{display.name}</p>
                {client.bookingStatus !== "active" && <StatusDot status={client.bookingStatus} />}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                <ClientPrimaryStatus client={client} compact />
                <span className="min-w-0 truncate text-xs leading-tight text-muted-foreground">
                  {display.subtitle ?? client.lastService}
                </span>
              </div>
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
                Marcações
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
          label="Marcações"
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

function ClientIdentity({
  client,
  compact = false,
}: {
  client: ClientSummary;
  compact?: boolean;
}) {
  const display = getClientDisplayInfo(client);

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <ClientAvatar
          name={display.name}
          avatarUrl={client.avatarUrl}
          className={compact ? "size-8 text-[11px]" : "size-9 text-xs"}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className={compact ? "truncate text-sm font-semibold" : "truncate font-medium"}>
              {display.name}
            </p>
            {client.bookingStatus !== "active" && <StatusDot status={client.bookingStatus} />}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <ClientPrimaryStatus client={client} compact={compact} />
            {!compact && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {display.subtitle ?? client.lastService}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientPrimaryStatus({ client, compact = false }: { client: ClientSummary; compact?: boolean }) {
  const status = getClientPrimaryStatus(client);
  if (!status) return null;

  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center truncate rounded-md border leading-none ${
        compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-[11px]"
      } ${primaryStatusToneClass(status.tone)}`}
    >
      {status.label}
    </span>
  );
}

function getClientPrimaryStatus(client: ClientSummary): ClientPrimaryStatusInfo | null {
  const badgesByLabel = new Map(client.badges.map((badge) => [badge.label, badge]));
  const withoutReturnBadge = badgesByLabel.get(CLIENT_WITHOUT_RETURN_BADGE);
  if (withoutReturnBadge) {
    return {
      label: getClientWithoutReturnLabel(client.daysSinceLastVisit),
      tone: withoutReturnBadge.tone,
    };
  }

  const priority: Array<{ badgeLabel: string; label: string }> = [
    { badgeLabel: "Em época de retorno", label: "Época de retorno" },
    { badgeLabel: "Cliente VIP", label: "VIP" },
    { badgeLabel: "Cliente frequente", label: "Frequente" },
  ];

  for (const item of priority) {
    const badge = badgesByLabel.get(item.badgeLabel);
    if (badge) {
      return { label: item.label, tone: badge.tone };
    }
  }

  if (client.totalAppointments <= 1) {
    return { label: "Novo cliente", tone: "slate" };
  }

  return null;
}

function primaryStatusToneClass(tone: ClientPrimaryStatusInfo["tone"]) {
  const classes: Record<ClientPrimaryStatusInfo["tone"], string> = {
    emerald: "border-emerald-700/15 bg-emerald-600/[0.07] text-emerald-700 dark:text-emerald-300",
    amber: "border-amber-700/15 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
    blue: "border-sky-700/15 bg-sky-500/[0.08] text-sky-700 dark:text-sky-300",
    rose: "border-rose-700/15 bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
    violet: "border-violet-700/15 bg-violet-500/[0.08] text-violet-700 dark:text-violet-300",
    slate: "border-border/70 bg-muted/35 text-muted-foreground",
  };
  return classes[tone];
}

function getClientWithoutReturnLabel(daysSinceLastVisit: number | null) {
  if (daysSinceLastVisit === null) return CLIENT_WITHOUT_RETURN_BADGE;
  return `Não retorna há ${daysSinceLastVisit} dia${daysSinceLastVisit === 1 ? "" : "s"}`;
}

function ClientBadges({ badges, compact = false }: { badges: ClientBadge[]; compact?: boolean }) {
  if (badges.length === 0) return null;
  return (
    <div className={`mt-1 flex flex-wrap gap-1 ${compact ? "max-w-[14rem] justify-end" : ""}`}>
      {badges.map((badge) => (
        <ClientBadge key={badge.label} badge={badge} compact={compact} />
      ))}
    </div>
  );
}

function ClientBadge({ badge, compact = false }: { badge: ClientBadge; compact?: boolean }) {
  return (
    <span
      className={`rounded-full border border-current/10 leading-tight ${
        compact
          ? "px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] opacity-80"
          : "px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
      } ${badgeToneClass(badge.tone)}`}
    >
      {badge.label}
    </span>
  );
}

function getClientDisplayInfo(client: ClientSummary) {
  const rawName = String(client.name ?? "").trim();
  if (isCounterClientName(rawName)) {
    return {
      name: "Cliente balcão",
      subtitle: "Cadastro realizado no balcão",
    };
  }

  return {
    name: rawName || "Cliente",
    subtitle: null,
  };
}

function isCounterClientName(name: string) {
  return /^cliente\s+balc(?:a|ã)o(?:\s*(?:-|–|—|#)?\s*balcao-[a-z0-9-]{6,}|\s+[a-z0-9]{10,}|\s*)$/i.test(
    name,
  );
}

function ClientDetails({
  client,
  studioId,
  studioName,
  onClose,
  onSaved,
}: {
  client: ClientSummary;
  studioId: string;
  studioName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<ClientBookingStatus>(client.bookingStatus);
  const [until, setUntil] = useState(client.suspendedUntil ?? "");
  const [reason, setReason] = useState(client.blockReason ?? "");
  const [saving, setSaving] = useState(false);
  const [showAppointmentDetails, setShowAppointmentDetails] = useState(false);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);

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
      setStatusPanelOpen(false);
      onSaved();
    }
  }

  const faltasWarning = client.noShowAppointments >= 2;
  const explainedTotal =
    client.completedAppointments +
    client.cancelledAppointments +
    client.noShowAppointments +
    client.futureAppointments +
    client.pendingAppointments +
    client.rescheduledAppointments +
    client.otherAppointments;
  const birthdayToday = isBirthdayToday(client.dateOfBirth);
  const relationshipInsight = getClientRelationshipInsight(client);
  const hasDelayedReturn = client.badges.some(
    (badge) => badge.label === CLIENT_WITHOUT_RETURN_BADGE,
  );
  const automationEvents = getClientAutomationEvents(client);
  const keyContextMetrics = [
    {
      label: "Última visita",
      value: client.daysSinceLastVisit === null ? "Sem visita" : `${client.daysSinceLastVisit} dias`,
    },
    {
      label: "Retorno esperado",
      value: client.suggestedReturnAt ? formatDate(client.suggestedReturnAt) : "A aprender",
    },
    { label: "Ticket médio", value: formatEUR(client.averageSpend), money: true },
  ];
  const relationshipDetails = [
    { label: "Visitas", value: String(client.completedAppointments) },
    { label: "Frequência", value: client.avgIntervalDays ? `${client.avgIntervalDays} dias` : "A aprender" },
    { label: "Presença", value: client.attendanceRate === null ? "Sem dados" : `${client.attendanceRate}%` },
  ];
  const preferenceDetails = [
    { label: "Aniversário", value: formatBirthdayLabel(client.dateOfBirth) },
    { label: "Serviço favorito", value: client.favoriteServices[0] ?? "A aprender" },
  ];

  const [primaryBadge, ...secondaryBadges] = client.badges;
  const mainAppointmentMetrics = [
    { label: "Total", value: String(client.totalAppointments) },
    { label: "Concluídas", value: String(client.completedAppointments) },
    { label: "Futuras", value: String(client.futureAppointments) },
    { label: "Faltas", value: String(client.noShowAppointments) },
    { label: "Canceladas", value: String(client.cancelledAppointments) },
  ];
  const secondaryAppointmentMetrics = [
    { label: "Pendentes", value: String(client.pendingAppointments) },
    { label: "Reagendadas", value: String(client.rescheduledAppointments) },
    { label: "Outras", value: String(client.otherAppointments) },
  ];
  const visibleSecondaryMetrics = secondaryAppointmentMetrics.filter(
    (metric) => metric.label !== "Outras" || client.otherAppointments > 0,
  );
  const statusLabel = getBookingStatusLabel(status);
  const display = getClientDisplayInfo(client);

  return (
    <section className="max-w-5xl overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm md:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ClientAvatar name={display.name} avatarUrl={client.avatarUrl} size="lg" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Ficha do cliente
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 truncate text-xl font-semibold tracking-tight">{display.name}</h2>
              {primaryBadge && <ClientBadge badge={primaryBadge} compact />}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {display.subtitle ?? client.phone}
            </p>
            {display.subtitle && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{client.phone}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar ficha do cliente"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-background/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold">Resumo das marcações</p>
          <button
            type="button"
            onClick={() => setShowAppointmentDetails((open) => !open)}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-border/70 px-3 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {showAppointmentDetails ? "Ocultar" : "Ver detalhes"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition ${showAppointmentDetails ? "rotate-180" : ""}`}
            />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 min-[430px]:grid-cols-5">
          {mainAppointmentMetrics.map((metric) => (
            <CompactStat key={metric.label} label={metric.label} value={metric.value} />
          ))}
        </div>
        {showAppointmentDetails && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 min-[430px]:grid-cols-3">
              {visibleSecondaryMetrics.map((metric) => (
                <CompactStat key={metric.label} label={metric.label} value={metric.value} muted />
              ))}
            </div>
          </div>
        )}
      </div>

      {explainedTotal !== client.totalAppointments && (
        <p className="mt-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          Existem estados antigos sem categoria clara. O total apresentado mantém todas as marcações
          reais deste cliente.
        </p>
      )}

      {faltasWarning && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {client.noShowAppointments} faltas registadas. Avaliar status apenas se fizer sentido para este cliente.
          </p>
        </div>
      )}

      {birthdayToday && (
        <div className="mt-4 rounded-3xl border border-amber-500/25 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-100">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold">Hoje é aniversário deste cliente.</p>
              <p className="mt-1 text-xs leading-relaxed opacity-80">
                Mensagem de aniversário pendente.
              </p>
            </div>
            <a
              href={birthdayWhatsAppUrl(client)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-foreground px-4 text-xs font-bold uppercase tracking-wide text-background"
            >
              <MessageCircle className="h-4 w-4" />
              Enviar agora
            </a>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-2xl border border-border/70 bg-background/55 p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Contexto do cliente
            </p>
          </div>
          {primaryBadge && <ClientBadge badge={primaryBadge} compact />}
        </div>
        {secondaryBadges.length > 0 && (
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Também: {secondaryBadges.map((badge) => badge.label).join(", ")}
          </p>
        )}

        {relationshipInsight && (
          <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-amber-900 dark:text-amber-100">
            <div className="flex flex-col gap-2 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">
                  {hasDelayedReturn ? "Cliente com retorno atrasado" : relationshipInsight}
                </p>
                {hasDelayedReturn &&
                  client.daysSinceLastVisit !== null &&
                  client.suggestedReturnAt && (
                    <p className="mt-0.5 text-xs leading-snug text-amber-800/75 dark:text-amber-200/75">
                      Não retorna há {client.daysSinceLastVisit} dia
                      {client.daysSinceLastVisit === 1 ? "" : "s"}. Pelo histórico de visitas, o
                      retorno era esperado em {formatDate(client.suggestedReturnAt)}.
                    </p>
                  )}
              </div>
              <a
                href={whatsAppUrl(client, studioName)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border border-amber-600/20 bg-background/70 px-3 text-[11px] font-semibold text-foreground transition hover:bg-background"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Enviar mensagem
              </a>
            </div>
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-2 min-[430px]:grid-cols-3">
          {keyContextMetrics.map((metric) => (
            <ContextMetric
              key={metric.label}
              label={metric.label}
              value={metric.value}
              money={metric.money}
            />
          ))}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <ContextGroup title="Relacionamento" items={relationshipDetails} />
          <ContextGroup title="Preferências" items={preferenceDetails} />
        </div>
        {automationEvents.length > 0 && (
          <div className="mt-3 rounded-2xl border border-border/60 bg-card/50 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Automações do cliente
            </p>
            <div className="mt-2 space-y-1.5">
              {automationEvents.map((event) => (
                <p key={event} className="text-sm leading-snug text-muted-foreground">
                  {event}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 min-w-0 max-w-full overflow-x-hidden rounded-2xl border border-border/70 bg-background/55 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-sm font-semibold">Status: {statusLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => setStatusPanelOpen((open) => !open)}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border/70 px-3 text-[11px] font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {statusPanelOpen ? "Fechar" : "Alterar"}
            <ChevronDown className={`h-3.5 w-3.5 transition ${statusPanelOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
        {statusPanelOpen && (
          <>
        <div className="mt-3 grid min-w-0 grid-cols-1 gap-2 min-[430px]:grid-cols-2 md:grid-cols-3 auto-rows-fr">
          <StatusOption
            active={status === "active"}
            title="Ativo"
            description="Marcações normais."
            onClick={() => {
              setStatus("active");
              setUntil("");
            }}
          />
          <StatusOption
            active={status === "suspended"}
            title="Suspenso temporariamente"
            description="Até uma data definida."
            onClick={() => setStatus("suspended")}
          />
          <StatusOption
            active={status === "blocked"}
            title="Bloqueado definitivamente"
            description="Sem novas marcações."
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
          </>
        )}
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
      className={`flex h-full min-h-[6.25rem] w-full min-w-0 max-w-full flex-col justify-center overflow-hidden rounded-2xl border px-3 py-2.5 text-left transition md:min-h-[5.75rem] ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-foreground"
          : "border-border bg-card hover:bg-muted/50"
      }`}
    >
      <span className="block max-w-full whitespace-normal break-words text-[12px] font-semibold leading-tight [overflow-wrap:anywhere] md:text-[13px] lg:text-sm">
        {title}
      </span>
      <span className="mt-1 block max-w-full whitespace-normal break-words text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere] md:text-xs">
        {description}
      </span>
    </button>
  );
}

function StatusDot({ status }: { status: ClientBookingStatus }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide leading-tight ${
        status === "blocked"
          ? "bg-red-500/10 text-red-700 dark:text-red-300"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
      }`}
    >
          {status === "blocked" ? "Bloqueado definitivamente" : "Suspenso temporariamente"}
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
    <div className="rounded-xl border border-border/80 bg-background/75 px-3 py-2 shadow-sm">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p
        className={`mt-0.5 text-base font-semibold tracking-tight md:text-lg ${
          money ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function CompactStat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function ContextMetric({
  label,
  value,
  money = false,
}: {
  label: string;
  value: string;
  money?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/55 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 truncate text-sm font-semibold tracking-tight ${
          money ? "text-emerald-700 dark:text-emerald-400" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ContextGroup({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <dl className="mt-2 grid gap-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0 truncate text-right font-medium text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
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
      Ainda não existem clientes com marcações neste estúdio.
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

function formatAppointmentCount(count: number) {
  return `${count} ${count === 1 ? "marcação" : "marcações"}`;
}

function whatsAppUrl(client: ClientSummary, studioName?: string | null) {
  const text = buildClientWhatsAppMessage(client, studioName);
  return `https://wa.me/${phoneForWhatsApp(client.phone)}?text=${encodeURIComponent(text)}`;
}

function buildClientWhatsAppMessage(client: ClientSummary, studioName?: string | null) {
  const greeting = buildClientGreeting(client.name);
  const delayDays = getClientReturnDelayDays(client);
  if (delayDays > 0) {
    const quantityText =
      delayDays === 1
        ? "já passou 1 dia da sua previsão de retorno"
        : `já se passaram ${delayDays} dias da sua previsão de retorno`;
    const studioText = studioName?.trim() ? ` ao ${studioName.trim()}` : " conosco";
    return `${greeting} Tudo bem? 😊\nPercebemos que ${quantityText}${studioText}. Gostaríamos de saber se está tudo bem e se deseja marcar um novo horário conosco.`;
  }

  return `${greeting} Tudo bem? 😊 Sentimos a sua falta e gostaríamos de saber se deseja marcar um novo horário conosco.`;
}

function buildClientGreeting(name: string | null | undefined) {
  const cleanName = String(name ?? "").trim();
  return cleanName ? `Olá, ${cleanName}!` : "Olá!";
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

function badgeToneClass(tone: ClientBadge["tone"]) {
  const classes: Record<ClientBadge["tone"], string> = {
    emerald: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-300",
    amber: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
    blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  };
  return classes[tone];
}

function isBirthdaySoon(value: string | null | undefined, windowDays: number) {
  const birthday = parseBirthday(value);
  if (!birthday) return false;
  const today = new Date();
  const currentYear = today.getFullYear();
  const nextBirthday = new Date(currentYear, birthday.month - 1, birthday.day);
  if (nextBirthday < startOfLocalDay(today)) {
    nextBirthday.setFullYear(currentYear + 1);
  }
  const diffDays = Math.ceil((nextBirthday.getTime() - startOfLocalDay(today).getTime()) / 86400000);
  return diffDays >= 0 && diffDays <= windowDays;
}

function parseBirthday(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function startOfLocalDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function formatBirthdayLabel(value: string | null | undefined) {
  const birthday = parseBirthday(value);
  if (!birthday) return "Não informado";
  return `${String(birthday.day).padStart(2, "0")}/${String(birthday.month).padStart(2, "0")}`;
}

function isBirthdayToday(value: string | null | undefined) {
  const birthday = parseBirthday(value);
  if (!birthday) return false;
  const today = new Date();
  return birthday.month === today.getMonth() + 1 && birthday.day === today.getDate();
}

function birthdayWhatsAppUrl(client: ClientSummary) {
  const text = `Olá, ${client.name}. Feliz aniversário! Que o seu dia seja muito especial.`;
  return `https://wa.me/${phoneForWhatsApp(client.phone)}?text=${encodeURIComponent(text)}`;
}

function getClientRelationshipInsight(client: ClientSummary) {
  if (client.avgIntervalDays === null || client.daysSinceLastVisit === null || client.futureAppointments > 0) {
    return null;
  }
  const delay = client.suggestedReturnAt
    ? Math.floor((Date.now() - new Date(client.suggestedReturnAt).getTime()) / 86400000)
    : 0;
  if (delay >= 14) return `Retorno bastante atrasado: ${delay} dias além do esperado.`;
  if (delay >= 1) return `Retorno atrasado há ${delay} dia${delay === 1 ? "" : "s"}.`;
  if (client.daysSinceLastVisit < Math.max(3, Math.round(client.avgIntervalDays * 0.6))) {
    return "Cliente voltou antes do esperado.";
  }
  if (client.daysSinceLastVisit >= client.avgIntervalDays - 2) {
    return "Cliente está na época habitual de retornar.";
  }
  return null;
}

function getClientReturnDelayDays(client: ClientSummary) {
  if (!client.suggestedReturnAt || client.futureAppointments > 0) return 0;
  const expectedReturn = new Date(client.suggestedReturnAt);
  if (!Number.isFinite(expectedReturn.getTime())) return 0;
  const today = startOfLocalDay(new Date()).getTime();
  const expectedDay = startOfLocalDay(expectedReturn).getTime();
  return Math.max(0, Math.floor((today - expectedDay) / 86400000));
}

function getBookingStatusLabel(status: ClientBookingStatus) {
  if (status === "blocked") return "Bloqueado definitivamente";
  if (status === "suspended") return "Suspenso temporariamente";
  return "Ativo";
}

function getClientContextMetrics(client: ClientSummary) {
  const metrics: Array<{ label: string; value: string; money?: boolean }> = [
    { label: "Ticket médio", value: formatEUR(client.averageSpend), money: true },
    { label: "Visitas", value: String(client.completedAppointments) },
  ];

  if (client.avgIntervalDays !== null) {
    metrics.unshift({ label: "Frequência", value: `${client.avgIntervalDays} dias` });
  }
  if (client.daysSinceLastVisit !== null) {
    metrics.push({ label: "Última visita", value: `${client.daysSinceLastVisit} dias` });
  }
  if (client.suggestedReturnAt) {
    metrics.push({ label: "Retorno", value: formatDate(client.suggestedReturnAt) });
  }
  if (client.attendanceRate !== null) {
    metrics.push({ label: "Presença", value: `${client.attendanceRate}%` });
  }
  if (client.dateOfBirth) {
    metrics.push({ label: "Aniversário", value: formatBirthdayLabel(client.dateOfBirth) });
  }
  if (client.favoriteServices[0]) {
    metrics.push({ label: "Favorito", value: client.favoriteServices[0] });
  }

  return metrics.slice(0, 8);
}

function getClientAutomationEvents(_client: ClientSummary) {
  const client = _client;
  const birthdayToday = false;
  if (client.returnReminder) {
    if (client.futureAppointments > 0) return ["Cliente agendou após o lembrete."];

    const days = Math.max(
      0,
      Math.floor((Date.now() - new Date(client.returnReminder.sentAt).getTime()) / 86400000),
    );
    const sentText =
      days === 0
        ? "Lembrete de retorno enviado automaticamente hoje."
        : `Lembrete de retorno enviado automaticamente há ${days} dia${days === 1 ? "" : "s"}.`;

    return [sentText, "Aguardando resposta."];
  }
  return [] as string[];
  const events: string[] = [];
  if (birthdayToday) events.push("Mensagem de aniversário pendente.");
  if (client.futureAppointments > 0) events.push("Cliente já tem próxima marcação agendada.");
  if (client.badges.some((badge) => badge.label === CLIENT_WITHOUT_RETURN_BADGE)) {
    events.push("Lembrete de retorno recomendado.");
  }
  return events;
}

function getClientMessageSuggestion(client: ClientSummary) {
  if (client.badges.some((badge) => badge.label === "Aniversário próximo")) {
    return "Enviar mensagem de aniversário.";
  }
  if (client.badges.some((badge) => badge.label === CLIENT_WITHOUT_RETURN_BADGE)) {
    return "Enviar convite de retorno.";
  }
  if (client.badges.some((badge) => badge.label === "Em época de retorno")) {
    return "Lembrar que está na altura de voltar.";
  }
  return "Manter contacto simples após a próxima visita.";
}

function getClientOfferSuggestion(client: ClientSummary) {
  const favorite = client.favoriteServices[0];
  if (!favorite) return "Aguardar mais histórico.";
  if (client.badges.some((badge) => badge.label === "Cliente VIP")) {
    return `Criar mimo ligado a ${favorite}.`;
  }
  if (client.badges.some((badge) => badge.label === CLIENT_WITHOUT_RETURN_BADGE)) {
    return `Oferecer incentivo leve em ${favorite}.`;
  }
  return `Sugerir complemento para ${favorite}.`;
}

function phoneForWhatsApp(phone: string) {
  const digits = cleanPhone(phone);
  if (digits.startsWith("351") || digits.length > 9) return digits;
  return `351${digits}`;
}

function formatDate(value: string | null) {
  if (!value) return "Sem visita";
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
