import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";

export const Route = createFileRoute("/_authenticated/admin/balcao")({
  head: () => ({ meta: [{ title: "Balcão - Painel" }] }),
  component: BalcaoPage,
});

type StudioRow = {
  id: string;
  payment_policy: "pay_in_studio" | "pre_payment";
  accepted_payment_methods: string[];
  deposit_percent: number;
  commission_percent: number;
};

type ServiceOption = {
  id: string;
  name: string;
  price: number;
  duration_min: number;
  commission_percent: number | null;
};

type StaffOption = {
  id: string;
  name: string;
  commission_percent: number | null;
};

type ClientOption = {
  id: string;
  name: string;
  phone: string;
};

type ManualEntry = {
  id: string;
  service_id: string;
  staff_id: string;
  client_id: string | null;
  performed_at: string;
  amount: number;
  payment_method: string;
  notes: string | null;
  source: "manual" | "walk_in";
  services?: { name: string } | null;
  staff?: { name: string } | null;
  clients?: { name: string; phone: string } | null;
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Dinheiro" },
  { value: "mb_way", label: "MB Way" },
  { value: "card", label: "Apple Pay, Google Pay ou cartão" },
  { value: "bank_transfer", label: "Transferência" },
  { value: "other", label: "Outro" },
];

const controlClass =
  "box-border h-12 w-full min-w-0 max-w-full rounded-2xl border border-border bg-background/85 px-4 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground/55 hover:bg-background focus:border-foreground/30 focus:ring-2 focus:ring-ring/15";
const selectTriggerClass =
  "box-border h-12 w-full min-w-0 max-w-full rounded-2xl border-border bg-background/85 px-4 pr-3 text-sm shadow-sm transition hover:bg-background focus:ring-2 focus:ring-ring/15 [&>svg]:ml-3 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-60";
const selectContentClass =
  "rounded-3xl border-border/80 bg-popover/98 p-2 shadow-xl shadow-foreground/5";
const selectItemClass =
  "rounded-2xl px-3 py-2.5 text-sm transition-colors focus:bg-emerald-950/10 focus:text-foreground data-[state=checked]:bg-emerald-950/10 data-[state=checked]:text-foreground";
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

function BalcaoPage() {
  const [studio, setStudio] = useState<StudioRow | null>(null);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [manualServiceId, setManualServiceId] = useState("");
  const [manualStaffId, setManualStaffId] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualPerformedAt, setManualPerformedAt] = useState(toDateTimeLocal(new Date()));
  const [manualPaymentMethod, setManualPaymentMethod] = useState("cash");
  const [manualNotes, setManualNotes] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: roles } = await supabase.from("user_roles").select("studio_id").limit(1);
      const studioId = (roles?.[0] as { studio_id: string } | undefined)?.studio_id;
      if (!studioId) return;
      const result = await loadPaymentSettings(studioId);
      if (result.studio) {
        setStudio(result.studio);
        setServiceOptions(result.serviceOptions);
        setStaffOptions(result.staffOptions);
        setClients(result.clients);
        if (result.serviceOptions[0]) {
          setManualServiceId(result.serviceOptions[0].id);
          setManualAmount(String(result.serviceOptions[0].price));
        }
        if (result.staffOptions[0]) setManualStaffId(result.staffOptions[0].id);
      }
    })();
  }, []);

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return clients;
    return clients.filter((client) => {
      return (
        client.name.toLowerCase().includes(term) ||
        client.phone.toLowerCase().includes(term) ||
        cleanPhone(client.phone).includes(cleanPhone(term))
      );
    });
  }, [clientSearch, clients]);

  async function createManualEntry() {
    if (!studio || !manualServiceId || !manualStaffId || !manualAmount || !manualPerformedAt) {
      toast.error("Preencha serviço, profissional, valor e data.");
      return;
    }
    const amount = Number(manualAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Indique um valor válido.");
      return;
    }

    setManualSaving(true);
    const db = supabase as any;
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await db.from("manual_service_entries").insert({
      studio_id: studio.id,
      service_id: manualServiceId,
      staff_id: manualStaffId,
      client_id: selectedClientId || null,
      performed_at: new Date(manualPerformedAt).toISOString(),
      amount,
      payment_method: manualPaymentMethod,
      notes: manualNotes.trim() || null,
      source: selectedClientId ? "manual" : "walk_in",
      created_by: userData.user?.id ?? null,
    });
    setManualSaving(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Atendimento presencial registado.");
    setManualPerformedAt(toDateTimeLocal(new Date()));
    setManualNotes("");
    setClientSearch("");
    setSelectedClientId("");
    const service = serviceOptions.find((item) => item.id === manualServiceId);
    setManualAmount(service ? String(service.price) : "");
  }

  if (!studio) {
    return <p className="text-sm text-muted-foreground">A carregar...</p>;
  }

  return (
    <div className="space-y-4 xl:mx-auto xl:max-w-[88rem]">
      <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
        <div className="border-b border-border/70 bg-muted/20 px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="grid size-8 place-items-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                  <CalendarPlus className="h-4 w-4" />
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em]">Registar atendimento presencial</span>
              </div>
              <h1 className="mt-2 text-base font-medium tracking-tight md:text-lg">Balcão</h1>
            </div>
            <span className="rounded-full border border-emerald-700/20 bg-emerald-950/5 px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Balcão
            </span>
          </div>
        </div>

        <div className="grid gap-6 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_30rem] xl:items-start">
          <div className="rounded-3xl border border-border/70 bg-background/45 p-3.5 md:p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Serviço realizado">
                <Select
                  value={manualServiceId}
                  onValueChange={(value) => {
                    setManualServiceId(value);
                    const service = serviceOptions.find((item) => item.id === value);
                    if (service) setManualAmount(String(service.price));
                  }}
                >
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue placeholder="Selecionar serviço" />
                  </SelectTrigger>
                  <SelectContent className={selectContentClass}>
                    {serviceOptions.map((service) => (
                      <SelectItem key={service.id} value={service.id} className={selectItemClass}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Profissional">
                <Select value={manualStaffId} onValueChange={setManualStaffId}>
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue placeholder="Selecionar profissional" />
                  </SelectTrigger>
                  <SelectContent className={selectContentClass}>
                    {staffOptions.map((member) => (
                      <SelectItem key={member.id} value={member.id} className={selectItemClass}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Valor cobrado">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={manualAmount}
                  onChange={(event) => setManualAmount(event.target.value)}
                  className={controlClass}
                />
              </Field>

              <Field label="Forma de pagamento">
                <Select value={manualPaymentMethod} onValueChange={setManualPaymentMethod}>
                  <SelectTrigger className={selectTriggerClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={selectContentClass}>
                    {PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method.value} value={method.value} className={selectItemClass}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Data e hora" className="md:col-span-2">
                <DateTimePicker value={manualPerformedAt} onChange={setManualPerformedAt} />
              </Field>

              <Field label="Observação opcional" className="md:col-span-2">
                <input
                  value={manualNotes}
                  onChange={(event) => setManualNotes(event.target.value)}
                  placeholder="Ex.: ajuste de preço, produto incluído..."
                  className={controlClass}
                />
              </Field>
            </div>
          </div>

          <div className="flex min-h-full flex-col rounded-3xl border border-border/80 bg-background/80 p-4 shadow-sm shadow-foreground/5">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="grid size-8 place-items-center rounded-2xl bg-muted text-foreground">
                  <Search className="h-4 w-4" />
                </span>
                <div>
                  <span className="block text-[10px] uppercase tracking-[0.2em]">Cliente opcional</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    Associe ao histórico ou registe como avulso.
                  </span>
                </div>
              </div>
            </div>
            <input
              value={clientSearch}
              onChange={(event) => {
                setClientSearch(event.target.value);
                setSelectedClientId("");
              }}
              placeholder="Pesquisar nome ou WhatsApp"
              className={`${controlClass} mt-4 bg-card/95`}
            />

            <div className="mt-3 flex-1 space-y-2">
              {selectedClientId ? (
                <ClientPill
                  client={clients.find((client) => client.id === selectedClientId)}
                  onClear={() => {
                    setSelectedClientId("");
                    setClientSearch("");
                  }}
                />
              ) : (
                <>
                  {filteredClients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setClientSearch(`${client.name} · ${client.phone}`);
                      }}
                      className="w-full rounded-2xl border border-border bg-card/80 px-3 py-2.5 text-left text-sm transition hover:border-emerald-700/25 hover:bg-emerald-950/5"
                    >
                      <span className="block font-medium">{client.name}</span>
                      <span className="text-xs text-muted-foreground">{client.phone}</span>
                    </button>
                  ))}
                  <p className="rounded-2xl border border-dashed border-border bg-card/60 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                    Sem cliente selecionado: atendimento presencial avulso.
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={createManualEntry}
              disabled={manualSaving}
              className="mt-4 w-full rounded-2xl bg-emerald-600 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-white shadow-lg shadow-emerald-950/10 transition hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-xl disabled:translate-y-0 disabled:opacity-60"
            >
              {manualSaving ? "A guardar..." : "Registar atendimento"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

async function loadPaymentSettings(studioId: string) {
  const [studioFull, staffFull, serviceFull, clientsFull] = await Promise.all([
    supabase
      .from("studios")
      .select("id,payment_policy,accepted_payment_methods,deposit_percent,commission_percent")
      .eq("id", studioId)
      .maybeSingle(),
    supabase
      .from("staff")
      .select("id,name,commission_percent")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("services")
      .select("id,name,price,duration_min,commission_percent")
      .eq("studio_id", studioId)
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("clients").select("id,name,phone").eq("studio_id", studioId).order("name"),
  ]);

  const staffOptions = (staffFull.data ?? []) as StaffOption[];
  const serviceOptions = (serviceFull.data ?? []) as ServiceOption[];
  const clients = (clientsFull.data ?? []) as ClientOption[];

  if (!studioFull.error) {
    return {
      studio: normalizeStudio(studioFull.data),
      staffOptions,
      serviceOptions,
      clients,
    };
  }

  const studioLegacy = studioFull;
  return {
    studio: normalizeStudio(studioLegacy.data),
    staffOptions,
    serviceOptions,
    clients,
  };
}

function normalizeStudio(
  studio: (Omit<Partial<StudioRow>, "payment_policy"> & { payment_policy?: string | null }) | null,
): StudioRow {
  return {
    ...studio,
    id: studio?.id ?? "",
    payment_policy: studio?.payment_policy === "pre_payment" ? "pre_payment" : "pay_in_studio",
    accepted_payment_methods: normalizeAcceptedPaymentMethods(studio?.accepted_payment_methods),
    deposit_percent: studio?.deposit_percent ?? 0,
    commission_percent: studio?.commission_percent ?? 0,
  };
}

function normalizeAcceptedPaymentMethods(methods?: string[] | null) {
  const normalized = (methods ?? ["mb_way", "card"]).filter(
    (method) => method === "mb_way" || method === "card" || method === "cash",
  );
  return normalized.length ? normalized : ["mb_way", "card"];
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function ClientPill({ client, onClear }: { client?: ClientOption; onClear: () => void }) {
  if (!client) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-700/25 bg-emerald-950/5 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{client.name}</p>
        <p className="text-xs text-muted-foreground">{client.phone}</p>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full border border-border bg-background/70 px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        Remover
      </button>
    </div>
  );
}

function DatePicker({
  value,
  placeholder,
  onChange,
  variant = "field",
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  variant?: "filter" | "field";
}) {
  return (
    <PremiumDatePicker
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={
        variant === "filter"
          ? "h-10 rounded-full bg-background/90 text-xs font-medium"
          : `${controlClass} h-12`
      }
      allowClear={variant === "filter"}
    />
  );
}

function DateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = value ? new Date(value) : undefined;
  const time = value ? value.slice(11, 16) : "09:00";
  const [hour, minute] = time.split(":");
  const setTimePart = (nextHour: string, nextMinute: string) => {
    const date = selected ? localDateValue(selected) : localDateValue(new Date());
    onChange(`${date}T${nextHour}:${nextMinute}`);
  };

  return (
    <div className="grid w-full min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9.5rem,12rem)]">
      <DatePicker
        value={value ? value.slice(0, 10) : ""}
        placeholder="Escolher data"
        variant="field"
        onChange={(date) => {
          if (date) onChange(`${date}T${time}`);
        }}
      />
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <Select value={hour} onValueChange={(nextHour) => setTimePart(nextHour, minute)}>
          <SelectTrigger className={`${selectTriggerClass} px-3`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            {HOUR_OPTIONS.map((item) => (
              <SelectItem key={item} value={item} className={selectItemClass}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minute} onValueChange={(nextMinute) => setTimePart(hour, nextMinute)}>
          <SelectTrigger className={`${selectTriggerClass} px-3`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={selectContentClass}>
            {MINUTE_OPTIONS.map((item) => (
              <SelectItem key={item} value={item} className={selectItemClass}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function toDateTimeLocal(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function localDateValue(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateOnly(value: string) {
  if (!value) return "";
  return new Date(`${value}T12:00`).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function cleanPhone(phone: string) {
  return phone.replace(/\D/g, "");
}
