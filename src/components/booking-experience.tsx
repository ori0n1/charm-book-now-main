import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  CreditCard,
  Droplets,
  Download,
  Info,
  MapPin,
  QrCode,
  RefreshCcw,
  Search,
  Share2,
  Smile,
  Sparkles,
  Star,
  Tv,
  UserRound,
  Wallet,
  Wifi,
  X,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { FaFacebookF, FaInstagram, FaTiktok, FaWhatsapp, FaXTwitter } from "react-icons/fa6";
import {
  studio as staticStudio,
  getNextDates,
  SERVICE_DB_ID,
  STAFF_DB_ID,
  type Category,
  type Service,
  type Professional,
  type Upsell,
} from "@/data/studio";
import { useLiveStudio } from "@/hooks/use-live-studio";
import { getSegmentConfig, type SegmentLabels } from "@/lib/segments";
import heroImg from "@/assets/studio-hero.jpg";
import { cn } from "@/lib/utils";
import { createPublicBooking } from "@/lib/booking";
import { sendAppointmentConfirmationForAppointment } from "@/lib/whatsapp.functions";
import { submitRefundRequest } from "@/lib/refunds";
import {
  buildPolicyPlainText,
  getPolicyParts,
  readCancellationNoticeHours,
  readRefundPolicy,
  type PolicyTextParts,
} from "@/lib/policy-text";
import type { AvailableSlot } from "@/lib/availability";
import { PaymentPendingView } from "@/components/payment-pending";
import { CookieBanner } from "@/components/cookie-banner";
import { PublicFooter } from "@/components/public-footer";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Step = 0 | 1 | 2 | 3 | 4;
type ConfirmedPaymentStatus = "paid_online" | "pay_in_studio" | "unknown";

type ClientForm = { name: string; phone: string; email: string; notes: string };
const STORAGE_KEY = "lumiere.booking.draft";

type PublicAmenities = {
  wifi: boolean;
  payments: {
    mb_way: boolean;
    multibanco: boolean;
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
    multibanco: true,
    card: false,
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

function createBrandStyle(brandColor?: string | null): CSSProperties | undefined {
  if (!brandColor || !/^#[0-9a-fA-F]{6}$/.test(brandColor)) return undefined;
  return {
    "--accent": hexToOklch(brandColor),
    "--ring": hexToOklch(brandColor),
  } as CSSProperties;
}

function withAssetVersion(url?: string | null, version?: string | null) {
  if (!url) return undefined;
  if (!version) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function uniqueImageList(images: Array<string | undefined>) {
  return images.reduce<string[]>((acc, src) => {
    if (!src || acc.includes(src)) return acc;
    acc.push(src);
    return acc;
  }, []);
}

function normalizeHeroGallery(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((src): src is string => typeof src === "string" && src.trim().length > 0);
}

function getMeaningfulText(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  const normalized = text.toLowerCase();
  if (normalized === "null" || normalized === "undefined" || normalized === "-") return "";
  return text;
}

type PublicPolicyStudio = {
  payment_policy?: string | null;
  deposit_percent?: number | null;
  cancellation_min_notice_hours?: number | null;
  cancellation_after_deadline_policy?: string | null;
  cancellation_policy_text?: string | null;
  legal_policy_version?: string | null;
};

function getCancellationNoticeHours(studio: PublicPolicyStudio) {
  return readCancellationNoticeHours(studio);
}

function getAfterDeadlinePolicy(studio: PublicPolicyStudio) {
  return readRefundPolicy(studio);
}

function getPolicyVersion(studio: PublicPolicyStudio) {
  return getMeaningfulText(studio.legal_policy_version) || "2026-05-28";
}

function getStudioPolicyParts(studio: PublicPolicyStudio) {
  return getPolicyParts(readRefundPolicy(studio), readCancellationNoticeHours(studio));
}

function buildPublicPolicyText(studio: PublicPolicyStudio) {
  return buildPolicyPlainText(readRefundPolicy(studio), readCancellationNoticeHours(studio), {
    withDepositIntro: studio.payment_policy === "pre_payment",
  });
}

function hexToOklch(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const srgbToLinear = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  const okL = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const okA = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const okB = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  const chroma = Math.sqrt(okA * okA + okB * okB);
  const hue = (Math.atan2(okB, okA) * 180) / Math.PI;
  return `oklch(${okL.toFixed(3)} ${chroma.toFixed(3)} ${((hue + 360) % 360).toFixed(1)})`;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function BookingExperience({ studioId }: { studioId?: string } = {}) {
  const live = useLiveStudio(studioId ?? staticStudio.id);
  const studio = live.studio;
  const segment = getSegmentConfig((studio as { business_segment?: string }).business_segment);
  const services = live.services;
  const categories = live.categories;
  const professionals = live.professionals;
  const [step, setStep] = useState<Step>(0);
  const [categoryId, setCategoryId] = useState<string>("all");
  const [service, setService] = useState<Service | null>(null);
  const [professional, setProfessional] = useState<Professional | "any" | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [extras, setExtras] = useState<Record<string, boolean>>({});
  const [client, setClient] = useState<ClientForm>({ name: "", phone: "", email: "", notes: "" });
  const [contactConsent, setContactConsent] = useState(false);
  const [sensitiveNotesConsent, setSensitiveNotesConsent] = useState(false);
  const [policyAccepted, setPolicyAccepted] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmedPaymentStatus, setConfirmedPaymentStatus] =
    useState<ConfirmedPaymentStatus>("unknown");
  const [pendingPayment, setPendingPayment] = useState<{
    appointmentId?: string;
    bookingRequestId?: string;
  } | null>(null);
  const [confirmedTarget, setConfirmedTarget] = useState<{
    appointmentId?: string | null;
    bookingRequestId?: string | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [logoPreviewOpen, setLogoPreviewOpen] = useState(false);
  const [publicTab, setPublicTab] = useState("services");
  const [heroIndex, setHeroIndex] = useState(0);
  const [showHeroControls, setShowHeroControls] = useState(false);
  const sendAppointmentConfirmation = useServerFn(sendAppointmentConfirmationForAppointment);
  const heroTouchStartX = useRef<number | null>(null);
  const heroControlsTimer = useRef<number | null>(null);

  // Auto-save client form to sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setClient((c) => ({ ...c, ...JSON.parse(saved) }));
    } catch {
      /* noop */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(client));
    } catch {
      /* noop */
    }
  }, [client]);

  const hasSensitiveNotes = client.notes.trim().length > 0;
  const clientValid =
    client.name.trim().length >= 2 &&
    client.phone.replace(/\D/g, "").length >= 9 &&
    (client.email === "" || /\S+@\S+\.\S+/.test(client.email)) &&
    contactConsent &&
    policyAccepted &&
    (!hasSensitiveNotes || sensitiveNotesConsent);

  // Helpers: resolve IDs to real DB UUIDs (live data has UUIDs; static mock falls back to map)
  const resolveServiceId = (id: string) => SERVICE_DB_ID[id] ?? id;
  const resolveStaffId = (id: string) => STAFF_DB_ID[id] ?? id;

  async function submitBooking() {
    if (!service || !date || !time || !professional || !clientValid) return;

    const staffDbId =
      selectedSlot?.staff_id ??
      (professional !== "any" && professional
        ? resolveStaffId((professional as Professional).id)
        : null);
    if (!staffDbId) {
      toast.error("Escolha um horário disponível para selecionar a profissional.");
      return;
    }
    const serviceDbIds = [
      resolveServiceId(service.id),
      ...(addedUpsells
        .map((u) =>
          "offeredServiceId" in u && u.offeredServiceId
            ? u.offeredServiceId
            : SERVICE_DB_ID[u.id.replace(/^u-/, "")],
        )
        .filter(Boolean) as string[]),
    ].filter(Boolean);

    const startsAt = selectedSlot?.slot_start;
    if (!startsAt) {
      toast.error("Volte a escolher o horário para confirmar disponibilidade em tempo real.");
      return;
    }

    setSubmitting(true);
    toast.message("A reservar horário...");
    try {
      const result = await createPublicBooking({
        studioSlug: studio.slug,
        staffDbId,
        startsAt,
        serviceDbIds,
        clientName: client.name.trim(),
        clientPhone: client.phone.trim(),
        clientEmail: client.email.trim() || undefined,
        notes: client.notes.trim() || undefined,
        policyAcceptance: {
          studioId: studio.id,
          policyVersion: getPolicyVersion(studio),
          cancellationNoticeHours: getCancellationNoticeHours(studio),
          afterDeadlinePolicy: getAfterDeadlinePolicy(studio),
        },
      });
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* noop */
      }
      if (result.requires_payment) {
        if (result.booking_request_id) {
          toast.message("Horário reservado temporariamente. Conclua o pagamento para confirmar.");
          setConfirmedTarget({ bookingRequestId: result.booking_request_id });
          setPendingPayment({ bookingRequestId: result.booking_request_id });
        } else if (result.appointment_id) {
          setConfirmedTarget({ appointmentId: result.appointment_id });
          setPendingPayment({ appointmentId: result.appointment_id });
        } else {
          setConfirmedPaymentStatus("paid_online");
          setConfirmed(true);
        }
      } else {
        if (result.appointment_id) {
          void sendAppointmentConfirmation({ data: { appointmentId: result.appointment_id } });
        }
        setConfirmedPaymentStatus(
          result.payment_status === "pay_in_studio" ? "pay_in_studio" : "unknown",
        );
        setConfirmedTarget({
          appointmentId: result.appointment_id,
          bookingRequestId: result.booking_request_id,
        });
        setConfirmed(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao reservar.");
    } finally {
      setSubmitting(false);
    }
  }

  const publicCategories = useMemo(
    () =>
      categories.filter((category) => services.some((service) => service.category === category.id)),
    [categories, services],
  );
  const activeCategoryId = publicCategories.some((category) => category.id === categoryId)
    ? categoryId
    : publicCategories[0]?.id;
  const filteredServices = useMemo(
    () =>
      activeCategoryId ? services.filter((service) => service.category === activeCategoryId) : [],
    [activeCategoryId, services],
  );

  useEffect(() => {
    if (!activeCategoryId || categoryId === activeCategoryId) return;
    setCategoryId(activeCategoryId);
    setService(null);
    setProfessional(null);
    setDate(null);
    setTime(null);
    setSelectedSlot(null);
    setExtras({});
  }, [activeCategoryId, categoryId]);

  const eligiblePros = useMemo(() => {
    if (!service) return professionals;
    return professionals.filter((p) => p.serviceIds.includes(service.id));
  }, [service, professionals]);

  const eligibleDbStaffIds = useMemo(
    () => eligiblePros.map((p) => resolveStaffId(p.id)),
    [eligiblePros],
  );

  const liveUpsells = service ? live.upsellsByServiceId[service.id] : undefined;
  const upsells: Upsell[] = service
    ? live.ready
      ? liveUpsells ?? []
      : []
    : [];
  const addedUpsells = upsells.filter((u) => extras[u.id]);

  // Track upsell views once per session per offer
  const viewedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (step !== 3) return;
    const ids = upsells
      .map((u) => u.id)
      .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(id) && !viewedRef.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => viewedRef.current.add(id));
    void supabase.rpc("track_upsell_views", { p_offer_ids: ids });
  }, [step, upsells]);

  const upsellsTotal = addedUpsells.reduce((sum, u) => sum + u.price, 0);
  const upsellsDuration = addedUpsells.reduce((sum, u) => sum + u.durationMin, 0);
  const upsellsSavings = addedUpsells.reduce((sum, u) => sum + (u.originalPrice - u.price), 0);

  const total = (service?.price ?? 0) + upsellsTotal;
  const totalDuration = (service?.durationMin ?? 0) + upsellsDuration;

  const proLabel =
    professional === "any"
      ? selectedSlot
        ? (professionals.find((p) => resolveStaffId(p.id) === selectedSlot.staff_id)?.name ??
          `${segment.labels.professional} disponivel`)
        : `Qualquer ${segment.labels.professional}`
      : (professional?.name ?? "—");

  const brandStyle = useMemo(() => createBrandStyle(studio.brand_color), [studio.brand_color]);
  const heroSlides = useMemo(() => {
    const gallery = normalizeHeroGallery(
      (studio as typeof studio & { hero_gallery_urls?: unknown }).hero_gallery_urls,
    );
    const customImages = gallery.length
      ? gallery
      : [withAssetVersion(studio.hero_image_url ?? undefined, studio.updated_at ?? undefined)];
    const cleanCustomImages = uniqueImageList(customImages);
    return cleanCustomImages.length ? cleanCustomImages : [heroImg];
  }, [studio, studio.hero_image_url, studio.updated_at]);
  const heroSlidesKey = heroSlides.join("|");
  const logoSrc = withAssetVersion(studio.logo_url ?? undefined, studio.updated_at ?? undefined);
  const publicAmenities = useMemo(
    () => normalizePublicAmenities(studio.public_amenities),
    [studio.public_amenities],
  );

  useEffect(() => {
    setHeroIndex(0);
  }, [heroSlidesKey]);

  useEffect(() => {
    if (heroSlides.length <= 1) return;
    const interval = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % heroSlides.length);
    }, 4800);
    return () => window.clearInterval(interval);
  }, [heroSlides.length, heroSlidesKey]);

  useEffect(() => {
    return () => {
      if (heroControlsTimer.current) window.clearTimeout(heroControlsTimer.current);
    };
  }, []);

  const revealHeroControls = () => {
    if (heroSlides.length <= 1) return;
    setShowHeroControls(true);
    if (heroControlsTimer.current) window.clearTimeout(heroControlsTimer.current);
    heroControlsTimer.current = window.setTimeout(() => {
      setShowHeroControls(false);
    }, 2400);
  };

  const moveHeroSlide = (direction: 1 | -1) => {
    setHeroIndex((current) => (current + direction + heroSlides.length) % heroSlides.length);
  };

  const goNext = () => setStep((s) => Math.min(s + 1, 4) as Step);
  const goBack = () => setStep((s) => Math.max(s - 1, 0) as Step);

  // Avoid flashing the static mock studio (old "Lumière" placeholders, default
  // services and professionals) before live data arrives.
  if (!live.ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
          <p className="font-mono text-[10px] uppercase tracking-[0.3em]">A carregar estúdio…</p>
        </div>
        <CookieBanner />
      </div>
    );
  }

  if (pendingPayment && !confirmed) {
    return (
      <div className="min-h-screen bg-background" style={brandStyle}>
        <PaymentPendingView
          appointmentId={pendingPayment.appointmentId}
          bookingRequestId={pendingPayment.bookingRequestId}
          acceptedMethods={
            (studio.accepted_payment_methods as string[] | undefined) ?? ["mb_way", "multibanco"]
          }
          totalPrice={total}
          policySummary={buildPublicPolicyText(studio)}
          onConfirmed={() => {
            setConfirmedTarget(pendingPayment);
            setPendingPayment(null);
            setConfirmedPaymentStatus("paid_online");
            setConfirmed(true);
          }}
          onCancel={() => {
            setPendingPayment(null);
            toast.message("Reserva por confirmar. Conclua o pagamento para garantir o horário.");
          }}
        />
      </div>
    );
  }

  if (confirmed) {
    return (
      <ConfirmationView
        studioName={studio.name}
        when={`${date && formatDate(date)} • ${time}`}
        clientName={client.name}
        pro={proLabel}
        total={total}
        savings={upsellsSavings}
        paymentStatus={confirmedPaymentStatus}
        refundEnabled={Boolean(studio.refund_requests_enabled)}
        refundTarget={confirmedTarget}
        onReset={() => {
          setStep(0);
          setCategoryId("all");
          setService(null);
          setProfessional(null);
          setDate(null);
          setTime(null);
          setExtras({});
          setClient({ name: "", phone: "", email: "", notes: "" });
          setContactConsent(false);
          setSensitiveNotesConsent(false);
          setPolicyAccepted(false);
          setConfirmedTarget(null);
          setConfirmedPaymentStatus("unknown");
          setConfirmed(false);
        }}
      />
    );
  }

  const studioRating = Number(studio.rating || 0);
  const reviewsCount = Number(
    (studio as typeof studio & { reviews_count?: number }).reviews_count ?? studio.reviews ?? 0,
  );
  const mapsHref = studio.location ? getMapsHref(studio.location) : null;
  const studioDescription = getMeaningfulText(studio.description);
  const studioTagline = getMeaningfulText(studio.tagline);
  const studioIntro = studioDescription || studioTagline;

  return (
    <div className="public-booking min-h-screen bg-background" style={brandStyle}>
      <div className="mx-auto w-full max-w-[560px] pb-32 md:max-w-6xl md:px-6">
        {/* Hero */}
        <header className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden bg-black md:left-auto md:w-auto md:translate-x-0 md:bg-transparent md:pt-6">
          <div
            className="group relative isolate h-[22rem] w-screen touch-pan-y overflow-hidden rounded-b-[1.75rem] bg-black shadow-[0_24px_70px_rgba(0,0,0,0.18)] [backface-visibility:hidden] [clip-path:inset(0_round_0_0_1.75rem_1.75rem)] [transform:translateZ(0)] md:h-[34rem] md:w-full md:rounded-[2.25rem] md:[clip-path:inset(0_round_2.25rem)] md:shadow-[0_32px_90px_rgba(0,0,0,0.24)] md:ring-1 md:ring-white/10"
            style={{
              WebkitMaskImage: "-webkit-radial-gradient(white, black)",
            }}
            onTouchStart={(event) => {
              revealHeroControls();
              heroTouchStartX.current = event.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(event) => {
              revealHeroControls();
              const startX = heroTouchStartX.current;
              heroTouchStartX.current = null;
              if (startX === null || heroSlides.length <= 1) return;
              const endX = event.changedTouches[0]?.clientX ?? startX;
              const deltaX = endX - startX;
              if (Math.abs(deltaX) < 42) return;
              moveHeroSlide(deltaX > 0 ? -1 : 1);
            }}
            onPointerDown={(event) => {
              if (event.pointerType === "touch") revealHeroControls();
            }}
          >
            <div className="absolute -inset-px z-0 overflow-hidden">
              {heroSlides.map((src, index) => (
                <img
                  key={`${src}-${index}`}
                  src={src}
                  alt={index === 0 ? "Interior do estúdio" : `Imagem ${index + 1} do estúdio`}
                  className={cn(
                    "absolute -inset-px h-[calc(100%+2px)] w-[calc(100%+2px)] max-w-none object-cover object-center transition-[opacity,transform] duration-700 ease-out will-change-[opacity,transform]",
                    index === heroIndex ? "scale-100 opacity-100" : "scale-[1.015] opacity-0",
                  )}
                  width={832}
                  height={512}
                  draggable={false}
                />
              ))}
            </div>
            <div className="absolute -inset-px z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.38),rgba(0,0,0,0.08)_36%,rgba(0,0,0,0.94))]" />
            <div className="absolute -inset-px z-10 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.12),transparent_36%)]" />
            <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-4 md:px-7 md:pt-7">
              {step > 0 ? (
                <button
                  onClick={goBack}
                  className="grid size-10 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/20 active:scale-95 md:size-11"
                  aria-label="Voltar"
                >
                  <ArrowLeft className="size-4" />
                </button>
              ) : (
                <span className="max-w-[58vw] rounded-full bg-white/14 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/85 ring-1 ring-white/18 backdrop-blur-md md:max-w-none md:px-4 md:py-2.5">
                  {studioTagline || "Reserva online"}
                </span>
              )}
              <div className="flex items-center">
                <button
                  type="button"
                  aria-label="Guardar estúdio nos favoritos"
                  className="hidden"
                >
                </button>
                <button
                  onClick={() => setShareOpen(true)}
                  aria-label="Partilhar estúdio"
                  className="grid size-10 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/20 active:scale-95 md:size-12"
                >
                  <Share2 className="size-4" />
                </button>
              </div>
            </div>
            {heroSlides.length > 1 && (
              <>
              <button
                type="button"
                aria-label="Imagem anterior"
                onClick={() => {
                  revealHeroControls();
                  moveHeroSlide(-1);
                }}
                className={cn(
                  "absolute left-3 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/18 text-white/85 ring-1 ring-white/12 backdrop-blur-md transition duration-300 hover:bg-black/28 active:scale-95 md:left-7 md:size-12 md:opacity-0 md:group-hover:opacity-100",
                  showHeroControls ? "opacity-100" : "pointer-events-none opacity-0 md:pointer-events-auto",
                )}
              >
                <ChevronLeft className="size-4 md:size-5" />
              </button>
              <button
                type="button"
                aria-label="Próxima imagem"
                onClick={() => {
                  revealHeroControls();
                  moveHeroSlide(1);
                }}
                className={cn(
                  "absolute right-3 top-1/2 z-20 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/18 text-white/85 ring-1 ring-white/12 backdrop-blur-md transition duration-300 hover:bg-black/28 active:scale-95 md:right-7 md:size-12 md:opacity-0 md:group-hover:opacity-100",
                  showHeroControls ? "opacity-100" : "pointer-events-none opacity-0 md:pointer-events-auto",
                )}
              >
                <ChevronRight className="size-4 md:size-5" />
              </button>
              </>
            )}
            <div className="absolute bottom-4 left-4 right-4 z-20 md:bottom-8 md:left-8 md:right-8">
              <div className="flex max-w-[min(100%,30rem)] items-center gap-3 rounded-[1.55rem] border border-white/[0.08] bg-[linear-gradient(115deg,rgba(0,0,0,0.18),rgba(0,0,0,0.08)_58%,rgba(255,255,255,0.025))] p-2 pr-3 ring-1 ring-black/10 shadow-[0_18px_54px_rgba(0,0,0,0.22)] backdrop-blur-[3px] md:min-h-[7rem] md:w-full md:max-w-none md:gap-4 md:rounded-[1.9rem] md:bg-[linear-gradient(115deg,rgba(0,0,0,0.14),rgba(0,0,0,0.055)_62%,rgba(255,255,255,0.024))] md:p-3 md:pr-6">
                {logoSrc && (
                  <button
                    type="button"
                    onClick={() => setLogoPreviewOpen(true)}
                    className="group/logo shrink-0 rounded-[1.35rem] focus:outline-none focus:ring-2 focus:ring-white/60 md:rounded-[1.55rem]"
                    aria-label={`Ampliar logotipo ${studio.name}`}
                  >
                    <img
                      src={logoSrc}
                      alt={`Logotipo ${studio.name}`}
                      className="size-[4.35rem] rounded-[1.35rem] bg-white/94 object-cover p-1.5 ring-1 ring-white/40 shadow-[0_12px_36px_rgba(0,0,0,0.35)] transition duration-200 group-active/logo:scale-95 md:size-20 md:rounded-[1.55rem]"
                    />
                  </button>
                )}
                <div className="min-w-0 flex-1 text-left md:max-w-[58rem]">
                  <h1 className="line-clamp-2 max-w-[18rem] text-[1.38rem] font-extrabold leading-[1.02] tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.35)] md:max-w-[52rem] md:text-[2.55rem] md:leading-[0.98]">
                    {studio.name}
                  </h1>
                  {studioIntro && (
                    <p className="mt-1 line-clamp-2 max-w-[17rem] text-[0.78rem] font-medium leading-snug text-white/78 drop-shadow-[0_1px_10px_rgba(0,0,0,0.3)] md:mt-1.5 md:max-w-[44rem] md:text-[0.98rem]">
                      {studioIntro}
                    </p>
                  )}
                  {studio.location && mapsHref && (
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 px-2 py-1 text-[0.72rem] font-semibold leading-none text-white/78 ring-1 ring-white/10 backdrop-blur-[2px] transition hover:bg-white/14 hover:text-white md:mt-2.5 md:px-2.5 md:text-[0.82rem]"
                    >
                      <MapPin className="size-3.5 shrink-0 text-white/70" />
                      <span className="truncate leading-4">{studio.location}</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Stepper */}
        {step > 0 && <Stepper current={step} professionalLabel={segment.labels.professional} />}

        {/* Step content */}
        <div className={cn("px-4 pt-4 md:px-0", step > 0 && "md:mx-auto md:max-w-3xl")}>
          {step === 0 && (
            <>
              <PublicTabs
                active={publicTab}
                professionalPlural={segment.labels.professionalPlural}
                onChange={setPublicTab}
              />
              <Amenities amenities={publicAmenities} />
              {publicTab === "services" ? (
                <CategoryStep
                  categories={publicCategories}
                  services={filteredServices}
                  activeId={activeCategoryId ?? ""}
                  onPick={(id) => {
                    setCategoryId(id);
                    setService(null);
                    setProfessional(null);
                    setDate(null);
                    setTime(null);
                    setSelectedSlot(null);
                    setExtras({});
                  }}
                  selected={service}
                  onSelect={(s) => {
                    const keepProfessional =
                      professional &&
                      professional !== "any" &&
                      professional.serviceIds.includes(s.id);
                    setService(s);
                    setProfessional((current) =>
                      current && current !== "any" && !current.serviceIds.includes(s.id)
                        ? null
                        : current,
                    );
                    setDate(null);
                    setTime(null);
                    setSelectedSlot(null);
                    setExtras({});
                    setStep(keepProfessional ? 2 : 1);
                  }}
                />
              ) : publicTab === "professionals" ? (
                <ProfessionalsPublicTab
                  professionals={professionals}
                  labels={segment.labels}
                  onPick={(picked) => {
                    setProfessional(picked);
                    setService(null);
                    setDate(null);
                    setTime(null);
                    setSelectedSlot(null);
                    setStep(0);
                    setPublicTab("services");
                    toast.message("Escolha um serviço para continuar com esta profissional.");
                  }}
                />
              ) : publicTab === "comments" ? (
                <CommentsTab rating={studioRating} reviewsCount={reviewsCount} />
              ) : (
                <ComingSoonPanel tab={publicTab} />
              )}
            </>
          )}

          {step === 1 && service && (
            <ProfessionalStep
              pros={eligiblePros}
              selected={professional}
              onSelect={(p) => {
                setProfessional(p);
                setDate(null);
                setTime(null);
                setSelectedSlot(null);
                setStep(2);
              }}
            />
          )}

          {step === 2 && service && (
            <DateTimeStep
              studioSlug={studio.slug}
              staffId={
                professional === "any"
                  ? null
                  : professional
                    ? resolveStaffId((professional as Professional).id)
                    : null
              }
              eligibleStaffIds={eligibleDbStaffIds}
              durationMin={totalDuration || service.durationMin}
              minBookingNoticeMin={studio.min_booking_notice_min ?? 30}
              date={date}
              time={time}
              onPickDate={(d) => {
                setDate(d);
                setTime(null);
                setSelectedSlot(null);
              }}
              onPickTime={(slot) => {
                setTime(slot.slot_label);
                setSelectedSlot(slot);
                setStep(3);
              }}
            />
          )}

          {step === 3 && service && (
            <UpsellStep
              upsells={upsells}
              extras={extras}
              onToggle={(id) => setExtras((e) => ({ ...e, [id]: !e[id] }))}
              savings={upsellsSavings}
              onContinue={() => setStep(4)}
            />
          )}

          {step === 4 && service && date && time && (
            <ReviewStepPremium
              service={service}
              proLabel={proLabel}
              date={date}
              time={time}
              extras={addedUpsells}
              total={total}
              duration={totalDuration}
              savings={upsellsSavings}
              client={client}
              onClientChange={setClient}
              contactConsent={contactConsent}
              onContactConsentChange={setContactConsent}
              sensitiveNotesConsent={sensitiveNotesConsent}
              onSensitiveNotesConsentChange={setSensitiveNotesConsent}
              policyAccepted={policyAccepted}
              onPolicyAcceptedChange={setPolicyAccepted}
              policyParts={getStudioPolicyParts(studio)}
              paymentPolicy={studio.payment_policy}
              depositPercent={studio.deposit_percent}
              onOpenPolicy={() => setPolicyModalOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Sticky footer */}
      {step > 0 && (
        <StickyFooter
          step={step}
          canContinue={canContinue(step, { service, professional, date, time, clientValid })}
          submitting={submitting}
          total={total}
          duration={totalDuration}
          proLabel={service ? proLabel : null}
          savings={upsellsSavings}
          onPrimary={() => {
            if (step === 4) submitBooking();
            else goNext();
          }}
        />
      )}

      {/* Share sheet */}
      {shareOpen && (
        <ShareSheet
          studioName={studio.name}
          studioSlug={studio.slug}
          onClose={() => setShareOpen(false)}
        />
      )}

      {logoPreviewOpen && logoSrc && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-black/78 p-5 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label={`Logotipo ${studio.name}`}
          onClick={() => setLogoPreviewOpen(false)}
        >
          <button
            type="button"
            onClick={() => setLogoPreviewOpen(false)}
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] grid size-10 place-items-center rounded-full bg-white/12 text-white ring-1 ring-white/18 backdrop-blur-md transition active:scale-95"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
          <div
            className="max-w-[min(78vw,24rem)] rounded-[2rem] bg-white/96 p-3 shadow-[0_30px_90px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={logoSrc}
              alt={`Logotipo ${studio.name}`}
              className="aspect-square w-full rounded-[1.55rem] object-cover"
            />
          </div>
        </div>
      )}

      {policyModalOpen && (
        <PolicyModalPremium
          studioName={studio.name}
          policyText={buildPublicPolicyText(studio)}
          customText={getMeaningfulText(studio.cancellation_policy_text)}
          onClose={() => setPolicyModalOpen(false)}
        />
      )}

      <PublicFooter
        studioName={studio.name}
        phone={studio.phone}
        whatsapp={studio.whatsapp}
        instagram={studio.instagram}
        facebook={(studio as typeof studio & { facebook?: string | null }).facebook}
        tiktok={(studio as typeof studio & { tiktok?: string | null }).tiktok}
        x={(studio as typeof studio & { x?: string | null; twitter?: string | null }).x}
        twitter={(studio as typeof studio & { twitter?: string | null }).twitter}
      />
      <CookieBanner />
    </div>
  );
}

function canContinue(
  step: Step,
  s: {
    service: Service | null;
    professional: Professional | "any" | null;
    date: Date | null;
    time: string | null;
    clientValid: boolean;
  },
) {
  if (step === 0) return !!s.service;
  if (step === 1) return !!s.professional;
  if (step === 2) return !!s.date && !!s.time;
  if (step === 3) return true;
  if (step === 4) return s.clientValid;
  return false;
}

function getMapsHref(location: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

function moneyClass(className = "") {
  return cn("font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400", className);
}

function capitalizeLabel(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function formatMoney(value: number, decimals = 2) {
  return `${value.toFixed(decimals)}€`;
}

/* ---------- Stepper ---------- */
function Stepper({ current, professionalLabel }: { current: Step; professionalLabel: string }) {
  const labels = ["Serviço", professionalLabel, "Horário", "Extras", "Confirmar"];
  return (
    <div className="px-5 pt-5 md:px-0">
      <div className="flex items-center gap-1.5">
        {labels.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= current ? "bg-accent" : "bg-surface-strong",
            )}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Etapa {current + 1} de 5 · {labels[current]}
      </p>
    </div>
  );
}

/* ---------- Steps ---------- */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </h2>
  );
}

const publicTabs = [
  { id: "services", label: "Serviços" },
  { id: "professionals", label: "Profissionais" },
  { id: "comments", label: "Comentários" },
];

function PublicTabs({
  active,
  professionalPlural,
  onChange,
}: {
  active: string;
  professionalPlural: string;
  onChange: (id: string) => void;
}) {
  return (
    <nav className="sticky top-0 z-20 -mx-4 border-b border-border/70 bg-background/86 px-4 pt-2 backdrop-blur-2xl md:static md:mx-0 md:rounded-2xl md:border md:bg-card/72 md:p-1.5">
      <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
        {publicTabs.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative h-11 shrink-0 rounded-full px-4 text-sm font-bold transition-all duration-300 active:scale-95 md:h-12",
                selected
                  ? "bg-accent text-accent-foreground shadow-lg shadow-black/10"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              {tab.id === "professionals" ? capitalizeLabel(professionalPlural) : tab.label}
              {selected && (
                <span className="absolute inset-x-5 -bottom-2 hidden h-1 rounded-full bg-accent md:block" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function Amenities({ amenities }: { amenities: PublicAmenities }) {
  const [active, setActive] = useState<{ label: string; detail: string } | null>(null);
  const items = buildAmenityItems(amenities);
  if (items.length === 0) return null;
  return (
    <section className="mt-6 space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Comodidades</h2>
          <p className="text-sm text-muted-foreground">Toque num item para ver o detalhe.</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2.5 md:gap-3">
        {items.map(({ icon: Icon, label, detail }) => (
          <button
            key={label}
            type="button"
            onClick={() => setActive({ label, detail })}
            className="group flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl bg-card/86 p-2 text-center ring-1 ring-border backdrop-blur transition hover:-translate-y-0.5 hover:ring-accent/50 active:scale-95"
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-surface text-muted-foreground transition group-hover:bg-accent group-hover:text-accent-foreground">
              <Icon className="size-5" />
            </span>
            <span className="text-[11px] font-bold">{label}</span>
          </button>
        ))}
      </div>
      {active && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/50 px-3 pb-3 backdrop-blur-sm md:place-items-center">
          <div className="w-full max-w-sm rounded-[1.5rem] bg-card p-5 shadow-2xl ring-1 ring-border">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
                  Comodidade
                </p>
                <h3 className="mt-1 text-xl font-extrabold">{active.label}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="grid size-9 place-items-center rounded-full bg-surface text-muted-foreground"
                aria-label="Fechar"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{active.detail}</p>
          </div>
        </div>
      )}
    </section>
  );
}

function ComingSoonPanel({ tab }: { tab: string }) {
  const label = publicTabs.find((item) => item.id === tab)?.label ?? "Área";
  return (
    <section className="mt-6 rounded-[1.5rem] border border-dashed border-border bg-card/72 p-8 text-center shadow-sm">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent/12 text-accent">
        <Sparkles className="size-6" />
      </div>
      <h2 className="mt-4 text-xl font-extrabold">{label}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Esta área está preparada para crescer sem pesar no agendamento. Os serviços continuam
        disponíveis na aba principal.
      </p>
    </section>
  );
}

function ProfessionalsPublicTab({
  professionals,
  labels,
  onPick,
}: {
  professionals: Professional[];
  labels: SegmentLabels;
  onPick: (professional: Professional) => void;
}) {
  return (
    <section className="mt-6 space-y-3">
      <div>
        <SectionTitle>{capitalizeLabel(labels.professionalPlural)}</SectionTitle>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
          Escolha por {labels.professional}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Veja a equipa e continue o agendamento com {labels.professional} que preferir.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {professionals.map((professional) => (
          <article
            key={professional.id}
            className="overflow-hidden rounded-[1.35rem] bg-card/90 p-3 shadow-sm ring-1 ring-border"
          >
            <div className="flex gap-3">
              <img
                src={professional.photo}
                alt={professional.name}
                className="size-20 rounded-[1.1rem] object-cover"
                loading="lazy"
                width={160}
                height={160}
              />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-extrabold">{professional.name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {professional.role || `${capitalizeLabel(labels.professional)} do negócio`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent/12 px-2.5 py-1 font-bold text-accent">
                    <Star className="size-3 fill-accent" />
                    {professional.rating ? professional.rating.toFixed(1) : "Novo"}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 font-semibold text-muted-foreground">
                    <Clock className="size-3" />
                    Horários disponíveis
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onPick(professional)}
              className="mt-3 h-11 w-full rounded-2xl bg-accent text-xs font-extrabold text-accent-foreground shadow-lg shadow-black/10 transition active:scale-[0.98]"
            >
              Agendar com {labels.professional}
            </button>
          </article>
        ))}
        {professionals.length === 0 && (
          <p className="rounded-[1.35rem] bg-card/80 p-6 text-center text-sm text-muted-foreground ring-1 ring-border">
            Ainda não existem {labels.professionalPlural} disponíveis.
          </p>
        )}
      </div>
    </section>
  );
}

function CommentsTab({ rating, reviewsCount }: { rating: number; reviewsCount: number }) {
  return (
    <section className="mt-6 space-y-4">
      <div>
        <SectionTitle>Comentários</SectionTitle>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Avaliações do estúdio</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Espaço preparado para sincronizar avaliações reais do Google e comentários das clientes.
        </p>
      </div>
      <div className="rounded-[1.5rem] bg-card/90 p-5 ring-1 ring-border">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-4xl font-extrabold tracking-tight">
              {rating > 0 ? rating.toFixed(1) : "—"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {reviewsCount > 0 ? `${reviewsCount} avaliações` : "Sem avaliações públicas ainda"}
            </p>
          </div>
          <div className="flex gap-1 text-accent">
            {Array.from({ length: 5 }).map((_, index) => (
              <Star
                key={index}
                className={cn("size-5", rating >= index + 1 ? "fill-accent" : "opacity-30")}
              />
            ))}
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-dashed border-border bg-surface/50 p-4">
          <p className="text-sm font-bold">Comentários reais em breve</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Quando a integração de avaliações estiver ativa, esta área mostrará comentários, origem
            da avaliação e data.
          </p>
        </div>
      </div>
    </section>
  );
}

function buildAmenityItems(amenities: PublicAmenities) {
  const items: { icon: typeof Wifi; label: string; detail: string }[] = [];
  if (amenities.wifi) {
    items.push({ icon: Wifi, label: "Wi‑Fi", detail: "Wi‑Fi disponível no estúdio." });
  }
  const payments = [
    amenities.payments.mb_way && "MB Way",
    amenities.payments.multibanco && "Multibanco",
    amenities.payments.card && "cartão",
    amenities.payments.cash && "dinheiro",
    amenities.payments.other.trim(),
  ].filter(Boolean);
  if (payments.length) {
    items.push({
      icon: CreditCard,
      label: "Pagamento",
      detail: `Aceita ${formatList(payments)}.`,
    });
  }
  if (amenities.parking.available || amenities.parking.easy_access) {
    const parking =
      amenities.parking.type === "paid"
        ? "Estacionamento pago disponível"
        : amenities.parking.type === "free"
          ? "Estacionamento gratuito disponível"
          : "Zona com estacionamento próximo";
    items.push({
      icon: Car,
      label: "Acesso",
      detail: `${parking}${amenities.parking.easy_access ? " e acesso simples ao estúdio" : ""}.`,
    });
  }
  const comforts = [
    amenities.comforts.air_conditioning && "ambiente climatizado",
    amenities.comforts.coffee && "café",
    amenities.comforts.children && "atendimento infantil",
    amenities.comforts.accessibility && "acessibilidade",
    amenities.comforts.tv && "TV",
    amenities.comforts.water && "água",
    amenities.comforts.other.trim(),
  ].filter(Boolean);
  if (comforts.length) {
    const icon = amenities.comforts.coffee
      ? Coffee
      : amenities.comforts.water
        ? Droplets
        : amenities.comforts.tv
          ? Tv
          : Smile;
    items.push({
      icon,
      label: "Conforto",
      detail: `Confortos disponíveis: ${formatList(comforts)}.`,
    });
  }
  return items;
}

function normalizePublicAmenities(value: unknown): PublicAmenities {
  const input = isRecord(value) ? value : {};
  const payments = isRecord(input.payments) ? input.payments : {};
  const parking = isRecord(input.parking) ? input.parking : {};
  const comforts = isRecord(input.comforts) ? input.comforts : {};
  return {
    wifi: typeof input.wifi === "boolean" ? input.wifi : defaultAmenities.wifi,
    payments: {
      mb_way: boolOr(payments.mb_way, defaultAmenities.payments.mb_way),
      multibanco: boolOr(payments.multibanco, defaultAmenities.payments.multibanco),
      card: boolOr(payments.card, defaultAmenities.payments.card),
      cash: boolOr(payments.cash, defaultAmenities.payments.cash),
      other: typeof payments.other === "string" ? payments.other : "",
    },
    parking: {
      available: boolOr(parking.available, defaultAmenities.parking.available),
      type:
        parking.type === "free" || parking.type === "paid" || parking.type === "none"
          ? parking.type
          : defaultAmenities.parking.type,
      easy_access: boolOr(parking.easy_access, defaultAmenities.parking.easy_access),
    },
    comforts: {
      air_conditioning: boolOr(
        comforts.air_conditioning,
        defaultAmenities.comforts.air_conditioning,
      ),
      coffee: boolOr(comforts.coffee, defaultAmenities.comforts.coffee),
      children: boolOr(comforts.children, defaultAmenities.comforts.children),
      accessibility: boolOr(comforts.accessibility, defaultAmenities.comforts.accessibility),
      tv: boolOr(comforts.tv, defaultAmenities.comforts.tv),
      water: boolOr(comforts.water, defaultAmenities.comforts.water),
      other: typeof comforts.other === "string" ? comforts.other : "",
    },
  };
}

function boolOr(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatList(items: unknown[]) {
  const clean = items.map(String).filter(Boolean);
  if (clean.length <= 1) return clean[0] ?? "";
  return `${clean.slice(0, -1).join(", ")} e ${clean.at(-1)}`;
}

function CategoryStep({
  categories,
  services,
  activeId,
  onPick,
  selected,
  onSelect,
}: {
  categories: Category[];
  services: Service[];
  activeId: string;
  onPick: (id: string) => void;
  selected: Service | null;
  onSelect: (s: Service) => void;
}) {
  const activeCategory = categories.find((c) => c.id === activeId);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [query, setQuery] = useState("");
  const primaryCategories = categories.slice(0, 5);
  const extraCategories = categories.slice(5);
  const visibleCategories = primaryCategories;
  const visibleServices = services.filter((service) =>
    `${service.name} ${service.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <section className="animate-slide-up space-y-5 pt-6">
      <div className="space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <SectionTitle>Serviços</SectionTitle>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Escolha o serviço</h2>
          </div>
          {activeCategory && (
            <span className="rounded-full bg-accent/12 px-3 py-1.5 text-[11px] font-bold text-accent">
              {activeCategory.label}
            </span>
          )}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar serviço"
            className="h-14 w-full rounded-2xl bg-card/88 pl-11 pr-4 text-sm font-medium shadow-sm ring-1 ring-border backdrop-blur placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <div className="-mx-5 overflow-x-auto px-5 pb-1 md:mx-0 md:overflow-visible md:px-0">
          <div className="flex w-max max-w-none flex-nowrap gap-2 md:w-full md:max-w-[680px] md:flex-wrap">
            {visibleCategories.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c.id)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center rounded-full px-3.5 text-xs font-bold transition-all active:scale-95 sm:h-11 sm:px-4",
                  activeId === c.id
                    ? "bg-accent text-accent-foreground shadow-lg shadow-black/10"
                    : "bg-card/82 text-foreground ring-1 ring-border hover:bg-surface-strong hover:ring-accent/35",
                )}
              >
                {c.label}
              </button>
            ))}
            {extraCategories.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllCategories((value) => !value)}
                className="inline-flex h-10 shrink-0 items-center rounded-full border border-dashed border-border bg-background px-3.5 text-xs font-semibold text-muted-foreground transition hover:bg-muted sm:h-11 sm:px-4"
              >
                {showAllCategories ? "Ver menos" : `Ver mais +${extraCategories.length}`}
              </button>
            )}
          </div>
        </div>
        {extraCategories.length > 0 && !showAllCategories && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Mostramos as categorias principais primeiro para facilitar a escolha.
          </p>
        )}
        {showAllCategories && extraCategories.length > 0 && (
          <div className="rounded-2xl border border-border bg-card/60 p-2">
            <div className="flex flex-wrap gap-2">
              {extraCategories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onPick(c.id)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full px-3 text-[11px] font-semibold transition-all active:scale-95",
                    activeId === c.id
                      ? "bg-foreground text-background"
                      : "bg-background text-foreground ring-1 ring-border hover:bg-surface-strong",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visibleServices.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              selected={selected?.id === s.id}
              onSelect={() => onSelect(s)}
            />
          ))}
          {visibleServices.length === 0 && (
            <p className="rounded-[1.35rem] bg-card/80 p-6 text-center text-sm text-muted-foreground ring-1 ring-border">
              Nenhum serviço encontrado nesta categoria.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ServiceStep({
  services,
  categories,
  activeId,
  onChangeCategory,
  selected,
  onSelect,
}: {
  services: Service[];
  categories: Category[];
  activeId: string;
  onChangeCategory: (id: string) => void;
  selected: Service | null;
  onSelect: (s: Service) => void;
}) {
  return (
    <section className="animate-slide-up space-y-4 pt-4">
      {/* Categories: wrap, no horizontal scroll, no clipping */}
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => onChangeCategory(c.id)}
            className={cn(
              "h-9 rounded-full px-4 text-xs font-medium transition-all active:scale-95",
              activeId === c.id
                ? "bg-foreground text-background"
                : "bg-card text-foreground ring-1 ring-border",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <SectionTitle>Serviços disponíveis</SectionTitle>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {services.map((s) => (
          <ServiceCard
            key={s.id}
            service={s}
            selected={selected?.id === s.id}
            onSelect={() => onSelect(s)}
          />
        ))}
        {services.length === 0 && (
          <p className="rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
            Nenhum serviço nesta categoria.
          </p>
        )}
      </div>
    </section>
  );
}

function ServiceCard({
  service,
  selected,
  onSelect,
}: {
  service: Service;
  selected: boolean;
  onSelect: () => void;
}) {
  const media = service.media[0];

  return (
    <article
      className={cn(
        "group overflow-hidden rounded-[1.35rem] bg-card/95 shadow-sm ring-1 backdrop-blur transition-all duration-300",
        selected
          ? "ring-2 ring-accent shadow-lg shadow-accent/10"
          : "ring-border hover:-translate-y-0.5 hover:shadow-lg hover:ring-accent/35",
      )}
    >
      <div className="flex gap-3 p-3.5">
        <div className="relative size-24 shrink-0 overflow-hidden rounded-[1.1rem] bg-surface shadow-inner md:size-28">
          {media?.type === "image" ? (
            <img
              src={media.src}
              alt={service.name}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              loading="lazy"
              width={256}
              height={256}
            />
          ) : media?.type === "video" ? (
            <video
              src={media.src}
              poster={media.poster}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-accent/18 via-surface to-card text-accent">
              <Sparkles className="size-5" />
            </div>
          )}
          {service.recommended && (
            <span className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-accent-foreground">
              Top
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 py-0.5">
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold leading-tight">{service.name}</p>
            {service.description && (
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {service.description}
              </p>
            )}
          </div>
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className={moneyClass("text-xl")}>{formatMoney(service.price)}</p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Clock className="size-3.5" />
                {service.durationMin} min
              </p>
            </div>
            <button
              onClick={onSelect}
              className={cn(
                "h-11 shrink-0 rounded-2xl px-4 text-xs font-extrabold shadow-sm transition-all active:scale-[0.98]",
                selected
                  ? "bg-foreground text-background"
                  : "bg-accent text-accent-foreground shadow-lg shadow-black/10 hover:brightness-105",
              )}
            >
              {selected ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5" strokeWidth={3} /> Selecionado
                </span>
              ) : (
                "Agendar"
              )}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ProfessionalStep({
  pros,
  selected,
  onSelect,
}: {
  pros: Professional[];
  selected: Professional | "any" | null;
  onSelect: (p: Professional | "any") => void;
}) {
  return (
    <section className="animate-slide-up space-y-5 rounded-[1.75rem] bg-card/86 p-4 shadow-sm ring-1 ring-border backdrop-blur md:p-6">
      <div className="flex items-end justify-between">
        <div>
          <SectionTitle>Profissionais</SectionTitle>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Escolha quem vai atender</h2>
        </div>
        <span className="text-[11px] text-muted-foreground">{pros.length} disponíveis</span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <button
          onClick={() => onSelect("any")}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-[1.25rem] bg-surface p-4 transition-all active:scale-[0.98]",
            selected === "any" ? "ring-2 ring-accent" : "ring-1 ring-border",
          )}
        >
          <div className="grid size-14 place-items-center rounded-full bg-accent/12 text-accent ring-1 ring-accent/20">
            <UserRound className="size-6" />
          </div>
          <p className="text-xs font-bold">Qualquer</p>
          <p className="font-mono text-[9px] uppercase text-muted-foreground">
            Melhor disponibilidade
          </p>
        </button>

        {pros.map((p) => {
          const isSelected = selected !== "any" && selected?.id === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className={cn(
                "overflow-hidden rounded-[1.25rem] bg-background/72 p-3 text-left transition-all active:scale-[0.98]",
                isSelected ? "ring-2 ring-accent" : "ring-1 ring-border hover:ring-accent/35",
              )}
            >
              <img
                src={p.photo}
                alt={p.name}
                className="aspect-square w-full rounded-lg object-cover"
                loading="lazy"
                width={512}
                height={512}
              />
              <p className="mt-3 truncate text-xs font-bold">{p.name}</p>
              <p className="font-mono text-[9px] uppercase text-muted-foreground">{p.role}</p>
              {typeof p.rating === "number" && p.rating > 0 ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <Star className="size-2.5 fill-accent text-accent" />
                  <span className="text-[10px] font-bold text-accent">{p.rating.toFixed(1)}</span>
                  {p.reviewsCount ? (
                    <span className="text-[9px] text-muted-foreground">({p.reviewsCount})</span>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                  Sem avaliações
                </p>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Date / Time (real availability from DB) ---------- */
function DateTimeStep({
  studioSlug,
  staffId,
  eligibleStaffIds,
  durationMin,
  minBookingNoticeMin,
  date,
  time,
  onPickDate,
  onPickTime,
}: {
  studioSlug: string;
  staffId: string | null;
  eligibleStaffIds: string[];
  durationMin: number;
  minBookingNoticeMin: number;
  date: Date | null;
  time: string | null;
  onPickDate: (d: Date) => void;
  onPickTime: (slot: AvailableSlot) => void;
}) {
  const allDates = useMemo(() => getNextDates(28), []);
  const [weekStart, setWeekStart] = useState(0);
  const week = allDates.slice(weekStart, weekStart + 7);

  const [slots, setSlots] = useState<import("@/lib/availability").AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    if (!date) return;
    const interval = window.setInterval(() => setRefreshTick((value) => value + 1), 8000);
    return () => window.clearInterval(interval);
  }, [date]);

  // Fetch slots whenever date/staff/duration changes
  useEffect(() => {
    let active = true;
    if (!date) {
      setSlots([]);
      return;
    }
    setLoading(true);
    setError(null);
    import("@/lib/availability")
      .then(async ({ fetchAvailableSlots }) => {
        if (staffId || eligibleStaffIds.length === 0) {
          return fetchAvailableSlots({
            studioSlug,
            staffId,
            date,
            durationMin,
            minBookingNoticeMin,
          });
        }
        const batches = await Promise.all(
          eligibleStaffIds.map((id) =>
            fetchAvailableSlots({
              studioSlug,
              staffId: id,
              date,
              durationMin,
              minBookingNoticeMin,
            }),
          ),
        );
        return batches.flat().sort((a, b) => a.slot_start.localeCompare(b.slot_start));
      })
      .then((data) => {
        if (active) setSlots(data);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [studioSlug, staffId, eligibleStaffIds, date, durationMin, minBookingNoticeMin, refreshTick]);

  const grouped = useMemo(() => {
    if (slots.length === 0) return { morning: [], afternoon: [], evening: [] };
    // lazy import group helper inline to avoid extra await
    const morning: typeof slots = [];
    const afternoon: typeof slots = [];
    const evening: typeof slots = [];
    const seen = new Set<string>();
    for (const s of slots) {
      if (seen.has(s.slot_label)) continue;
      seen.add(s.slot_label);
      const h = parseInt(s.slot_label.slice(0, 2), 10);
      if (h < 12) morning.push(s);
      else if (h < 17) afternoon.push(s);
      else evening.push(s);
    }
    return { morning, afternoon, evening };
  }, [slots]);

  const headerLabel = useMemo(() => {
    if (!week.length) return "";
    return week[0].toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  }, [week]);

  const noSlotsForDay = !loading && !error && date && slots.length === 0;
  const isSelectedToday = date ? new Date().toDateString() === date.toDateString() : false;
  const blockedImmediateSlots = useMemo(
    () => (isSelectedToday ? getBlockedImmediateSlots(minBookingNoticeMin) : []),
    [isSelectedToday, minBookingNoticeMin],
  );

  return (
    <section className="animate-slide-up space-y-5 rounded-[1.75rem] bg-card/76 p-4 shadow-sm ring-1 ring-border backdrop-blur md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-accent" />
            <SectionTitle>Disponibilidade</SectionTitle>
          </div>
          <p className="mt-1 text-sm font-bold capitalize">{headerLabel}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Duração: {durationMin} min
          </p>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Marcações disponíveis com {formatNotice(minBookingNoticeMin)} de antecedência.
          </p>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Os horários exibidos respeitam o tempo mínimo de antecedência configurado pelo estúdio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart((w) => Math.max(0, w - 7))}
            disabled={weekStart === 0}
            className="grid size-10 place-items-center rounded-full bg-background ring-1 ring-border transition active:scale-95 disabled:opacity-40"
            aria-label="Semana anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => setWeekStart((w) => Math.min(allDates.length - 7, w + 7))}
            disabled={weekStart + 7 >= allDates.length}
            className="grid size-10 place-items-center rounded-full bg-background ring-1 ring-border transition active:scale-95 disabled:opacity-40"
            aria-label="Próxima semana"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Week grid */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
        {week.map((d) => {
          const active = date?.toDateString() === d.toDateString();
          const isToday = new Date().toDateString() === d.toDateString();
          return (
            <button
              key={d.toISOString()}
              onClick={() => onPickDate(d)}
              className={cn(
                "flex h-20 min-w-16 flex-col items-center justify-center gap-1 rounded-2xl shadow-sm transition-all active:scale-95",
                active
                  ? "bg-accent text-accent-foreground shadow-lg shadow-black/10"
                  : "bg-background text-foreground ring-1 ring-border hover:ring-accent/35",
              )}
            >
              <span
                className={cn(
                  "font-mono text-[9px] uppercase",
                  active ? "opacity-70" : "text-muted-foreground",
                )}
              >
                {d.toLocaleDateString("pt-PT", { weekday: "short" }).slice(0, 3)}
              </span>
              <span className="text-base font-bold leading-none">{d.getDate()}</span>
              {isToday && (
                <span
                  className={cn(
                    "mt-0.5 size-1 rounded-full",
                    active ? "bg-accent-foreground" : "bg-accent",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Time slots */}
      <div className="rounded-[1.35rem] bg-background/66 p-3 ring-1 ring-border">
        <SectionTitle>Horário</SectionTitle>

        {!date && (
          <p className="mt-3 rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
            Escolha um dia para ver os horários disponíveis.
          </p>
        )}

        {date && loading && (
          <p className="mt-3 rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
            A verificar disponibilidade…
          </p>
        )}

        {date && error && (
          <div className="mt-3 rounded-2xl bg-destructive/10 p-5 text-center text-sm text-destructive ring-1 ring-destructive/15">
            <p className="font-bold">A agenda não carregou.</p>
            <p className="mt-1 text-xs">{error}</p>
            <button
              type="button"
              onClick={() => onPickDate(new Date(date))}
              className="mt-4 rounded-xl bg-card px-4 py-2 text-xs font-bold text-foreground ring-1 ring-border transition active:scale-95"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {date && !loading && !error && blockedImmediateSlots.length > 0 && (
          <div className="mt-4">
            <BlockedImmediateSlots slots={blockedImmediateSlots} />
          </div>
        )}

        {noSlotsForDay && (
          <NoSlotsCard
            studioSlug={studioSlug}
            staffId={staffId}
            durationMin={durationMin}
            minBookingNoticeMin={minBookingNoticeMin}
            fromDate={date!}
            onPickAlternative={(d, slot) => {
              onPickDate(d);
              setTimeout(() => onPickTime(slot), 0);
            }}
          />
        )}

        {date && !loading && !error && slots.length > 0 && (
          <div className="mt-4 space-y-4">
            <SlotGroup label="Manhã" slots={grouped.morning} time={time} onPick={onPickTime} />
            <SlotGroup label="Tarde" slots={grouped.afternoon} time={time} onPick={onPickTime} />
            <SlotGroup label="Noite" slots={grouped.evening} time={time} onPick={onPickTime} />
          </div>
        )}
      </div>
    </section>
  );
}

function BlockedImmediateSlots({ slots }: { slots: string[] }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        Bloqueados agora
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map((slot) => (
          <button
            key={slot}
            type="button"
            disabled
            title="Este horário não está mais disponível para agendamento imediato."
            className="cursor-not-allowed rounded-xl bg-muted/50 py-3 text-xs font-bold text-muted-foreground/70 ring-1 ring-border/70 line-through"
          >
            {slot}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Este horário não está mais disponível para agendamento imediato.
      </p>
    </div>
  );
}

function getBlockedImmediateSlots(minBookingNoticeMin: number) {
  const notice = Math.max(0, minBookingNoticeMin);
  if (notice <= 0) return [];

  const now = new Date();
  const threshold = new Date(now.getTime() + notice * 60_000);
  const cursor = new Date(now);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(Math.ceil(cursor.getMinutes() / 15) * 15);

  const slots: string[] = [];
  while (cursor < threshold && slots.length < 4) {
    slots.push(formatTimeLabel(cursor));
    cursor.setMinutes(cursor.getMinutes() + 15);
  }

  return slots;
}

function formatTimeLabel(date: Date) {
  return date.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

function formatNotice(minutes: number) {
  if (minutes <= 0) return "sem limite mínimo";
  if (minutes < 60) return `${minutes} minutos`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return hours === 1 ? "1 hora" : `${hours} horas`;
  return `${minutes} minutos`;
}

function SlotGroup({
  label,
  slots,
  time,
  onPick,
}: {
  label: string;
  slots: AvailableSlot[];
  time: string | null;
  onPick: (slot: AvailableSlot) => void;
}) {
  if (slots.length === 0) return null;
  return (
    <div>
      <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {slots.map((s) => {
          const active = time === s.slot_label;
          return (
            <button
              key={s.slot_label}
              onClick={() => onPick(s)}
              className={cn(
                "rounded-xl py-3 text-xs font-bold shadow-sm transition-all active:scale-95",
                active
                  ? "bg-accent text-accent-foreground shadow-lg shadow-black/10"
                  : "bg-card text-foreground ring-1 ring-border hover:ring-accent/35",
              )}
            >
              {s.slot_label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* When the chosen day has zero slots, suggest the next 3 days that do */
function NoSlotsCard({
  studioSlug,
  staffId,
  durationMin,
  minBookingNoticeMin,
  fromDate,
  onPickAlternative,
}: {
  studioSlug: string;
  staffId: string | null;
  durationMin: number;
  minBookingNoticeMin: number;
  fromDate: Date;
  onPickAlternative: (d: Date, slot: AvailableSlot) => void;
}) {
  const [alts, setAlts] = useState<{ date: Date; slot: AvailableSlot }[]>([]);
  const [searching, setSearching] = useState(true);

  useEffect(() => {
    let active = true;
    setSearching(true);
    setAlts([]);
    (async () => {
      const { fetchAvailableSlots } = await import("@/lib/availability");
      const found: { date: Date; slot: AvailableSlot }[] = [];
      for (let i = 1; i <= 14 && found.length < 3; i++) {
        const d = new Date(fromDate);
        d.setDate(fromDate.getDate() + i);
        try {
          const data = await fetchAvailableSlots({
            studioSlug,
            staffId,
            date: d,
            durationMin,
            minBookingNoticeMin,
          });
          if (data.length > 0) found.push({ date: d, slot: data[0] });
        } catch {
          /* ignore */
        }
        if (!active) return;
      }
      if (active) {
        setAlts(found);
        setSearching(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [studioSlug, staffId, durationMin, minBookingNoticeMin, fromDate]);

  return (
    <div className="mt-3 rounded-2xl bg-surface p-5">
      <p className="text-sm font-bold">Sem horários disponíveis neste dia</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {staffId
          ? "A profissional escolhida não tem horários livres com a duração necessária."
          : "Nenhuma profissional tem horários livres neste dia."}
      </p>
      {searching && <p className="mt-3 text-xs text-muted-foreground">A procurar alternativas…</p>}
      {!searching && alts.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem alternativas nos próximos 14 dias. Tente outra profissional.
        </p>
      )}
      {!searching && alts.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Sugestões mais próximas
          </p>
          {alts.map((a) => (
            <button
              key={a.date.toISOString()}
              onClick={() => onPickAlternative(a.date, a.slot)}
              className="flex w-full items-center justify-between rounded-xl bg-card px-4 py-3 ring-1 ring-border transition active:scale-[0.98] hover:ring-foreground/30"
            >
              <span className="text-sm font-medium capitalize">
                {a.date.toLocaleDateString("pt-PT", {
                  weekday: "long",
                  day: "2-digit",
                  month: "short",
                })}
              </span>
              <span className="text-sm font-bold">{a.slot.slot_label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Upsells (combo deals) ---------- */
function UpsellStep({
  upsells,
  extras,
  onToggle,
  savings,
  onContinue,
}: {
  upsells: Upsell[];
  extras: Record<string, boolean>;
  onToggle: (id: string) => void;
  savings: number;
  onContinue: () => void;
}) {
  return (
    <section className="animate-slide-up space-y-4 pt-4">
      <div className="flex items-end justify-between">
        <SectionTitle>Combos exclusivos para si</SectionTitle>
        {savings > 0 && (
          <span className="rounded-full bg-emerald-600/12 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Poupa {formatMoney(savings, 0)}
          </span>
        )}
      </div>

      {/* Hero combo banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-foreground to-foreground/85 p-5 text-background">
        <div className="absolute -right-6 -top-6 size-32 rounded-full bg-accent/30 blur-3xl" />
        <p className="relative font-mono text-[9px] font-bold uppercase tracking-widest text-accent">
          Oferta limitada
        </p>
        <h3 className="relative mt-1 text-xl font-extrabold leading-tight">
          Adicione + e poupe até 25%
        </h3>
        <p className="relative mt-1 text-xs opacity-80">
          Selecione abaixo para incluir na sua marcação.
        </p>
      </div>

      <div className="space-y-3">
        {upsells.map((u) => {
          const added = !!extras[u.id];
          const save = u.originalPrice - u.price;
          const pct = Math.round((save / u.originalPrice) * 100);
          return (
            <article
              key={u.id}
              className={cn(
                "overflow-hidden rounded-2xl bg-card transition-all",
                added ? "ring-2 ring-accent" : "ring-1 ring-border",
              )}
            >
              <div className="flex">
                <div className="relative h-auto w-28 shrink-0 sm:w-36">
                  <img
                    src={u.photo}
                    alt={u.name}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                  />
                  <span className="absolute left-2 top-2 rounded-md bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-accent-foreground">
                    -{pct}%
                  </span>
                </div>
                <div className="flex flex-1 flex-col justify-between gap-2 p-3.5">
                  <div>
                    <p className="text-sm font-bold leading-tight">{u.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                      {u.description}
                    </p>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div className="leading-tight">
                      <p className="font-mono text-[9px] uppercase text-muted-foreground">
                        +{u.durationMin} min
                      </p>
                      <p className={moneyClass("text-base")}>
                        +{formatMoney(u.price, 0)}
                        <span className="ml-1.5 align-middle font-mono text-[10px] font-medium text-muted-foreground line-through">
                          {formatMoney(u.originalPrice, 0)}
                        </span>
                      </p>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Poupa {formatMoney(save, 0)}
                      </p>
                    </div>
                    <button
                      onClick={() => onToggle(u.id)}
                      className={cn(
                        "h-9 shrink-0 rounded-lg px-3 text-[11px] font-bold transition-all active:scale-95",
                        added
                          ? "bg-accent text-accent-foreground"
                          : "bg-foreground text-background",
                      )}
                    >
                      {added ? "Adicionado ✓" : "Adicionar"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="mx-auto block py-3 text-center text-xs font-medium uppercase tracking-widest text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Não, obrigada
      </button>
    </section>
  );
}

/* ---------- Review ---------- */
function ReviewStep({
  service,
  proLabel,
  date,
  time,
  extras,
  total,
  duration,
  savings,
  client,
  onClientChange,
  contactConsent,
  onContactConsentChange,
  sensitiveNotesConsent,
  onSensitiveNotesConsentChange,
  policyAccepted,
  onPolicyAcceptedChange,
  policyParts,
  paymentPolicy,
  depositPercent,
  onOpenPolicy,
}: {
  service: Service;
  proLabel: string;
  date: Date;
  time: string;
  extras: Upsell[];
  total: number;
  duration: number;
  savings: number;
  client: ClientForm;
  onClientChange: (c: ClientForm) => void;
  contactConsent: boolean;
  onContactConsentChange: (value: boolean) => void;
  sensitiveNotesConsent: boolean;
  onSensitiveNotesConsentChange: (value: boolean) => void;
  policyAccepted: boolean;
  onPolicyAcceptedChange: (value: boolean) => void;
  policyParts: PolicyTextParts;
  paymentPolicy?: string | null;
  depositPercent?: number | null;
  onOpenPolicy: () => void;
}) {
  const set = (patch: Partial<ClientForm>) => onClientChange({ ...client, ...patch });
  const hasSensitiveNotes = client.notes.trim().length > 0;
  const requiresDeposit = paymentPolicy === "pre_payment";
  const depositRate = Number(depositPercent ?? 0);
  const depositNow = requiresDeposit ? Math.round(total * depositRate) / 100 : 0;
  const remaining = Math.max(0, total - depositNow);
  const policySummary = `${policyParts.rescheduleBody} ${policyParts.refundBody}`;
  return (
    <section className="animate-slide-up space-y-5 pt-4">
      {/* Identification card */}
      <div className="space-y-3">
        <SectionTitle>Os seus dados</SectionTitle>
        <div className="space-y-2">
          <FieldInput
            label="Nome"
            value={client.name}
            onChange={(v) => set({ name: v })}
            placeholder="Como gostaria de ser chamada?"
            autoComplete="name"
          />
          <FieldInput
            label="WhatsApp"
            value={client.phone}
            onChange={(v) => set({ phone: v })}
            placeholder="+351 912 345 678"
            type="tel"
            autoComplete="tel"
          />
          <FieldInput
            label="Email (opcional)"
            value={client.email}
            onChange={(v) => set({ email: v })}
            placeholder="email@exemplo.com"
            type="email"
            autoComplete="email"
          />
          <label className="block">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Observações (opcional)
            </span>
            <textarea
              value={client.notes}
              onChange={(e) => {
                set({ notes: e.target.value });
                if (!e.target.value.trim()) onSensitiveNotesConsentChange(false);
              }}
              placeholder="Alguma alergia, preferência ou nota?"
              rows={2}
              className="mt-1.5 block w-full resize-none rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-border placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground"
            />
          </label>
          <ConsentCheckbox
            checked={contactConsent}
            onChange={onContactConsentChange}
            label="Autorizo o uso dos meus dados para gerir esta marcação e receber mensagens sobre a reserva."
          />
          {hasSensitiveNotes && (
            <ConsentCheckbox
              checked={sensitiveNotesConsent}
              onChange={onSensitiveNotesConsentChange}
              label="Confirmo que pretendo partilhar estas observações, podendo incluir informação sensível relevante para o atendimento."
            />
          )}
          <ConsentCheckbox
            checked={policyAccepted}
            onChange={onPolicyAcceptedChange}
            label={
              <>
                Li e concordo com as{" "}
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenPolicy();
                  }}
                  className="font-semibold text-foreground underline underline-offset-2"
                >
                  políticas de cancelamento
                </button>{" "}
                e do sinal.
              </>
            }
          />
        </div>
      </div>

      {/* Summary */}
      <div>
        <SectionTitle>Resumo</SectionTitle>
        <div className="mt-3 space-y-px overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          <Row label="Serviço" value={service.name} />
          <Row label="Profissional" value={proLabel} />
          <Row label="Data" value={formatDate(date)} />
          <Row label="Hora" value={time} />
          {extras.map((e) => (
            <Row key={e.id} label="Extra" value={`${e.name} · +${formatMoney(e.price, 0)}`} />
          ))}
          <Row label="Duração" value={`${duration} min`} />
          {savings > 0 && (
            <div className="flex items-center justify-between bg-accent/10 px-4 py-3">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent">
                Poupança total
              </span>
              <span className={moneyClass("text-sm")}>−{formatMoney(savings)}</span>
            </div>
          )}
          <div className="flex items-center justify-between bg-surface px-4 py-4">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Total
            </span>
            <span className={moneyClass("text-xl")}>{formatMoney(total)}</span>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">Sinal e cancelamento</p>
        <p className="mt-1">{policySummary}</p>
      </div>
      <p className="px-2 text-center text-[11px] text-muted-foreground">
        Receberá a confirmação no WhatsApp.
      </p>
    </section>
  );
}

function ReviewStepPremium({
  service,
  proLabel,
  date,
  time,
  extras,
  total,
  duration,
  savings,
  client,
  onClientChange,
  contactConsent,
  onContactConsentChange,
  sensitiveNotesConsent,
  onSensitiveNotesConsentChange,
  policyAccepted,
  onPolicyAcceptedChange,
  policyParts,
  paymentPolicy,
  depositPercent,
  onOpenPolicy,
}: {
  service: Service;
  proLabel: string;
  date: Date;
  time: string;
  extras: Upsell[];
  total: number;
  duration: number;
  savings: number;
  client: ClientForm;
  onClientChange: (c: ClientForm) => void;
  contactConsent: boolean;
  onContactConsentChange: (value: boolean) => void;
  sensitiveNotesConsent: boolean;
  onSensitiveNotesConsentChange: (value: boolean) => void;
  policyAccepted: boolean;
  onPolicyAcceptedChange: (value: boolean) => void;
  policyParts: PolicyTextParts;
  paymentPolicy?: string | null;
  depositPercent?: number | null;
  onOpenPolicy: () => void;
}) {
  const set = (patch: Partial<ClientForm>) => onClientChange({ ...client, ...patch });
  const hasSensitiveNotes = client.notes.trim().length > 0;
  const requiresDeposit = paymentPolicy === "pre_payment";
  const depositRate = Number(depositPercent ?? 0);
  const depositNow = requiresDeposit ? Math.round(total * depositRate) / 100 : 0;
  const remaining = Math.max(0, total - depositNow);
  const policySummary = `${policyParts.rescheduleBody} ${policyParts.refundBody}`;

  return (
    <section className="animate-slide-up space-y-5 pt-4">
      <div className="space-y-3">
        <SectionTitle>Os seus dados</SectionTitle>
        <div className="space-y-2">
          <FieldInput
            label="Nome"
            value={client.name}
            onChange={(v) => set({ name: v })}
            placeholder="Como prefere ser chamada?"
            autoComplete="name"
          />
          <FieldInput
            label="WhatsApp"
            value={client.phone}
            onChange={(v) => set({ phone: v })}
            placeholder="+351 912 345 678"
            type="tel"
            autoComplete="tel"
          />
          <FieldInput
            label="Email (opcional)"
            value={client.email}
            onChange={(v) => set({ email: v })}
            placeholder="email@exemplo.com"
            type="email"
            autoComplete="email"
          />
          <label className="block">
            <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Observações (opcional)
            </span>
            <textarea
              value={client.notes}
              onChange={(e) => {
                set({ notes: e.target.value });
                if (!e.target.value.trim()) onSensitiveNotesConsentChange(false);
              }}
              placeholder="Alguma preferência, alergia ou nota para o atendimento?"
              rows={2}
              className="mt-1.5 block w-full resize-none rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-border placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground"
            />
          </label>
          <ConsentCheckbox
            checked={contactConsent}
            onChange={onContactConsentChange}
            label="Autorizo o uso dos meus dados para gerir esta marcação e receber mensagens sobre a reserva."
          />
          {hasSensitiveNotes && (
            <ConsentCheckbox
              checked={sensitiveNotesConsent}
              onChange={onSensitiveNotesConsentChange}
              label="Quero partilhar estas observações com o estúdio para preparar melhor o atendimento."
            />
          )}
          <ConsentCheckbox
            checked={policyAccepted}
            onChange={onPolicyAcceptedChange}
            label={
              <>
                Li e aceito as{" "}
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenPolicy();
                  }}
                  className="font-semibold text-foreground underline underline-offset-2"
                >
                  regras de cancelamento
                </button>{" "}
                e do sinal.
              </>
            }
          />
        </div>
      </div>

      <div>
        <SectionTitle>Resumo</SectionTitle>
        <div className="mt-3 space-y-px overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          <Row label="Serviço" value={service.name} />
          <Row label="Profissional" value={proLabel} />
          <Row label="Data" value={formatDate(date)} />
          <Row label="Hora" value={time} />
          {extras.map((e) => (
            <Row key={e.id} label="Extra" value={`${e.name} · +${formatMoney(e.price, 0)}`} />
          ))}
          <Row label="Duração" value={`${duration} min`} />
          {savings > 0 && (
            <div className="flex items-center justify-between bg-accent/10 px-4 py-3">
              <span className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent">
                Poupança total
              </span>
              <span className={moneyClass("text-sm")}>−{formatMoney(savings)}</span>
            </div>
          )}
          <div className="flex items-center justify-between bg-surface px-4 py-4">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Total
            </span>
            <span className={moneyClass("text-xl")}>{formatMoney(total)}</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Sinal e cancelamento</p>
            <p className="mt-0.5 text-xs text-muted-foreground">O essencial antes de confirmar.</p>
          </div>
          {policyParts.badge && (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[10px] font-semibold",
                policyParts.refundTone === "warning"
                  ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {policyParts.badge}
            </span>
          )}
        </div>
        <div className="grid gap-px bg-border/70 sm:grid-cols-2">
          <PolicyInfoItem
            icon={CreditCard}
            label="Paga agora"
            value={requiresDeposit ? formatMoney(depositNow) : "Nada"}
            detail={
              requiresDeposit
                ? `${depositRate}% de sinal. O restante (${formatMoney(remaining)}) é pago no estúdio.`
                : "A marcação é paga no estúdio."
            }
          />
          <PolicyInfoItem
            icon={Clock}
            label="Pode cancelar até"
            value={`${policyParts.hours}h antes`}
            detail="Depois desse prazo, fale com o estúdio."
          />
          <PolicyInfoItem
            icon={Wallet}
            label="Sinal"
            value={
              !requiresDeposit
                ? "Sem sinal"
                : policyParts.policy === "refund_allowed"
                  ? "Reembolso possível"
                  : policyParts.policy === "reschedule_only"
                    ? "Vale para remarcar"
                    : "Não reembolsável"
            }
            detail={!requiresDeposit ? "Não há valor antecipado nesta reserva." : policyParts.refundBody}
          />
          <button
            type="button"
            onClick={onOpenPolicy}
            className="flex min-h-[6rem] items-start gap-3 bg-card px-4 py-3 text-left transition hover:bg-muted/50"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Detalhes
              </span>
              <span className="mt-1 block text-sm font-semibold text-foreground">Ver regras completas</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                Inclui notas específicas do estúdio, quando existirem.
              </span>
            </span>
          </button>
        </div>
      </div>
      <p className="px-2 text-center text-[11px] text-muted-foreground">
        Receberá a confirmação no WhatsApp.
      </p>
    </section>
  );
}

function PolicyInfoItem({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CreditCard;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-[6rem] items-start gap-3 bg-card px-4 py-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 block w-full rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-border placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground"
      />
    </label>
  );
}

function ConsentCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl bg-card px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-border">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-foreground"
      />
      <span>{label}</span>
    </label>
  );
}

function PolicyModal({
  studioName,
  policyText,
  customText,
  onClose,
}: {
  studioName: string;
  policyText: string;
  customText: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-t-3xl border border-border bg-background shadow-2xl sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
              Políticas do estúdio
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight">{studioName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar políticas"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-border transition hover:bg-surface-strong"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5 text-sm leading-relaxed text-muted-foreground">
          <section className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-sm font-bold text-foreground">Sinal e cancelamento</h3>
            <p className="mt-2">{policyText}</p>
          </section>
          {customText && (
            <section className="rounded-2xl border border-border bg-card p-4">
              <h3 className="text-sm font-bold text-foreground">Politica adicional</h3>
              <p className="mt-2 whitespace-pre-line">{customText}</p>
            </section>
          )}
          <p className="text-xs">
            Ao continuar, aceita que o aceite destas políticas fique registado para efeitos de
            comprovativo da marcação e do pagamento do sinal.
          </p>
        </div>
      </div>
    </div>
  );
}

function PolicyModalPremium({
  studioName,
  policyText,
  customText,
  onClose,
}: {
  studioName: string;
  policyText: string;
  customText: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-hidden rounded-t-3xl border border-border bg-background shadow-2xl sm:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
              Regras da reserva
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight">{studioName}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-surface ring-1 ring-border transition hover:bg-surface-strong"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5 text-sm leading-relaxed text-muted-foreground">
          <section className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-sm font-bold text-foreground">Sinal e cancelamento</h3>
            <p className="mt-2">{policyText}</p>
          </section>
          {customText && (
            <section className="rounded-2xl border border-border bg-card p-4">
              <h3 className="text-sm font-bold text-foreground">Nota do estúdio</h3>
              <p className="mt-2 whitespace-pre-line">{customText}</p>
            </section>
          )}
          <p className="text-xs">
            Ao confirmar, estas regras ficam associadas à sua reserva.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const isMoney = value.includes("€");
  return (
    <div className="flex items-center justify-between bg-card px-4 py-3">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("text-sm font-semibold", isMoney && moneyClass("text-sm"))}>{value}</span>
    </div>
  );
}

/* ---------- Sticky footer ---------- */
function StickyFooter({
  step,
  canContinue,
  submitting,
  total,
  duration,
  proLabel,
  savings,
  onPrimary,
}: {
  step: Step;
  canContinue: boolean;
  submitting: boolean;
  total: number;
  duration: number;
  proLabel: string | null;
  savings: number;
  onPrimary: () => void;
}) {
  const labels: Record<Step, string> = {
    0: "Continuar com este serviço",
    1: "Continuar",
    2: "Continuar",
    3: "Continuar",
    4: submitting ? "A confirmar…" : "Confirmar marcação",
  };
  const disabled = !canContinue || submitting;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4 backdrop-blur-xl">
      <div className="mx-auto max-w-[520px] md:max-w-3xl">
        {total > 0 && (
          <div className="mb-3 flex items-center justify-between px-1">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                Total{" "}
                {savings > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    · poupa {formatMoney(savings, 0)}
                  </span>
                )}
              </p>
              <p className={moneyClass("text-lg")}>{formatMoney(total)}</p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                {duration} min
              </p>
              <p className="text-xs font-medium">{proLabel ?? "—"}</p>
            </div>
          </div>
        )}
        <button
          onClick={onPrimary}
          disabled={disabled}
          className={cn(
            "flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold transition-all active:scale-[0.98]",
            !disabled
              ? "bg-accent text-accent-foreground shadow-lg shadow-black/10"
              : "cursor-not-allowed bg-surface-strong text-muted-foreground",
          )}
        >
          {labels[step]}
          {!disabled && step === 4 && (
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          )}
        </button>
      </div>
    </div>
  );
}

/* ---------- Confirmation ---------- */
function ConfirmationView({
  studioName,
  when,
  clientName,
  pro,
  total,
  savings,
  paymentStatus,
  refundEnabled,
  refundTarget,
  onReset,
}: {
  studioName: string;
  when: string;
  clientName: string;
  pro: string;
  total: number;
  savings: number;
  paymentStatus: ConfirmedPaymentStatus;
  refundEnabled: boolean;
  refundTarget: { appointmentId?: string | null; bookingRequestId?: string | null } | null;
  onReset: () => void;
}) {
  const isPaidOnline = paymentStatus === "paid_online";
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);

  async function sendRefundRequest() {
    if (!refundTarget || refundBusy) return;
    setRefundBusy(true);
    try {
      await submitRefundRequest({
        bookingRequestId: refundTarget.bookingRequestId,
        appointmentId: refundTarget.appointmentId,
        reason: refundReason,
      });
      toast.success("Pedido de reembolso enviado para o estúdio.");
      setRefundOpen(false);
      setRefundReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar o pedido.");
    } finally {
      setRefundBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-center">
      <div className="animate-slide-up flex w-full max-w-[400px] flex-col items-center">
        <div className="relative grid size-20 place-items-center rounded-full bg-accent/10 text-accent">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
          <Check className="relative size-9" strokeWidth={3} />
        </div>
        <p className="mt-6 font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
          Marcação confirmada
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{studioName}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {when} com <span className="font-semibold text-foreground">{pro}</span>
        </p>
        <div className="mt-8 w-full rounded-2xl bg-card p-5 ring-1 ring-border">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">Cliente</span>
            <span className="text-sm font-semibold">{clientName}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">Total</span>
            <span className={moneyClass("text-lg")}>{formatMoney(total)}</span>
          </div>
          {savings > 0 && (
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                Poupança
              </span>
              <span className={moneyClass("text-sm")}>−{formatMoney(savings)}</span>
            </div>
          )}
        </div>
        <div className="mt-6 w-full rounded-2xl bg-muted/50 p-4 text-left ring-1 ring-border">
          <p className="text-sm font-semibold">
            {isPaidOnline ? "Pagamento confirmado." : "Pagamento pendente."}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {isPaidOnline
              ? "O sinal foi pago online e a marcação ficou confirmada no estúdio."
              : "A marcação está confirmada. O pagamento será feito presencialmente no estúdio."}
          </p>
        </div>
        {isPaidOnline && refundEnabled && refundTarget && (
          <div className="mt-3 w-full rounded-2xl bg-card p-4 text-left ring-1 ring-border">
            {!refundOpen ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Pedido de reembolso</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Pode enviar um pedido para análise do estúdio, conforme a política aceite.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRefundOpen(true)}
                  className="h-10 rounded-xl bg-surface px-4 text-xs font-bold text-foreground ring-1 ring-border transition hover:bg-surface-strong"
                >
                  Solicitar reembolso
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Motivo
                  </span>
                  <textarea
                    value={refundReason}
                    onChange={(event) => setRefundReason(event.target.value)}
                    rows={3}
                    placeholder="Explique brevemente o motivo do pedido."
                    className="mt-2 w-full resize-none rounded-xl bg-background px-4 py-3 text-sm ring-1 ring-border placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setRefundOpen(false);
                      setRefundReason("");
                    }}
                    className="h-11 rounded-xl bg-surface text-xs font-bold ring-1 ring-border"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={sendRefundRequest}
                    disabled={refundBusy || refundReason.trim().length < 4}
                    className="h-11 rounded-xl bg-foreground text-xs font-bold text-background transition disabled:opacity-50"
                  >
                    {refundBusy ? "A enviar" : "Enviar pedido"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        <button
          onClick={onReset}
          className="mt-3 h-12 w-full rounded-xl bg-foreground text-sm font-bold text-background"
        >
          Fazer nova marcação
        </button>
      </div>
    </div>
  );
}

/* ---------- Share Sheet (Link + QR + Social) ---------- */
function ShareSheet({
  studioName,
  studioSlug,
  onClose,
}: {
  studioName: string;
  studioSlug: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setUrl(`${window.location.origin}/s/${studioSlug}`);
  }, [studioSlug]);

  const shareText = `Marque online no ${studioName} em segundos:`;
  const enc = encodeURIComponent;
  const links = {
    whatsapp: `https://wa.me/?text=${enc(`${shareText} ${url}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`,
    instagram: `https://www.instagram.com/`, // IG não suporta share direto via web
    twitter: `https://twitter.com/intent/tweet?text=${enc(shareText)}&url=${enc(url)}`,
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const onNativeShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: studioName, text: shareText, url });
      } catch {
        // user dismissed
      }
    } else {
      onCopy();
    }
  };

  const onDownloadQr = () => {
    const canvas = qrRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${studioSlug}-qrcode.png`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in sm:items-center"
      onClick={onClose}
    >
      <div
        className="animate-slide-up w-full max-w-md overflow-hidden rounded-t-3xl bg-background p-5 pb-[max(env(safe-area-inset-bottom),20px)] ring-1 ring-border sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Partilhar estúdio
            </p>
            <h3 className="mt-1 text-lg font-extrabold tracking-tight">{studioName}</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-9 place-items-center rounded-full bg-surface ring-1 ring-border"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* QR Code */}
        <div
          ref={qrRef}
          className="mx-auto flex aspect-square w-48 items-center justify-center rounded-2xl bg-white p-4 ring-1 ring-border"
        >
          <QRCodeCanvas value={url} size={160} level="H" bgColor="#ffffff" fgColor="#1a1a26" />
        </div>

        {/* Link with copy */}
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface p-2 ring-1 ring-border">
          <span className="ml-2 grid size-7 place-items-center rounded-md bg-foreground/10 text-foreground">
            <QrCode className="size-3.5" />
          </span>
          <p className="flex-1 truncate font-mono text-xs">{url}</p>
          <button
            onClick={onCopy}
            className="h-9 rounded-lg bg-foreground px-3 text-[11px] font-bold text-background transition active:scale-95"
          >
            {copied ? "Copiado ✓" : "Copiar"}
          </button>
        </div>

        {/* Social */}
        <div className="mt-4 grid grid-cols-5 gap-2">
          <SocialBtn
            label="WhatsApp"
            href={links.whatsapp}
            color="#25D366"
            icon={<FaWhatsapp className="size-4" />}
          />
          <SocialBtn
            label="Instagram"
            href={links.instagram}
            gradient="bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5]"
            icon={<FaInstagram className="size-4" />}
          />
          <SocialBtn
            label="Facebook"
            href={links.facebook}
            color="#1877F2"
            icon={<FaFacebookF className="size-4" />}
          />
          <SocialBtn
            label="TikTok"
            href="https://www.tiktok.com/"
            color="#000000"
            icon={<FaTiktok className="size-4" />}
          />
          <SocialBtn
            label="X"
            href={links.twitter}
            color="#000000"
            icon={<FaXTwitter className="size-4" />}
          />
        </div>

        {/* Actions */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            onClick={onDownloadQr}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-surface text-xs font-bold ring-1 ring-border transition active:scale-95"
          >
            <Download className="size-3.5" /> QR Code
          </button>
          <button
            onClick={onNativeShare}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground text-xs font-bold text-background transition active:scale-95"
          >
            <Share2 className="size-3.5" /> Partilhar
          </button>
        </div>
      </div>
    </div>
  );
}

function SocialBtn({
  label,
  href,
  color,
  gradient,
  icon,
}: {
  label: string;
  href: string;
  color?: string;
  gradient?: string;
  icon: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center gap-1.5 rounded-xl bg-card p-2.5 ring-1 ring-border transition hover:ring-foreground/30 active:scale-95"
      aria-label={label}
    >
      <span
        className={cn("grid size-9 place-items-center rounded-full text-white", gradient)}
        style={!gradient && color ? { backgroundColor: color } : undefined}
      >
        {icon}
      </span>
      <span className="text-[10px] font-medium text-foreground">{label}</span>
    </a>
  );
}

function formatDate(d: Date) {
  return d.toLocaleDateString("pt-PT", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}
