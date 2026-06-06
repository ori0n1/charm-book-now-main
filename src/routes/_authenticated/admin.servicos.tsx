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

function ServicesPage() {
  const { studio } = useCurrentStudio();
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
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
    setServices((s ?? []) as unknown as Service[]);
    setCategories((c ?? []) as Category[]);
    setSuggestions((sug ?? []) as Suggestion[]);
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
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Serviços</p>
          <h2 className="mt-1 text-2xl font-light tracking-tight">{services.length} serviços</h2>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background"
        >
          <Plus className="h-4 w-4" /> Novo
        </button>
      </header>

      {services.length === 0 ? (
        <p className="rounded-lg border border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Sem serviços. Crie o primeiro.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {services.map((s) => {
            const cover = s.media?.[0]?.src;
            const cat = categories.find((c) => c.id === s.category_id);
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
                    {s.is_recommended && (
                      <span className="rounded-full bg-foreground px-2 py-0.5 text-[9px] uppercase tracking-wide text-background">
                        Top
                      </span>
                    )}
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
          })}
        </div>
      )}

      {(editing || creating) && studio && (
        <ServiceModal
          studioId={studio.id}
          businessSegment={studio.business_segment}
          services={services}
          categories={categories}
          suggestions={suggestions}
          service={editing}
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
          .select("id,offered_service_id,discounted_price,description")
          .eq("studio_id", studioId)
          .eq("trigger_service_id", service.id)
          .eq("is_active", true);
        const rows: UpsellRow[] = (offers ?? []).map((o, i) => ({
          rowKey: `u-${i}-${o.id}`,
          id: o.id,
          offered_service_id: o.offered_service_id,
          discounted_price: Number(o.discounted_price),
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
      if (r.id) {
        await supabase
          .from("upsell_offers")
          .update({
            offered_service_id: r.offered_service_id,
            discounted_price: r.discounted_price,
            description: r.description || null,
            is_active: true,
          })
          .eq("id", r.id);
      } else {
        await supabase.from("upsell_offers").insert({
          studio_id: studioId,
          trigger_service_id: triggerServiceId,
          offered_service_id: r.offered_service_id,
          discounted_price: r.discounted_price,
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
      <div className="flex max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.35rem] border border-border bg-background shadow-2xl shadow-black/35 md:max-h-[92vh] md:rounded-[1.35rem]">
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
          {adding ? "Fechar" : "+ Nova"}
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
            const save = Math.max(0, original - (Number(r.discounted_price) || 0));
            return (
              <div
                key={r.rowKey}
                className="space-y-2 rounded-md border border-border bg-background p-3"
              >
                <div className="flex items-start gap-2">
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
                      });
                    }}
                  >
                    <SelectTrigger className="flex-1 rounded-xl border-border bg-background px-2 text-sm shadow-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-2xl border-border bg-popover/98 p-1.5 shadow-xl">
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

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px]">
                    <span className="text-muted-foreground">Preço c/ desconto (€)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.5"
                      value={r.discounted_price}
                      onChange={(e) =>
                        updateRow(r.rowKey, { discounted_price: Number(e.target.value) })
                      }
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </label>
                  <div className="text-[11px]">
                    <span className="text-muted-foreground">Resumo</span>
                    <div className="mt-1 flex h-[34px] items-center gap-2 rounded-md border border-border bg-muted/40 px-2 text-[11px]">
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
                          <span className="ml-auto text-muted-foreground">
                            +{offered.duration_min}min
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                </div>

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
