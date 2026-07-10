import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { getSegmentConfig, inferSegmentCategory, normalizeSegmentText } from "@/lib/segments";
import { isStudioImageFile, uploadStudioAsset } from "@/lib/upload";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Upload, Star, Check, Sparkles, Search, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpandableList } from "@/components/ui/expandable-list";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/servicos")({
  component: ServicesPage,
});

type Suggestion = { id: string; label: string };

type Category = { id: string; label: string; sort_order: number };
type ServiceMedia = { type: "image" | "video"; src: string };
type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_min: number;
  price: number;
  is_recommended: boolean;
  is_active: boolean;
  category_id: string | null;
  media: ServiceMedia[];
  sort_order: number;
};
type ServiceTrend = {
  label: "Em alta" | "Estável" | "Em baixa";
  current: number;
  previous: number;
  growth: number;
  pairName: string | null;
};
type ServiceTrendMap = Record<string, ServiceTrend>;

type ServicePreset = {
  name: string;
  category: string;
  duration: number;
  price: number;
  description?: string;
};

const SERVICE_PRESETS: ServicePreset[] = [
  { name: "Corte de cabelo", category: "Cabelo", duration: 45, price: 30 },
  { name: "Brushing", category: "Cabelo", duration: 45, price: 25 },
  { name: "Coloração", category: "Cabelo", duration: 120, price: 65 },
  { name: "Hidratação capilar", category: "Cabelo", duration: 60, price: 35 },
  { name: "Unha em gel", category: "Unhas", duration: 90, price: 35 },
  { name: "Banho de gel", category: "Unhas", duration: 75, price: 30 },
  { name: "Manicure", category: "Unhas", duration: 45, price: 18 },
  { name: "Pedicure", category: "Unhas", duration: 50, price: 22 },
  { name: "Design de sobrancelha", category: "Sobrancelhas", duration: 30, price: 18 },
  { name: "Henna de sobrancelha", category: "Sobrancelhas", duration: 35, price: 22 },
  { name: "Extensão de pestanas", category: "Pestanas", duration: 120, price: 55 },
  { name: "Lifting de pestanas", category: "Pestanas", duration: 60, price: 35 },
  { name: "Limpeza de pele", category: "Estética", duration: 75, price: 45 },
  { name: "Tratamento facial", category: "Estética", duration: 60, price: 40 },
  { name: "Depilação a cera", category: "Depilação", duration: 30, price: 20 },
  { name: "Massagem relaxante", category: "Massagem", duration: 60, price: 50 },
];

const DEFAULT_CATEGORY_LABELS = [
  "Cabelo",
  "Unhas",
  "Estética",
  "Sobrancelhas",
  "Pestanas",
  "Depilação",
  "Massagem",
];

const CATEGORY_RULES: { label: string; words: string[] }[] = [
  {
    label: "Unhas",
    words: ["unha", "gel", "verniz", "manicure", "pedicure", "nail", "acrilico", "alongamento"],
  },
  {
    label: "Cabelo",
    words: [
      "cabelo",
      "corte",
      "brushing",
      "escova",
      "coloracao",
      "madeixa",
      "luzes",
      "hidrata",
      "capilar",
    ],
  },
  { label: "Sobrancelhas", words: ["sobrancelha", "brow", "design"] },
  { label: "Pestanas", words: ["pestana", "cilio", "cilios", "lash"] },
  { label: "Depilação", words: ["depilacao", "cera", "laser"] },
  { label: "Massagem", words: ["massagem", "relaxante", "drenagem"] },
  {
    label: "Estética",
    words: [
      "facial",
      "pele",
      "limpeza",
      "estetica",
      "corporal",
      "tratamento",
      "maquilhagem",
      "microagulhamento",
    ],
  },
];

const normalizeText = normalizeSegmentText;

function inferCategoryLabel(serviceName: string) {
  const normalized = normalizeText(serviceName);
  return (
    CATEGORY_RULES.find((rule) =>
      rule.words.some((word) => normalized.includes(normalizeText(word))),
    )?.label ?? "Estética"
  );
}

async function fetchServiceTrends(services: Service[]): Promise<ServiceTrendMap> {
  if (services.length === 0) return {};
  const serviceIds = services.map((service) => service.id);
  const base = new Map<string, ServiceTrend>(
    services.map((service) => [
      service.id,
      { label: "Estável" as const, current: 0, previous: 0, growth: 0, pairName: null },
    ]),
  );
  const { data, error } = await (supabase as any)
    .from("appointment_services")
    .select("service_id,appointment_id,appointments(starts_at,status),services(name)")
    .in("service_id", serviceIds);
  if (error) return Object.fromEntries(base);

  const now = Date.now();
  const currentStart = now - 30 * 86400000;
  const previousStart = now - 60 * 86400000;
  const byAppointment = new Map<string, { serviceId: string; serviceName: string }[]>();

  for (const row of data ?? []) {
    const appointment = Array.isArray(row.appointments) ? row.appointments[0] : row.appointments;
    if (!appointment || appointment.status !== "completed") continue;
    const startsAt = new Date(appointment.starts_at).getTime();
    const current = base.get(row.service_id);
    if (current) {
      if (startsAt >= currentStart) current.current += 1;
      if (startsAt >= previousStart && startsAt < currentStart) current.previous += 1;
    }
    const service = Array.isArray(row.services) ? row.services[0] : row.services;
    const lines = byAppointment.get(row.appointment_id) ?? [];
    lines.push({ serviceId: row.service_id, serviceName: service?.name ?? "Serviço" });
    byAppointment.set(row.appointment_id, lines);
  }

  const pairCounts = new Map<string, Map<string, number>>();
  for (const lines of byAppointment.values()) {
    for (const line of lines) {
      const pairs = pairCounts.get(line.serviceId) ?? new Map<string, number>();
      for (const other of lines) {
        if (other.serviceId === line.serviceId) continue;
        pairs.set(other.serviceName, (pairs.get(other.serviceName) ?? 0) + 1);
      }
      pairCounts.set(line.serviceId, pairs);
    }
  }

  for (const [serviceId, trend] of base) {
    const growth = getTrendGrowth(trend.current, trend.previous);
    trend.growth = growth;
    trend.label = growth >= 15 ? "Em alta" : growth <= -15 ? "Em baixa" : "Estável";
    trend.pairName =
      Array.from(pairCounts.get(serviceId)?.entries() ?? []).sort((a, b) => b[1] - a[1])[0]?.[0] ??
      null;
  }
  return Object.fromEntries(base);
}

function getTrendGrowth(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function ServiceTrendBadge({ trend }: { trend: ServiceTrend }) {
  const cls =
    trend.label === "Em alta"
      ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-300"
      : trend.label === "Em baixa"
        ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${cls}`}>
      {trend.label}
    </span>
  );
}

function getServiceTrendCopy(trend: ServiceTrend) {
  if (trend.label === "Em alta") {
    return `Procura a crescer: ${trend.current} vendas nos últimos 30 dias, contra ${trend.previous} no período anterior.`;
  }
  if (trend.label === "Em baixa") {
    return `Procura mais baixa: ${trend.current} vendas nos últimos 30 dias, contra ${trend.previous} no período anterior.`;
  }
  return `Procura estável: ${trend.current} vendas nos últimos 30 dias.`;
}

function ServicesPage() {
  const { studio } = useCurrentStudio();
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [serviceTrends, setServiceTrends] = useState<ServiceTrendMap>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Service | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    if (!studio) return;
    const [{ data: s }, { data: c }, { data: sug }] = await Promise.all([
      supabase
        .from("services")
        .select("*")
        .eq("studio_id", studio.id)
        .order("sort_order")
        .order("name"),
      supabase
        .from("service_categories")
        .select("id,label,sort_order")
        .eq("studio_id", studio.id)
        .order("sort_order"),
      supabase.from("service_category_suggestions").select("id,label").order("sort_order"),
    ]);
    const serviceRows = (s ?? []) as unknown as Service[];
    setServices(serviceRows);
    setCategories((c ?? []) as Category[]);
    setSuggestions((sug ?? []) as Suggestion[]);
    setServiceTrends(await fetchServiceTrends(serviceRows));
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [studio]);

  async function remove(id: string) {
    if (!confirm("Eliminar este serviço?")) return;
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Serviço eliminado");
    load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">A carregar…</p>;

  return (
    <div className="space-y-8">
      <header className="grid gap-3 rounded-[1.25rem] border border-border/80 bg-card/95 p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Serviços</p>
          <h2 className="mt-1 text-2xl font-light tracking-tight">{services.length} serviços</h2>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bellza-panel-action bellza-panel-action-primary"
        >
          <Plus className="h-4 w-4" /> Novo serviço
        </button>
      </header>

      {services.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Sem serviços. Crie o primeiro.
        </p>
      ) : (
        <ExpandableList
          items={services}
          initialCount={5}
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          itemClassName="min-w-0"
          buttonWrapClassName="md:col-span-2"
          getKey={(service) => service.id}
          moreLabel={(hidden) => `Mostrar mais ${hidden} serviço${hidden !== 1 ? "s" : ""}`}
          renderItem={(s) => {
            const cover = s.media?.[0]?.src;
            const cat = categories.find((c) => c.id === s.category_id);
            const trend = serviceTrends[s.id];
            return (
              <article
                key={s.id}
                className={`overflow-hidden rounded-lg border ${s.is_active ? "border-border" : "border-border/50 opacity-60"}`}
              >
                {cover && <img src={cover} alt={s.name} className="h-32 w-full object-cover" />}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {cat?.label && (
                        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          {cat.label}
                        </p>
                      )}
                      <h3 className="mt-1 text-base font-medium">{s.name}</h3>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {trend && <ServiceTrendBadge trend={trend} />}
                      {s.is_recommended && (
                        <span className="rounded-full bg-foreground px-2 py-0.5 text-[9px] uppercase tracking-wide text-background">
                          Top
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{s.duration_min} min</span>
                    <span>€{Number(s.price).toFixed(0)}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setEditing(s)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1.5 text-xs"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => remove(s.id)}
                      className="rounded-md border border-border p-1.5 text-xs"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </article>
            );
          }}
        />
      )}

      {(editing || creating) && studio && (
        <ServiceModal
          studioId={studio.id}
          businessSegment={studio.business_segment}
          services={services}
          categories={categories}
          suggestions={suggestions}
          service={editing}
          serviceTrend={editing ? serviceTrends[editing.id] : null}
          onCategoriesChanged={load}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function ServiceModal({
  studioId,
  businessSegment,
  services,
  categories,
  suggestions,
  service,
  serviceTrend,
  onClose,
  onSaved,
  onCategoriesChanged,
}: {
  studioId: string;
  businessSegment: string;
  services: Service[];
  categories: Category[];
  suggestions: Suggestion[];
  service: Service | null;
  serviceTrend: ServiceTrend | null;
  onClose: () => void;
  onSaved: () => void;
  onCategoriesChanged: () => void | Promise<void>;
}) {
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [duration, setDuration] = useState(service?.duration_min ?? 60);
  const [price, setPrice] = useState(service?.price ?? 30);
  const [recommended, setRecommended] = useState(service?.is_recommended ?? false);
  const [active, setActive] = useState(service?.is_active ?? true);
  const [categoryId, setCategoryId] = useState(service?.category_id ?? "");
  const [media, setMedia] = useState<ServiceMedia[]>(service?.media ?? []);
  const [serviceQuery, setServiceQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const segmentConfig = getSegmentConfig(businessSegment);

  // All studio services (for upsell picker)
  const [allServices, setAllServices] = useState<Service[]>([]);
  type UpsellRow = {
    rowKey: string;
    id?: string; // existing upsell_offers.id
    offered_service_id: string;
    discounted_price: number;
    discount_type: "price" | "percent" | "fixed";
    discount_value: number | null;
    display_mode: "percent" | "amount" | "both";
    duration_min: number | null;
    description: string;
  };
  const [upsellEnabled, setUpsellEnabled] = useState(false);
  const [upsells, setUpsells] = useState<UpsellRow[]>([]);
  const [initialUpsellIds, setInitialUpsellIds] = useState<string[]>([]);

  const presetMatches = useMemo(() => {
    const q = normalizeText(serviceQuery || name);
    const existingNames = new Set(
      services.filter((item) => item.id !== service?.id).map((item) => normalizeText(item.name)),
    );
    return segmentConfig.servicePresets.filter((preset) => {
      const presetName = normalizeText(preset.name);
      const categoryName = normalizeText(preset.category);
      return (
        !existingNames.has(presetName) && (!q || presetName.includes(q) || categoryName.includes(q))
      );
    }).slice(0, 8);
  }, [name, segmentConfig.servicePresets, service?.id, serviceQuery, services]);

  const existingService = services.find(
    (item) => item.id !== service?.id && normalizeText(item.name) === normalizeText(name),
  );

  function selectPreset(preset: ServicePreset) {
    const existingCategory = categories.find(
      (category) => normalizeText(category.label) === normalizeText(preset.category),
    );
    setName(preset.name);
    setDescription(preset.description ?? "");
    setDuration(preset.duration);
    setPrice(preset.price);
    setCategoryId(existingCategory?.id ?? "");
    setServiceQuery(preset.name);
  }

  useEffect(() => {
    (async () => {
      const { data: svc } = await supabase
        .from("services")
        .select(
          "id,name,description,duration_min,price,is_recommended,is_active,media,category_id,sort_order",
        )
        .eq("studio_id", studioId)
        .eq("is_active", true)
        .order("name");
      setAllServices((svc ?? []) as unknown as Service[]);

      if (service?.id) {
        const { data: offers } = await supabase
          .from("upsell_offers")
          .select("id,offered_service_id,discounted_price,discount_type,discount_value,display_mode,duration_min,description")
          .eq("studio_id", studioId)
          .eq("trigger_service_id", service.id)
          .eq("is_active", true);
        const rows: UpsellRow[] = (offers ?? []).map((o, i) => ({
          rowKey: `u-${i}-${o.id}`,
          id: o.id,
          offered_service_id: o.offered_service_id,
          discounted_price: Number(o.discounted_price),
          discount_type: normalizeDiscountType((o as any).discount_type),
          discount_value: (o as any).discount_value == null ? null : Number((o as any).discount_value),
          display_mode: normalizeDisplayMode((o as any).display_mode),
          duration_min: (o as any).duration_min == null ? null : Number((o as any).duration_min),
          description: o.description ?? "",
        }));
        setUpsells(rows);
        setInitialUpsellIds(rows.map((r) => r.id!).filter(Boolean));
        setUpsellEnabled(rows.length > 0);
      }
    })();
  }, [studioId, service?.id]);

  async function handleUpload(files: FileList) {
    const selected = Array.from(files).filter(
      (file) => isStudioImageFile(file) || file.type.startsWith("video/"),
    );
    if (!selected.length) return toast.error("Escolha uma imagem válida.");
    setUploading(true);
    setUploadProgress(`0/${selected.length}`);
    try {
      const nextMedia: ServiceMedia[] = [];
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        setUploadProgress(`${index + 1}/${selected.length}`);
        const { url } = await uploadStudioAsset(studioId, file, "services");
        nextMedia.push({ type: file.type.startsWith("video") ? "video" : "image", src: url });
      }
      setMedia((current) => [...current, ...nextMedia]);
      toast.success(selected.length === 1 ? "Imagem carregada" : "Imagens carregadas");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  async function persistUpsells(triggerServiceId: string) {
    const validRows = upsellEnabled
      ? upsells.filter(
          (r) =>
            r.offered_service_id &&
            r.offered_service_id !== triggerServiceId &&
            r.discounted_price >= 0,
        )
      : [];

    const keptIds = new Set(validRows.filter((r) => r.id).map((r) => r.id!));
    const toDelete = initialUpsellIds.filter((id) => !keptIds.has(id));
    if (toDelete.length) {
      await supabase.from("upsell_offers").delete().in("id", toDelete);
    }
    for (const r of validRows) {
      const offered = allServices.find((s) => s.id === r.offered_service_id);
      const original = offered ? Number(offered.price) : Number(r.discounted_price || 0);
      const discountedPrice = computeUpsellDiscountedPrice(original, r);
      if (r.id) {
        await supabase
          .from("upsell_offers")
          .update({
            offered_service_id: r.offered_service_id,
            discounted_price: discountedPrice,
            discount_type: r.discount_type,
            discount_value: r.discount_value,
            display_mode: r.display_mode,
            duration_min: r.duration_min,
            description: r.description || null,
            is_active: true,
          })
          .eq("id", r.id);
      } else {
        await supabase.from("upsell_offers").insert({
          studio_id: studioId,
          trigger_service_id: triggerServiceId,
          offered_service_id: r.offered_service_id,
          discounted_price: discountedPrice,
          discount_type: r.discount_type,
          discount_value: r.discount_value,
          display_mode: r.display_mode,
          duration_min: r.duration_min,
          description: r.description || null,
          is_active: true,
        });
      }
    }
  }

  async function save() {
    if (!name.trim()) return toast.error("Nome obrigatório");
    if (existingService) return toast.error("Este serviço já existe no estúdio");
    setSaving(true);
    let finalCategoryId = categoryId;
    if (!finalCategoryId) {
      try {
        finalCategoryId = await ensureCategory(inferSegmentCategory(name, businessSegment));
      } catch (e) {
        setSaving(false);
        return toast.error((e as Error).message);
      }
    }
    const payload = {
      studio_id: studioId,
      name: name.trim(),
      description: description.trim() || null,
      duration_min: duration,
      price,
      is_recommended: recommended,
      is_active: active,
      category_id: finalCategoryId || null,
      media,
    };
    let triggerId = service?.id ?? "";
    if (service) {
      const { error } = await supabase.from("services").update(payload).eq("id", service.id);
      if (error) {
        setSaving(false);
        return toast.error(error.message);
      }
    } else {
      const { data, error } = await supabase.from("services").insert(payload).select("id").single();
      if (error || !data) {
        setSaving(false);
        return toast.error(error?.message ?? "Erro ao criar");
      }
      triggerId = data.id;
    }

    try {
      await persistUpsells(triggerId);
    } catch (e) {
      setSaving(false);
      return toast.error((e as Error).message);
    }

    setSaving(false);
    toast.success(service ? "Alterações guardadas" : "Serviço criado");
    onSaved();
  }

  async function ensureCategory(label: string) {
    const normalized = normalizeText(label);
    const existing = categories.find((c) => normalizeText(c.label) === normalized);
    if (existing) return existing.id;

    const nextOrder = (categories.at(-1)?.sort_order ?? 0) + 10;
    const { data, error } = await supabase
      .from("service_categories")
      .insert({ studio_id: studioId, label: label.trim(), sort_order: nextOrder })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Não foi possível criar a categoria");
    await onCategoriesChanged();
    return data.id as string;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-hidden bg-black/60 p-0 backdrop-blur-sm md:items-center md:p-6">
      <div className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.35rem] border border-border bg-background shadow-2xl shadow-black/35 md:max-h-[92vh] md:max-w-2xl md:rounded-[1.35rem]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-xl md:pt-5">
          <h3 className="text-lg font-light">{service ? "Editar serviço" : "Novo serviço"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground shadow-sm"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 [-webkit-overflow-scrolling:touch]">
          {!service && (
            <div className="space-y-3 rounded-lg border border-border bg-card/40 p-3">
              <div>
                <p className="text-sm font-medium text-foreground">Pesquisar serviço</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Escolha um serviço pré-registado. A categoria correta será sugerida
                  automaticamente.
                </p>
              </div>
              <label className="block text-xs">
                <span className="text-muted-foreground">Serviço prestado</span>
                <span className="relative mt-1 block">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={serviceQuery}
                    onChange={(e) => {
                      setServiceQuery(e.target.value);
                      setName(e.target.value);
                      setCategoryId("");
                    }}
                    placeholder={segmentConfig.labels.serviceSearchPlaceholder}
                    className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-sm"
                  />
                </span>
              </label>
              {presetMatches.length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {presetMatches.map((preset) => (
                    <button
                      key={`${preset.category}-${preset.name}`}
                      type="button"
                      onClick={() => selectPreset(preset)}
                      className="rounded-md border border-border bg-background px-3 py-2 text-left text-xs hover:bg-muted"
                    >
                      <span className="block font-medium text-foreground">{preset.name}</span>
                      <span className="mt-0.5 block text-muted-foreground">
                        {preset.category} · {preset.duration} min · €{preset.price}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {serviceQuery.trim() && presetMatches.length === 0 && !existingService && (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Não encontrámos este serviço. Pode continuar e criar manualmente abaixo.
                </p>
              )}
            </div>
          )}

          {existingService && (
            <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Este serviço já existe neste {segmentConfig.labels.business}. Edite o serviço existente em vez de criar uma
              duplicação.
            </p>
          )}

          {service && serviceTrend && (
            <div className="rounded-2xl border border-border/80 bg-card/55 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Procura do serviço
                </p>
                <ServiceTrendBadge trend={serviceTrend} />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {getServiceTrendCopy(serviceTrend)}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {serviceTrend.pairName
                  ? `Venda cruzada sugerida: combinar com ${serviceTrend.pairName}.`
                  : "Venda cruzada: ainda sem padrão claro."}
              </p>
            </div>
          )}

          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setServiceQuery(e.target.value);
              setCategoryId("");
            }}
            placeholder="Nome do serviço"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição"
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs">
              <span className="text-muted-foreground">Duração (min)</span>
              <input
                type="number"
                min={5}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">Preço (€)</span>
              <input
                type="number"
                min={0}
                step="0.5"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <CategoryPicker
            studioId={studioId}
            categories={categories}
            suggestions={suggestions}
            defaultCategoryLabels={segmentConfig.defaultCategoryLabels}
            inferredLabel={inferSegmentCategory(name, businessSegment)}
            value={categoryId}
            onChange={setCategoryId}
            onCategoriesChanged={onCategoriesChanged}
          />

          <div>
            <p className="text-xs text-muted-foreground">Galeria</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {media.map((m, i) => (
                <div
                  key={i}
                  className="relative aspect-square overflow-hidden rounded-md border border-border"
                >
                  {m.type === "video" ? (
                    <video src={m.src} className="h-full w-full object-cover" />
                  ) : (
                    <img src={m.src} className="h-full w-full object-cover" alt="" />
                  )}
                  <button
                    onClick={() => setMedia(media.filter((_, idx) => idx !== i))}
                    className="absolute right-1 top-1 rounded-full bg-background/90 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                aria-label={uploading ? `A carregar ${uploadProgress}` : "Adicionar imagem"}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-background/60 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-foreground" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {uploading ? "…" : "Adicionar"}
                {uploading && uploadProgress && (
                  <span className="text-[10px] text-foreground">{uploadProgress}</span>
                )}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void handleUpload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
            </div>
          </div>

          <UpsellEditor
            triggerServiceName={name || (service?.name ?? "este serviço")}
            allServices={allServices.filter((s) => s.id !== service?.id)}
            enabled={upsellEnabled}
            onEnabledChange={(v) => {
              setUpsellEnabled(v);
              if (v && upsells.length === 0) {
                setUpsells([
                  {
                    rowKey: `u-new-${Date.now()}`,
                    offered_service_id: "",
                    discounted_price: 0,
                    discount_type: "price",
                    discount_value: null,
                    display_mode: "both",
                    duration_min: null,
                    description: "",
                  },
                ]);
              }
            }}
            rows={upsells}
            onRowsChange={setUpsells}
          />

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={recommended}
                onChange={(e) => setRecommended(e.target.checked)}
              />
              <Star className="h-3.5 w-3.5" /> Destacado
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Ativo
            </label>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex gap-2 border-t border-border bg-background/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl border border-border py-2.5 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 rounded-2xl bg-foreground py-2.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {saving ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryPicker({
  studioId,
  categories,
  suggestions,
  defaultCategoryLabels,
  inferredLabel,
  value,
  onChange,
  onCategoriesChanged,
}: {
  studioId: string;
  categories: Category[];
  suggestions: Suggestion[];
  defaultCategoryLabels: string[];
  inferredLabel: string;
  value: string;
  onChange: (id: string) => void;
  onCategoriesChanged: () => void | Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const ownedLabels = new Set(categories.map((c) => normalizeText(c.label)));
  const suggestionLabels = [...defaultCategoryLabels, ...suggestions.map((s) => s.label)];
  const availableSuggestions = suggestionLabels
    .filter(
      (label, index, arr) =>
        arr.findIndex((item) => normalizeText(item) === normalizeText(label)) === index,
    )
    .filter((label) => !ownedLabels.has(normalizeText(label)));

  async function addCategory(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setBusyId(trimmed);
    const nextOrder = (categories.at(-1)?.sort_order ?? 0) + 10;
    const { data, error } = await supabase
      .from("service_categories")
      .insert({ studio_id: studioId, label: trimmed, sort_order: nextOrder })
      .select("id")
      .single();
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Categoria adicionada");
    if (data?.id) onChange(data.id);
    setCustomLabel("");
    setAdding(false);
    await onCategoriesChanged();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Categoria</span>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-[11px] uppercase tracking-wide text-foreground underline"
        >
          {adding ? "Fechar" : "+ Nova categoria"}
        </button>
      </div>

      <Select value={value || "__none"} onValueChange={(nextValue) => onChange(nextValue === "__none" ? "" : nextValue)}>
        <SelectTrigger className="rounded-xl border-border bg-background px-3 text-sm shadow-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
          <SelectItem value="__none" className="rounded-xl px-3 py-2.5 text-sm">
            Sem categoria
          </SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id} className="rounded-xl px-3 py-2.5 text-sm">
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!value && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Se não escolher uma categoria, este serviço será classificado automaticamente em{" "}
          <strong>{inferredLabel}</strong>.
        </p>
      )}

      {availableSuggestions.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Categorias disponíveis
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {availableSuggestions.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => addCategory(label)}
                disabled={busyId !== null}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {adding && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Criar personalizada
            </p>
            <div className="mt-1 flex gap-2">
              <input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="Ex.: Cabelo"
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => addCategory(customLabel)}
                disabled={!customLabel.trim() || busyId !== null}
                className="rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50"
              >
                Criar
              </button>
            </div>
          </div>

          {availableSuggestions.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sugestões</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {availableSuggestions.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => addCategory(label)}
                    disabled={busyId !== null}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Cross-sell / Upsell editor ---------- */

type UpsellRow = {
  rowKey: string;
  id?: string;
  offered_service_id: string;
  discounted_price: number;
  discount_type: "price" | "percent" | "fixed";
  discount_value: number | null;
  display_mode: "percent" | "amount" | "both";
  duration_min: number | null;
  description: string;
};

function UpsellEditor({
  triggerServiceName,
  allServices,
  enabled,
  onEnabledChange,
  rows,
  onRowsChange,
}: {
  triggerServiceName: string;
  allServices: Service[];
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  rows: UpsellRow[];
  onRowsChange: (rows: UpsellRow[]) => void;
}) {
  // Smart suggestions: pick services whose name hints at complementary care.
  const triggerLower = triggerServiceName.toLowerCase();
  const suggestionKeywords: { match: RegExp; hints: RegExp }[] = [
    { match: /unha|manicure|gel|verniz/, hints: /pedicure|hidrat|nail art|máscara/i },
    { match: /pedicure/, hints: /manicure|hidrat|esfolia/i },
    { match: /cabelo|corte|brushing|cor|coloraç/, hints: /máscara|reconstruç|hidrat|tratamento/i },
    { match: /facial|limpeza|pele/, hints: /máscara|hidrat|sobrance/i },
    { match: /pestana|lash/, hints: /sobrance|brow|design/i },
    { match: /sobrance|brow/, hints: /pestana|lash|design/i },
  ];
  const suggested = (() => {
    const rule = suggestionKeywords.find((r) => r.match.test(triggerLower));
    if (!rule) return [] as Service[];
    const taken = new Set(rows.map((r) => r.offered_service_id));
    return allServices.filter((s) => rule.hints.test(s.name) && !taken.has(s.id)).slice(0, 4);
  })();

  function addRow(prefill?: Partial<UpsellRow>) {
    onRowsChange([
      ...rows,
      {
        rowKey: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        offered_service_id: prefill?.offered_service_id ?? "",
        discounted_price: prefill?.discounted_price ?? 0,
        discount_type: prefill?.discount_type ?? "price",
        discount_value: prefill?.discount_value ?? null,
        display_mode: prefill?.display_mode ?? "both",
        duration_min: prefill?.duration_min ?? null,
        description: prefill?.description ?? "",
      },
    ]);
  }

  function updateRow(rowKey: string, patch: Partial<UpsellRow>) {
    onRowsChange(rows.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  }

  function removeRow(rowKey: string) {
    onRowsChange(rows.filter((r) => r.rowKey !== rowKey));
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="mt-0.5"
        />
        <span className="flex-1">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Venda cruzada
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            Sugira serviços complementares com desconto a quem reserva {triggerServiceName}.
          </span>
        </span>
      </label>

      {enabled && (
        <div className="mt-3 space-y-3">
          {rows.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Sem ofertas. Adicione abaixo.</p>
          )}

          {rows.map((r) => {
            const offered = allServices.find((s) => s.id === r.offered_service_id);
            const original = offered ? Number(offered.price) : 0;
            const finalPrice = computeUpsellDiscountedPrice(original, r);
            const save = Math.max(0, original - finalPrice);
            const pct = original > 0 ? (save / original) * 100 : 0;
            return (
              <div
                key={r.rowKey}
                className="space-y-3 rounded-2xl border border-border bg-background/80 p-3.5 shadow-sm"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Select
                    value={r.offered_service_id || "__none"}
                    onValueChange={(nextValue) => {
                      const serviceId = nextValue === "__none" ? "" : nextValue;
                      const s = allServices.find((x) => x.id === serviceId);
                      updateRow(r.rowKey, {
                        offered_service_id: serviceId,
                        discounted_price: s
                          ? Math.round(Number(s.price) * 0.8 * 100) / 100
                          : r.discounted_price,
                        discount_type: s ? "percent" : r.discount_type,
                        discount_value: s ? 20 : r.discount_value,
                        display_mode: r.display_mode ?? "both",
                        duration_min: null,
                      });
                    }}
                  >
                    <SelectTrigger className="min-h-11 flex-1 rounded-xl border-border bg-background px-3 text-sm shadow-sm [&>span]:whitespace-normal [&>span]:text-left [&>span]:leading-snug">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[90] max-h-[min(22rem,70vh)] rounded-2xl border-border bg-popover/98 p-1.5 shadow-2xl">
                      <SelectItem value="__none" className="rounded-xl px-3 py-2.5 text-sm">
                        Escolher serviço
                      </SelectItem>
                      {allServices.map((s) => (
                        <SelectItem key={s.id} value={s.id} className="rounded-xl px-3 py-2.5 text-sm">
                          {s.name} · {s.duration_min}min · €{Number(s.price).toFixed(0)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeRow(r.rowKey)}
                    aria-label="Remover"
                    className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="text-[11px]">
                    <span className="text-muted-foreground">Preço c/ desconto (€)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={r.discounted_price}
                        onChange={(e) =>
                        updateRow(r.rowKey, {
                          discounted_price: roundCurrency(Number(e.target.value)),
                          discount_type: "price",
                          discount_value: null,
                        })
                      }
                      className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="text-[11px]">
                    <span className="text-muted-foreground">Resumo</span>
                    <div className="mt-1 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-muted/40 px-3 py-2 text-[11px]">
                      {offered ? (
                        <>
                          <span className="text-muted-foreground line-through">
                            €{original.toFixed(0)}
                          </span>
                          <span className="font-semibold">
                            €{Number(r.discounted_price).toFixed(0)}
                          </span>
                          {save > 0 && (
                            <span className="text-accent">poupa €{save.toFixed(0)}</span>
                          )}
                      <span className="ml-auto whitespace-nowrap text-muted-foreground">
                            +{r.duration_min ?? offered.duration_min}min
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </div>

                {offered && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-[11px]">
                      <span className="text-muted-foreground">Aplicar desconto (%)</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        placeholder="Ex.: 10"
                        onChange={(e) => {
                          const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                          updateRow(r.rowKey, {
                            discount_type: "percent",
                            discount_value: pct,
                            discounted_price: computeDiscountedPriceFromConfig(original, "percent", pct, original),
                          });
                        }}
                        className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-[11px]">
                      <span className="text-muted-foreground">Aplicar desconto (€)</span>
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        placeholder="Ex.: 5"
                        onChange={(e) => {
                          const fixed = Math.max(0, Number(e.target.value) || 0);
                          updateRow(r.rowKey, {
                            discount_type: "fixed",
                            discount_value: roundCurrency(fixed),
                            discounted_price: computeDiscountedPriceFromConfig(original, "fixed", fixed, original),
                          });
                        }}
                        className="mt-1 min-h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                )}

                {offered && (
                  <div className="rounded-2xl border border-border bg-muted/20 p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="min-w-0 text-[11px]">
                        <span className="text-muted-foreground">Tipo de desconto</span>
                        <Select
                          value={r.discount_type}
                          onValueChange={(value) => {
                            const nextType = normalizeDiscountType(value);
                            const suggestedPercent = (r.discount_value ?? Math.round(pct)) || 10;
                            const suggestedFixed = (r.discount_value ?? Math.round(save * 100) / 100) || 2;
                            const nextValue =
                              nextType === "percent"
                                ? Math.max(0, Math.min(100, suggestedPercent))
                                : nextType === "fixed"
                                  ? Math.max(0, suggestedFixed)
                                  : null;
                            updateRow(r.rowKey, {
                              discount_type: nextType,
                              discount_value: nextValue,
                              discounted_price: computeDiscountedPriceFromConfig(original, nextType, nextValue, Number(r.discounted_price) || original),
                            });
                          }}
                        >
                          <SelectTrigger className="mt-1 min-h-11 rounded-xl border-border bg-background px-3 text-sm [&>span]:whitespace-normal [&>span]:text-left [&>span]:leading-snug">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="z-[90] max-h-[min(18rem,65vh)] rounded-2xl border-border bg-popover/98 p-1.5 shadow-2xl">
                            <SelectItem value="percent">Percentagem (%)</SelectItem>
                            <SelectItem value="fixed">Valor fixo (€)</SelectItem>
                            <SelectItem value="price">Preço final</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>

                      <label className="min-w-0 text-[11px]">
                        <span className="text-muted-foreground">
                          {r.discount_type === "percent"
                            ? "Desconto (%)"
                            : r.discount_type === "fixed"
                              ? "Desconto (€)"
                              : "Preço final (€)"}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={r.discount_type === "percent" ? 100 : undefined}
                          step={r.discount_type === "percent" ? "1" : "0.5"}
                          value={r.discount_type === "price" ? Number(r.discounted_price || 0) : (r.discount_value ?? "")}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            if (r.discount_type === "price") {
                              updateRow(r.rowKey, { discounted_price: value, discount_value: null });
                              return;
                            }
                            const nextValue =
                              r.discount_type === "percent"
                                ? Math.min(100, Math.max(0, value))
                                : Math.max(0, value);
                            updateRow(r.rowKey, {
                              discount_value: nextValue,
                              discounted_price: computeDiscountedPriceFromConfig(original, r.discount_type, nextValue, Number(r.discounted_price) || original),
                            });
                          }}
                          className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                        />
                      </label>

                      <label className="min-w-0 text-[11px]">
                        <span className="text-muted-foreground">Duração nesta oferta</span>
                        <input
                          type="number"
                          min={1}
                          step="1"
                          value={r.duration_min ?? ""}
                          placeholder={`${offered.duration_min} min`}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            updateRow(r.rowKey, {
                              duration_min: value > 0 ? Math.round(value) : null,
                            });
                          }}
                          className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                        />
                        <span className="mt-1 block text-[10px] leading-tight text-muted-foreground">
                          Vazio usa {offered.duration_min} min.
                        </span>
                      </label>

                      <label className="min-w-0 text-[11px]">
                        <span className="text-muted-foreground">Destacar no checkout</span>
                        <Select
                          value={r.display_mode}
                          onValueChange={(value) => updateRow(r.rowKey, { display_mode: normalizeDisplayMode(value) })}
                        >
                          <SelectTrigger className="mt-1 min-h-11 rounded-xl border-border bg-background px-3 text-sm [&>span]:whitespace-normal [&>span]:text-left [&>span]:leading-snug">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="z-[90] max-h-[min(18rem,65vh)] rounded-2xl border-border bg-popover/98 p-1.5 shadow-2xl">
                            <SelectItem value="percent">Apenas percentagem</SelectItem>
                            <SelectItem value="amount">Apenas valor poupado</SelectItem>
                            <SelectItem value="both">Percentagem e valor</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-4">
                      <MiniSummary label="Original" value={`€${original.toFixed(2)}`} muted />
                      <MiniSummary label="Desconto" value={formatUpsellDiscountSummary(save, pct, r.display_mode)} />
                      <MiniSummary label="Economia" value={`€${save.toFixed(2)}`} />
                      <MiniSummary label="Preço final" value={`€${finalPrice.toFixed(2)}`} strong />
                    </div>
                  </div>
                )}

                <input
                  value={r.description}
                  onChange={(e) => updateRow(r.rowKey, { description: e.target.value })}
                  placeholder="Mensagem opcional (ex.: Combo perfeito para si)"
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[12px]"
                />
              </div>
            );
          })}

          {suggested.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Sugestões inteligentes
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {suggested.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      addRow({
                        offered_service_id: s.id,
                        discounted_price: Math.round(Number(s.price) * 0.8 * 100) / 100,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" /> {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => addRow()}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-2 text-[12px] text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar oferta
          </button>
        </div>
      )}
    </div>
  );
}

function MiniSummary({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/70 px-2.5 py-2">
      <p className="break-words text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 break-words font-mono text-[12px] leading-snug",
          strong ? "font-extrabold text-accent" : "font-semibold text-foreground",
          muted && "text-muted-foreground line-through",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function normalizeDiscountType(value: unknown): UpsellRow["discount_type"] {
  return value === "percent" || value === "fixed" || value === "price" ? value : "price";
}

function normalizeDisplayMode(value: unknown): UpsellRow["display_mode"] {
  return value === "percent" || value === "amount" || value === "both" ? value : "both";
}

function computeDiscountedPriceFromConfig(
  original: number,
  discountType: UpsellRow["discount_type"],
  discountValue: number | null,
  fallbackPrice: number,
) {
  const value = Number(discountValue ?? 0);
  if (discountType === "percent") {
    return roundCurrency(Math.max(0, original * (1 - Math.min(100, Math.max(0, value)) / 100)));
  }
  if (discountType === "fixed") {
    return roundCurrency(Math.max(0, original - Math.max(0, value)));
  }
  return roundCurrency(Math.max(0, fallbackPrice));
}

function computeUpsellDiscountedPrice(original: number, row: UpsellRow) {
  return computeDiscountedPriceFromConfig(
    original,
    row.discount_type,
    row.discount_value,
    Number(row.discounted_price) || original,
  );
}

function formatUpsellDiscountSummary(
  save: number,
  pct: number,
  mode: UpsellRow["display_mode"],
) {
  const roundedPct = Math.round((pct + Number.EPSILON) * 100) / 100;
  const percent = `${roundedPct.toLocaleString("pt-PT", {
    minimumFractionDigits: roundedPct % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}%`;
  const amount = `€${save.toFixed(2)}`;
  if (mode === "percent") return percent;
  if (mode === "amount") return amount;
  return `${percent} · ${amount}`;
}

function roundCurrency(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}
