import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentStudio } from "@/hooks/use-current-studio";
import { GooglePlacesSettings } from "@/components/google-places-reviews";
import { SEGMENT_OPTIONS, getSegmentConfig, type BusinessSegment } from "@/lib/segments";
import { isStudioImageFile, uploadStudioAsset } from "@/lib/upload";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  Loader2,
  Store,
  Upload,
} from "lucide-react";
import type { Json } from "@/integrations/supabase/types";
import {
  InternationalPhoneInput,
  normalizeInternationalPhone,
} from "@/components/ui/international-phone-input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/_authenticated/admin/marca")({
  component: BrandPage,
});

type StudioRow = {
  id: string;
  name: string;
  owner_name: string | null;
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
  booking_flow_mode: "online" | "request";
  booking_request_professional_mode: "hidden" | "showcase" | "preference";
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

const bookingRequestProfessionalOptions = [
  ["hidden", "Não mostrar profissionais", "O estúdio distribui o atendimento."],
  ["showcase", "Mostrar equipa sem escolha", "A equipa fica visível apenas como catálogo."],
  ["preference", "Permitir preferência", "O cliente indica uma preferência não garantida."],
] as const;

function BrandPage() {
  const { studio } = useCurrentStudio();
  const [data, setData] = useState<StudioRow | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [openSection, setOpenSection] = useState("visual");
  const [openPublicEditor, setOpenPublicEditor] = useState<string | null>(null);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [heroUploading, setHeroUploading] = useState(false);
  const [heroUploadProgress, setHeroUploadProgress] = useState("");
  const logoInput = useRef<HTMLInputElement>(null);
  const heroInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!studio) return;
    const baseSelect =
      "id,name,owner_name,tagline,description,brand_color,logo_url,hero_image_url,hero_gallery_urls,location,phone,whatsapp,email,instagram,slug,accepted_payment_methods,business_segment,booking_flow_mode,booking_request_professional_mode";
    const legacySelect =
      "id,name,tagline,description,brand_color,logo_url,hero_image_url,location,phone,whatsapp,email,instagram,slug,accepted_payment_methods,business_segment";
    supabase
      .from("studios")
      .select(`${baseSelect},public_amenities`)
      .eq("id", studio.id)
      .single()
      .then(async ({ data, error }) => {
        if (!error && data) {
          const loaded = data as unknown as StudioRow;
          setData(loaded);
          setSavedSnapshot(serializeBrandData(loaded));
          return;
        }
        const legacy = await supabase
          .from("studios")
          .select(legacySelect)
          .eq("id", studio.id)
          .single();
        const loaded: StudioRow = {
          ...(legacy.data as StudioRow),
          owner_name: null,
          hero_gallery_urls: [],
          business_segment: studio.business_segment,
          booking_flow_mode: "online",
          booking_request_professional_mode: "hidden",
          public_amenities: null,
        };
        setData(loaded);
        setSavedSnapshot(serializeBrandData(loaded));
      });
  }, [studio]);

  useEffect(() => {
    if (!data || savedSnapshot === null || serializeBrandData(data) === savedSnapshot) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [data, savedSnapshot]);

  async function save() {
    if (!data) return;
    setSaving(true);
    setSaveState("idle");
    const payload = {
      name: data.name,
      owner_name: data.owner_name,
      tagline: data.tagline,
      description: data.description,
      brand_color: data.brand_color,
      logo_url: data.logo_url,
      hero_image_url: data.hero_image_url,
      hero_gallery_urls: data.hero_gallery_urls,
      location: data.location,
      phone: normalizeInternationalPhone(data.phone),
      whatsapp: normalizeInternationalPhone(data.whatsapp),
      email: data.email,
      instagram: data.instagram,
      accepted_payment_methods: normalizeAcceptedPaymentMethods(data.accepted_payment_methods),
      public_amenities: data.public_amenities,
      business_segment: data.business_segment,
      booking_flow_mode: data.booking_flow_mode,
      booking_request_professional_mode: data.booking_request_professional_mode,
    };
    if (data.booking_flow_mode === "request" && !normalizeInternationalPhone(data.whatsapp)) {
      setSaving(false);
      setSaveState("error");
      toast.error("Configure um WhatsApp válido antes de ativar solicitações.");
      return;
    }
    let { error } = await supabase.from("studios").update(payload).eq("id", data.id);
    if (
      error &&
      (error.message.includes("public_amenities") || error.message.includes("hero_gallery_urls"))
    ) {
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
    if (error && error.message.includes("owner_name")) {
      const { owner_name: _ownerName, ...legacyPayload } = payload;
      const legacy = await supabase.from("studios").update(legacyPayload).eq("id", data.id);
      error = legacy.error;
      if (!error) {
        toast.message(
          "Marca guardada. Aplique a nova migração para guardar o nome da proprietária.",
        );
      }
    }
    setSaving(false);
    if (error) {
      setSaveState("error");
      return toast.error(error.message);
    }
    setSavedSnapshot(serializeBrandData(data));
    setSaveState("saved");
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

  function setPrimaryHeroImage(url: string) {
    if (!data) return;
    const currentGallery = normalizeStringArray(data.hero_gallery_urls);
    if (currentGallery.length < 2 || currentGallery[0] === url) return;
    const nextGallery = [url, ...currentGallery.filter((item) => item !== url)];
    setData({
      ...data,
      hero_gallery_urls: nextGallery as unknown as Json,
      hero_image_url: url,
    });
  }

  if (!data) return <p className="text-sm text-muted-foreground">A carregar…</p>;
  const amenities = normalizeAmenities(data.public_amenities);
  const segment = getSegmentConfig(data.business_segment);
  const heroImages = getHeroImages(data);
  const isDirty = savedSnapshot !== null && serializeBrandData(data) !== savedSnapshot;
  const paymentLabels = getPaymentLabels(amenities);
  const comfortLabels = getComfortLabels(amenities);
  const studioSummary = [data.name, segment.title, data.location].filter(Boolean).join(" · ");
  const bookingSummary =
    data.booking_flow_mode === "request" ? "Solicitação pelo WhatsApp" : "Agendamento online";
  const publicSummary = `${paymentLabels.length} ${paymentLabels.length === 1 ? "pagamento" : "pagamentos"} · ${comfortLabels.length} ${comfortLabels.length === 1 ? "comodidade" : "comodidades"}`;

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
    <div
      className={`mx-auto w-full max-w-5xl space-y-3 md:space-y-4 ${isDirty || saving ? "pb-20 md:pb-0" : ""}`}
      data-testid="brand-settings-page"
    >
      <GooglePlacesSettings key={data.id} studioId={data.id} />
      <header className="flex items-center justify-between gap-3 px-1 py-2 md:rounded-2xl md:border md:border-border md:bg-card/90 md:px-5 md:py-4 md:shadow-sm">
        <div className="min-w-0 pl-3 md:pl-0">
          <p className="hidden text-[10px] uppercase tracking-[0.2em] text-muted-foreground md:block">
            Marca & página pública
          </p>
          <h1 className="text-xl font-semibold tracking-tight md:mt-0.5 md:text-2xl">
            Identidade visual
          </h1>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground md:text-sm">
            Logótipo, banner e cor principal
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={`/s/${data.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-foreground shadow-sm transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 md:px-4 md:text-sm"
          >
            <Eye className="size-4" />
            <span className="hidden min-[360px]:inline">Ver página</span>
          </a>
          <SaveActionButton
            className="hidden md:inline-flex"
            dirty={isDirty}
            saving={saving}
            saveState={saveState}
            onSave={() => void save()}
          />
        </div>
      </header>

      <section aria-label="Configuração da marca e página pública" className="min-w-0 space-y-3">
        <div className="min-w-0" data-testid="brand-section-visual">
          <div
            className="grid min-w-0 gap-3 lg:grid-cols-2 lg:items-start"
            data-testid="visual-identity-editor"
          >
            <CompactBannerEditor
              images={heroImages}
              uploading={heroUploading}
              uploadText={heroUploadProgress ? `A carregar ${heroUploadProgress}` : "A carregar"}
              onPick={() => heroInput.current?.click()}
              onRemove={removeHeroImage}
              onSetPrimary={setPrimaryHeroImage}
            />
            <CompactLogoEditor
              studioName={data.name}
              url={data.logo_url}
              onPick={() => logoInput.current?.click()}
              uploading={logoUploading}
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
            <BrandColorField
              value={data.brand_color}
              onChange={(value) => setData({ ...data, brand_color: value })}
            />
          </div>
        </div>

        <Accordion
          type="single"
          collapsible
          value={openSection}
          onValueChange={setOpenSection}
          className="space-y-3"
        >
          <AccordionItem
            value="studio"
            className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
            data-testid="brand-section-studio"
          >
            <SectionAccordionTrigger
              title="Dados do estúdio"
              description="Nome, contactos e apresentação pública"
              summary={studioSummary}
              icon={<Store className="size-5" />}
            />
            <AccordionContent className="px-3 pb-4 md:px-4">
              <div className="grid gap-x-3 gap-y-2 md:grid-cols-2">
                <Field
                  label="Nome do estúdio"
                  value={data.name}
                  onChange={(v) => setData({ ...data, name: v })}
                />
                <Field
                  label="Nome da proprietária"
                  value={data.owner_name ?? ""}
                  onChange={(v) => setData({ ...data, owner_name: v })}
                  placeholder="Ana Silva"
                />
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

              <label className="mt-2 block">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Descrição
                </span>
                <textarea
                  rows={3}
                  value={data.description ?? ""}
                  onChange={(e) => setData({ ...data, description: e.target.value })}
                  className="mt-1 min-h-24 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-ring/20 md:text-sm"
                />
              </label>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="booking"
            className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
            data-testid="brand-section-booking"
          >
            <SectionAccordionTrigger
              title="Agendamentos"
              description="Como os clientes iniciam uma marcação"
              summary={bookingSummary}
              icon={<CalendarDays className="size-5" />}
            />
            <AccordionContent className="px-3 pb-4 md:px-4">
              <div className="min-w-0 max-w-full" data-testid="booking-flow-settings">
                <p className="mb-2 text-sm font-semibold">Como os clientes iniciam uma marcação?</p>
                <div
                  className="grid w-full min-w-0 max-w-full gap-2 md:grid-cols-2"
                  role="radiogroup"
                  aria-label="Modo de agendamento"
                >
                  <BookingModeOption
                    checked={data.booking_flow_mode === "online"}
                    title="Agendamento online"
                    description="O cliente escolhe o horário e confirma diretamente."
                    onClick={() => setData({ ...data, booking_flow_mode: "online" })}
                  />
                  <BookingModeOption
                    checked={data.booking_flow_mode === "request"}
                    title="Solicitação pelo WhatsApp"
                    description="O cliente envia a preferência e o estúdio confirma."
                    onClick={() => setData({ ...data, booking_flow_mode: "request" })}
                  />
                </div>
                {data.booking_flow_mode === "request" && (
                  <div className="mt-3 w-full min-w-0 max-w-full rounded-xl border border-border bg-background/60 p-3">
                    <p className="mb-2 max-w-full break-words text-xs font-semibold">
                      Como os profissionais devem aparecer?
                    </p>
                    <div
                      className="grid w-full min-w-0 max-w-full gap-2 lg:grid-cols-3"
                      role="radiogroup"
                      aria-label="Apresentação dos profissionais"
                    >
                      {bookingRequestProfessionalOptions.map(([value, title, description]) => (
                        <BookingModeOption
                          key={value}
                          checked={data.booking_request_professional_mode === value}
                          title={title}
                          description={description}
                          onClick={() =>
                            setData({ ...data, booking_request_professional_mode: value })
                          }
                        />
                      ))}
                    </div>
                    <p className="mt-3 max-w-full text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                      Nenhuma solicitação cria marcação, bloqueia horário ou gera receita. WhatsApp
                      configurado: {normalizeInternationalPhone(data.whatsapp) ? "sim" : "não"}.
                    </p>
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem
            value="public"
            className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
            data-testid="brand-section-public"
          >
            <SectionAccordionTrigger
              title="Informações públicas"
              description={`Comodidades e detalhes do ${segment.labels.business}`}
              summary={publicSummary}
              icon={<ClipboardList className="size-5" />}
            />
            <AccordionContent className="px-3 pb-4 md:px-4">
              <div className="space-y-2">
                <CompactOptionRow
                  title="Estacionamento"
                  summary={getParkingLabel(amenities)}
                  open={openPublicEditor === "parking"}
                  onToggle={() =>
                    setOpenPublicEditor(openPublicEditor === "parking" ? null : "parking")
                  }
                >
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
                        parking: {
                          ...amenities.parking,
                          easy_access: !amenities.parking.easy_access,
                        },
                      })
                    }
                  />
                </CompactOptionRow>

                <CompactOptionRow
                  title="Pagamentos"
                  summary={formatOptionSummary(paymentLabels, "Nenhum método indicado")}
                  open={openPublicEditor === "payments"}
                  onToggle={() =>
                    setOpenPublicEditor(openPublicEditor === "payments" ? null : "payments")
                  }
                >
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
                    label="Cartão"
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

                <CompactOptionRow
                  title="Confortos"
                  summary={formatOptionSummary(comfortLabels, "Nenhuma comodidade indicada")}
                  open={openPublicEditor === "comforts"}
                  onToggle={() =>
                    setOpenPublicEditor(openPublicEditor === "comforts" ? null : "comforts")
                  }
                >
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
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>

      {(isDirty || saving) && (
        <div
          className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),8px)+4.9rem)] z-30 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border/80 bg-card/96 px-3 py-2.5 shadow-xl backdrop-blur-xl md:hidden"
          role="status"
          aria-live="polite"
          data-testid="brand-mobile-save-bar"
        >
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">
              {saving ? "A guardar alterações…" : "Alterações por guardar"}
            </p>
            {saveState === "error" && !saving && (
              <p className="text-[11px] text-destructive">Não foi possível guardar.</p>
            )}
          </div>
          <SaveActionButton
            className="inline-flex"
            dirty={isDirty}
            saving={saving}
            saveState={saveState}
            onSave={() => void save()}
          />
        </div>
      )}
    </div>
  );
}

function SectionAccordionTrigger({
  title,
  description,
  summary,
  icon,
}: {
  title: string;
  description: string;
  summary?: string;
  icon?: React.ReactNode;
}) {
  return (
    <AccordionTrigger
      className={`${summary ? "min-h-[5rem]" : "min-h-[4.25rem]"} min-w-0 gap-3 px-4 py-3 !whitespace-normal hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30`}
    >
      {icon && (
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[15px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs font-normal leading-snug text-muted-foreground">
          {description}
        </span>
        {summary && (
          <span
            className="mt-1 block break-words text-xs font-medium leading-snug text-foreground/70"
            data-testid="brand-section-summary"
          >
            {summary}
          </span>
        )}
      </span>
    </AccordionTrigger>
  );
}

function SaveActionButton({
  dirty,
  saving,
  saveState,
  onSave,
  className = "",
}: {
  dirty: boolean;
  saving: boolean;
  saveState: "idle" | "saved" | "error";
  onSave: () => void;
  className?: string;
}) {
  const content = saving ? (
    <>
      <Loader2 className="size-4 animate-spin" />A guardar…
    </>
  ) : !dirty && saveState === "saved" ? (
    <>
      <Check className="size-4" />
      Guardado
    </>
  ) : saveState === "error" ? (
    "Tentar novamente"
  ) : (
    "Guardar"
  );

  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saving}
      className={`h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background shadow-sm transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      {content}
    </button>
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
  if (label === "WhatsApp" || label.startsWith("Telem")) {
    return (
      <div className="min-w-0">
        <InternationalPhoneInput label={label} value={value} onChange={onChange} />
      </div>
    );
  }

  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-12 w-full rounded-xl border border-border bg-background/80 px-3 text-base shadow-sm transition focus:outline-none focus:ring-2 focus:ring-ring/20 md:text-sm"
      />
    </label>
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
  const triggerId = useId();
  return (
    <div
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false);
      }}
    >
      <label
        htmlFor={triggerId}
        className="text-[10px] uppercase tracking-wide text-muted-foreground"
      >
        Segmento
      </label>
      <button
        id={triggerId}
        type="button"
        onClick={() => onOpenChange(!open)}
        className="mt-1 flex h-12 w-full items-center justify-between rounded-xl border border-border bg-background/80 px-3 text-left text-base font-normal leading-normal shadow-sm transition focus:outline-none focus:ring-2 focus:ring-ring/20 md:text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selected?.title ?? "Escolher segmento"}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-[4.75rem] z-50 rounded-2xl border border-border/80 bg-popover/98 p-1.5 text-popover-foreground shadow-xl"
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
  const colorInput = useRef<HTMLInputElement>(null);
  return (
    <fieldset className="min-w-0 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] lg:col-span-2">
      <legend className="sr-only">Cor primária</legend>
      <div className="flex min-h-12 min-w-0 items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-foreground">Cor primária</span>
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            Usada nos botões e elementos principais
          </span>
        </span>
        <div className="flex h-11 min-w-0 shrink-0 items-center rounded-xl bg-muted/30 pl-1 transition focus-within:ring-2 focus-within:ring-ring/20">
          <input
            ref={colorInput}
            type="color"
            aria-label="Escolher cor primária"
            value={value ?? "#000000"}
            onChange={(event) => onChange(event.target.value)}
            className="size-9 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0.5"
          />
          <input
            aria-label="Código hexadecimal da cor primária"
            value={value ?? ""}
            onChange={(event) => onChange(event.target.value)}
            className="h-11 w-[4.75rem] min-w-0 bg-transparent px-1.5 text-sm font-semibold uppercase tracking-wide focus:outline-none sm:w-[5.5rem]"
            placeholder="#000000"
          />
          <button
            type="button"
            onClick={() => colorInput.current?.click()}
            className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            aria-label="Abrir seletor de cor"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </fieldset>
  );
}

function CompactOptionRow({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const contentId = `public-options-${title.toLocaleLowerCase("pt-PT").replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/45">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-2 text-left !whitespace-normal transition hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </span>
          <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
            {summary}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-muted-foreground">
          {open ? "Concluir" : "Alterar"}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div id={contentId} className="flex min-w-0 flex-wrap gap-2 border-t border-border/70 p-3">
          {children}
        </div>
      )}
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
      className={`inline-flex min-h-10 min-w-0 max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium !whitespace-normal transition active:scale-95 ${
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
  const [editing, setEditing] = useState(false);

  if (!editing && value.trim()) {
    return (
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
        <span className="inline-flex min-h-10 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3 py-1.5 text-sm font-medium text-background">
          <Check className="size-3.5 shrink-0" />
          <span className="break-words">{value}</span>
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-10 items-center rounded-full border border-border bg-background px-3 text-sm font-medium text-muted-foreground"
        >
          Editar outro
        </button>
      </div>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex min-h-10 items-center rounded-full border border-dashed border-border bg-background px-3 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
      >
        + Adicionar outro
      </button>
    );
  }

  return (
    <div className="flex min-w-[min(100%,18rem)] max-w-full flex-1 items-center gap-2">
      <label className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-background/80 px-3 text-sm focus-within:ring-2 focus-within:ring-ring/20">
        <span className="sr-only">{label}</span>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/60 md:text-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="inline-flex min-h-10 shrink-0 items-center rounded-xl border border-border bg-background px-3 text-sm font-semibold"
      >
        Concluir
      </button>
    </div>
  );
}

function BookingModeOption({
  checked,
  title,
  description,
  onClick,
}: {
  checked: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-testid="booking-mode-option"
      onClick={onClick}
      className={`h-auto w-full min-w-0 max-w-full !whitespace-normal rounded-2xl border p-3 text-left align-top transition ${checked ? "border-foreground bg-foreground/[0.04] ring-1 ring-foreground/15" : "border-border bg-card hover:border-foreground/30"}`}
    >
      <span className="flex min-w-0 max-w-full items-start gap-2">
        <span
          className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${checked ? "border-foreground bg-foreground text-background" : "border-border"}`}
        >
          {checked && <Check className="size-2.5" />}
        </span>
        <span className="min-w-0 max-w-full flex-1">
          <span className="block max-w-full !whitespace-normal text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
            {title}
          </span>
          <span
            data-testid="booking-mode-description"
            className="mt-1 block max-w-full !whitespace-normal text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
          >
            {description}
          </span>
        </span>
      </span>
    </button>
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

function serializeBrandData(data: StudioRow) {
  return JSON.stringify({
    name: data.name,
    owner_name: data.owner_name,
    tagline: data.tagline,
    description: data.description,
    brand_color: data.brand_color,
    logo_url: data.logo_url,
    hero_image_url: data.hero_image_url,
    hero_gallery_urls: normalizeStringArray(data.hero_gallery_urls),
    location: data.location,
    phone: data.phone,
    whatsapp: data.whatsapp,
    email: data.email,
    instagram: data.instagram,
    accepted_payment_methods: normalizeAcceptedPaymentMethods(data.accepted_payment_methods),
    public_amenities: normalizeAmenities(data.public_amenities),
    business_segment: data.business_segment,
    booking_flow_mode: data.booking_flow_mode,
    booking_request_professional_mode: data.booking_request_professional_mode,
  });
}

function getPaymentLabels(amenities: PublicAmenities) {
  return [
    amenities.payments.mb_way ? "MB Way" : null,
    amenities.payments.card ? "Cartão" : null,
    amenities.payments.cash ? "Dinheiro" : null,
    amenities.payments.other.trim() || null,
  ].filter((value): value is string => Boolean(value));
}

function getComfortLabels(amenities: PublicAmenities) {
  return [
    amenities.wifi ? "Wi‑Fi" : null,
    amenities.comforts.air_conditioning ? "Ar condicionado" : null,
    amenities.comforts.coffee ? "Café" : null,
    amenities.comforts.tv ? "TV" : null,
    amenities.comforts.water ? "Água" : null,
    amenities.comforts.accessibility ? "Acessibilidade" : null,
    amenities.comforts.children ? "Atendimento infantil" : null,
    amenities.comforts.other.trim() || null,
  ].filter((value): value is string => Boolean(value));
}

function getParkingLabel(amenities: PublicAmenities) {
  const type =
    amenities.parking.type === "free"
      ? "Estacionamento gratuito"
      : amenities.parking.type === "paid"
        ? "Estacionamento pago"
        : "Sem estacionamento";
  return amenities.parking.easy_access ? `${type} · Fácil acesso` : type;
}

function formatOptionSummary(labels: string[], emptyLabel: string) {
  if (labels.length === 0) return emptyLabel;
  if (labels.length <= 3) return labels.join(" · ");
  return `${labels.slice(0, 3).join(" · ")} +${labels.length - 3}`;
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

function CompactLogoEditor({
  studioName,
  url,
  onPick,
  uploading = false,
}: {
  studioName: string;
  url: string | null;
  onPick: () => void;
  uploading?: boolean;
}) {
  return (
    <section
      className="min-w-0 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-5"
      aria-label="Logótipo"
    >
      <p className="text-base font-semibold text-foreground sm:text-lg">Logótipo do estúdio</p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:text-sm">
        Será exibido na sua página e nas notificações
      </p>
      <div className="mt-4 flex min-w-0 items-center gap-4 sm:gap-5">
        <button
          type="button"
          onClick={onPick}
          disabled={uploading}
          className="flex size-[5.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-muted/25 text-xs text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-80 sm:size-24"
          aria-label={url ? "Alterar logótipo" : "Adicionar logótipo"}
          data-testid="brand-logo-preview"
        >
          {uploading ? (
            <span className="flex flex-col items-center gap-1.5 text-foreground" role="status">
              <Loader2 className="h-5 w-5 animate-spin" />A carregar
            </span>
          ) : url ? (
            <img src={url} alt="Logótipo atual" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1">
              <Upload className="h-5 w-5" />
              Adicionar
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="break-words text-base font-semibold leading-snug text-foreground sm:text-lg">
            {studioName}
          </p>
          <button
            type="button"
            onClick={onPick}
            disabled={uploading}
            className="mt-2 inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-xl bg-primary/10 px-3 text-xs font-semibold text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-60 sm:text-sm"
          >
            <Upload className="size-4 shrink-0" />
            <span>{url ? "Alterar logótipo" : "Adicionar logótipo"}</span>
          </button>
        </div>
      </div>
      {uploading && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Formato quadrado recomendado.
        </p>
      )}
    </section>
  );
}

function CompactBannerEditor({
  images,
  uploading,
  uploadText,
  onPick,
  onRemove,
  onSetPrimary,
}: {
  images: string[];
  uploading: boolean;
  uploadText: string;
  onPick: () => void;
  onRemove: (url: string) => void;
  onSetPrimary: (url: string) => void;
}) {
  const primaryImage = images[0];
  return (
    <section
      className="min-w-0 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-5"
      aria-label="Banner"
    >
      <div className="flex min-h-5 items-center justify-between gap-2">
        <p className="text-base font-semibold text-foreground sm:text-lg">Banner</p>
        {images.length > 1 && (
          <span className="text-[10px] text-muted-foreground">{images.length} fotos</span>
        )}
      </div>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:text-sm">
        Imagem de destaque da sua página pública
      </p>

      {!primaryImage ? (
        <button
          type="button"
          onClick={onPick}
          disabled={uploading}
          className="mt-3 flex aspect-[8/3] w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/25 text-xs text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-80"
          aria-label="Adicionar fotos do banner"
          data-testid="brand-banner-empty"
        >
          {uploading ? (
            <span className="flex flex-col items-center gap-1.5 text-foreground" role="status">
              <Loader2 className="size-5 animate-spin" />
              {uploadText}
            </span>
          ) : (
            <span className="flex flex-col items-center gap-1">
              <Upload className="size-5" />
              Adicionar
            </span>
          )}
        </button>
      ) : (
        <div
          className="relative mt-3 aspect-[8/3] w-full overflow-hidden rounded-xl bg-muted"
          data-testid="brand-banner-preview"
        >
          <img src={primaryImage} alt="Banner principal" className="h-full w-full object-cover" />
          <span className="absolute left-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur">
            Principal
          </span>
          <RemoveBannerButton onClick={() => onRemove(primaryImage)} label="Remover banner" />
          {uploading && <UploadOverlay text={uploadText} />}
        </div>
      )}

      {images.length > 1 && (
        <div
          className="mt-2 flex max-w-full gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]"
          data-testid="brand-banner-gallery"
        >
          {images.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className="group relative aspect-[16/9] w-28 shrink-0 overflow-hidden rounded-xl bg-muted sm:w-32"
            >
              <button
                type="button"
                onClick={() => onSetPrimary(url)}
                className="h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
                aria-label={
                  index === 0
                    ? "Foto principal do banner"
                    : `Definir foto ${index + 1} como principal`
                }
                aria-pressed={index === 0}
              >
                <img
                  src={url}
                  alt={`Foto do banner ${index + 1}`}
                  className="h-full w-full object-cover"
                />
              </button>
              {index === 0 ? (
                <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset ring-foreground/35" />
              ) : (
                <RemoveBannerButton
                  onClick={() => onRemove(url)}
                  label={`Remover foto ${index + 1}`}
                />
              )}
            </div>
          ))}
          {uploading && (
            <div className="flex aspect-[16/9] w-28 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/35 text-[10px] text-muted-foreground sm:w-32">
              <span className="flex flex-col items-center gap-1" role="status">
                <Loader2 className="size-4 animate-spin" />
                {uploadText}
              </span>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onPick}
        disabled={uploading}
        className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary/10 px-3 text-sm font-semibold text-primary transition hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-wait disabled:opacity-60"
      >
        <Upload className="size-3.5" />
        {images.length > 0 ? "Alterar banner" : "Adicionar banner"}
      </button>
      {uploading && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Pode selecionar várias imagens de uma vez.
        </p>
      )}
    </section>
  );
}

function RemoveBannerButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-0 top-0 grid size-11 place-items-center text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
      aria-label={label}
    >
      <span className="grid size-7 place-items-center rounded-full bg-black/60 text-base leading-none backdrop-blur transition hover:bg-black/75">
        ×
      </span>
    </button>
  );
}

function UploadOverlay({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-medium text-white backdrop-blur-[1px]">
      <span className="flex items-center gap-2" role="status">
        <Loader2 className="size-4 animate-spin" />
        {text}
      </span>
    </div>
  );
}
