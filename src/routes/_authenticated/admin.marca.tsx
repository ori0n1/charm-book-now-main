import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { SEGMENT_OPTIONS, getSegmentConfig, type BusinessSegment } from "@/lib/segments";
import { isStudioImageFile, uploadStudioAsset } from "@/lib/upload";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2, Upload } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/admin/marca")({
  component: BrandPage,
});

type StudioRow = {
  id: string;
  name: string;
  tagline: string | null;
  description: string | null;
  brand_color: string | null;
  logo_url: string | null;
  hero_image_url: string | null;
  hero_gallery_urls: Json;
  location: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
  slug: string;
  accepted_payment_methods: string[];
  public_amenities: Json | null;
  business_segment: BusinessSegment;
};

type PublicAmenities = {
  wifi: boolean;
  payments: {
    mb_way: boolean;
    card: boolean;
    cash: boolean;
    other: string;
  };
  parking: {
    available: boolean;
    type: "none" | "free" | "paid";
    easy_access: boolean;
  };
  comforts: {
    air_conditioning: boolean;
    coffee: boolean;
    children: boolean;
    accessibility: boolean;
    tv: boolean;
    water: boolean;
    other: string;
  };
};

const defaultAmenities: PublicAmenities = {
  wifi: true,
  payments: {
    mb_way: true,
    card: true,
    cash: true,
    other: "",
  },
  parking: {
    available: false,
    type: "none",
    easy_access: false,
  },
  comforts: {
    air_conditioning: true,
    coffee: false,
    children: false,
    accessibility: false,
    tv: false,
    water: true,
    other: "",
  },
};

function BrandPage() {
  const { studio } = useCurrentStudio();
  const [data, setData] = useState<StudioRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [heroUploading, setHeroUploading] = useState(false);
  const [heroUploadProgress, setHeroUploadProgress] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  const heroInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!studio) return;
    const baseSelect =
      "id,name,tagline,description,brand_color,logo_url,hero_image_url,hero_gallery_urls,location,phone,whatsapp,email,instagram,slug,accepted_payment_methods,business_segment";
    const legacySelect =
      "id,name,tagline,description,brand_color,logo_url,hero_image_url,location,phone,whatsapp,email,instagram,slug,accepted_payment_methods,business_segment";
    supabase
      .from("studios")
      .select(`${baseSelect},public_amenities`)
      .eq("id", studio.id)
      .single()
      .then(async ({ data, error }) => {
        if (!error && data) {
          setData(data as StudioRow);
          return;
        }
        const legacy = await supabase
          .from("studios")
          .select(legacySelect)
          .eq("id", studio.id)
          .single();
        setData({
          ...(legacy.data as StudioRow),
          hero_gallery_urls: [],
          business_segment: studio.business_segment,
          public_amenities: null,
        });
      });
  }, [studio]);

  async function save() {
    if (!data) return;
    setSaving(true);
    const payload = {
      name: data.name,
      tagline: data.tagline,
      description: data.description,
      brand_color: data.brand_color,
      logo_url: data.logo_url,
      hero_image_url: data.hero_image_url,
      hero_gallery_urls: data.hero_gallery_urls,
      location: data.location,
      phone: data.phone,
      whatsapp: data.whatsapp,
      email: data.email,
      instagram: data.instagram,
      accepted_payment_methods: normalizeAcceptedPaymentMethods(data.accepted_payment_methods),
      public_amenities: data.public_amenities,
      business_segment: data.business_segment,
    };
    let { error } = await supabase.from("studios").update(payload).eq("id", data.id);
    if (error && (error.message.includes("public_amenities") || error.message.includes("hero_gallery_urls"))) {
      const {
        public_amenities: _publicAmenities,
        hero_gallery_urls: _heroGalleryUrls,
        ...legacyPayload
      } = payload;
      const legacy = await supabase.from("studios").update(legacyPayload).eq("id", data.id);
      error = legacy.error;
      if (!error) {
        toast.message("Marca guardada. Aplique a nova migração para guardar comodidades públicas.");
      }
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Marca atualizada");
  }

  async function uploadImage(field: "logo_url" | "hero_image_url", file: File) {
    if (!data) return;
    const previousUrl = data[field];
    const previewUrl = field === "logo_url" ? URL.createObjectURL(file) : null;
    if (previewUrl) {
      setData({ ...data, [field]: previewUrl });
    }
    setLogoUploading(field === "logo_url");
    setHeroUploading(field === "hero_image_url");
    try {
      const { url } = await uploadStudioAsset(
        data.id,
        file,
        field === "logo_url" ? "logo" : "hero",
      );
      setData({ ...data, [field]: url });
      toast.success("Imagem carregada");
    } catch (e) {
      if (previewUrl) {
        setData({ ...data, [field]: previousUrl });
      }
      toast.error((e as Error).message);
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setLogoUploading(false);
      setHeroUploading(false);
    }
  }

  async function uploadHeroImages(files: FileList) {
    if (!data) return;
    const selected = Array.from(files).filter(isStudioImageFile);
    if (selected.length === 0) return toast.error("Escolha imagens válidas.");
    setHeroUploading(true);
    setHeroUploadProgress(`0/${selected.length}`);
    try {
      const uploaded = [];
      for (let index = 0; index < selected.length; index += 1) {
        setHeroUploadProgress(`${index + 1}/${selected.length}`);
        uploaded.push(await uploadStudioAsset(data.id, selected[index], "hero-gallery"));
      }
      const urls = uploaded.map((item) => item.url);
      const currentGallery = normalizeStringArray(data.hero_gallery_urls);
      const nextGallery = currentGallery.length ? [...currentGallery, ...urls] : urls;
      setData({
        ...data,
        hero_gallery_urls: nextGallery as unknown as Json,
        hero_image_url: nextGallery[0] ?? null,
      });
      toast.success(selected.length === 1 ? "Foto carregada" : "Fotos carregadas");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setHeroUploading(false);
      setHeroUploadProgress("");
    }
  }

  function removeHeroImage(url: string) {
    if (!data) return;
    const currentGallery = normalizeStringArray(data.hero_gallery_urls);
    if (currentGallery.length) {
      const nextGallery = currentGallery.filter((item) => item !== url);
      setData({
        ...data,
        hero_gallery_urls: nextGallery as unknown as Json,
        hero_image_url: nextGallery[0] ?? null,
      });
      return;
    }
    if (data.hero_image_url === url) {
      setData({ ...data, hero_image_url: null, hero_gallery_urls: [] });
    }
  }

  if (!data) return <p className="text-sm text-muted-foreground">A carregar…</p>;
  const amenities = normalizeAmenities(data.public_amenities);
  const segment = getSegmentConfig(data.business_segment);
  const heroImages = getHeroImages(data);

  function updateAmenities(next: PublicAmenities) {
    if (!data) return;
    const paymentMethods = [
      next.payments.mb_way && "mb_way",
      next.payments.card && "card",
      next.payments.cash && "cash",
    ].filter(Boolean) as string[];
    setData({
      ...data,
      accepted_payment_methods: paymentMethods,
      public_amenities: next as unknown as Json,
    });
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card/90 p-4 shadow-sm md:flex-row md:items-center md:justify-between md:px-5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Marca & página pública
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight md:text-2xl">A sua identidade</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Organize a aparência pública do estúdio com imagens, cor principal e informações claras.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
        </button>
      </header>

      <section className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-sm">
        <div className="grid items-start gap-3 border-b border-border p-3 md:grid-cols-[7rem_minmax(0,1fr)] md:p-4">
          <ImageField
            label="Logótipo"
            hint="Formato quadrado."
            url={data.logo_url}
            aspect="aspect-square h-28 max-h-28 max-w-28 md:h-24 md:max-h-24 md:max-w-24"
            compact
            onPick={() => logoInput.current?.click()}
            uploading={logoUploading}
            uploadText="A carregar"
          />
          <input
            ref={logoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadImage("logo_url", file);
              e.currentTarget.value = "";
            }}
          />
          <ImageField
            label="Fotos do banner"
            hint="Pode selecionar várias imagens de uma vez."
            url={data.hero_image_url}
            aspect="aspect-[16/5] max-h-32 md:max-h-36"
            onPick={() => heroInput.current?.click()}
            uploading={heroUploading}
            uploadText={heroUploadProgress ? `A carregar ${heroUploadProgress}` : "A carregar"}
          />
          <input
            ref={heroInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void uploadHeroImages(e.target.files);
              e.currentTarget.value = "";
            }}
          />
          <HeroGalleryPreview images={heroImages} onRemove={removeHeroImage} />
        </div>

        <div className="grid gap-3 border-b border-border p-3 md:grid-cols-2 md:p-4 xl:grid-cols-4">
          <Field label="Nome" value={data.name} onChange={(v) => setData({ ...data, name: v })} />
          <SegmentField
            value={data.business_segment}
            open={segmentOpen}
            onOpenChange={setSegmentOpen}
            onChange={(value) => setData({ ...data, business_segment: value })}
          />
          <Field
            label="Tagline"
            value={data.tagline ?? ""}
            onChange={(v) => setData({ ...data, tagline: v })}
          />
          <Field
            label="Localização"
            value={data.location ?? ""}
            onChange={(v) => setData({ ...data, location: v })}
          />
          <BrandColorField
            value={data.brand_color}
            onChange={(value) => setData({ ...data, brand_color: value })}
          />
          <Field
            label="Telemóvel"
            value={data.phone ?? ""}
            onChange={(v) => setData({ ...data, phone: v })}
          />
          <Field
            label="WhatsApp"
            value={data.whatsapp ?? ""}
            onChange={(v) => setData({ ...data, whatsapp: v })}
          />
          <Field
            label="Email"
            value={data.email ?? ""}
            onChange={(v) => setData({ ...data, email: v })}
          />
          <Field
            label="Instagram"
            value={data.instagram ?? ""}
            onChange={(v) => setData({ ...data, instagram: v })}
            placeholder="@estudio"
          />
        </div>

        <div className="border-b border-border p-3 md:p-4">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Descrição
          </label>
          <textarea
            rows={3}
            value={data.description ?? ""}
            onChange={(e) => setData({ ...data, description: e.target.value })}
            className="mt-1 w-full rounded-2xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-foreground"
          />
        </div>

        <div className="space-y-4 p-3 md:p-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
              Informações públicas
            </p>
            <h2 className="mt-1 text-base font-medium">
              Comodidades e detalhes do {segment.labels.business}
            </h2>
          </div>

          <CompactOptionRow title="Estacionamento">
            <ChipButton
              checked={amenities.parking.type === "free"}
              label="Gratuito"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  parking: { ...amenities.parking, available: true, type: "free" },
                })
              }
            />
            <ChipButton
              checked={amenities.parking.type === "paid"}
              label="Pago"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  parking: { ...amenities.parking, available: true, type: "paid" },
                })
              }
            />
            <ChipButton
              checked={amenities.parking.type === "none"}
              label="Sem estacionamento"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  parking: { ...amenities.parking, available: false, type: "none" },
                })
              }
            />
            <ChipButton
              checked={amenities.parking.easy_access}
              label="Fácil acesso"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  parking: { ...amenities.parking, easy_access: !amenities.parking.easy_access },
                })
              }
            />
          </CompactOptionRow>

          <CompactOptionRow title="Pagamentos">
            <ChipButton
              checked={amenities.payments.mb_way}
              label="MB Way"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  payments: { ...amenities.payments, mb_way: !amenities.payments.mb_way },
                })
              }
            />
            <ChipButton
              checked={amenities.payments.card}
              label="Apple Pay, Google Pay e cartão"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  payments: { ...amenities.payments, card: !amenities.payments.card },
                })
              }
            />
            <ChipButton
              checked={amenities.payments.cash}
              label="Dinheiro"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  payments: { ...amenities.payments, cash: !amenities.payments.cash },
                })
              }
            />
            <InlineTextField
              label="Outros"
              value={amenities.payments.other}
              placeholder="Transferência"
              onChange={(value) =>
                updateAmenities({
                  ...amenities,
                  payments: { ...amenities.payments, other: value },
                })
              }
            />
          </CompactOptionRow>

          <CompactOptionRow title="Confortos">
            <ChipButton
              checked={amenities.wifi}
              label="Wi‑Fi"
              onClick={() => updateAmenities({ ...amenities, wifi: !amenities.wifi })}
            />
            <ChipButton
              checked={amenities.comforts.air_conditioning}
              label="Ar condicionado"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  comforts: {
                    ...amenities.comforts,
                    air_conditioning: !amenities.comforts.air_conditioning,
                  },
                })
              }
            />
            <ChipButton
              checked={amenities.comforts.coffee}
              label="Café"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  comforts: { ...amenities.comforts, coffee: !amenities.comforts.coffee },
                })
              }
            />
            <ChipButton
              checked={amenities.comforts.tv}
              label="TV"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  comforts: { ...amenities.comforts, tv: !amenities.comforts.tv },
                })
              }
            />
            <ChipButton
              checked={amenities.comforts.water}
              label="Água"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  comforts: { ...amenities.comforts, water: !amenities.comforts.water },
                })
              }
            />
            <ChipButton
              checked={amenities.comforts.accessibility}
              label="Acessibilidade"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  comforts: {
                    ...amenities.comforts,
                    accessibility: !amenities.comforts.accessibility,
                  },
                })
              }
            />
            <ChipButton
              checked={amenities.comforts.children}
              label="Atendimento infantil"
              onClick={() =>
                updateAmenities({
                  ...amenities,
                  comforts: { ...amenities.comforts, children: !amenities.comforts.children },
                })
              }
            />
            <InlineTextField
              label="Outros"
              value={amenities.comforts.other}
              placeholder="Zona de espera"
              onChange={(value) =>
                updateAmenities({
                  ...amenities,
                  comforts: { ...amenities.comforts, other: value },
                })
              }
            />
          </CompactOptionRow>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="min-h-[68px]">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-10 w-full rounded-xl border border-border bg-background/80 px-3 text-sm shadow-sm transition focus:outline-none focus:ring-2 focus:ring-ring/20"
      />
    </div>
  );
}

function SegmentField({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: BusinessSegment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: BusinessSegment) => void;
}) {
  const selected = SEGMENT_OPTIONS.find((option) => option.id === value);
  return (
    <div
      className="relative min-h-[68px]"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
      }}
    >
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Segmento
      </label>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="mt-1 flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background/80 px-3 text-left text-sm font-normal leading-normal shadow-sm transition focus:outline-none focus:ring-2 focus:ring-ring/20"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selected?.title ?? "Escolher segmento"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-[4.35rem] z-50 rounded-2xl border border-border/80 bg-popover/98 p-1.5 text-popover-foreground shadow-xl"
          role="listbox"
        >
          {SEGMENT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.id);
                onOpenChange(false);
              }}
              className={`flex h-9 w-full items-center justify-between rounded-xl px-3 text-left text-sm transition ${
                option.id === value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              }`}
            >
              <span>{option.title}</span>
              {option.id === value && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandColorField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-h-[68px]">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Cor primária
      </label>
      <div className="mt-1 flex h-10 items-center gap-3 rounded-xl border border-border bg-background/80 px-3 shadow-sm transition focus-within:ring-2 focus-within:ring-ring/20">
        <input
          type="color"
          value={value ?? "#000000"}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-10 cursor-pointer rounded-lg"
        />
        <input
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

function CompactOptionRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border/70 pt-3 first:border-t-0 first:pt-0 md:grid-cols-[8rem_1fr] md:items-start">
      <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function ChipButton({
  checked,
  label,
  onClick,
}: {
  checked: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition active:scale-95 ${
        checked
          ? "border-foreground bg-foreground text-background shadow-sm"
          : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      }`}
    >
      {checked && <Check className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function InlineTextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="inline-flex h-9 min-w-[12rem] flex-1 items-center gap-2 rounded-full border border-border bg-background/80 px-3 text-sm">
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
      />
    </label>
  );
}

function normalizeAmenities(value: Json | null): PublicAmenities {
  const input = (value ?? {}) as Partial<PublicAmenities>;
  const payments = {
    ...defaultAmenities.payments,
    ...(isRecord(input.payments) ? input.payments : {}),
  };
  return {
    wifi: typeof input.wifi === "boolean" ? input.wifi : defaultAmenities.wifi,
    payments,
    parking: {
      ...defaultAmenities.parking,
      ...(isRecord(input.parking) ? input.parking : {}),
    },
    comforts: {
      ...defaultAmenities.comforts,
      ...(isRecord(input.comforts) ? input.comforts : {}),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeAcceptedPaymentMethods(methods?: string[] | null) {
  const normalized = (methods ?? ["mb_way", "card"]).filter(
    (method) => method === "mb_way" || method === "card" || method === "cash",
  );
  return normalized.length ? normalized : ["mb_way", "card"];
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function getHeroImages(data: StudioRow) {
  const gallery = normalizeStringArray(data.hero_gallery_urls);
  return gallery.length ? gallery : data.hero_image_url ? [data.hero_image_url] : [];
}

function HeroGalleryPreview({
  images,
  onRemove,
}: {
  images: string[];
  onRemove: (url: string) => void;
}) {
  if (images.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background/60 p-3 text-xs text-muted-foreground md:col-start-2">
        Nenhuma foto personalizada. A página pública usa a imagem padrão até carregar fotos do estúdio.
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto rounded-xl border border-border bg-background/60 p-2 md:col-start-2">
      {images.map((url, index) => (
        <div
          key={`${url}-${index}`}
          className="group relative h-20 w-32 shrink-0 overflow-hidden rounded-xl bg-muted md:h-24 md:w-40"
        >
          <img src={url} alt={`Foto do banner ${index + 1}`} className="h-full w-full object-cover" />
          {index === 0 && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur">
              Principal
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(url)}
            className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-100 backdrop-blur transition hover:bg-black/70 md:opacity-0 md:group-hover:opacity-100"
            aria-label="Remover foto"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function ImageField({
  label,
  hint,
  url,
  onPick,
  aspect,
  compact = false,
  uploading = false,
  uploadText = "A carregar",
}: {
  label: string;
  hint?: string;
  url: string | null;
  onPick: () => void;
  aspect: string;
  compact?: boolean;
  uploading?: boolean;
  uploadText?: string;
}) {
  return (
    <div className={`h-fit rounded-xl border border-border bg-background/60 p-2.5 ${compact ? "w-fit max-w-full" : ""}`}>
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</label>
      <button
        type="button"
        onClick={onPick}
        disabled={uploading}
        className={`mt-2 flex ${compact ? "w-28 md:w-24" : "w-full"} ${aspect} items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground transition hover:bg-muted disabled:cursor-wait disabled:opacity-80`}
      >
        {uploading ? (
          <span className="flex flex-col items-center gap-1 text-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {uploadText}
          </span>
        ) : url ? (
          <img src={url} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1">
            <Upload className="h-5 w-5" />
            Carregar
          </span>
        )}
      </button>
      {hint && <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
