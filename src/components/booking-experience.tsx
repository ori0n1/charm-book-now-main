import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type TouchEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BookmarkCheck,
  CalendarDays,
  CalendarOff,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  CreditCard,
  Droplets,
  Download,
  ExternalLink,
  Heart,
  Info,
  LogIn,
  MapPin,
  MessageSquare,
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
import { useAuth } from "@/hooks/use-auth";
import { getSegmentConfig, type SegmentLabels } from "@/lib/segments";
import heroImg from "@/assets/studio-hero.jpg";
import { cn } from "@/lib/utils";
import {
  sortAppointmentsChronologically,
} from "@/lib/appointment-ordering";
import { buildPublicAuthCallbackUrl, rememberPublicAuthReturn } from "@/lib/auth-context";
import { createPublicBooking } from "@/lib/booking";
import {
  ensurePublicClientProfile,
  finalizePublicClientBooking,
  getPublicClientArea,
  markAllPublicClientNotificationsRead,
  markPublicClientNotificationRead,
} from "@/lib/public-client.functions";
import {
  toggleStudioFollow,
  getStudioFollowStatus,
  getFollowedStudios,
  type FollowedStudio,
} from "@/lib/studio-follows.functions";
import {
  submitStudioReview,
  getStudioReviews,
  canReviewAppointment,
  type StudioReview,
} from "@/lib/reviews.functions";
import { dispatchRecentStudioAppointmentPushNotification } from "@/lib/notification-dispatcher.server";
import { sendPublicAppointmentConfirmationForAppointment } from "@/lib/whatsapp.functions";
import { savePushSubscription, sendTestPushNotification } from "@/lib/push-subscriptions.functions";
import { requestPushSubscription, shouldRefreshStoredPushSubscription } from "@/lib/pwa-push";
import {
  createGoogleNoncePair,
  getGoogleIdentity,
  loadGoogleIdentityScript,
} from "@/lib/google-id-token";
import { submitRefundRequest } from "@/lib/refunds";
import {
  buildPolicyPlainText,
  getPolicyParts,
  readCancellationNoticeHours,
  readRefundPolicy,
  type PolicyTextParts,
} from "@/lib/policy-text";
import {
  calculateUpsellLine,
  calculateUpsellPricing,
  formatUpsellMoney,
} from "@/lib/upsell-pricing";
import type { AvailableSlot } from "@/lib/availability";
import { PaymentPendingView } from "@/components/payment-pending";
import { CookieBanner } from "@/components/cookie-banner";
import { PublicFooter } from "@/components/public-footer";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ExpandableList } from "@/components/ui/expandable-list";
import { PremiumDatePicker } from "@/components/ui/premium-date-picker";
import {
  InternationalPhoneInput as SharedInternationalPhoneInput,
  isValidInternationalPhone as isValidSharedInternationalPhone,
  normalizeInternationalPhone as normalizeSharedInternationalPhone,
} from "@/components/ui/international-phone-input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Step = 0 | 1 | 2 | 3 | 4;
type ConfirmedPaymentStatus = "paid_online" | "pay_in_studio" | "unknown";

type ClientForm = { name: string; phone: string; email: string; notes: string };
const STORAGE_KEY = "lumiere.booking.draft";
const INCOMPATIBLE_UPSELL_MESSAGE =
  "Este serviço adicional não está disponível com a profissional escolhida. Escolha outra profissional ou remova o serviço.";

type UpsellWithOfferedService = Upsell & { offeredServiceId?: string | null };

const STATIC_UPSELL_SERVICE_ID: Record<string, string> = {
  "u-pedi": "s3",
  "u-brow": "s5",
  "u-brow2": "s5",
  "u-brow3": "s5",
  "u-mani": "s1",
  "u-mask": "s4",
  "u-lash": "s2",
};

function getUpsellOfferedServiceId(upsell: Upsell): string | null {
  const offeredServiceId = (upsell as UpsellWithOfferedService).offeredServiceId;
  if (offeredServiceId && String(offeredServiceId).trim()) return String(offeredServiceId);
  return STATIC_UPSELL_SERVICE_ID[upsell.id] ?? SERVICE_DB_ID[upsell.id.replace(/^u-/, "")] ?? null;
}

function uniqueServiceIds(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id && id.trim()))));
}

function getRequiredServiceIds(service: Service | null, selectedUpsells: Upsell[]) {
  return uniqueServiceIds([
    service?.id,
    ...selectedUpsells.map((upsell) => getUpsellOfferedServiceId(upsell)),
  ]);
}

function professionalCanPerformServices(professional: Professional, serviceIds: string[]) {
  if (serviceIds.length === 0) return true;
  // Empty serviceIds = staff not yet linked -> treat as eligible for all services.
  if (professional.serviceIds.length === 0) return true;
  return serviceIds.every((serviceId) => professional.serviceIds.includes(serviceId));
}

function getDraftStorageKey(slug?: string | null) {
  return `bellza.booking.draft.${slug || "studio"}`;
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PublicClientAreaPayload = {
  profile: {
    name: string;
    phone: string;
    email: string;
    avatarUrl?: string | null;
    dateOfBirth?: string | null;
    contactConsentAt?: string | null;
    contactConsentVersion?: string | null;
    policyAcceptedAt?: string | null;
    policyVersion?: string | null;
    totalVisits: number;
    totalSpent: number;
  };
  appointments: Array<{
    id: string;
    token: string | null;
    startsAt: string;
    endsAt: string | null;
    status: string;
    totalPrice: number;
    paidAmount: number;
    pendingAmount: number;
    staffName: string;
    services: Array<{ name: string; price: number; durationMin: number }>;
    canOpen: boolean;
    isUpcoming: boolean;
  }>;
  pendingPayments: Array<{
    appointmentId: string | null;
    bookingRequestId: string | null;
    amount: number;
    method: string;
    status: string;
  }>;
  notifications?: Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    status: string;
    createdAt: string;
  }>;
  totals: {
    paid: number;
    deposits: number;
    pending: number;
  };
  loyalty?: {
    referralCode: string;
    referralUrl: string;
    totalStamps: number;
    progressStamps: number;
    nextRewardAt: number;
    completedReferrals: number;
    levelName: string;
    availableRewards: Array<{
      id: string;
      type: "percent" | "fixed";
      value: number;
      stampsRequired: number;
      createdAt: string;
    }>;
    settings: {
      enabled: boolean;
      bookingStampsEnabled: boolean;
      stampsPerCompletedBooking: number;
      referralStampsEnabled: boolean;
      stampsPerCompletedReferral: number;
      stampsRequiredForReward: number;
      rewardType: "percent" | "fixed";
      rewardValue: number;
      levels: Array<{ name: string; threshold: number }>;
    };
  } | null;
  reviewedAppointmentIds?: string[];
};

type PublicClientNotification = NonNullable<PublicClientAreaPayload["notifications"]>[number];

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

function getPublicCheckoutPaymentMethods(
  methods?: string[] | null,
  options?: { connectReady?: boolean; mbWayReady?: boolean },
) {
  const configured = new Set(methods?.length ? methods : ["card", "mb_way"]);
  const connectReady = options?.connectReady !== false;
  const mbWayReady = options?.mbWayReady === true;
  return (["card", "mb_way"] as const).filter((method) => {
    if (!configured.has(method)) return false;
    if (!connectReady) return false;
    if (method === "mb_way" && !mbWayReady) return false;
    return true;
  });
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
  return getPolicyParts(
    readRefundPolicy(studio),
    readCancellationNoticeHours(studio),
    studio.payment_policy === "pre_payment" ? (studio.deposit_percent ?? 100) : 0,
  );
}

function buildPublicPolicyText(studio: PublicPolicyStudio) {
  return buildPolicyPlainText(readRefundPolicy(studio), readCancellationNoticeHours(studio), {
    withDepositIntro: studio.payment_policy === "pre_payment",
    depositPercent: studio.payment_policy === "pre_payment" ? (studio.deposit_percent ?? 100) : 0,
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
  const { user, loading: authLoading } = useAuth();
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
  const sendAppointmentConfirmation = useServerFn(sendPublicAppointmentConfirmationForAppointment);
  const dispatchStudioAppointmentPush = useServerFn(dispatchRecentStudioAppointmentPushNotification);
  const loadPublicClientArea = useServerFn(getPublicClientArea);
  const finalizeClientBooking = useServerFn(finalizePublicClientBooking);
  const savePublicClientProfile = useServerFn(ensurePublicClientProfile);
  const markAllClientNotificationsRead = useServerFn(markAllPublicClientNotificationsRead);
  const markClientNotificationRead = useServerFn(markPublicClientNotificationRead);
  const persistPushSubscription = useServerFn(savePushSubscription);
  const sendTestPush = useServerFn(sendTestPushNotification);
  const heroTouchStartX = useRef<number | null>(null);
  const heroControlsTimer = useRef<number | null>(null);
  const stepSwipeStart = useRef<{ x: number; y: number; at: number } | null>(null);
  const [clientArea, setClientArea] = useState<PublicClientAreaPayload | null>(null);
  const [clientAreaLoading, setClientAreaLoading] = useState(false);
  const [clientProfileSaving, setClientProfileSaving] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const customerReferralCode = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return (params.get("ref") || params.get("indicacao") || "").trim();
  }, []);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [pwaInstalled, setPwaInstalled] = useState(false);
  const [notificationsConsent, setNotificationsConsent] = useState<"unknown" | "granted" | "denied">(
    "unknown",
  );
  const [showEntryBanner, setShowEntryBanner] = useState(false);
  const [accountDrawerSignal, setAccountDrawerSignal] = useState(0);
  const [followStatus, setFollowStatus] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followedStudios, setFollowedStudios] = useState<FollowedStudio[]>([]);
  const [studioReviews, setStudioReviews] = useState<StudioReview[]>([]);
  const showNotificationEntryAction = false as boolean;
  const fetchFollowStatus = useServerFn(getStudioFollowStatus);
  const fetchFollowedStudios = useServerFn(getFollowedStudios);
  const toggleFollow = useServerFn(toggleStudioFollow);
  const fetchReviews = useServerFn(getStudioReviews);
  const submitReview = useServerFn(submitStudioReview);
  const checkCanReview = useServerFn(canReviewAppointment);

  // Auto-save client form across PWA restarts.
  useEffect(() => {
    try {
      const saved =
        localStorage.getItem(getDraftStorageKey(studio.slug)) ?? localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<ClientForm>;
        setClient((c) => ({
          ...c,
          ...parsed,
          phone: parsed.phone ? normalizeSharedInternationalPhone(parsed.phone) : c.phone,
        }));
      }
    } catch {
      /* noop */
    }
  }, [studio.slug]);
  useEffect(() => {
    try {
      localStorage.setItem(getDraftStorageKey(studio.slug), JSON.stringify(client));
    } catch {
      /* noop */
    }
  }, [client, studio.slug]);

  useEffect(() => {
    if (!user?.id) {
      setClientArea(null);
      return;
    }
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const inferredName = String(metadata.full_name ?? metadata.name ?? "").trim();
    const inferredPhone = normalizeSharedInternationalPhone(String(metadata.phone ?? metadata.phone_number ?? ""));
    const authEmail = String(user.email ?? "").trim();
    setClient((current) => ({
      ...current,
      name:
        current.email && authEmail && current.email.toLowerCase() !== authEmail.toLowerCase()
          ? inferredName || authEmail.split("@")[0] || current.name
          : current.name || inferredName || authEmail.split("@")[0],
      phone:
        current.email && authEmail && current.email.toLowerCase() !== authEmail.toLowerCase()
          ? inferredPhone
          : current.phone || inferredPhone,
      email: authEmail,
    }));
  }, [user?.email, user?.id, user?.user_metadata]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const updateInstalledState = () => {
      const standalone =
        ("standalone" in navigator && (navigator as any).standalone === true) ||
        window.matchMedia("(display-mode: standalone)").matches ||
        window.matchMedia("(display-mode: fullscreen)").matches;
      setPwaInstalled(standalone);
    };
    const handleInstalled = () => {
      setPwaInstalled(true);
      setInstallDismissed(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", handleInstalled);
    updateInstalledState();
    setNotificationsConsent(readNotificationPermission());
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  // Entry banner — show after 1.8 s on first visit (localStorage-gated per studio)
  useEffect(() => {
    const shouldPrioritizeNotifications = pwaInstalled && notificationsConsent !== "granted";
    try {
      const key = `bellza_banner_${studio.slug}`;
      if (localStorage.getItem(key) && !shouldPrioritizeNotifications) return;
    } catch { /* noop */ }
    const t = window.setTimeout(() => setShowEntryBanner(true), 1800);
    return () => window.clearTimeout(t);
  }, [notificationsConsent, pwaInstalled, studio.slug]);

  const hasSensitiveNotes = client.notes.trim().length > 0;
  const currentPolicyVersion = getPolicyVersion(studio);
  const hasSavedContactConsent = Boolean(clientArea?.profile?.contactConsentAt);
  const hasSavedPolicyAcceptance =
    Boolean(clientArea?.profile?.policyAcceptedAt) &&
    clientArea?.profile?.policyVersion === currentPolicyVersion;
  const clientValid =
    client.name.trim().length >= 2 &&
    isValidSharedInternationalPhone(client.phone) &&
    (client.email === "" || /\S+@\S+\.\S+/.test(client.email)) &&
    (contactConsent || hasSavedContactConsent) &&
    (policyAccepted || hasSavedPolicyAcceptance) &&
    (!hasSensitiveNotes || sensitiveNotesConsent);

  async function syncPublicClientProfile(options?: {
    phone?: string;
    dateOfBirth?: string | null;
    contactConsent?: boolean;
    policyAccepted?: boolean;
    showToast?: boolean;
    refreshArea?: boolean;
  }) {
    if (!user?.id || !user.email) return null;
    const hasManualPhone = Object.prototype.hasOwnProperty.call(options ?? {}, "phone");
    const savedProfilePhone = normalizeSharedInternationalPhone(clientArea?.profile?.phone ?? "");
    const typedPhone = normalizeSharedInternationalPhone(client.phone);
    const shouldSaveTypedPhone =
      !isValidSharedInternationalPhone(savedProfilePhone) && isValidSharedInternationalPhone(typedPhone);
    const nextPhone = normalizeSharedInternationalPhone(
      hasManualPhone ? options?.phone : savedProfilePhone || (shouldSaveTypedPhone ? typedPhone : ""),
    );
    let payload: unknown;
    try {
      const hasManualDate = Object.prototype.hasOwnProperty.call(options ?? {}, "dateOfBirth");
      const dateOfBirth = hasManualDate ? options?.dateOfBirth : await getGoogleDateOfBirth(user);
      payload = await savePublicClientProfile({
        data: {
          studioId: studio.id,
          name: clientArea?.profile?.name || client.name || getGoogleDisplayName(user) || user.email.split("@")[0],
          ...(nextPhone ? { phone: nextPhone } : {}),
          email: user.email,
          avatarUrl: getGoogleAvatarUrl(user),
          ...(typeof dateOfBirth === "undefined" || dateOfBirth === null ? {} : { dateOfBirth }),
          ...(options?.contactConsent ? { contactConsent: true } : {}),
          ...(options?.policyAccepted ? { policyAccepted: true, policyVersion: currentPolicyVersion } : {}),
        },
      });
    } catch (error) {
      throw new Error(explainPublicProfileError(error));
    }
    const profile = (payload as any).profile;
    const savedDateOfBirth =
      typeof profile?.dateOfBirth === "string"
        ? profile.dateOfBirth
        : Object.prototype.hasOwnProperty.call(options ?? {}, "dateOfBirth")
          ? options?.dateOfBirth ?? null
          : clientArea?.profile?.dateOfBirth ?? null;
    setClient((current) => ({
      ...current,
      name: profile?.name || current.name,
      phone: normalizeSharedInternationalPhone(profile?.phone || nextPhone || current.phone),
      email: profile?.email || current.email || user.email || "",
    }));
    setClientArea((current) => {
      if (!current) return current;
      return {
        ...current,
        profile: {
          ...current.profile,
          name: profile?.name || current.profile.name,
          phone: normalizeSharedInternationalPhone(profile?.phone || current.profile.phone),
          email: profile?.email || current.profile.email,
          avatarUrl: profile?.avatarUrl ?? current.profile.avatarUrl,
          dateOfBirth: savedDateOfBirth,
          contactConsentAt: profile?.contactConsentAt ?? current.profile.contactConsentAt,
          contactConsentVersion: profile?.contactConsentVersion ?? current.profile.contactConsentVersion,
          policyAcceptedAt: profile?.policyAcceptedAt ?? current.profile.policyAcceptedAt,
          policyVersion: profile?.policyVersion ?? current.profile.policyVersion,
        },
      };
    });
    if (options?.refreshArea !== false) {
      try {
        const area = (await loadPublicClientArea({
          data: { studioId: studio.id },
        })) as PublicClientAreaPayload;
        const savedPhone = normalizeSharedInternationalPhone(profile?.phone || nextPhone || area.profile.phone || "");
        setClientArea({
          ...area,
          profile: {
            ...area.profile,
            phone: savedPhone || area.profile.phone,
            dateOfBirth: savedDateOfBirth ?? area.profile.dateOfBirth ?? null,
          },
        });
      } catch (error) {
        console.error("[public-client] client area refresh failed", error);
      }
    }
    if (options?.showToast) toast.success("Dados guardados para as próximas marcações.");
    return profile;
  }

  async function refreshClientAreaNow() {
    if (!user?.id) return null;
    const area = (await loadPublicClientArea({
      data: { studioId: studio.id },
    })) as PublicClientAreaPayload;
    setClientArea(area);
    return area;
  }

  async function finalizeClientBookingState(target: {
    appointmentId?: string | null;
    bookingRequestId?: string | null;
  } | null) {
    if (!user?.id || !target) return;
    try {
      await finalizeClientBooking({
        data: {
          studioId: studio.id,
          appointmentId: target.appointmentId ?? null,
          bookingRequestId: target.bookingRequestId ?? null,
        },
      });
      await refreshClientAreaNow();
    } catch (error) {
      console.warn("[public-client] booking finalization failed", error);
    }
  }

  function dispatchPublicBookingSideEffects(appointmentId?: string | null) {
    if (!appointmentId) return;
    void sendAppointmentConfirmation({
      data: { studioId: studio.id, appointmentId },
    }).catch((error) => {
      console.error("[public-booking] whatsapp confirmation dispatch failed", {
        studioId: studio.id,
        appointmentId,
        error,
      });
    });
    void dispatchStudioAppointmentPush({
      data: { studioId: studio.id, appointmentId },
    }).catch((error) => {
      console.error("[public-booking] studio push dispatch failed", {
        studioId: studio.id,
        appointmentId,
        error,
      });
    });
  }

  useEffect(() => {
    if (!user?.id || !clientArea?.profile) return;
    const profilePhone = normalizeSharedInternationalPhone(clientArea.profile.phone ?? "");
    setClient((current) => ({
      ...current,
      name: clientArea.profile.name || current.name,
      phone: profilePhone || current.phone,
      email: clientArea.profile.email || user.email || current.email,
    }));
  }, [
    clientArea?.profile?.email,
    clientArea?.profile?.name,
    clientArea?.profile?.phone,
    user?.email,
    user?.id,
  ]);

  useEffect(() => {
    if (hasSavedContactConsent) setContactConsent(true);
    if (hasSavedPolicyAcceptance) setPolicyAccepted(true);
  }, [hasSavedContactConsent, hasSavedPolicyAcceptance]);

  useEffect(() => {
    if (!user?.id || !user.email) return;
    let cancelled = false;
    setClientAreaLoading(true);
    syncPublicClientProfile()
      .catch((error) => {
        console.error("[public-client] profile sync failed", error);
      })
      .finally(() => {
        if (!cancelled) setClientAreaLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Keep this scoped to the authenticated identity/studio; manual phone edits are saved explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.email, studio.id]);

  useEffect(() => {
    if (!user?.id || !studio.id) return;
    let cancelled = false;
    let refreshTimer: number | null = null;
    const recipient = `user:${user.id}`;
    const refreshClientArea = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        if (cancelled) return;
        loadPublicClientArea({ data: { studioId: studio.id } })
          .then((area) => {
            if (!cancelled) setClientArea(area as PublicClientAreaPayload);
          })
          .catch((error) => console.warn("public_client_notifications_refresh_failed", error));
      }, 250);
    };
    const channel = supabase
      .channel(`public-client-notifications:${studio.id}:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `studio_id=eq.${studio.id}` },
        () => refreshClientArea(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_intents", filter: `studio_id=eq.${studio.id}` },
        () => refreshClientArea(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications_log", filter: `studio_id=eq.${studio.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { recipient?: string } | null;
          if (row?.recipient !== recipient) return;
          refreshClientArea();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [loadPublicClientArea, studio.id, user?.id]);

  useEffect(() => {
    if (!user?.id || !studio.id) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    let cancelled = false;
    requestPushSubscription({ forceRenew: shouldRefreshStoredPushSubscription(`client:${studio.id}`) })
      .then((result) => {
        if (cancelled || result.permission !== "granted" || !result.subscription) return;
        setNotificationsConsent("granted");
        return persistPushSubscription({
          data: {
            audience: "client",
            studioId: studio.id,
            subscription: result.subscription,
          },
        });
      })
      .catch((error) => console.warn("client_push_auto_register_failed", error));
    return () => {
      cancelled = true;
    };
  }, [persistPushSubscription, studio.id, user?.id]);

  useEffect(() => {
    if (!user?.id || !studio.id) return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "BELLZA_PUSH_SUBSCRIPTION_CHANGED") return;
      void requestPushSubscription({ forceRenew: true })
        .then((result) => {
          if (result.permission !== "granted" || !result.subscription) return;
          setNotificationsConsent("granted");
          return persistPushSubscription({
            data: {
              audience: "client",
              studioId: studio.id,
              subscription: result.subscription,
            },
          });
        })
        .catch((error) => console.warn("client_push_subscription_refresh_failed", error));
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [persistPushSubscription, studio.id, user?.id]);

  // Load follow status and followed studios when user authenticates
  useEffect(() => {
    if (!user?.id || !studio.id) {
      setFollowStatus(false);
      setFollowedStudios([]);
      return;
    }
    let cancelled = false;
    fetchFollowStatus({ data: { studioId: studio.id } })
      .then((res: any) => { if (!cancelled) setFollowStatus(Boolean(res?.following)); })
      .catch(() => {});
    fetchFollowedStudios({})
      .then((res: any) => { if (!cancelled) setFollowedStudios(Array.isArray(res?.studios) ? res.studios : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, studio.id]);

  // Load public reviews for this studio
  useEffect(() => {
    if (!studio.id) return;
    let cancelled = false;
    fetchReviews({ data: { studioId: studio.id, limit: 20 } })
      .then((res: any) => { if (!cancelled) setStudioReviews(Array.isArray(res?.reviews) ? res.reviews : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.id]);

  async function handleFollowToggle() {
    if (!user?.id) {
      setAccountDrawerSignal((n) => n + 1);
      toast.message("Entre na sua conta para seguir este estúdio.");
      return;
    }
    setFollowLoading(true);
    try {
      const res = (await toggleFollow({ data: { studioId: studio.id } })) as any;
      const next = Boolean(res?.following);
      setFollowStatus(next);
      if (next) {
        setFollowedStudios((prev) =>
          prev.some((s) => s.id === studio.id)
            ? prev
            : [
                {
                  id: studio.id,
                  name: studio.name,
                  slug: studio.slug,
                  logo_url: studio.logo_url ?? null,
                  rating: Number(studio.rating) || null,
                  reviews_count: reviewsCount || null,
                  location: studio.location ?? null,
                },
                ...prev,
              ],
        );
        toast.success("Estúdio adicionado aos seguidos.");
      } else {
        setFollowedStudios((prev) => prev.filter((s) => s.id !== studio.id));
        toast.message("Estúdio removido dos seguidos.");
      }
    } catch {
      toast.error("Não foi possível atualizar. Tente novamente.");
    } finally {
      setFollowLoading(false);
    }
  }

  // Helpers: resolve IDs to real DB UUIDs (live data has UUIDs; static mock falls back to map)
  const resolveServiceId = (id: string) => SERVICE_DB_ID[id] ?? id;
  const resolveStaffId = (id: string) => STAFF_DB_ID[id] ?? id;

  async function submitBooking() {
    if (!service || !date || !time || !professional) return;
    if (!clientValid) {
      if (client.name.trim().length < 2) toast.error("Confirme o seu nome para continuar.");
      else if (!isValidSharedInternationalPhone(client.phone))
        toast.error("Indique um telemóvel válido para confirmar a reserva.");
      else if (client.email && !/\S+@\S+\.\S+/.test(client.email))
        toast.error("Confirme o e-mail ou deixe o campo vazio.");
      else if (!contactConsent || !policyAccepted)
        toast.error("Aceite os consentimentos obrigatórios para concluir a reserva.");
      else toast.error("Confirme os dados da reserva antes de continuar.");
      return;
    }

    const staffDbId =
      selectedSlot?.staff_id ??
      (professional !== "any" && professional
        ? resolveStaffId((professional as Professional).id)
        : null);
    if (!staffDbId) {
      toast.error("Escolha um horário disponível para selecionar a profissional.");
      return;
    }
    if (
      professional &&
      professional !== "any" &&
      !professionalCanPerformServices(professional as Professional, selectedServiceIds)
    ) {
      toast.error(INCOMPATIBLE_UPSELL_MESSAGE);
      setStep(2);
      return;
    }
    const serviceDbIds = [
      resolveServiceId(service.id),
      ...(addedUpsells
        .map((u) => {
          const offeredServiceId = getUpsellOfferedServiceId(u);
          return offeredServiceId ? resolveServiceId(offeredServiceId) : null;
        })
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
      if (user?.id) {
        await syncPublicClientProfile({
          phone: client.phone,
          contactConsent: contactConsent || hasSavedContactConsent,
          policyAccepted: policyAccepted || hasSavedPolicyAcceptance,
          refreshArea: false,
        });
      }
      const result = await createPublicBooking({
        studioSlug: studio.slug,
        staffDbId,
        startsAt,
        serviceDbIds,
        clientName: client.name.trim(),
        clientPhone: normalizeSharedInternationalPhone(client.phone),
        clientEmail: client.email.trim() || undefined,
        notes: client.notes.trim() || undefined,
        customerReferralCode: customerReferralCode || undefined,
        policyAcceptance: {
          studioId: studio.id,
          policyVersion: getPolicyVersion(studio),
          cancellationNoticeHours: getCancellationNoticeHours(studio),
          afterDeadlinePolicy: getAfterDeadlinePolicy(studio),
        },
      });
      try {
        localStorage.removeItem(getDraftStorageKey(studio.slug));
        localStorage.removeItem(STORAGE_KEY);
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
        dispatchPublicBookingSideEffects(result.appointment_id);
        await finalizeClientBookingState({
          appointmentId: result.appointment_id,
          bookingRequestId: result.booking_request_id,
        });
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
  const bookingCategories = useMemo(
    () => publicCategories,
    [publicCategories],
  );
  const activeCategoryId = bookingCategories.some((category) => category.id === categoryId)
    ? categoryId
    : bookingCategories[0]?.id;
  const filteredServices = useMemo(
    () => (activeCategoryId ? services.filter((service) => service.category === activeCategoryId) : []),
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

  const liveUpsells = service ? live.upsellsByServiceId[service.id] : undefined;
  const upsells: Upsell[] = service
    ? live.ready
      ? liveUpsells ?? []
      : []
    : [];
  const rawSelectedUpsells = useMemo(
    () => upsells.filter((upsell) => extras[upsell.id]),
    [extras, upsells],
  );
  const selectedServiceIds = useMemo(
    () => getRequiredServiceIds(service, rawSelectedUpsells),
    [service, rawSelectedUpsells],
  );

  const eligiblePros = useMemo(() => {
    if (!service) return professionals;
    return professionals.filter(
      // Empty serviceIds = staff not yet linked → treat as eligible for all services
      (p) => professionalCanPerformServices(p, selectedServiceIds.length > 0 ? selectedServiceIds : [service.id]),
    );
  }, [service, professionals, selectedServiceIds]);

  const eligibleDbStaffIds = useMemo(
    () => eligiblePros.map((p) => resolveStaffId(p.id)),
    [eligiblePros],
  );
  const selectedSlotProfessional = useMemo(() => {
    if (!selectedSlot?.staff_id) return null;
    return professionals.find((p) => resolveStaffId(p.id) === selectedSlot.staff_id) ?? null;
  }, [professionals, selectedSlot?.staff_id]);

  const compatibleUpsells = useMemo(() => {
    if (!service) return [];
    const selectedPro =
      professional && professional !== "any" ? (professional as Professional) : selectedSlotProfessional;
    return upsells.filter((upsell) => {
      const line = calculateUpsellLine(upsell);
      const offeredServiceId = getUpsellOfferedServiceId(upsell);
      if (
        upsell.id === service.id ||
        !offeredServiceId ||
        offeredServiceId === service.id ||
        upsell.name.trim().length === 0 ||
        line.originalPrice <= 0 ||
        line.finalPrice < 0
      ) {
        return false;
      }
      const requiredIds = uniqueServiceIds([service.id, offeredServiceId]);
      if (selectedPro) return professionalCanPerformServices(selectedPro, requiredIds);
      return professionals.some((p) => professionalCanPerformServices(p, requiredIds));
    });
  }, [service, upsells, professional, professionals, selectedSlotProfessional]);
  const addedUpsells = useMemo(
    () => compatibleUpsells.filter((u) => extras[u.id]),
    [compatibleUpsells, extras],
  );
  const addedUpsellsPricing = useMemo(() => calculateUpsellPricing(addedUpsells), [addedUpsells]);

  useEffect(() => {
    const compatibleIds = new Set(compatibleUpsells.map((upsell) => upsell.id));
    setExtras((current) => {
      let changed = false;
      const next = { ...current };
      Object.keys(next).forEach((id) => {
        if (next[id] && !compatibleIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [compatibleUpsells]);

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

  const upsellsTotal = addedUpsellsPricing.finalTotal;
  const upsellsDuration = addedUpsells.reduce((sum, u) => sum + u.durationMin, 0);
  const upsellsSavings = addedUpsellsPricing.savingsTotal;

  const total = (service?.price ?? 0) + upsellsTotal;
  const totalDuration = (service?.durationMin ?? 0) + upsellsDuration;

  const handleToggleExtra = async (id: string) => {
    const isSelected = Boolean(extras[id]);
    const upsell = compatibleUpsells.find((item) => item.id === id);
    if (!isSelected && !upsell) {
      toast.error(INCOMPATIBLE_UPSELL_MESSAGE);
      return;
    }
    if (!isSelected && service && upsell) {
      const slotProfessional =
        selectedSlotProfessional ??
        (professional && professional !== "any" ? (professional as Professional) : null);
      const requiredIds = uniqueServiceIds([service.id, getUpsellOfferedServiceId(upsell)]);
      if (slotProfessional && !professionalCanPerformServices(slotProfessional, requiredIds)) {
        toast.error(INCOMPATIBLE_UPSELL_MESSAGE);
        return;
      }
    }
    setExtras((current) => ({ ...current, [id]: !current[id] }));

    if (!isSelected && service && upsell && date && selectedSlot?.staff_id) {
      const nextDuration = service.durationMin + upsellsDuration + upsell.durationMin;
      const slotProfessional =
        selectedSlotProfessional ??
        (professional && professional !== "any" ? (professional as Professional) : null);
      const minBookingNoticeMin =
        slotProfessional?.currentStatus === "online" ? 0 : (studio.min_booking_notice_min ?? 30);
      import("@/lib/availability")
        .then(({ fetchAvailableSlots }) =>
          fetchAvailableSlots({
            studioSlug: studio.slug,
            staffId: selectedSlot.staff_id,
            date,
            durationMin: nextDuration,
            minBookingNoticeMin,
            studioTimezone: studio.timezone,
          }),
        )
        .then((slots) => {
          if (slots.some((slot) => slot.slot_start === selectedSlot.slot_start)) return;
          const replacement =
            slots.find((slot) => slot.slot_start >= selectedSlot.slot_start) ?? slots[0] ?? null;
          if (!replacement) return;
          setSelectedSlot(replacement);
          setTime(replacement.slot_label);
        })
        .catch((error) => {
          console.warn("[public-booking] upsell slot refresh skipped", {
            studioSlug: studio.slug,
            staffId: selectedSlot.staff_id,
            durationMin: nextDuration,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  };

  const proLabel =
    professional === "any"
      ? selectedSlot
        ? (professionals.find((p) => resolveStaffId(p.id) === selectedSlot.staff_id)?.name ??
          `${segment.labels.professional} disponível`)
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

  // Dynamic favicon + PWA manifest: inject studio logo as page icon and update manifest
  useEffect(() => {
    const setLink = (rel: string, href: string) => {
      let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!el) {
        el = document.createElement("link");
        el.rel = rel;
        document.head.appendChild(el);
      }
      el.href = href;
    };
    const publicIconSrc = logoSrc ?? "/pwa-icon.svg";
    const visualVersion = encodeURIComponent(studio.updated_at ?? "");
    setLink("icon", publicIconSrc);
    setLink("apple-touch-icon", publicIconSrc);
    setLink(
      "manifest",
      `/api/public/studio-manifest/${studio.slug}${visualVersion ? `?v=${visualVersion}` : ""}`,
    );

    const storageKey = `bellza:pwa-visual-version:${studio.slug}`;
    const previousVersion = window.localStorage.getItem(storageKey);
    if (studio.updated_at && previousVersion !== studio.updated_at) {
      window.localStorage.setItem(storageKey, studio.updated_at);
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.ready
          .then((registration) => {
            registration.active?.postMessage({
              type: "BELLZA_STUDIO_VISUAL_VERSION",
              slug: studio.slug,
              version: studio.updated_at,
            });
            return registration.update();
          })
          .catch(() => undefined);
      }
    }
  }, [logoSrc, studio.slug, studio.updated_at]);

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

  const goNext = () =>
    setStep((s) => {
      if (s === 2) return 4;
      if (s === 3) return 4;
      return Math.min(s + 1, 4) as Step;
    });
  const goBack = () =>
    setStep((s) => {
      // Extras live inside confirmation now; go back from review to schedule.
      if (s === 4) return 2;
      // Skip professional step (1) if only 1 eligible pro (was auto-selected)
      if (s === 2) return 0;
      return Math.max(s - 1, 0) as Step;
    });

  const handleStepTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (step <= 0 || event.touches.length !== 1) return;
    const touch = event.touches[0];
    stepSwipeStart.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  };

  const handleStepTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = stepSwipeStart.current;
    stepSwipeStart.current = null;
    if (!start || step <= 0) return;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Date.now() - start.at;
    const isBackSwipe =
      dx > 78 && Math.abs(dx) > Math.abs(dy) * 1.45 && Math.abs(dy) < 92 && elapsed < 900;
    if (isBackSwipe) goBack();
  };

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
          acceptedMethods={getPublicCheckoutPaymentMethods(studio.accepted_payment_methods as string[] | undefined, {
            connectReady: Boolean(studio.stripe_connect_charges_enabled && studio.stripe_connect_onboarding_completed),
            mbWayReady: Boolean(studio.stripe_connect_mb_way_payments_enabled),
          })}
          totalPrice={total}
          reservationSummary={{
            service: service?.name ?? "Serviço",
            professional: proLabel,
            date: date ? formatDate(date) : "Data selecionada",
            time: time ?? "Hora selecionada",
            clientName: client.name.trim() || "Cliente",
            clientPhone: client.phone.trim() || "Telefone",
            depositLabel: (() => {
              if (studio.payment_policy !== "pre_payment") return "Pago no estúdio";
              const pct = Number(studio.deposit_percent ?? 100);
              const amt = formatMoney(Math.round(total * pct) / 100);
              return pct >= 100 ? `${amt} — Pagamento integral` : `${amt} (${pct}% de sinal)`;
            })(),
          }}
          policySummary={buildPublicPolicyText(studio)}
          onConfirmed={async () => {
            const target = pendingPayment;
            await finalizeClientBookingState(target);
            setConfirmedTarget(target);
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
          setClient((current) => ({ ...current, notes: "" }));
          setSensitiveNotesConsent(false);
          setContactConsent(hasSavedContactConsent);
          setPolicyAccepted(hasSavedPolicyAcceptance);
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

  function handleDismissEntryBanner() {
    setShowEntryBanner(false);
    try { localStorage.setItem(`bellza_banner_${studio.slug}`, "1"); } catch { /* noop */ }
  }

  async function handleInstallApp() {
    if (!installPrompt) {
      setInstallDismissed(true);
      toast.message("Pode adicionar esta página ao ecrã inicial pelo menu do navegador.");
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice?.catch(() => null);
    if (choice?.outcome === "accepted") toast.success("Página adicionada ao ecrã inicial.");
    setInstallPrompt(null);
    setInstallDismissed(true);
  }

  async function handleNotificationConsent() {
    // iOS Safari in browser mode: Notification API is only available inside a
    // PWA (home screen). Guide the user to install first instead of showing a
    // generic "not supported" error.
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      ("standalone" in navigator && (navigator as any).standalone === true) ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (!("Notification" in window)) {
      if (isIos && !isStandalone) {
        toast.message(
          "No iOS, instale o app no ecrã inicial primeiro (partilhar → Adicionar ao ecrã inicial), depois ative as notificações.",
        );
      } else {
        toast.message(
          "As notificações não estão disponíveis neste navegador. Tente no Chrome ou Safari.",
        );
      }
      return;
    }

    // Already denied — guide to browser settings
    if (Notification.permission === "denied") {
      toast.message("Notificações bloqueadas. Permite-as nas definições do teu navegador.");
      setNotificationsConsent("denied");
      return;
    }

    try {
      const result = await requestPushSubscription();
      const permission = result.permission;
      if (permission === "missing_vapid_key") {
        toast.message("Não foi possível ativar notificações agora. Tente novamente em instantes.");
        setNotificationsConsent("unknown");
        return;
      }
      if (permission === "unsupported") {
        toast.message("As notificações push não estão disponíveis neste navegador.");
        setNotificationsConsent("unknown");
        return;
      }
      if (permission === "insecure_context") {
        toast.message("As notificações push exigem HTTPS. Abra pelo domínio oficial da Bellza.");
        setNotificationsConsent("unknown");
        return;
      }
      if (permission === "push_unsupported") {
        toast.message("Este navegador não suporta push neste modo. No iPhone, use o PWA instalado.");
        setNotificationsConsent("unknown");
        return;
      }
      setNotificationsConsent(permission === "default" ? "unknown" : permission);
      if (permission === "granted") {
        if (result.subscription && user?.id) {
          await persistPushSubscription({
            data: {
              audience: "client",
              studioId: studio.id,
              subscription: result.subscription,
            },
          });
          void sendTestPush({ data: { audience: "client", studioId: studio.id } });
        }
        toast.success("Notificações ativadas! Você receberá avisos importantes do app do estúdio.");
      } else {
        toast.message("Você pode ativar notificações mais tarde nas definições do navegador.");
      }
    } catch {
      toast.message("Não foi possível pedir permissão. Tenta novamente.");
    }
  }

  return (
    <div className="public-booking flex min-h-screen flex-col bg-background" style={brandStyle}>
      <div className="mx-auto w-full max-w-[560px] flex-1 pb-4 md:max-w-6xl md:px-6 md:pb-6">
        {/* Hero */}
        <header className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden bg-black md:left-auto md:w-auto md:translate-x-0 md:bg-transparent md:pt-6">
          <div
            className="group relative isolate h-[18.5rem] w-screen touch-pan-y overflow-hidden rounded-b-[1.5rem] bg-black shadow-[0_18px_54px_rgba(0,0,0,0.18)] [backface-visibility:hidden] [clip-path:inset(0_round_0_0_1.5rem_1.5rem)] [transform:translateZ(0)] md:h-[34rem] md:w-full md:rounded-[2.25rem] md:[clip-path:inset(0_round_2.25rem)] md:shadow-[0_32px_90px_rgba(0,0,0,0.24)] md:ring-1 md:ring-white/10"
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
            <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.85rem)] md:px-7 md:pt-7">
              {step > 0 ? (
                <button
                  onClick={goBack}
                  className="grid size-10 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/20 active:scale-95 md:size-11"
                  aria-label="Voltar"
                >
                  <ArrowLeft className="size-4" />
                </button>
              ) : (
                <span className="max-w-[52vw] rounded-full bg-white/14 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/85 ring-1 ring-white/18 backdrop-blur-md md:max-w-none md:px-4 md:py-2.5 md:tracking-[0.22em]">
                  {studioTagline || "App oficial do estúdio"}
                </span>
              )}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleFollowToggle}
                  disabled={followLoading}
                  aria-label={followStatus ? "Deixar de seguir estúdio" : "Seguir estúdio"}
                  className={cn(
                    "grid size-10 place-items-center rounded-full ring-1 backdrop-blur-md transition hover:bg-white/20 active:scale-95 md:size-12 disabled:opacity-60",
                    followStatus
                      ? "bg-accent/90 text-white ring-accent/50"
                      : "bg-white/15 text-white ring-white/20",
                  )}
                >
                  <Heart className={cn("size-4", followStatus && "fill-current")} />
                </button>
                {user?.id && (
                  <PublicNotificationBell
                    notifications={clientArea?.notifications ?? []}
                    onMarkRead={async (notificationId) => {
                      await markClientNotificationRead({ data: { studioId: studio.id, notificationId } });
                      const area = (await loadPublicClientArea({
                        data: { studioId: studio.id },
                      })) as PublicClientAreaPayload;
                      setClientArea(area);
                    }}
                    onMarkAllRead={async () => {
                      await markAllClientNotificationsRead({ data: { studioId: studio.id } });
                      setClientArea((current) =>
                        current
                          ? {
                              ...current,
                              notifications: (current.notifications ?? []).map((notification) => ({
                                ...notification,
                                status: "read",
                              })),
                            }
                          : current,
                      );
                    }}
                  />
                )}
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
            <div className="absolute bottom-3 left-3 right-3 z-20 md:bottom-8 md:left-8 md:right-8">
              <div className="flex max-w-[min(100%,30rem)] items-center gap-2.5 rounded-[1.25rem] border border-white/[0.08] bg-[linear-gradient(115deg,rgba(0,0,0,0.18),rgba(0,0,0,0.08)_58%,rgba(255,255,255,0.025))] p-2 pr-3 ring-1 ring-black/10 shadow-[0_18px_54px_rgba(0,0,0,0.22)] backdrop-blur-[3px] md:min-h-[7rem] md:w-full md:max-w-none md:gap-4 md:rounded-[1.9rem] md:bg-[linear-gradient(115deg,rgba(0,0,0,0.14),rgba(0,0,0,0.055)_62%,rgba(255,255,255,0.024))] md:p-3 md:pr-6">
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
                      className="size-16 rounded-[1.15rem] bg-white/94 object-cover p-1.5 ring-1 ring-white/40 shadow-[0_12px_36px_rgba(0,0,0,0.35)] transition duration-200 group-active/logo:scale-95 md:size-20 md:rounded-[1.55rem]"
                    />
                  </button>
                )}
                <div className="min-w-0 flex-1 text-left md:max-w-[58rem]">
                  <h1 className="line-clamp-2 max-w-[18rem] text-[1.24rem] font-extrabold leading-[1.14] tracking-tight text-white drop-shadow-[0_2px_14px_rgba(0,0,0,0.35)] md:max-w-[52rem] md:text-[2.55rem] md:leading-[0.98]">
                    {studio.name}
                  </h1>
                  {/* Rating prominently below the name */}
                  {studioRating > 0 && (
                    <div className="mt-1.5 flex items-center gap-1.5 md:mt-2">
                      <div className="flex items-center gap-0.5">
                        {[1,2,3,4,5].map((n) => (
                          <Star
                            key={n}
                            className={cn(
                              "size-3 md:size-3.5",
                              n <= Math.round(studioRating)
                                ? "fill-amber-400 text-amber-400"
                                : "fill-white/20 text-white/20",
                            )}
                          />
                        ))}
                      </div>
                      <span className="text-[0.78rem] font-extrabold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.4)] md:text-[0.9rem]">
                        {studioRating.toFixed(1)}
                      </span>
                      {reviewsCount > 0 && (
                        <span className="text-[0.7rem] text-white/65 md:text-[0.8rem]">
                          ({reviewsCount})
                        </span>
                      )}
                    </div>
                  )}
                  {studioIntro && (
                    <p className="mt-1 line-clamp-2 max-w-[17rem] text-[0.78rem] font-medium leading-snug text-white/78 drop-shadow-[0_1px_10px_rgba(0,0,0,0.3)] md:mt-1.5 md:max-w-[44rem] md:text-[0.98rem]">
                      {studioIntro}
                    </p>
                  )}
                  {/* address shown in stats bar below hero */}
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Premium stats bar */}
        <div className="px-4 pt-3 md:px-0">
          <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-border">
              <BookmarkCheck className="size-3.5 text-accent" />
              <span className="text-muted-foreground">App oficial</span>
            </div>
            {studio.location && mapsHref && (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs font-medium shadow-sm ring-1 ring-border transition hover:ring-accent/40"
              >
                <MapPin className="size-3.5 text-muted-foreground" />
                <span className="max-w-[180px] truncate text-muted-foreground">{studio.location}</span>
              </a>
            )}
            {services.length > 0 && (
              <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs font-medium shadow-sm ring-1 ring-border">
                <Sparkles className="size-3.5 text-accent" />
                <span className="text-muted-foreground">{services.length} serviços</span>
              </div>
            )}
            {followStatus && (
              <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-accent/20">
                <BookmarkCheck className="size-3.5" />
                A seguir
              </div>
            )}
          </div>
        </div>

        <div className="px-4 pt-3 md:px-0">
          <PublicClientAccountCard
            userEmail={user?.email ?? null}
            userName={clientArea?.profile?.name || getGoogleDisplayName(user) || client.name}
            userAvatarUrl={clientArea?.profile?.avatarUrl ?? getGoogleAvatarUrl(user)}
            authLoading={authLoading}
            clientArea={clientArea}
            loading={clientAreaLoading}
            profilePhone={client.phone}
            savingProfile={clientProfileSaving}
            studioName={studio.name}
            studioId={studio.id}
            professionals={professionals}
            openSignal={accountDrawerSignal}
            canInstallApp={!installDismissed}
            isPwaInstalled={pwaInstalled}
            canPrompt={Boolean(installPrompt)}
            notificationStatus={notificationsConsent}
            followedStudios={followedStudios}
            onInstall={handleInstallApp}
            onDismissInstall={() => setInstallDismissed(true)}
            onEnableNotifications={handleNotificationConsent}
            onSavePhone={async (phone) => {
              const nextPhone = normalizeSharedInternationalPhone(phone);
              if (!isValidSharedInternationalPhone(nextPhone)) {
                toast.error("Indique um WhatsApp válido antes de continuar.");
                throw new Error("invalid_public_client_phone");
              }
              setClientProfileSaving(true);
              try {
                await syncPublicClientProfile({ phone: nextPhone, showToast: true });
              } catch (error) {
                console.error("[public-client] phone save failed", error);
                toast.error(error instanceof Error ? error.message : "Não foi possível guardar o WhatsApp. Tente novamente.");
                throw error;
              } finally {
                setClientProfileSaving(false);
              }
            }}
            onSaveBirthday={async (dateOfBirth) => {
              setClientProfileSaving(true);
              try {
                await syncPublicClientProfile({ dateOfBirth, showToast: true });
              } catch (error) {
                console.error("[public-client] birthday save failed", error);
                toast.error("Não foi possível guardar a data de aniversário.");
              } finally {
                setClientProfileSaving(false);
              }
            }}
            onAutofill={() => {
              setClient((current) => ({
                ...current,
                name: clientArea?.profile?.name || current.name,
                phone: clientArea?.profile?.phone || current.phone,
                email: clientArea?.profile?.email || user?.email || current.email,
              }));
              toast.success("Dados preenchidos para esta marcação.");
            }}
            onReload={() => {
              if (!user?.id) return;
              setClientAreaLoading(true);
              loadPublicClientArea({ data: { studioId: studio.id } })
                .then((payload) => {
                  const area = payload as PublicClientAreaPayload;
                  setClientArea(area);
                  setClient((current) => ({
                    ...current,
                    name: area.profile?.name || current.name || "",
                    phone: area.profile?.phone || current.phone || "",
                    email: area.profile?.email || user.email || current.email || "",
                  }));
                })
                .catch(() => toast.error("Não foi possível atualizar a sua área."))
                .finally(() => setClientAreaLoading(false));
            }}
            onReviewSubmitted={() => {
              if (!studio.id) return;
              fetchReviews({ data: { studioId: studio.id, limit: 20 } })
                .then((res: any) => {
                  if (Array.isArray(res?.reviews)) setStudioReviews(res.reviews);
                })
                .catch(() => {});
            }}
            onMarkNotificationRead={async (notificationId) => {
              await markClientNotificationRead({ data: { studioId: studio.id, notificationId } });
              const area = (await loadPublicClientArea({
                data: { studioId: studio.id },
              })) as PublicClientAreaPayload;
              setClientArea(area);
            }}
            onMarkAllNotificationsRead={async () => {
              await markAllClientNotificationsRead({ data: { studioId: studio.id } });
              setClientArea((current) =>
                current
                  ? {
                      ...current,
                      notifications: (current.notifications ?? []).map((notification) => ({
                        ...notification,
                        status: "read",
                      })),
                    }
                  : current,
              );
            }}
          />
        </div>

        {/* Stepper */}
        {step > 0 && <Stepper current={step} professionalLabel={segment.labels.professional} />}

        {/* Step content */}
        <div
          className={cn(
            "touch-pan-y px-4 pt-3 transition-transform duration-300 ease-out md:px-0",
            step > 0 ? "pb-4 md:mx-auto md:max-w-3xl" : "pb-6",
          )}
          onTouchStart={handleStepTouchStart}
          onTouchEnd={handleStepTouchEnd}
        >
          {step === 0 && (
            <>
              <PublicTabs
                active={publicTab}
                professionalPlural={segment.labels.professionalPlural}
                onChange={setPublicTab}
              />
              {publicTab === "services" ? (
                <>
                  <CategoryStep
                    categories={bookingCategories}
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
                      setService(s);
                      setDate(null);
                      setTime(null);
                      setSelectedSlot(null);
                      setExtras({});
                      // Auto-select when only 1 professional is eligible — skip step 1
                      const eligible = professionals.filter(
                        (p) => p.serviceIds.length === 0 || p.serviceIds.includes(s.id),
                      );
                      const currentProfessional =
                        professional && professional !== "any"
                          ? eligible.find((p) => p.id === (professional as Professional).id)
                          : null;
                      if (currentProfessional) {
                        setProfessional(currentProfessional);
                        setStep(2);
                      } else if (eligible.length === 1) {
                        setProfessional(eligible[0]);
                        setStep(2);
                      } else {
                        setProfessional(null);
                        setStep(2);
                      }
                    }}
                  />
                </>
              ) : publicTab === "professionals" ? (
                <ProfessionalsPublicTab
                  professionals={professionals}
                  labels={segment.labels}
                  studioSlug={studio.slug}
                  studioTimezone={studio.timezone}
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
                <CommentsTab
                  rating={studioRating}
                  reviewsCount={reviewsCount}
                  reviews={studioReviews}
                  professionals={professionals}
                />
              ) : publicTab === "info" ? (
                <InfoTab amenities={publicAmenities} studio={studio} mapsHref={mapsHref} />
              ) : (
                <ComingSoonPanel tab={publicTab} />
              )}
            </>
          )}

          {step === 1 && service && (
            <ProfessionalStep
              pros={eligiblePros}
              selected={professional}
              studioSlug={studio.slug}
              studioTimezone={studio.timezone}
              durationMin={service.durationMin + upsellsDuration}
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
              studioId={studio.id}
              studioSlug={studio.slug}
              studioTimezone={studio.timezone}
              staffId={professional && professional !== "any" ? resolveStaffId((professional as Professional).id) : null}
              eligibleStaffIds={eligibleDbStaffIds}
              getStaffId={(p) => resolveStaffId(p.id)}
              durationMin={totalDuration || service.durationMin}
              minBookingNoticeMin={
                // Agenda disponível can surface same-day slots by skipping the minimum notice window.
                professional &&
                professional !== "any" &&
                (professional as Professional)?.currentStatus === "online"
                  ? 0
                  : (studio.min_booking_notice_min ?? 30)
              }
              unavailableStatus={
                professional !== "any" && professional
                  ? String((professional as Professional).currentStatus ?? "")
                  : null
              }
              date={date}
              time={time}
              professionals={eligiblePros}
              selectedProfessional={professional === "any" ? null : professional}
              onPickProfessional={(p) => {
                setProfessional(p);
                setTime(null);
                setSelectedSlot(null);
              }}
              onPickDate={(d) => {
                setDate(d);
                setTime(null);
                setSelectedSlot(null);
              }}
              onPickTime={(slot) => {
                setTime(slot.slot_label);
                setSelectedSlot(slot);
                setStep(4);
              }}
            />
          )}

          {step === 3 && service && (
            <UpsellStep
              upsells={compatibleUpsells}
              extras={extras}
              onToggle={handleToggleExtra}
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
                clientAccountEmail={clientArea?.profile?.email ?? user?.email ?? null}
                clientAccountName={clientArea?.profile?.name || getGoogleDisplayName(user)}
              onClientChange={setClient}
              availableUpsells={compatibleUpsells}
              selectedExtras={extras}
              onToggleExtra={handleToggleExtra}
              contactConsent={contactConsent}
              onContactConsentChange={setContactConsent}
              sensitiveNotesConsent={sensitiveNotesConsent}
              onSensitiveNotesConsentChange={setSensitiveNotesConsent}
              policyAccepted={policyAccepted}
              onPolicyAcceptedChange={setPolicyAccepted}
              hasSavedContactConsent={hasSavedContactConsent}
              hasSavedPolicyAcceptance={hasSavedPolicyAcceptance}
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
          depositPercent={studio.payment_policy === "pre_payment" ? studio.deposit_percent : null}
          onClose={() => setPolicyModalOpen(false)}
        />
      )}

      {/* ── Entry banner: PWA install + notifications ── */}
      {showEntryBanner && step === 0 && (() => {
        const isIos = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
        const isStandalone =
          typeof navigator !== "undefined" &&
          (("standalone" in navigator && (navigator as any).standalone === true) ||
            (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches));
        const installed = pwaInstalled || isStandalone;
        const shouldShowInstall = !installed && !installDismissed && (Boolean(installPrompt) || isIos);
        const shouldShowNotifications = installed && notificationsConsent !== "granted";
        const hasInstallPrompt = Boolean(installPrompt) && shouldShowInstall;
        const bannerMode = shouldShowNotifications ? "notifications" : "install";
        // Show banner if: has Chrome install prompt, OR can ask for notifications,
        // OR is iOS (to show "add to home screen" tip) — but not already standalone
        const shouldShow = shouldShowInstall || shouldShowNotifications;
        if (!shouldShow) return null;

        return (
          <div className="fixed bottom-0 left-0 right-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-[520px] rounded-[1.4rem] border border-border bg-card/97 p-4 shadow-[0_-2px_40px_rgba(0,0,0,0.14)] backdrop-blur-xl ring-1 ring-white/5">
              <div className="flex items-start gap-3">
                {bannerMode === "notifications" ? (
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
                    <Bell className="size-5" />
                  </div>
                ) : logoSrc ? (
                  <img src={logoSrc} alt="" className="size-10 shrink-0 rounded-xl object-cover shadow-sm" />
                ) : (
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
                    <Download className="size-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold tracking-tight text-foreground">
                    {bannerMode === "notifications"
                      ? "Ative as notificações do app"
                      : `Instale o app oficial de ${studio.name}`}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {bannerMode === "notifications"
                      ? "Receba lembretes de marcações, alterações de horário e novidades dos seus estúdios favoritos."
                      : isIos && !isStandalone
                        ? "Toque em partilhar → Adicionar à Tela de Início para acompanhar reservas, novidades e notificações."
                        : "Instale o app do estúdio para acesso rápido à conta, histórico, reservas e novidades."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDismissEntryBanner}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Fechar"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              {/* Action buttons — only shown on non-iOS or when prompts are available */}
              {bannerMode === "install" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(hasInstallPrompt || !isIos) && (
                    <button
                      type="button"
                      onClick={async () => { await handleInstallApp(); handleDismissEntryBanner(); }}
                      className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.11em] text-background transition hover:opacity-85 active:scale-95"
                    >
                      <Download className="size-3.5" />
                      {hasInstallPrompt ? "Instalar app" : "Como instalar"}
                    </button>
                  )}
                  {showNotificationEntryAction && (
                    <button
                      type="button"
                      onClick={async () => { await handleNotificationConsent(); handleDismissEntryBanner(); }}
                      className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.11em] text-foreground transition hover:bg-muted active:scale-95"
                    >
                      <Bell className="size-3.5" />
                      Ativar notificações
                    </button>
                  )}
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={async () => { await handleNotificationConsent(); setShowEntryBanner(false); }}
                    className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.11em] text-background transition hover:opacity-85 active:scale-95"
                  >
                    <Bell className="size-3.5" />
                    Ativar notificações
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {step === 0 ? (
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
      ) : (
        <>
          {/* Mobile booking footer: one compact line that sits above the fixed bottom bar.
              pb-[calc(8rem+safe-area)] creates clearance so the bar never covers the text. */}
          <footer className="border-t border-border/30 px-5 pb-[calc(8rem+env(safe-area-inset-bottom,0px))] pt-3 text-center md:hidden">
            <p className="text-[10px] leading-relaxed text-muted-foreground/50">
              © {new Date().getFullYear()}
              <span className="mx-1.5 opacity-40">·</span>
              <a href="/termos" className="transition hover:text-foreground">Termos</a>
              <span className="mx-1.5 opacity-40">·</span>
              <a href="/privacidade" className="transition hover:text-foreground">Privacidade</a>
            </p>
          </footer>
          {/* Desktop: full footer — no fixed-bar overlap on wider screens */}
          <div className="hidden md:block">
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
          </div>
        </>
      )}
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
  return `${Number(value).toLocaleString("pt-PT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}\u20ac`;
}

function formatPercent(value: number) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return `${rounded.toLocaleString("pt-PT", {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatPhoneInput(value: string) {
  if (value.includes("@")) return "";
  const cleaned = value.replace(/[^\d+\s]/g, "").replace(/\s+/g, " ");
  if (!cleaned.includes("+")) return cleaned.trimStart();
  return `+${cleaned.replace(/\+/g, "").trimStart()}`;
}

function explainPublicProfileError(error: unknown) {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error ?? "");
  if (/auth|401|session/i.test(text)) {
    return "A sessão expirou. Entre novamente para concluir a reserva.";
  }
  if (/studio_not_found|studio/i.test(text)) {
    return "Este link de marcação já não está disponível.";
  }
  if (/email/i.test(text)) {
    return "Não foi possível confirmar o e-mail da sua conta.";
  }
  if (/phone_already_in_use|duplicate key|clients_studio_id_phone_key/i.test(text)) {
    return "Este WhatsApp já está associado a outro perfil neste estúdio.";
  }
  if (/permission|rls|row-level|policy/i.test(text)) {
    return "Não foi possível confirmar o seu perfil neste estúdio. Tente entrar novamente.";
  }
  return "Não foi possível guardar os seus dados de cliente. Tente novamente.";
}

function rememberPublicReturn() {
  rememberPublicAuthReturn(`${window.location.pathname}${window.location.search}`);
}

function readNotificationPermission(): "unknown" | "granted" | "denied" {
  if (typeof window === "undefined") return "unknown";
  // Notification API absent → treat as unknown (not denied) so the banner can
  // still offer the "install first" guidance on iOS Safari in browser mode.
  if (!("Notification" in window)) return "unknown";
  return Notification.permission === "granted"
    ? "granted"
    : Notification.permission === "denied"
      ? "denied"
      : "unknown";
}

function getGoogleDisplayName(user: unknown) {
  const metadata = ((user as any)?.user_metadata ?? {}) as Record<string, unknown>;
  return String(metadata.full_name ?? metadata.name ?? "").trim();
}

function getGoogleAvatarUrl(user: unknown) {
  const metadata = ((user as any)?.user_metadata ?? {}) as Record<string, unknown>;
  const value = metadata.avatar_url ?? metadata.picture;
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}

async function getGoogleDateOfBirth(user: unknown) {
  const metadata = ((user as any)?.user_metadata ?? {}) as Record<string, unknown>;
  const fromMetadata = normalizeGoogleDateOfBirth(
    metadata.date_of_birth ?? metadata.birthdate ?? metadata.birthday ?? metadata.dob,
  );
  if (fromMetadata) return fromMetadata;

  try {
    const { data } = await supabase.auth.getSession();
    const providerToken = data.session?.provider_token;
    if (!providerToken) return null;
    const response = await fetch("https://people.googleapis.com/v1/people/me?personFields=birthdays", {
      headers: { Authorization: `Bearer ${providerToken}` },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { birthdays?: Array<{ date?: { year?: number; month?: number; day?: number } }> };
    for (const birthday of payload.birthdays ?? []) {
      const date = birthday.date;
      if (!date?.month || !date?.day) continue;
      const normalized = normalizeGoogleDateOfBirth(`${date.year && date.year > 0 ? date.year : 1900}-${date.month}-${date.day}`);
      if (normalized) return normalized;
    }
  } catch {
    /* Birthday access is optional and should never block booking. */
  }

  return null;
}

function normalizeGoogleDateOfBirth(value: unknown) {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const european = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  const monthDay = raw.match(/^(\d{1,2})[./-](\d{1,2})$/);
  const match = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : european
      ? { year: Number(european[3]), month: Number(european[2]), day: Number(european[1]) }
      : monthDay
        ? { year: 1900, month: Number(monthDay[1]), day: Number(monthDay[2]) }
        : null;
  if (!match) return null;
  const date = new Date(Date.UTC(match.year, match.month - 1, match.day));
  if (
    date.getUTCFullYear() !== match.year ||
    date.getUTCMonth() !== match.month - 1 ||
    date.getUTCDate() !== match.day
  ) {
    return null;
  }
  return `${String(match.year).padStart(4, "0")}-${String(match.month).padStart(2, "0")}-${String(
    match.day,
  ).padStart(2, "0")}`;
}

function formatProfileBirthday(value: string | null | undefined) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "Opcional";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function clientStatusLabel(status: string) {
  const labels: Record<string, string> = {
    confirmed: "Confirmada",
    pending_payment: "Pagamento pendente",
    completed: "Concluída",
    cancelled: "Cancelada",
    no_show: "Falta",
  };
  return labels[status] ?? capitalizeLabel(status.replace(/_/g, " "));
}

function formatDateTimeShort(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTimeOnly(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/* ---------- Stepper ---------- */
function Stepper({ current, professionalLabel: _professionalLabel }: { current: Step; professionalLabel: string }) {
  const labels = ["Serviço", "Profissional e horário", "Confirmar"];
  const visualCurrent = current >= 4 ? 2 : current >= 2 ? 1 : 0;
  return (
    <div className="px-5 pt-5 md:px-0">
      <div className="flex items-center gap-1.5">
        {labels.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i <= visualCurrent ? "bg-accent" : "bg-surface-strong",
            )}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        Etapa {visualCurrent + 1} de 3 · {labels[visualCurrent]}
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
  { id: "comments", label: "Avaliações" },
  { id: "info", label: "Informações" },
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
    <nav className="sticky top-0 z-20 -mx-4 border-b border-border/70 bg-background/90 px-4 py-2 backdrop-blur-2xl md:static md:mx-0 md:rounded-2xl md:border md:bg-card/72 md:p-1.5">
      <div className="grid grid-cols-4 gap-1.5">
        {publicTabs.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "relative h-10 min-w-0 rounded-xl px-1.5 text-[10px] font-extrabold transition-all duration-300 active:scale-95 md:h-12 md:rounded-[1rem] md:px-2 md:text-[0.7rem]",
                selected
                  ? "bg-accent text-accent-foreground shadow-lg shadow-black/10"
                  : "text-muted-foreground hover:bg-surface hover:text-foreground",
              )}
            >
              <span className="block truncate">
                {tab.id === "professionals" ? capitalizeLabel(professionalPlural) : tab.label}
              </span>
              {selected && (
                <span className="absolute inset-x-3 -bottom-2 hidden h-1 rounded-full bg-accent md:block" />
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

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active]);

  if (items.length === 0) return null;

  return (
    <section className="mt-2 rounded-[1.15rem] border border-border bg-card/74 p-2 shadow-sm backdrop-blur">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {items.map(({ icon: Icon, label, detail }) => (
          <button
            key={label}
            type="button"
            onClick={() => setActive({ label, detail })}
            className="group inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-background/72 px-2 text-[0.66rem] font-extrabold ring-1 ring-border transition hover:-translate-y-0.5 hover:ring-accent/35 active:scale-95 md:h-9"
            title={detail}
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground transition group-hover:bg-accent group-hover:text-accent-foreground md:size-6">
              <Icon className="size-3.5" />
            </span>
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* Portal modal — escapes any parent transform/backdrop-blur stacking context */}
      {active &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={active.label}
            className="fixed inset-0 z-[9999] flex items-end justify-center px-4 pb-4 md:items-center"
            onClick={() => setActive(null)}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            {/* Sheet / modal card */}
            <div
              className="relative z-10 w-full max-w-sm rounded-[1.5rem] bg-card p-5 shadow-2xl ring-1 ring-border"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-accent">
                    Comodidade
                  </p>
                  <h3 className="mt-1 truncate text-lg font-extrabold">{active.label}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-muted/80"
                  aria-label="Fechar"
                >
                  <X className="size-4" />
                </button>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {active.detail}
              </p>
            </div>
          </div>,
          document.body,
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
        Esta área está preparada para crescer sem pesar na experiência do app. Os serviços continuam
        disponíveis na aba principal.
      </p>
    </section>
  );
}

function ProfessionalsPublicTab({
  professionals,
  labels,
  studioSlug,
  studioTimezone,
  onPick,
}: {
  professionals: Professional[];
  labels: SegmentLabels;
  studioSlug: string;
  studioTimezone?: string | null;
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
          Veja a equipa e escolha {labels.professional} que preferir no app do estúdio.
        </p>
      </div>
      <ExpandableList
        items={professionals}
        initialCount={4}
        className="grid gap-3 md:grid-cols-2"
        itemClassName="min-w-0"
        buttonWrapClassName="md:col-span-2"
        getKey={(professional) => professional.id}
        moreLabel={(hidden) => `Ver mais ${hidden} profissional${hidden !== 1 ? "is" : ""}`}
        renderItem={(professional) => (
          <article
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
                    {professional.reviewsCount && professional.reviewsCount > 0
                      ? <span className="font-normal opacity-70">· {professional.reviewsCount}</span>
                      : null}
                  </span>
                  <PublicStaffAvailabilityIndicator
                    professional={professional}
                    studioSlug={studioSlug}
                    studioTimezone={studioTimezone}
                    durationMin={30}
                  />
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
        )}
      />
      <div>
        {professionals.length === 0 && (
          <p className="rounded-[1.35rem] bg-card/80 p-6 text-center text-sm text-muted-foreground ring-1 ring-border">
            Ainda não existem {labels.professionalPlural} disponíveis.
          </p>
        )}
      </div>
    </section>
  );
}

function PublicStaffAvailabilityIndicator({
  professional,
  studioSlug,
  studioTimezone,
  durationMin,
  compact = false,
}: {
  professional: Professional;
  studioSlug: string;
  studioTimezone?: string | null;
  durationMin: number;
  compact?: boolean;
}) {
  const status = String(professional.currentStatus ?? "available");
  const isDayOff = status === "absent";
  const isVacation = status === "vacation" || status === "holiday" || status === "ferias" || status === "férias";
  const [hasFutureSlots, setHasFutureSlots] = useState<boolean | null>(
    isDayOff || isVacation ? false : null,
  );

  useEffect(() => {
    if (isDayOff || isVacation) {
      setHasFutureSlots(false);
      return;
    }
    let active = true;
    const dates = getNextDates(14, studioTimezone || "Europe/Lisbon");
    import("@/lib/availability")
      .then(async ({ fetchAvailableSlots }) => {
        for (const day of dates) {
          const slots = await fetchAvailableSlots({
            studioSlug,
            staffId: professional.id,
            date: day,
            durationMin: Math.max(15, durationMin || 30),
            minBookingNoticeMin: 30,
            studioTimezone,
          });
          if (slots.length > 0) return true;
        }
        return false;
      })
      .then((available) => {
        if (active) setHasFutureSlots(available);
      })
      .catch(() => {
        if (active) setHasFutureSlots(true);
      });
    return () => {
      active = false;
    };
  }, [durationMin, isDayOff, isVacation, professional.id, studioSlug, studioTimezone]);

  const cfg = isVacation
    ? {
        label: "Em férias",
        dot: "bg-sky-500",
        ring: "ring-sky-500/25",
        bg: "bg-sky-500/10",
      }
    : isDayOff
      ? {
          label: "De folga",
          dot: "bg-amber-500",
          ring: "ring-amber-500/25",
          bg: "bg-amber-500/10",
        }
      : hasFutureSlots === false
        ? {
            label: "Sem horários disponíveis no momento",
            dot: "bg-zinc-400",
            ring: "ring-border",
            bg: "bg-muted/70",
          }
        : {
            label: "Aceitando reservas",
            dot: "bg-emerald-500",
            ring: "ring-emerald-500/25",
            bg: "bg-emerald-500/10",
          };

  return (
    <span
      title={cfg.label}
      aria-label={cfg.label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full ring-1 transition-colors",
        compact ? "size-9" : "h-7 w-9",
        cfg.bg,
        cfg.ring,
      )}
    >
      <span
        className={cn(
          "size-2.5 rounded-full shadow-sm",
          cfg.dot,
          !isDayOff && !isVacation && hasFutureSlots !== false && "animate-pulse",
        )}
      />
      <span className="sr-only">{cfg.label}</span>
    </span>
  );
}

function CommentsTab({
  rating,
  reviewsCount,
  reviews,
  professionals,
}: {
  rating: number;
  reviewsCount: number;
  reviews: StudioReview[];
  professionals: Professional[];
}) {
  // Build distribution from real reviews
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    label: `${star} ★`,
    count: reviews.filter((r) => r.rating === star).length,
  }));
  const maxCount = Math.max(...dist.map((d) => d.count), 1);

  return (
    <section className="mt-6 space-y-4">
      <div>
        <SectionTitle>Avaliações</SectionTitle>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight">O que dizem as clientes</h2>
      </div>
      <div className="overflow-hidden rounded-[1.5rem] bg-card/90 ring-1 ring-border">
        {/* Rating header */}
        <div className="flex items-center gap-6 p-5">
          <div className="text-center">
            <p className="text-[3.5rem] font-extrabold leading-none tracking-tight text-accent">
              {rating > 0 ? rating.toFixed(1) : "—"}
            </p>
            <div className="mt-1.5 flex justify-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className={cn("size-4", rating >= i + 1 ? "fill-accent text-accent" : "text-border")} />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {reviewsCount > 0 ? `${reviewsCount} avaliações` : "Sem avaliações"}
            </p>
          </div>
          {reviews.length > 0 && (
            <div className="flex-1 space-y-1.5">
              {dist.map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className="w-7 text-right text-[10px] font-semibold text-muted-foreground">{b.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/40">
                    <div
                      className="h-full rounded-full bg-accent/70 transition-all duration-700"
                      style={{ width: `${Math.round((b.count / maxCount) * 100)}%` }}
                    />
                  </div>
                  <span className="w-4 text-[10px] text-muted-foreground">{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review cards */}
        <div className="divide-y divide-border/50">
          {reviews.length > 0 ? (
            <ExpandableList
              items={reviews}
              initialCount={4}
              className="divide-y divide-border/50"
              getKey={(rev) => rev.id}
              moreLabel={(hidden) => `Ver mais ${hidden} avaliação${hidden !== 1 ? "ões" : ""}`}
              renderItem={(rev) => {
              const taggedPros = professionals.filter((p) => rev.staffIds.includes(p.id));
              const initials = (rev.reviewerName ?? "C")
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? "")
                .join("");
              const date = new Date(rev.createdAt);
              const dateLabel = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", year: "numeric" }).format(date);
              return (
                <div className="p-5">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-xs font-black text-background">
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{rev.reviewerName ?? "Cliente verificada"}</span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star key={i} className={cn("size-3", i < rev.rating ? "fill-accent text-accent" : "text-border")} />
                          ))}
                        </div>
                        <span className="text-[10px] text-muted-foreground">{dateLabel}</span>
                      </div>
                      {taggedPros.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {taggedPros.map((p) => (
                            <span key={p.id} className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {rev.comment && (
                        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{rev.comment}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 px-5 py-8">
              <div className="grid size-10 place-items-center rounded-2xl bg-muted text-muted-foreground">
                <Star className="size-4" />
              </div>
              <p className="text-sm font-bold">Ainda sem avaliações</p>
              <p className="max-w-xs text-center text-xs text-muted-foreground">
                As primeiras avaliações vão aparecer aqui depois das marcações concluídas.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function InfoTab({
  amenities,
  studio,
  mapsHref,
}: {
  amenities: PublicAmenities;
  studio: { location?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; instagram?: string | null };
  mapsHref: string | null;
}) {
  const items = buildAmenityItems(amenities);
  return (
    <section className="mt-6 space-y-4">
      <div>
        <SectionTitle>Informações</SectionTitle>
        <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Sobre o estúdio</h2>
      </div>

      {/* Contact & Location */}
      {(studio.location || studio.phone || studio.email || studio.instagram) && (
        <div className="overflow-hidden rounded-[1.35rem] bg-card/90 ring-1 ring-border">
          {studio.location && mapsHref && (
            <a href={mapsHref} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-4 transition hover:bg-muted/30">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                <MapPin className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Morada</p>
                <p className="truncate text-sm font-semibold">{studio.location}</p>
              </div>
              <ExternalLink className="ml-auto size-4 shrink-0 text-muted-foreground/40" />
            </a>
          )}
          {studio.phone && (
            <a href={`tel:${studio.phone}`} className="flex items-center gap-3 border-t border-border/50 px-5 py-4 transition hover:bg-muted/30">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                <span className="text-sm">📞</span>
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Telefone</p>
                <p className="text-sm font-semibold">{studio.phone}</p>
              </div>
            </a>
          )}
          {studio.instagram && (
            <a href={`https://instagram.com/${studio.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 border-t border-border/50 px-5 py-4 transition hover:bg-muted/30">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] text-white shadow-sm">
                <FaInstagram className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Instagram</p>
                <p className="text-sm font-semibold">@{studio.instagram.replace(/^@/, "")}</p>
              </div>
              <ExternalLink className="ml-auto size-4 shrink-0 text-muted-foreground/40" />
            </a>
          )}
        </div>
      )}

      {/* Amenities */}
      {items.length > 0 && (
        <div className="overflow-hidden rounded-[1.35rem] bg-card/90 ring-1 ring-border">
          <p className="border-b border-border/50 px-5 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Comodidades</p>
          {items.map((item, i) => (
            <div key={i} className={cn("flex items-center gap-3 px-5 py-4", i > 0 && "border-t border-border/50")}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                <item.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
                <p className="mt-0.5 text-sm font-medium">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
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
  const primaryCategoryLimit = 5;
  const primaryCategories = categories.slice(0, primaryCategoryLimit);
  const extraCategories = categories.slice(primaryCategoryLimit);
  const visibleCategories = primaryCategories;
  const visibleServices = services.filter((service) =>
    `${service.name} ${service.description ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <section id="public-services" className="animate-slide-up space-y-3 pt-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <SectionTitle>Serviços</SectionTitle>
          </div>
          {activeCategory && (
            <span className="max-w-[52vw] truncate rounded-full bg-accent/12 px-3 py-1.5 text-[11px] font-bold text-accent">
              {activeCategory.label}
            </span>
          )}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar serviço"
            className="h-11 w-full rounded-2xl bg-card/88 pl-10 pr-4 text-sm font-semibold shadow-sm ring-1 ring-border backdrop-blur placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent md:h-12"
          />
        </label>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 md:mx-0 md:overflow-visible md:px-0">
          <div className="flex w-max max-w-none flex-nowrap gap-2 md:w-full md:max-w-[680px] md:flex-wrap">
            {visibleCategories.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c.id)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center rounded-full px-3 text-[11px] font-extrabold transition-all active:scale-95 sm:h-10 sm:px-3.5 sm:text-xs",
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
                className="inline-flex h-9 shrink-0 items-center rounded-full border border-dashed border-border bg-background px-3 text-[11px] font-bold text-muted-foreground transition hover:bg-muted sm:h-10 sm:px-3.5 sm:text-xs"
              >
                {showAllCategories ? "Ver menos" : `Ver mais +${extraCategories.length}`}
              </button>
            )}
          </div>
        </div>
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

      <div className="space-y-2">
        <div>
          <ExpandableList
            items={visibleServices}
            initialCount={4}
            className="grid grid-cols-1 items-stretch gap-2.5 md:grid-cols-2 md:gap-3"
            itemClassName="min-w-0"
            buttonWrapClassName="md:col-span-2"
            getKey={(s) => s.id}
            moreLabel={(hidden) => `Ver mais ${hidden} serviço${hidden !== 1 ? "s" : ""}`}
            renderItem={(s) => (
              <ServiceCard
                service={s}
                selected={selected?.id === s.id}
                onSelect={() => onSelect(s)}
              />
            )}
          />
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
      <div>
        <ExpandableList
          items={services}
          initialCount={4}
          className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2"
          itemClassName="min-w-0"
          buttonWrapClassName="md:col-span-2"
          getKey={(s) => s.id}
          moreLabel={(hidden) => `Ver mais ${hidden} serviço${hidden !== 1 ? "s" : ""}`}
          renderItem={(s) => (
            <ServiceCard
              service={s}
              selected={selected?.id === s.id}
              onSelect={() => onSelect(s)}
            />
          )}
        />
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
  const imageSources = uniqueImageList(service.media.filter((item) => item.type === "image").map((item) => item.src));

  return (
    <article
      className={cn(
        "group flex h-full min-h-[6.9rem] overflow-hidden rounded-[1.15rem] bg-card/95 shadow-sm ring-1 backdrop-blur transition-all duration-300",
        selected
          ? "ring-2 ring-accent shadow-lg shadow-accent/10"
          : "ring-border hover:-translate-y-0.5 hover:shadow-lg hover:ring-accent/35",
      )}
    >
      <div className="flex h-full w-full gap-2.5 p-2.5 md:gap-3 md:p-3">
        <div className="relative size-[4.85rem] shrink-0 overflow-hidden rounded-2xl bg-surface shadow-inner md:size-24">
          {imageSources.length > 1 ? (
            <ServiceMediaCarousel images={imageSources} alt={service.name} />
          ) : media?.type === "image" ? (
            <ServiceImage src={media.src} fallback={media.src} alt={service.name} />
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

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
          <div className="min-w-0">
            <p className="truncate text-[0.94rem] font-extrabold leading-tight md:text-base" title={service.name}>
              {service.name}
            </p>
            {service.description && (
              <p className="mt-0.5 line-clamp-1 text-[0.72rem] leading-relaxed text-muted-foreground md:text-xs" title={service.description}>
                {service.description}
              </p>
            )}
          </div>
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <p className={cn(moneyClass("text-lg md:text-xl"), "truncate")}>
                {formatMoney(service.price)}
              </p>
              <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground md:text-[11px]">
                <Clock className="size-3.5" />
                {service.durationMin} min
              </p>
            </div>
            <button
              onClick={onSelect}
              className={cn(
                "h-9 shrink-0 rounded-xl px-3 text-[0.68rem] font-extrabold shadow-sm transition-all active:scale-[0.98] md:h-10 md:px-4 md:text-xs",
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

function ServiceImage({ src, fallback, alt }: { src: string; fallback: string; alt: string }) {
  const [currentSrc, setCurrentSrc] = useState(src);

  useEffect(() => {
    setCurrentSrc(src);
  }, [src]);

  return (
    <img
      src={currentSrc}
      alt={alt}
      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
      loading="lazy"
      width={256}
      height={256}
      onError={() => {
        if (currentSrc !== fallback) setCurrentSrc(fallback);
      }}
    />
  );
}

function ServiceMediaCarousel({ images, alt }: { images: string[]; alt: string }) {
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const fallback = images[0] ?? "";

  useEffect(() => {
    if (images.length <= 1) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % images.length);
    }, 3800);
    return () => window.clearInterval(timer);
  }, [images.length]);

  useEffect(() => {
    setActive(0);
  }, [fallback]);

  function showPrevious() {
    setActive((current) => (current - 1 + images.length) % images.length);
  }

  function showNext() {
    setActive((current) => (current + 1) % images.length);
  }

  return (
    <div
      className="relative h-full w-full touch-pan-y overflow-hidden"
      onTouchStart={(event) => {
        touchStartX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        const end = event.changedTouches[0]?.clientX;
        if (start == null || end == null || Math.abs(start - end) < 28) return;
        if (start > end) showNext();
        else showPrevious();
      }}
    >
      {images.map((src, index) => (
        <div
          key={`${src}-${index}`}
          className={cn(
            "absolute inset-0 transition-opacity duration-700 ease-out",
            index === active ? "opacity-100" : "opacity-0",
          )}
          aria-hidden={index !== active}
        >
          <ServiceImage src={src} fallback={fallback} alt={alt} />
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-1.5 flex justify-center gap-1">
        {images.map((src, index) => (
          <span
            key={`dot-${src}-${index}`}
            className={cn(
              "h-1.5 rounded-full bg-white/80 shadow-sm transition-all",
              index === active ? "w-3" : "w-1.5 opacity-70",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function ProfessionalStep({
  pros,
  selected,
  onSelect,
  studioSlug: _studioSlug,
  studioTimezone,
  durationMin,
}: {
  pros: Professional[];
  selected: Professional | "any" | null;
  onSelect: (p: Professional | "any") => void;
  studioSlug: string;
  studioTimezone?: string | null;
  durationMin: number;
}) {
  type StatusKey = "online" | "available" | "busy" | "absent";
  const statusCfg: Record<StatusKey, { dot: string; label: string; helper?: string; text: string }> = {
    online: {
      dot: "bg-emerald-500",
      label: "Agenda disponível",
      helper: "Horários disponíveis",
      text: "text-emerald-600 dark:text-emerald-400",
    },
    available: {
      dot: "bg-emerald-500",
      label: "Agenda disponível",
      helper: "Horários disponíveis",
      text: "text-emerald-600 dark:text-emerald-400",
    },
    busy: {
      dot: "bg-zinc-950 dark:bg-zinc-200",
      label: "Atendendo no momento",
      helper: "Horários futuros disponíveis",
      text: "text-zinc-700 dark:text-zinc-300",
    },
    absent: { dot: "bg-zinc-300 dark:bg-zinc-600", label: "Folga", text: "text-muted-foreground" },
  };

  return (
    <section className="animate-slide-up space-y-4 rounded-[1.35rem] bg-card/86 p-4 shadow-sm ring-1 ring-border backdrop-blur md:space-y-5 md:rounded-[1.75rem] md:p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="min-w-0">
          <SectionTitle>Profissionais</SectionTitle>
          <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Escolha quem vai atender</h2>
        </div>
        <span className="text-right text-[11px] text-muted-foreground">{pros.length} disponíveis</span>
      </div>

      <div className="flex flex-col gap-2">
        {/* "Any professional" option */}
        <button
          type="button"
          onClick={() => onSelect("any")}
          className={cn(
            "flex min-w-0 items-center gap-3 rounded-xl bg-surface px-3.5 py-3 text-left transition-all active:scale-[0.99]",
            selected === "any" ? "ring-2 ring-accent" : "ring-1 ring-border hover:ring-accent/40",
          )}
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/12 text-accent ring-1 ring-accent/20">
            <UserRound className="size-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">Qualquer profissional</p>
            <p className="truncate text-[11px] text-muted-foreground">Melhor disponibilidade</p>
          </div>
          {selected === "any" && (
            <div className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-background">
              <Check className="size-3" />
            </div>
          )}
        </button>

        {/* Individual staff cards */}
        <ExpandableList
          items={pros}
          initialCount={4}
          className="space-y-2"
          getKey={(p) => p.id}
          moreLabel={(hidden) => `Ver mais ${hidden} profissional${hidden !== 1 ? "is" : ""}`}
          renderItem={(p) => {
            const isSelected = selected !== "any" && selected?.id === p.id;
            return (
              <button
                type="button"
                onClick={() => onSelect(p)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 rounded-xl bg-background/72 px-3.5 py-3 text-left transition-all active:scale-[0.99]",
                  isSelected ? "ring-2 ring-accent" : "ring-1 ring-border hover:ring-accent/40",
                )}
              >
                {/* Circular avatar */}
                {p.photo ? (
                  <img
                    src={p.photo}
                    alt={p.name}
                    className="size-10 shrink-0 rounded-full object-cover ring-1 ring-border"
                    loading="lazy"
                    width={80}
                    height={80}
                  />
                ) : (
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-muted ring-1 ring-border">
                    <UserRound className="size-5 text-muted-foreground" />
                  </div>
                )}

                {/* Name + role */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold leading-snug">{p.name}</p>
                  {p.role && (
                    <p className="truncate text-[11px] text-muted-foreground">{p.role}</p>
                  )}
                </div>

                <PublicStaffAvailabilityIndicator
                  professional={p}
                  studioSlug={_studioSlug}
                  studioTimezone={studioTimezone}
                  durationMin={durationMin}
                  compact
                />
              </button>
            );
          }}
        />
      </div>
    </section>
  );
}

function PublicProfessionalChooser({
  pros,
  selected,
  onSelect,
}: {
  pros: Professional[];
  selected: Professional | null;
  onSelect: (p: Professional) => void;
}) {
  if (pros.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <div className="flex items-end justify-between gap-2.5">
        <div className="min-w-0">
          <SectionTitle>Profissional</SectionTitle>
          <p className="mt-0.5 text-sm font-bold text-foreground">Escolha quem vai atender</p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">{pros.length} opções</span>
      </div>

      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1 scrollbar-hide md:grid md:grid-cols-4 md:overflow-visible">
        <ExpandableList
          items={pros}
          initialCount={6}
          className="contents"
          getKey={(p) => p.id}
          moreLabel={(hidden) => `Ver mais ${hidden}`}
          renderItem={(p) => {
            const isSelected = selected?.id === p.id;
            return (
              <button
                type="button"
                onClick={() => onSelect(p)}
                className={cn(
                  "flex h-[6.8rem] w-[5.65rem] shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[1.05rem] border bg-background/78 px-2 py-2.5 text-center shadow-sm transition-all duration-200 active:scale-[0.98] md:w-full",
                  isSelected
                    ? "border-accent bg-accent text-accent-foreground shadow-md shadow-accent/10"
                    : "border-border text-foreground hover:border-accent/45 hover:bg-background",
                )}
              >
                <div className="relative">
                  {p.photo ? (
                    <img
                      src={p.photo}
                      alt={p.name}
                      className={cn(
                        "size-12 rounded-full border object-cover transition-colors duration-200",
                        isSelected ? "border-accent-foreground/55" : "border-border",
                      )}
                      loading="lazy"
                      width={96}
                      height={96}
                    />
                  ) : (
                    <div
                      className={cn(
                        "grid size-12 place-items-center rounded-full border bg-muted transition-colors duration-200",
                        isSelected ? "border-accent-foreground/55 bg-accent-foreground/10" : "border-border",
                      )}
                    >
                      <UserRound className={cn("size-5", isSelected ? "text-accent-foreground" : "text-muted-foreground")} />
                    </div>
                  )}
                  {isSelected && (
                    <div className="absolute -bottom-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-accent-foreground text-accent shadow-sm">
                      <Check className="size-3" />
                    </div>
                  )}
                </div>
                <p
                  className={cn(
                    "line-clamp-2 h-7 w-full text-center text-[11px] font-extrabold leading-tight",
                    isSelected ? "text-accent-foreground" : "text-foreground",
                  )}
                >
                  {p.name}
                </p>
              </button>
            );
          }}
        />
      </div>
    </div>
  );
}

/* ---------- Date / Time (real availability from DB) ---------- */
function DateTimeStep({
  studioId,
  studioSlug,
  studioTimezone,
  staffId,
  eligibleStaffIds,
  getStaffId,
  durationMin,
  minBookingNoticeMin,
  unavailableStatus,
  date,
  time,
  professionals,
  selectedProfessional,
  onPickProfessional,
  onPickDate,
  onPickTime,
}: {
  studioId: string;
  studioSlug: string;
  studioTimezone?: string | null;
  staffId: string | null;
  eligibleStaffIds: string[];
  getStaffId: (professional: Professional) => string;
  durationMin: number;
  minBookingNoticeMin: number;
  unavailableStatus?: string | null;
  date: Date | null;
  time: string | null;
  professionals: Professional[];
  selectedProfessional: Professional | null;
  onPickProfessional: (p: Professional | null) => void;
  onPickDate: (d: Date) => void;
  onPickTime: (slot: AvailableSlot) => void;
}) {
  const allDates = useMemo(() => getNextDates(120, studioTimezone || "Europe/Lisbon"), [studioTimezone]);
  const [weekStart, setWeekStart] = useState(0);
  const week = allDates.slice(weekStart, weekStart + 7);

  const [slots, setSlots] = useState<import("@/lib/availability").AvailableSlot[]>([]);
  const [allStaffSlots, setAllStaffSlots] = useState<import("@/lib/availability").AvailableSlot[]>([]);
  const [loading, setLoading] = useState(false);
  const [staffLoading, setStaffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshTimerRef = useRef<number | null>(null);
  const eligibleStaffKey = useMemo(() => [...eligibleStaffIds].sort().join(","), [eligibleStaffIds]);
  const eligibleStaffList = useMemo(
    () => eligibleStaffKey.split(",").filter(Boolean),
    [eligibleStaffKey],
  );
  const allStaffSlotsCountRef = useRef(0);
  const slotsCountRef = useRef(0);

  // For same-day availability: probe today's real slots before showing the badge.
  // "idle" → not yet started | "checking" → fetching | "yes" → slots exist | "no" → no slots
  const [immediateCheck, setImmediateCheck] = useState<"idle" | "checking" | "yes" | "no">("idle");

  const selectedProfessionalId = selectedProfessional ? getStaffId(selectedProfessional) : null;
  const selectedDateKey = useMemo(
    () => (date ? formatDateKeyForStudio(date, studioTimezone || "Europe/Lisbon") : null),
    [date, studioTimezone],
  );

  useEffect(() => {
    allStaffSlotsCountRef.current = allStaffSlots.length;
  }, [allStaffSlots.length]);

  useEffect(() => {
    slotsCountRef.current = slots.length;
  }, [slots.length]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(() => {
        setRefreshTick((value) => value + 1);
      }, 350);
    };
    const channel = supabase
      .channel(`public-availability-${studioId}-${staffId ?? "any"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `studio_id=eq.${studioId}` }, () => {
        scheduleRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_payment_requests", filter: `studio_id=eq.${studioId}` }, () => {
        scheduleRefresh();
      })
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "staff_time_off",
          ...(staffId ? { filter: `staff_id=eq.${staffId}` } : {}),
        },
        () => {
          scheduleRefresh();
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_availability", filter: `studio_id=eq.${studioId}` }, () => {
        scheduleRefresh();
      })
      .subscribe();
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, [studioId, staffId]);

  useEffect(() => {
    let active = true;
    if (!date || eligibleStaffList.length === 0) {
      setAllStaffSlots([]);
      return;
    }
    setStaffLoading(allStaffSlotsCountRef.current === 0);
    import("@/lib/availability")
      .then(async ({ fetchAvailableSlots }) => {
        const batches = await Promise.all(
          eligibleStaffList.map((id) =>
            fetchAvailableSlots({
              studioSlug,
              staffId: id,
              date,
              durationMin,
              minBookingNoticeMin,
              studioTimezone,
            }),
          ),
        );
        return batches.flat().sort((a, b) => a.slot_start.localeCompare(b.slot_start));
      })
      .then((data) => {
        if (active) setAllStaffSlots(data);
      })
      .catch(() => {
        if (active) setAllStaffSlots([]);
      })
      .finally(() => {
        if (active) setStaffLoading(false);
      });
    return () => {
      active = false;
    };
  }, [studioSlug, studioTimezone, eligibleStaffList, date, durationMin, minBookingNoticeMin, refreshTick]);

  // Fetch slots whenever date/staff/duration changes
  useEffect(() => {
    let active = true;
    if (!date) {
      setSlots([]);
      return;
    }
    setLoading(slotsCountRef.current === 0);
    setError(null);
    import("@/lib/availability")
      .then(async ({ fetchAvailableSlots }) => {
        if (!staffId) return [];
        if (eligibleStaffList.length === 0) {
          return fetchAvailableSlots({
            studioSlug,
            staffId,
            date,
            durationMin,
            minBookingNoticeMin,
            studioTimezone,
          });
        }
        return fetchAvailableSlots({
          studioSlug,
          staffId,
          date,
          durationMin,
          minBookingNoticeMin,
          studioTimezone,
        });
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
  }, [studioSlug, studioTimezone, staffId, eligibleStaffList, date, durationMin, minBookingNoticeMin, refreshTick]);

  // Probe today's real slots when same-day availability is active (minBookingNoticeMin=0).
  // Only runs once per mount (or when key dependencies change). If real slots
  // exist → set "yes" and auto-select today; otherwise → "no" (hide badge).
  useEffect(() => {
    if (minBookingNoticeMin !== 0) { setImmediateCheck("idle"); return; }
    let active = true;
    setImmediateCheck("checking");
    const today = new Date();
    import("@/lib/availability")
      .then(async ({ fetchAvailableSlots }) => {
        let found: import("@/lib/availability").AvailableSlot[];
        if (staffId || eligibleStaffList.length === 0) {
          found = await fetchAvailableSlots({
            studioSlug,
            staffId,
            date: today,
            durationMin,
            minBookingNoticeMin: 0,
            studioTimezone,
          });
        } else {
          const batches = await Promise.all(
            eligibleStaffList.map((id) =>
              fetchAvailableSlots({
                studioSlug,
                staffId: id,
                date: today,
                durationMin,
                minBookingNoticeMin: 0,
                studioTimezone,
              }),
            ),
          );
          found = batches.flat();
        }
        if (!active) return;
        if (found.length > 0) {
          setImmediateCheck("yes");
        } else {
          setImmediateCheck("no");
        }
      })
      .catch(() => { if (active) setImmediateCheck("no"); });
    return () => { active = false; };
  }, [minBookingNoticeMin, studioSlug, studioTimezone, staffId, eligibleStaffList, durationMin]);

  const selectedSlotsFromAllStaff = useMemo(
    () =>
      selectedProfessionalId && selectedDateKey
        ? allStaffSlots.filter(
            (slot) =>
              slot.staff_id === selectedProfessionalId &&
              formatDateKeyForStudio(new Date(slot.slot_start), studioTimezone || "Europe/Lisbon") ===
                selectedDateKey,
          )
        : [],
    [allStaffSlots, selectedDateKey, selectedProfessionalId, studioTimezone],
  );
  const selectedStaffSlots = useMemo(
    () =>
      selectedDateKey
        ? slots.filter(
            (slot) =>
              formatDateKeyForStudio(new Date(slot.slot_start), studioTimezone || "Europe/Lisbon") ===
              selectedDateKey,
          )
        : [],
    [selectedDateKey, slots, studioTimezone],
  );
  const visibleSlots =
    selectedSlotsFromAllStaff.length > 0 ? selectedSlotsFromAllStaff : selectedStaffSlots;

  const grouped = useMemo(() => {
    if (visibleSlots.length === 0) return { morning: [], afternoon: [], evening: [] };
    // lazy import group helper inline to avoid extra await
    const morning: typeof visibleSlots = [];
    const afternoon: typeof visibleSlots = [];
    const evening: typeof visibleSlots = [];
    const seen = new Set<string>();
    for (const s of visibleSlots) {
      if (seen.has(s.slot_label)) continue;
      seen.add(s.slot_label);
      const h = parseInt(s.slot_label.slice(0, 2), 10);
      if (h < 12) morning.push(s);
      else if (h < 17) afternoon.push(s);
      else evening.push(s);
    }
    return { morning, afternoon, evening };
  }, [visibleSlots]);

  const availableStaffIdSet = useMemo(
    () => new Set(allStaffSlots.map((slot) => slot.staff_id)),
    [allStaffSlots],
  );
  const availableProfessionals = useMemo(
    () =>
      !date
        ? []
        : professionals.filter((professional) => availableStaffIdSet.has(getStaffId(professional))),
    [availableStaffIdSet, date, getStaffId, professionals],
  );

  useEffect(() => {
    if (!date) return;
    let debugEnabled = import.meta.env.DEV;
    if (!debugEnabled && typeof window !== "undefined") {
      try {
        debugEnabled = window.localStorage.getItem("bellza:availability-debug") === "1";
      } catch {
        debugEnabled = false;
      }
    }
    if (!debugEnabled) return;
    const mask = (value: string | null | undefined) =>
      value && value.length > 8 ? `${value.slice(0, 8)}...` : value ?? null;
    console.info("[booking-availability]", "frontend_state", {
      selectedDate: date.toISOString(),
      studioTimezone: studioTimezone || "Europe/Lisbon",
      selectedStaffId: mask(staffId),
      selectedProfessionalId: mask(selectedProfessionalId),
      eligibleStaffCount: eligibleStaffList.length,
      durationMin,
      minBookingNoticeMin,
      allStaffSlotsCount: allStaffSlots.length,
      selectedStaffSlotsCount: selectedStaffSlots.length,
      selectedSlotsFromAllStaffCount: selectedSlotsFromAllStaff.length,
      visibleSlotsCount: visibleSlots.length,
      availableProfessionalsCount: availableProfessionals.length,
      loading,
      staffLoading,
      hasError: Boolean(error),
    });
  }, [
    allStaffSlots.length,
    availableProfessionals,
    date,
    durationMin,
    eligibleStaffList,
    error,
    getStaffId,
    loading,
    minBookingNoticeMin,
    selectedProfessional,
    selectedProfessionalId,
    selectedSlotsFromAllStaff.length,
    selectedStaffSlots.length,
    staffId,
    staffLoading,
    studioTimezone,
    visibleSlots.length,
  ]);

  useEffect(() => {
    if (!date || staffLoading || !selectedProfessional || allStaffSlots.length === 0) return;
    if (!availableStaffIdSet.has(getStaffId(selectedProfessional))) {
      onPickProfessional(null);
    }
  }, [
    availableStaffIdSet,
    date,
    getStaffId,
    onPickProfessional,
    selectedProfessional,
    staffLoading,
    allStaffSlots.length,
  ]);

  const headerLabel = useMemo(() => {
    if (!week.length) return "";
    return week[0].toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  }, [week]);

  const noProfessionalsForDay =
    Boolean(date) &&
    !loading &&
    !staffLoading &&
    !error &&
    allStaffSlots.length === 0;
  const noSlotsForSelectedProfessional =
    Boolean(date) &&
    !loading &&
    !staffLoading &&
    !error &&
    Boolean(selectedProfessional) &&
    allStaffSlots.length > 0 &&
    visibleSlots.length === 0;
  const isSelectedToday = date ? new Date().toDateString() === date.toDateString() : false;
  const showImmediateAvailabilityStatus = !date || isSelectedToday;
  const blockedImmediateSlots = useMemo(
    () => (isSelectedToday ? getBlockedImmediateSlots(minBookingNoticeMin) : []),
    [isSelectedToday, minBookingNoticeMin],
  );

  return (
    <section className="animate-slide-up space-y-4 rounded-[1.45rem] border border-border bg-card/76 p-3.5 shadow-sm backdrop-blur md:p-5">
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
          {minBookingNoticeMin === 0 && showImmediateAvailabilityStatus && immediateCheck === "yes" ? (
            <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              Agenda disponível · consulte os horários
            </p>
          ) : minBookingNoticeMin === 0 && showImmediateAvailabilityStatus && immediateCheck === "no" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Agenda disponível, mas sem horário livre para hoje. Escolha um horário futuro.
            </p>
          ) : minBookingNoticeMin === 0 && showImmediateAvailabilityStatus && immediateCheck === "checking" ? (
            <p className="mt-1 text-xs text-muted-foreground">A verificar disponibilidade…</p>
          ) : (
            <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              {minBookingNoticeMin <= 0
                ? "Marcações disponíveis sem limite mínimo de antecedência."
                : `Marcações disponíveis com ${formatNotice(minBookingNoticeMin)} de antecedência.`}
            </p>
          )}
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
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-hide">
        {week.map((d) => {
          const active = date?.toDateString() === d.toDateString();
          const isToday = new Date().toDateString() === d.toDateString();
          return (
            <button
              key={d.toISOString()}
              onClick={() => onPickDate(d)}
              className={cn(
                "flex h-16 min-w-[3.55rem] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-[1.05rem] border shadow-sm transition-all duration-200 active:scale-95",
                active
                  ? "border-accent bg-accent text-accent-foreground shadow-md shadow-accent/10"
                  : "border-border bg-background text-foreground hover:border-accent/45",
              )}
            >
              <span
                className={cn(
                    "font-mono text-[8px] uppercase",
                  active ? "opacity-70" : "text-muted-foreground",
                )}
              >
                {d.toLocaleDateString("pt-PT", { weekday: "short" }).slice(0, 3)}
              </span>
              <span className="text-sm font-extrabold leading-none">{d.getDate()}</span>
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

      {date && staffLoading && allStaffSlots.length === 0 && professionals.length > 1 && (
        <p className="rounded-2xl bg-surface p-4 text-center text-sm text-muted-foreground">
          A verificar profissionais disponiveis...
        </p>
      )}

      {date && availableProfessionals.length > 0 && (
        <PublicProfessionalChooser
          pros={availableProfessionals}
          selected={selectedProfessional}
          onSelect={onPickProfessional}
        />
      )}

      {/* Time slots */}
      <div className="rounded-[1.35rem] bg-background/66 p-3 ring-1 ring-border">
        <SectionTitle>Horário</SectionTitle>

        {!date && (
          <p className="mt-3 rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
            Escolha um dia para ver os horários disponíveis.
          </p>
        )}

        {date && !selectedProfessional && allStaffSlots.length > 0 && (
          <p className="mt-3 rounded-2xl bg-surface p-5 text-center text-sm text-muted-foreground">
            Escolha um profissional para ver os horarios.
          </p>
        )}

        {noProfessionalsForDay && (
          <p className="mt-3 rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
            Não encontramos horários livres para a duração escolhida nesta data. Escolha outro dia.
          </p>
        )}

        {date && selectedProfessional && loading && visibleSlots.length === 0 && (
          <p className="mt-3 rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
            A verificar disponibilidade…
          </p>
        )}

        {date && selectedProfessional && error && (
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

        {date && selectedProfessional && !loading && !error && blockedImmediateSlots.length > 0 && (
          <div className="mt-4">
            <BlockedImmediateSlots slots={blockedImmediateSlots} />
          </div>
        )}

        {noSlotsForSelectedProfessional && (
          <NoSlotsCard
            studioSlug={studioSlug}
            studioTimezone={studioTimezone}
            staffId={staffId}
            unavailableStatus={unavailableStatus}
            durationMin={durationMin}
            minBookingNoticeMin={minBookingNoticeMin}
            fromDate={date!}
            onPickAlternative={(d, slot) => {
              onPickDate(d);
              onPickTime(slot);
            }}
          />
        )}

        {date && selectedProfessional && !error && visibleSlots.length > 0 && (
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
            title="Este horário não está mais disponível para marcação imediata."
            className="cursor-not-allowed rounded-xl bg-muted/50 py-3 text-xs font-bold text-muted-foreground/70 ring-1 ring-border/70 line-through"
          >
            {slot}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Este horário não está mais disponível para marcação imediata.
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

function formatDateKeyForStudio(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const read = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = read("year");
    const month = read("month");
    const day = read("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    /* fall back to local date below */
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  studioTimezone,
  staffId,
  unavailableStatus,
  durationMin,
  minBookingNoticeMin,
  fromDate,
  onPickAlternative,
}: {
  studioSlug: string;
  studioTimezone?: string | null;
  staffId: string | null;
  unavailableStatus?: string | null;
  durationMin: number;
  minBookingNoticeMin: number;
  fromDate: Date;
  onPickAlternative: (d: Date, slot: AvailableSlot) => void;
}) {
  const [alts, setAlts] = useState<{ date: Date; slot: AvailableSlot }[]>([]);
  const [searching, setSearching] = useState(true);
  const unavailableCopy = getUnavailableCopy(unavailableStatus);

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
            studioTimezone,
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
  }, [studioSlug, studioTimezone, staffId, durationMin, minBookingNoticeMin, fromDate]);

  return (
    <div className="mt-3 rounded-[1.35rem] border border-border/70 bg-surface/80 p-5 text-center shadow-sm">
      <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300">
        <CalendarOff className="size-5" />
      </span>
      <p className="mt-3 text-sm font-bold">{unavailableCopy.title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {unavailableCopy.description ??
          (staffId
            ? "A profissional escolhida não tem horários livres com a duração necessária."
            : "Nenhuma profissional tem horários livres neste período.")}
      </p>
      {searching && <p className="mt-3 text-xs text-muted-foreground">A procurar alternativas...</p>}
      {!searching && alts.length === 0 && (
        <p className="mx-auto mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
          Sem alternativas nos próximos 14 dias. Tente outra profissional ou outro período.
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

function getUnavailableCopy(status?: string | null) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "absent") {
    return {
      title: "Esta profissional está em folga hoje.",
      description: "A agenda está temporariamente suspensa. Consulte outro dia ou escolha outra profissional.",
    };
  }
  if (["vacation", "holiday", "ferias", "férias"].includes(normalized)) {
    return {
      title: "Esta profissional está de férias.",
      description: "Não há horários disponíveis durante este período. Consulte outra profissional ou volte mais tarde.",
    };
  }
  return {
    title: "Não há horários disponíveis neste período.",
    description: null as string | null,
  };
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
  const selectedUpsells = upsells.filter((u) => extras[u.id]);
  const selectedPricing = calculateUpsellPricing(selectedUpsells);

  return (
    <section className="animate-slide-up space-y-4 pt-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <SectionTitle>Adicionar junto e poupar</SectionTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha um ou mais serviços complementares. A poupança é calculada automaticamente.
          </p>
        </div>
        {savings > 0 && (
          <span className="rounded-full bg-emerald-600/12 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Poupa {formatUpsellMoney(savings)}
          </span>
        )}
      </div>

      {/* Hero combo banner */}
      <div className="overflow-hidden rounded-[1.35rem] border border-emerald-400/20 bg-[linear-gradient(145deg,rgba(8,13,18,0.98),rgba(12,24,25,0.96)_55%,rgba(6,42,34,0.92))] p-4 text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
        <div className="hidden" />
        <p className="font-mono text-[9px] font-black uppercase tracking-[0.18em] text-emerald-300">
          Oferta especial
        </p>
        <h3 className="sr-only">
          Adicione + e poupe até 25%
        </h3>
        <p className="mt-1 text-xs opacity-80">
          Selecione abaixo para incluir na sua marcação.
        </p>
        <h3 className="mt-3 text-xl font-extrabold leading-tight">
          Quanto mais adicionar, maior pode ser a poupança.
        </h3>
        <p className="mt-1 text-xs opacity-80">
          Selecione abaixo para incluir na sua marcação.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-white/[0.06] px-2 py-2 ring-1 ring-white/10">
            <p className="text-[9px] uppercase tracking-[0.12em] text-white/55">Original</p>
            <p className="mt-1 font-mono text-sm font-black">
              {formatUpsellMoney(selectedPricing.originalTotal)}
            </p>
          </div>
          <div className="rounded-2xl bg-emerald-400/[0.10] px-2 py-2 ring-1 ring-emerald-300/15">
            <p className="text-[9px] uppercase tracking-[0.12em] text-emerald-100/70">Poupa</p>
            <p className="mt-1 font-mono text-sm font-black text-emerald-300">
              {`${formatPercent(selectedPricing.savingsPercent)} (${formatUpsellMoney(selectedPricing.savingsTotal)})`}
            </p>
          </div>
          <div className="rounded-2xl bg-white px-2 py-2 text-zinc-950">
            <p className="text-[9px] uppercase tracking-[0.12em] text-zinc-500">Final</p>
            <p className="mt-1 font-mono text-sm font-black">
              {formatUpsellMoney(selectedPricing.finalTotal)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {upsells.map((u) => {
          const added = !!extras[u.id];
          const line = calculateUpsellLine(u);
          const pctLabel = formatPercent(line.savingsPercent);
          const save = line.savings;
          const highlight = formatUpsellPublicHighlight(u, save, pctLabel);
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
                    {highlight}
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
                      <p className="mt-1 font-mono text-[10px] font-semibold text-muted-foreground line-through">
                        Original: {formatUpsellMoney(line.originalPrice)}
                      </p>
                      <p className="font-mono text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                        Desconto: {pctLabel} · Economia: {formatUpsellMoney(save)}
                      </p>
                      <p className={moneyClass("text-base")}>
                        Final: {formatUpsellMoney(line.finalPrice)}
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

function formatUpsellPublicHighlight(upsell: Upsell, save: number, pctLabel: string) {
  if (upsell.displayMode === "percent") return `${pctLabel} desconto`;
  if (upsell.displayMode === "amount") return `Poupe ${formatUpsellMoney(save)}`;
  return `-${pctLabel} · ${formatUpsellMoney(save)}`;
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
  clientAccountEmail,
  onClientChange,
  contactConsent,
  onContactConsentChange,
  sensitiveNotesConsent,
  onSensitiveNotesConsentChange,
  policyAccepted,
  onPolicyAcceptedChange,
  hasSavedContactConsent,
  hasSavedPolicyAcceptance,
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
  clientAccountEmail?: string | null;
  onClientChange: (c: ClientForm) => void;
  contactConsent: boolean;
  onContactConsentChange: (value: boolean) => void;
  sensitiveNotesConsent: boolean;
  onSensitiveNotesConsentChange: (value: boolean) => void;
  policyAccepted: boolean;
  onPolicyAcceptedChange: (value: boolean) => void;
  hasSavedContactConsent: boolean;
  hasSavedPolicyAcceptance: boolean;
  policyParts: PolicyTextParts;
  paymentPolicy?: string | null;
  depositPercent?: number | null;
  onOpenPolicy: () => void;
}) {
  const set = (patch: Partial<ClientForm>) => onClientChange({ ...client, ...patch });
  const hasSensitiveNotes = client.notes.trim().length > 0;
  const requiresDeposit = paymentPolicy === "pre_payment";
  // Default to 100 when deposit_percent is null (full payment online)
  const depositRate = Number(depositPercent ?? 100);
  const depositNow = requiresDeposit ? Math.round(total * depositRate) / 100 : 0;
  const remaining = Math.max(0, total - depositNow);
  const isFullPay = requiresDeposit && depositRate >= 100;
  const showPaymentPolicySummary = false as boolean;
  const policySummary = `${policyParts.rescheduleBody} ${policyParts.refundBody}`;
  return (
    <section className="animate-slide-up space-y-5 pt-4">
      {/* Identification card */}
      <div className="space-y-3">
        <SectionTitle>Os seus dados</SectionTitle>
        {clientAccountEmail && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs leading-relaxed text-emerald-800 dark:text-emerald-200">
            Sessão iniciada com {clientAccountEmail}. Os dados podem ser editados antes de confirmar.
          </div>
        )}
        <div className="space-y-2">
          <FieldInput
            label="Nome"
            value={client.name}
            onChange={(v) => set({ name: v })}
            placeholder="Como gostaria de ser identificado?"
            autoComplete="name"
          />
          <SharedInternationalPhoneInput
            label="WhatsApp"
            value={client.phone}
            onChange={(value) => set({ phone: value })}
          />
          <FieldInput
            label="Email (opcional)"
            value={client.email}
            onChange={(v) => set({ email: v })}
            placeholder="email@exemplo.com"
            type="email"
            autoComplete="email"
          />
          <label className="block rounded-2xl border border-border/70 bg-background/60 px-3.5 py-3 shadow-sm transition focus-within:border-foreground/25 focus-within:bg-background/90 focus-within:ring-2 focus-within:ring-foreground/10">
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
              className="mt-1.5 block w-full resize-none rounded-xl border-0 bg-transparent px-0 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </label>
          {!hasSavedContactConsent && (
            <ConsentCheckbox
              checked={contactConsent}
              onChange={onContactConsentChange}
              label="Autorizo o uso dos meus dados para gerir esta marcação e receber mensagens sobre a reserva."
            />
          )}
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
                {isFullPay ? "e do pagamento integral." : "e do sinal."}
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
            <Row
              key={e.id}
              label="Extra"
              value={`${e.name} · +${formatUpsellMoney(calculateUpsellLine(e).finalPrice)}`}
            />
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
        <p className="font-semibold text-foreground">{isFullPay ? "Pagamento e cancelamento" : "Sinal e cancelamento"}</p>
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
  availableUpsells,
  selectedExtras,
  onToggleExtra,
  client,
  clientAccountEmail,
  clientAccountName,
  onClientChange,
  contactConsent,
  onContactConsentChange,
  sensitiveNotesConsent,
  onSensitiveNotesConsentChange,
  policyAccepted,
  onPolicyAcceptedChange,
  hasSavedContactConsent,
  hasSavedPolicyAcceptance,
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
  availableUpsells: Upsell[];
  selectedExtras: Record<string, boolean>;
  onToggleExtra: (id: string) => void;
  client: ClientForm;
  clientAccountEmail?: string | null;
  clientAccountName?: string | null;
  onClientChange: (c: ClientForm) => void;
  contactConsent: boolean;
  onContactConsentChange: (value: boolean) => void;
  sensitiveNotesConsent: boolean;
  onSensitiveNotesConsentChange: (value: boolean) => void;
  policyAccepted: boolean;
  onPolicyAcceptedChange: (value: boolean) => void;
  hasSavedContactConsent: boolean;
  hasSavedPolicyAcceptance: boolean;
  policyParts: PolicyTextParts;
  paymentPolicy?: string | null;
  depositPercent?: number | null;
  onOpenPolicy: () => void;
}) {
  const [editingClientDetails, setEditingClientDetails] = useState(false);
  const set = (patch: Partial<ClientForm>) => onClientChange({ ...client, ...patch });
  const hasSensitiveNotes = client.notes.trim().length > 0;
  const requiresDeposit = paymentPolicy === "pre_payment";
  // Default to 100 when deposit_percent is null (full payment online)
  const depositRate = Number(depositPercent ?? 100);
  const depositNow = requiresDeposit ? Math.round(total * depositRate) / 100 : 0;
  const remaining = Math.max(0, total - depositNow);
  const isFullPay = requiresDeposit && depositRate >= 100;
  const showPaymentPolicySummary = false as boolean;
  const policySummary = `${policyParts.rescheduleBody} ${policyParts.refundBody}`;
  const missingClientFields = [
    client.name.trim().length < 2 ? "nome" : null,
    !isValidSharedInternationalPhone(client.phone) ? "telefone" : null,
    client.email && !/\S+@\S+\.\S+/.test(client.email) ? "e-mail válido" : null,
  ].filter(Boolean);
  const clientDetailsComplete = clientAccountEmail && missingClientFields.length === 0;
  const showNameField = editingClientDetails || !clientAccountEmail || client.name.trim().length < 2;
  const showEmailField =
    editingClientDetails || !clientAccountEmail || !client.email || !/\S+@\S+\.\S+/.test(client.email);
  const showPhoneField =
    editingClientDetails || !clientAccountEmail || !isValidSharedInternationalPhone(client.phone);
  const validUpsells = availableUpsells.filter((upsell) => {
    const line = calculateUpsellLine(upsell);
    const offeredServiceId =
      "offeredServiceId" in upsell ? String((upsell as Upsell & { offeredServiceId?: string }).offeredServiceId ?? "") : "";
    return (
      upsell.id !== service.id &&
      offeredServiceId !== service.id &&
      upsell.name.trim().length > 0 &&
      line.originalPrice > 0 &&
      line.finalPrice >= 0
    );
  });

  return (
    <section className="animate-slide-up space-y-5 pt-4">
      {(!clientDetailsComplete ||
        editingClientDetails ||
        hasSensitiveNotes ||
        !hasSavedContactConsent ||
        !hasSavedPolicyAcceptance) && (
      <div className="space-y-3">
        <SectionTitle>Os seus dados</SectionTitle>
        {clientAccountEmail && (
          <div className="rounded-3xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3.5 text-xs leading-relaxed text-emerald-800 shadow-sm shadow-emerald-950/5 dark:text-emerald-100">
            {clientDetailsComplete
              ? `Dados preenchidos para ${clientAccountName || client.name || clientAccountEmail}.`
              : `Sessão iniciada. Falta apenas ${missingClientFields.join(", ")} para confirmar.`}
          </div>
        )}
        <div className="space-y-3">
          {clientDetailsComplete && !editingClientDetails && (
            <div className="rounded-3xl border border-border/70 bg-background/70 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-extrabold tracking-tight text-foreground">{client.name}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2.5 py-1">{client.phone}</span>
                    <span className="rounded-full bg-muted px-2.5 py-1">{client.email}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingClientDetails(true)}
                  className="shrink-0 rounded-full border border-border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  Editar
                </button>
              </div>
            </div>
          )}
          {showNameField && (
            <FieldInput
              label="Nome"
              value={client.name}
              onChange={(v) => set({ name: v })}
              placeholder="Como prefere ser identificado?"
              autoComplete="name"
            />
          )}
          {showPhoneField && (
            <SharedInternationalPhoneInput
              label="WhatsApp"
              value={client.phone}
              onChange={(value) => set({ phone: value })}
            />
          )}
          {showEmailField && (
            <FieldInput
              label="Email (opcional)"
              value={client.email}
              onChange={(v) => set({ email: v })}
              placeholder="email@exemplo.com"
              type="email"
              autoComplete="email"
            />
          )}
          {client.notes.trim().length > 0 ? (
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
          ) : (
            <button
              type="button"
              onClick={() => set({ notes: " " })}
              className="text-left text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              + Adicionar observação (alergia, preferência…)
            </button>
          )}
          {!hasSavedContactConsent && (
            <ConsentCheckbox
              checked={contactConsent}
              onChange={onContactConsentChange}
              label="Autorizo o uso dos meus dados para gerir esta marcação e receber mensagens sobre a reserva."
            />
          )}
          {hasSensitiveNotes && (
            <ConsentCheckbox
              checked={sensitiveNotesConsent}
              onChange={onSensitiveNotesConsentChange}
              label="Quero partilhar estas observações com o estúdio para preparar melhor o atendimento."
            />
          )}
          {!hasSavedPolicyAcceptance && (
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
                  {isFullPay ? "e do pagamento integral." : "e do sinal."}
                </>
              }
            />
          )}
        </div>
      </div>
      )}

      {validUpsells.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Adicionar junto
              </p>
              <p className="mt-0.5 truncate text-sm font-extrabold text-foreground">
                Complete a reserva
              </p>
            </div>
            {savings > 0 && (
              <span className="shrink-0 rounded-full bg-emerald-600/12 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Poupa {formatUpsellMoney(savings)}
              </span>
            )}
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-hide md:grid md:grid-cols-2 md:overflow-visible">
            {validUpsells.map((upsell) => {
              const selected = Boolean(selectedExtras[upsell.id]);
              const line = calculateUpsellLine(upsell);
              const pctLabel = formatPercent(line.savingsPercent);
              const save = line.savings;
              const highlight = formatUpsellPublicHighlight(upsell, save, pctLabel);
              return (
                <button
                  key={upsell.id}
                  type="button"
                  onClick={() => onToggleExtra(upsell.id)}
                  className={cn(
                    "flex min-w-[15rem] flex-1 items-center gap-2 rounded-2xl border bg-background/70 p-2.5 text-left transition active:scale-[0.99] md:min-w-0",
                    selected
                      ? "border-emerald-400/50 bg-emerald-500/10 ring-2 ring-emerald-400/20"
                      : "border-border hover:border-foreground/20",
                  )}
                >
                  <img
                    src={upsell.photo}
                    alt={upsell.name}
                    className="size-11 shrink-0 rounded-xl object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="truncate text-xs font-extrabold leading-tight text-foreground">
                        {upsell.name}
                      </p>
                      {save > 0 && (
                        <span className="shrink-0 rounded-full bg-accent/12 px-2 py-0.5 font-mono text-[8px] font-black uppercase tracking-wider text-accent">
                          {highlight}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold">
                      <span className="font-mono text-muted-foreground">+{upsell.durationMin} min</span>
                      {save > 0 && (
                        <span className="font-mono text-muted-foreground line-through">
                          {formatUpsellMoney(line.originalPrice)}
                        </span>
                      )}
                      <span className="font-mono text-emerald-600 dark:text-emerald-400">
                        {formatUpsellMoney(line.finalPrice)}
                      </span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-black",
                      selected
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {selected ? "✓" : "+"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>Resumo</SectionTitle>
        <div className="mt-3 space-y-px overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          <Row label="Serviço" value={service.name} />
          <Row label="Profissional" value={proLabel} />
          <Row label="Data" value={formatDate(date)} />
          <Row label="Hora" value={time} />
          {extras.map((e) => (
            <Row
              key={e.id}
              label="Extra"
              value={`${e.name} · +${formatUpsellMoney(calculateUpsellLine(e).finalPrice)}`}
            />
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

      {showPaymentPolicySummary && (
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                {isFullPay ? "Pagamento integral" : requiresDeposit ? "Sinal" : "Pago no estúdio"}
              </p>
              <p className="text-sm font-extrabold text-foreground">
                {requiresDeposit ? formatMoney(depositNow) : formatMoney(0)}
                {isFullPay ? " — online agora" : !requiresDeposit ? " no estúdio" : ` (${depositRate}%)`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Cancelar até</p>
              <p className="text-sm font-extrabold text-foreground">{policyParts.hours}h antes</p>
            </div>
          </div>
          {policyParts.badge && (
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold",
                policyParts.refundTone === "warning"
                  ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {policyParts.badge}
            </span>
          )}
        </div>
        {!requiresDeposit && (
          <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
            Não há pagamento antecipado — paga no dia do serviço.
          </p>
        )}
        {requiresDeposit && !isFullPay && remaining > 0 && (
          <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
            Restam {formatMoney(remaining)} a pagar no estúdio.
          </p>
        )}
        <button
          type="button"
          onClick={onOpenPolicy}
          className="flex w-full items-center gap-2 border-t border-border/60 px-4 py-2.5 text-left text-xs font-medium text-muted-foreground transition hover:bg-muted/40"
        >
          <Info className="size-3.5 shrink-0" />
          Ver regras completas de cancelamento
        </button>
      </div>
      )}
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

function PublicNotificationBell({
  notifications,
  onMarkRead,
  onMarkAllRead,
}: {
  notifications: PublicClientNotification[];
  onMarkRead: (notificationId: string) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const sortedNotifications = useMemo(
    () =>
      [...notifications].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [notifications],
  );
  const unreadCount = sortedNotifications.filter((item) => item.status !== "read").length;

  async function markRead(notificationId: string, unread: boolean) {
    if (!unread || busyId) return;
    setBusyId(notificationId);
    try {
      await onMarkRead(notificationId);
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    if (unreadCount === 0 || busyAll) return;
    setBusyAll(true);
    try {
      await onMarkAllRead();
    } finally {
      setBusyAll(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir notificações"
        className="relative grid size-10 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/20 backdrop-blur-md transition hover:bg-white/20 active:scale-95 md:size-12"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-black/30">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[95] flex items-end bg-black/45 p-0 backdrop-blur-sm md:items-center md:justify-center md:p-6">
            <button
              type="button"
              aria-label="Fechar notificações"
              className="absolute inset-0 cursor-default"
              onClick={() => setOpen(false)}
            />
            <section className="relative max-h-[82vh] w-full overflow-hidden rounded-t-[1.6rem] border border-border/80 bg-card shadow-[0_24px_80px_rgba(0,0,0,0.3)] md:max-h-[78vh] md:max-w-[28rem] md:rounded-[1.6rem]">
              <div className="flex items-start justify-between gap-3 border-b border-border/80 bg-muted/20 px-4 py-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                    Notificações
                  </p>
                  <h2 className="mt-1 text-lg font-extrabold tracking-tight text-foreground">
                    Central do estúdio
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Reservas, pagamentos, lembretes e novidades.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={markAllRead}
                      disabled={busyAll}
                      className="max-w-[10rem] rounded-full border border-border bg-background/80 px-3 py-1.5 text-[10px] font-black text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
                    >
                      Marcar todas como vistas
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-background/80 text-muted-foreground ring-1 ring-border transition hover:text-foreground"
                    aria-label="Fechar"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="max-h-[calc(82vh-6.5rem)] overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:max-h-[calc(78vh-6.5rem)]">
                {sortedNotifications.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                    <div className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                      <Bell className="size-5" />
                    </div>
                    <p className="text-sm font-extrabold text-foreground">Sem notificações por enquanto</p>
                    <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                      Confirmações, alterações, pagamentos e avisos importantes aparecem aqui.
                    </p>
                  </div>
                ) : (
                  <ExpandableList
                    items={sortedNotifications}
                    initialCount={5}
                    getKey={(item) => item.id}
                    className="divide-y divide-border/70"
                    buttonWrapClassName="pb-5 pt-3"
                    moreLabel={(hidden) => `Ver mais ${hidden} notificação${hidden !== 1 ? "ões" : ""}`}
                    lessLabel="Ver menos"
                    renderItem={(item, index) => {
                      const unread = item.status !== "read";
                      const group = notificationDateGroup(item.createdAt);
                      const previous = sortedNotifications[index - 1];
                      const showGroup = !previous || notificationDateGroup(previous.createdAt) !== group;
                      return (
                        <div>
                          {showGroup && (
                            <div className="bg-background/45 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                              {group}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => markRead(item.id, unread)}
                            className={cn(
                              "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/35",
                              unread && "bg-red-500/[0.045]",
                            )}
                          >
                            <span
                              className={cn(
                                "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl",
                                unread
                                  ? "bg-red-500/12 text-red-600 dark:text-red-300"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              <Bell className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="line-clamp-1 text-sm font-extrabold text-foreground">
                                  {item.title}
                                </span>
                                {unread && <span className="size-2 shrink-0 rounded-full bg-red-500" />}
                              </span>
                              <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                {item.body}
                              </span>
                              <span className="mt-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                {formatDateTimeShort(item.createdAt)}
                              </span>
                            </span>
                            {busyId === item.id && (
                              <RefreshCcw className="mt-1 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                            )}
                          </button>
                        </div>
                      );
                    }}
                  />
                )}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

function notificationDateGroup(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recentes";
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return date.toLocaleDateString("pt-PT", { day: "2-digit", month: "long" });
}

function PublicClientAccountCard({
  userEmail,
  userName,
  userAvatarUrl,
  authLoading,
  clientArea,
  loading,
  profilePhone,
  savingProfile,
  studioName,
  studioId,
  professionals,
  openSignal,
  canInstallApp,
  isPwaInstalled,
  canPrompt,
  notificationStatus,
  followedStudios,
  onInstall,
  onDismissInstall,
  onEnableNotifications,
  onSavePhone,
  onSaveBirthday,
  onAutofill,
  onReload,
  onReviewSubmitted,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}: {
  userEmail: string | null;
  userName?: string | null;
  userAvatarUrl?: string | null;
  authLoading: boolean;
  clientArea: PublicClientAreaPayload | null;
  loading: boolean;
  profilePhone: string;
  savingProfile: boolean;
  studioName: string;
  studioId: string;
  professionals: Professional[];
  openSignal: number;
  canInstallApp: boolean;
  isPwaInstalled: boolean;
  canPrompt: boolean;
  notificationStatus: "unknown" | "granted" | "denied";
  followedStudios: FollowedStudio[];
  onInstall: () => void;
  onDismissInstall: () => void;
  onEnableNotifications: () => void;
  onSavePhone: (phone: string) => Promise<void>;
  onSaveBirthday: (dateOfBirth: string) => Promise<void>;
  onAutofill: () => void;
  onReload: () => void;
  onReviewSubmitted?: () => void;
  onMarkNotificationRead: (notificationId: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [accountTab, setAccountTab] = useState<ClientAccountTab>("overview");
  const [phoneDraft, setPhoneDraft] = useState(profilePhone);
  const [phoneEditorOpen, setPhoneEditorOpen] = useState(false);
  const clientProfile = clientArea?.profile ?? null;
  const clientAppointments = Array.isArray(clientArea?.appointments) ? clientArea.appointments : [];
  const clientTotals = clientArea?.totals ?? { paid: 0, deposits: 0, pending: 0 };
  const clientLoyalty = clientArea?.loyalty ?? null;
  const pendingPayments = clientArea?.pendingPayments ?? [];
  const upcoming = sortAppointmentsChronologically(
    clientAppointments.filter((appointment) => appointment.isUpcoming),
    "future",
  );
  // Pass full history — filtering/pagination is handled inside ClientAccountArea
  const history = sortAppointmentsChronologically(
    clientAppointments.filter((appointment) => !appointment.isUpcoming),
    "history",
  );
  const displayName = userName || clientProfile?.name || userEmail || "Cliente";
  const savedPhone = normalizeSharedInternationalPhone(clientProfile?.phone || profilePhone);
  const needsPhone = savedPhone.replace(/\D/g, "").length < 9;
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  // Pending review badge — computed from server data so it's available outside the scroll area
  const pendingReviewBadge = (() => {
    const reviewed = new Set(clientArea?.reviewedAppointmentIds ?? []);
    return history.filter(
      (a) => a.status === "completed" && a.paidAmount > 0 && !reviewed.has(a.id)
    ).length;
  })();

  // Tab bar rendered in AccountDrawer subheader slot (never scrolls)
  const accountTabBar = (
    <div className="overflow-x-auto scrollbar-none">
      <div className="flex min-w-max gap-1.5 rounded-[1.1rem] border border-border bg-card/95 p-1.5 shadow-sm backdrop-blur">
        {(
          [
            { id: "overview", label: "Geral" },
            { id: "bookings", label: "Reservas" },
            { id: "reviews", label: "Avaliações", badge: pendingReviewBadge > 0 ? pendingReviewBadge : undefined },
            { id: "payments", label: "Pagamentos" },
          ] as Array<{ id: ClientAccountTab; label: string; badge?: number }>
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAccountTab(item.id)}
            className={cn(
              "relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition-all",
              accountTab === item.id
                ? "bg-foreground text-background shadow-[0_2px_8px_rgba(0,0,0,0.14)]"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            {item.label}
            {item.badge != null && item.badge > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-black text-white">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  useEffect(() => {
    setPhoneDraft(savedPhone);
  }, [savedPhone]);

  useEffect(() => {
    if (needsPhone) {
      setPhoneEditorOpen(true);
    } else {
      setPhoneEditorOpen(false);
    }
  }, [needsPhone]);

  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);

  if (authLoading) {
    return (
      <div className="rounded-3xl border border-border bg-card/80 px-4 py-3 text-sm text-muted-foreground shadow-sm">
        A preparar acesso rápido...
      </div>
    );
  }

  if (!userEmail) {
    return (
      <>
      <div className="overflow-hidden rounded-2xl border border-border bg-card/90 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full flex-col items-start justify-between gap-3 px-4 py-4 text-left transition hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4"
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <LogIn className="size-4" />
              Entrar no app do estúdio
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Acompanhe reservas, pagamentos, histórico e avaliações em um só lugar.
            </span>
          </span>
          <span className="shrink-0 self-start rounded-full bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-background sm:self-center sm:tracking-[0.16em]">
            Opcional
          </span>
        </button>
      </div>
      {open && (
        <AccountDrawer title="Entrar no app do estúdio" onClose={() => setOpen(false)}>
          <PublicClientAuthForm studioName={studioName} />
        </AccountDrawer>
      )}
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card/90 px-3 py-2.5 shadow-sm backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-xs font-black text-background ring-2 ring-emerald-500/20">
            {userAvatarUrl ? (
              <img src={userAvatarUrl} alt={displayName} className="size-full object-cover" />
            ) : (
              initials || <UserRound className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-foreground">{displayName}</p>
            <p className="truncate text-[11px] font-medium text-muted-foreground">{userEmail}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full bg-emerald-500/12 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300 sm:inline-flex">
            Conectado
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-9 rounded-full bg-foreground px-3.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-background transition hover:opacity-90"
          >
            Minha conta
          </button>
        </div>
      </div>

      {open && (
        <AccountDrawer title="Minha conta" subheader={accountTabBar} onClose={() => setOpen(false)}>
          <ClientAccountArea
            tab={accountTab}
            onTabChange={setAccountTab}
            studioName={studioName}
            displayName={displayName}
            userEmail={userEmail}
            userAvatarUrl={userAvatarUrl}
            initials={initials}
            savedPhone={savedPhone}
            needsPhone={needsPhone}
            phoneDraft={phoneDraft}
            onPhoneDraftChange={setPhoneDraft}
            phoneEditorOpen={phoneEditorOpen}
            onPhoneEditorOpenChange={setPhoneEditorOpen}
            savingProfile={savingProfile}
            onSavePhone={onSavePhone}
            onSaveBirthday={onSaveBirthday}
            loading={loading}
            onReload={onReload}
            onAutofill={onAutofill}
            clientProfile={clientProfile}
            clientTotals={clientTotals}
            loyalty={clientLoyalty}
            notifications={clientArea?.notifications ?? []}
            pendingPayments={pendingPayments}
            upcoming={upcoming}
            history={history}
            canInstallApp={canInstallApp}
            isPwaInstalled={isPwaInstalled}
            canPrompt={canPrompt}
            notificationStatus={notificationStatus}
            onInstall={onInstall}
            onDismissInstall={onDismissInstall}
            onEnableNotifications={onEnableNotifications}
            followedStudios={followedStudios}
            studioId={studioId}
            professionals={professionals}
            reviewedAppointmentIds={clientArea?.reviewedAppointmentIds}
            onReviewSubmitted={onReviewSubmitted}
            onMarkNotificationRead={onMarkNotificationRead}
            onMarkAllNotificationsRead={onMarkAllNotificationsRead}
          />
        </AccountDrawer>
      )}
    </>
  );
}

type ClientAccountTab = "overview" | "bookings" | "notifications" | "reviews" | "payments" | "profile";

function ClientAccountArea({
  tab,
  onTabChange,
  studioName,
  displayName,
  userEmail,
  userAvatarUrl,
  initials,
  savedPhone,
  needsPhone,
  phoneDraft,
  onPhoneDraftChange,
  phoneEditorOpen,
  onPhoneEditorOpenChange,
  savingProfile,
  onSavePhone,
  onSaveBirthday,
  loading,
  onReload,
  onAutofill,
  clientProfile,
  clientTotals,
  loyalty,
  notifications,
  pendingPayments,
  upcoming,
  history,
  canInstallApp,
  isPwaInstalled,
  canPrompt,
  notificationStatus,
  onInstall,
  onDismissInstall,
  onEnableNotifications,
  followedStudios,
  studioId,
  professionals,
  reviewedAppointmentIds,
  onReviewSubmitted,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
}: {
  tab: ClientAccountTab;
  onTabChange: (tab: ClientAccountTab) => void;
  studioName: string;
  displayName: string;
  userEmail: string;
  userAvatarUrl?: string | null;
  initials: string;
  savedPhone: string;
  needsPhone: boolean;
  phoneDraft: string;
  onPhoneDraftChange: (value: string) => void;
  phoneEditorOpen: boolean;
  onPhoneEditorOpenChange: (value: boolean) => void;
  savingProfile: boolean;
  onSavePhone: (phone: string) => Promise<void>;
  onSaveBirthday: (dateOfBirth: string) => Promise<void>;
  loading: boolean;
  onReload: () => void;
  onAutofill: () => void;
  clientProfile: PublicClientAreaPayload["profile"] | null;
  clientTotals: PublicClientAreaPayload["totals"];
  loyalty: NonNullable<PublicClientAreaPayload["loyalty"]> | null;
  notifications: NonNullable<PublicClientAreaPayload["notifications"]>;
  pendingPayments: PublicClientAreaPayload["pendingPayments"];
  upcoming: PublicClientAreaPayload["appointments"];
  history: PublicClientAreaPayload["appointments"];
  canInstallApp: boolean;
  isPwaInstalled: boolean;
  canPrompt: boolean;
  notificationStatus: "unknown" | "granted" | "denied";
  onInstall: () => void;
  onDismissInstall: () => void;
  onEnableNotifications: () => void;
  followedStudios: FollowedStudio[];
  studioId: string;
  professionals: Professional[];
  reviewedAppointmentIds?: string[];
  onReviewSubmitted?: () => void;
  onMarkNotificationRead: (notificationId: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
}) {
  const [reviewApptId, setReviewApptId] = useState<string | null>(null);
  const [reviewedApptIds, setReviewedApptIds] = useState<Set<string>>(new Set());
  const [markingAllNotifications, setMarkingAllNotifications] = useState(false);
  const [birthdayDraft, setBirthdayDraft] = useState(clientProfile?.dateOfBirth ?? "");
  const [birthdayEditorOpen, setBirthdayEditorOpen] = useState(false);

  // History filter + expand state
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<string>("all");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const HISTORY_INITIAL = 3;

  // Sync server-provided reviewed IDs into local state (merges with any reviews
  // submitted during this session so we never lose in-session additions)
  useEffect(() => {
    if (!reviewedAppointmentIds?.length) return;
    setReviewedApptIds((prev) => {
      const next = new Set(prev);
      for (const id of reviewedAppointmentIds) next.add(id);
      return next;
    });
  }, [reviewedAppointmentIds]);

  useEffect(() => {
    setBirthdayDraft(clientProfile?.dateOfBirth ?? "");
  }, [clientProfile?.dateOfBirth]);

  // Pending reviews = ONLY completed (service done) + paid + not yet reviewed
  const pendingReviews = history.filter(
    (a) => a.status === "completed" && a.paidAmount > 0 && !reviewedApptIds.has(a.id),
  );
  const completedReviews = history.filter((a) => reviewedApptIds.has(a.id));
  const unreadNotifications = notifications.filter((item) => item.status !== "read").length;

  async function markAllNotificationsRead() {
    if (unreadNotifications === 0 || markingAllNotifications) return;
    setMarkingAllNotifications(true);
    try {
      await onMarkAllNotificationsRead();
    } finally {
      setMarkingAllNotifications(false);
    }
  }

  // Shared review-form toggle — used in both Reservas and Avaliações tabs
  function toggleReview(id: string) {
    setReviewApptId((prev) => (prev === id ? null : id));
  }

  async function copyReferralLink() {
    if (!loyalty?.referralUrl) return;
    try {
      await navigator.clipboard.writeText(loyalty.referralUrl);
      toast.success("Link de indicação copiado.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  // Shared appointment history row — fits inside a divide-y list
  function ReservationSummary({
    appointment,
    tone = "muted",
  }: {
    appointment: PublicClientAreaPayload["appointments"][number];
    tone?: "upcoming" | "muted";
  }) {
    return (
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-[4.25rem] shrink-0 rounded-2xl px-2 py-2 text-center",
            tone === "upcoming"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-foreground",
          )}
        >
          <p className="text-base font-black leading-none tabular-nums">
            {formatTimeOnly(appointment.startsAt)}
          </p>
          <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {formatDateTimeShort(appointment.startsAt).split(",")[0]}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 break-words text-[11px] font-black uppercase leading-snug tracking-[0.14em] text-muted-foreground">
              {studioName}
            </p>
            <span className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold",
              appointment.status === "confirmed" && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
              appointment.status === "completed" && "bg-blue-500/12 text-blue-700 dark:text-blue-400",
              appointment.status === "cancelled" && "bg-red-500/12 text-red-700 dark:text-red-400",
              appointment.status === "no_show" && "bg-orange-500/12 text-orange-700 dark:text-orange-400",
              !["confirmed","completed","cancelled","no_show"].includes(appointment.status) && "bg-muted text-muted-foreground",
            )}>
              {clientStatusLabel(appointment.status)}
            </span>
          </div>
          <p className="mt-1 break-words text-sm font-extrabold leading-snug text-foreground">
            {appointment.services[0]?.name ?? "ServiÃ§o"}
          </p>
          {appointment.staffName && (
            <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
              {appointment.staffName}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {appointment.totalPrice > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {formatMoney(appointment.totalPrice)}
              </span>
            )}
            {appointment.paidAmount > 0 && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                Pago {formatMoney(appointment.paidAmount)}
              </span>
            )}
            {appointment.pendingAmount > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                Por receber {formatMoney(appointment.pendingAmount)}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  function HistoryCard({ appointment }: { appointment: PublicClientAreaPayload["appointments"][number] }) {
    const isReviewed = reviewedApptIds.has(appointment.id);
    const isReviewable = appointment.status === "completed" && appointment.paidAmount > 0;
    const isOpen = reviewApptId === appointment.id && !isReviewed;
    return (
      <div>
        <div className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="w-[4.25rem] shrink-0 rounded-2xl bg-muted px-2 py-2 text-center text-foreground">
              <p className="text-base font-black leading-none tabular-nums">
                {formatTimeOnly(appointment.startsAt)}
              </p>
              <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {formatDateTimeShort(appointment.startsAt).split(",")[0]}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start gap-2">
                <p className="w-full break-words text-[11px] font-black uppercase leading-snug tracking-[0.14em] text-muted-foreground">
                  {studioName}
                </p>
                <p className="min-w-0 break-words text-sm font-extrabold leading-snug text-foreground">
                  {appointment.services[0]?.name ?? "Serviço"}
                </p>
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                  appointment.status === "confirmed" && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
                  appointment.status === "completed" && "bg-blue-500/12 text-blue-700 dark:text-blue-400",
                  appointment.status === "cancelled" && "bg-red-500/12 text-red-700 dark:text-red-400",
                  appointment.status === "no_show" && "bg-orange-500/12 text-orange-700 dark:text-orange-400",
                  !["confirmed","completed","cancelled","no_show"].includes(appointment.status) && "bg-muted text-muted-foreground",
                )}>
                  {clientStatusLabel(appointment.status)}
                </span>
              </div>
              <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
                {formatDateTimeShort(appointment.startsAt)}
                {appointment.staffName ? ` · ${appointment.staffName}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {appointment.totalPrice > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {formatMoney(appointment.totalPrice)}
                  </span>
                )}
                {appointment.paidAmount > 0 && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                    Pago {formatMoney(appointment.paidAmount)}
                  </span>
                )}
              </div>
            </div>
            {isReviewable && (
              isReviewed ? (
                <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3" /> Avaliada
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleReview(appointment.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold transition",
                    isOpen
                      ? "bg-muted text-muted-foreground"
                      : "bg-accent/10 text-accent hover:bg-accent/20",
                  )}
                >
                  <Star className="size-3" />
                  {isOpen ? "Fechar" : "Avaliar"}
                </button>
              )
            )}
          </div>
        </div>
        {isOpen && (
          <div className="border-t border-border bg-muted/30 px-4 pb-4 pt-3">
            <ReviewForm
              studioId={studioId}
              appointmentId={appointment.id}
              professionals={professionals}
              reviewerName={displayName}
              onDone={() => setReviewApptId(null)}
              onSubmitted={() => {
                setReviewedApptIds((prev) => new Set(prev).add(appointment.id));
                onReviewSubmitted?.();
              }}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-0 pb-10">

      {/* ══════════════════ HEADER PREMIUM ══════════════════ */}
      <div className="relative overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-[oklch(0.16_0.02_265)] via-[oklch(0.19_0.022_268)] to-[oklch(0.15_0.018_280)] shadow-[0_20px_60px_rgba(0,0,0,0.32)]">
        {/* decorative orb */}
        <div className="pointer-events-none absolute -right-12 -top-12 size-48 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 size-36 rounded-full bg-emerald-400/15 blur-2xl" />

        <div className="relative px-5 pb-5 pt-5">
          {/* avatar row */}
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="grid size-[3.75rem] place-items-center overflow-hidden rounded-[1.1rem] bg-white/10 text-base font-black text-white ring-2 ring-white/20">
                {userAvatarUrl ? (
                  <img src={userAvatarUrl} alt={displayName} className="size-full object-cover" />
                ) : (
                  <span className="text-white/90">{initials || <UserRound className="size-5 text-white/70" />}</span>
                )}
              </div>
              <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-emerald-400 ring-2 ring-foreground">
                <span className="size-1.5 rounded-full bg-white" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[1.05rem] font-extrabold leading-tight tracking-tight text-white">
                {displayName}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-white/55">{userEmail}</p>
            </div>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 text-white/70 transition hover:bg-white/20 disabled:opacity-40"
              title="Atualizar"
            >
              <RefreshCcw className={cn("size-4", loading && "animate-spin")} />
            </button>
          </div>

          {/* stats strip */}
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "Reservas", value: String(upcoming.length + history.length) },
              { label: "Total pago", value: formatMoney(clientTotals.paid ?? 0) },
              { label: "Avaliações", value: String(completedReviews.length + pendingReviews.length) },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col items-center gap-0.5 rounded-xl bg-white/8 px-2 py-2.5">
                <p className="text-[11px] font-black tracking-tight text-white">{stat.value}</p>
                <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/45">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* action buttons */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => onTabChange("profile")}
              className="h-9 flex-1 rounded-xl bg-accent px-3 text-[11px] font-black uppercase tracking-[0.12em] text-white transition hover:opacity-90"
            >
              Meu Perfil
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════ GERAL ══════════════════ */}
      {tab === "overview" && (
        <div className="mt-3 space-y-3">

          {/* Pending reviews callout — only show when there are real pending reviews */}
          {pendingReviews.length > 0 && (
            <button
              type="button"
              onClick={() => onTabChange("reviews")}
              className="w-full overflow-hidden rounded-[1.2rem] border border-accent/25 bg-gradient-to-r from-accent/8 to-accent/4 p-4 text-left transition hover:from-accent/14 hover:to-accent/8"
            >
              <div className="flex items-center gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-white shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
                  <Star className="size-5 fill-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-foreground">
                    {pendingReviews.length === 1 ? "1 avaliação por fazer" : `${pendingReviews.length} avaliações por fazer`}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {pendingReviews[0]
                      ? `"${pendingReviews[0].services[0]?.name ?? "Serviço"}" aguarda a sua opinião`
                      : "Toque para avaliar os atendimentos concluídos"}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-accent" />
              </div>
            </button>
          )}

          {loyalty?.settings?.enabled && (
            <div className="overflow-hidden rounded-[1.2rem] border border-amber-500/20 bg-gradient-to-br from-amber-500/8 via-card to-card shadow-sm">
              <div className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                      Fidelidade
                    </p>
                    <p className="mt-1 text-base font-extrabold tracking-tight text-foreground">
                      {loyalty.totalStamps} carimbo{loyalty.totalStamps === 1 ? "" : "s"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Nível {loyalty.levelName}. Indicações contam após a reserva concluída.
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/12 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    {loyalty.completedReferrals} indicação{loyalty.completedReferrals === 1 ? "" : "ões"}
                  </span>
                </div>
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, (loyalty.progressStamps / Math.max(1, loyalty.nextRewardAt)) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {loyalty.progressStamps}/{loyalty.nextRewardAt} para benefício
                    </span>
                    <span>{loyalty.availableRewards.length} disponível{loyalty.availableRewards.length === 1 ? "" : "is"}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-2 rounded-xl bg-muted/60 p-2.5 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 truncate text-[11px] font-semibold text-muted-foreground">
                    {loyalty.referralUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copyReferralLink}
                    className="h-8 shrink-0 rounded-lg bg-foreground px-3 text-[10px] font-black uppercase tracking-[0.12em] text-background transition hover:opacity-90"
                  >
                    Copiar link
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Next appointment featured card */}
          {upcoming[0] ? (
            <div className="overflow-hidden rounded-[1.2rem] border border-emerald-500/20 bg-gradient-to-br from-emerald-500/8 via-card to-card shadow-sm">
              <div className="px-4 pb-4 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">Próxima marcação</p>
                  <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                    Confirmada
                  </span>
                </div>
                <p className="mt-2 text-base font-extrabold tracking-tight text-foreground">
                  {upcoming[0].services[0]?.name ?? "Serviço"}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="size-3.5 text-emerald-500" />
                    {formatDateTimeShort(upcoming[0].startsAt)}
                  </span>
                  {upcoming[0].staffName && (
                    <span className="flex items-center gap-1.5">
                      <UserRound className="size-3.5" />
                      {upcoming[0].staffName}
                    </span>
                  )}
                  {upcoming[0].totalPrice > 0 && (
                    <span className="flex items-center gap-1.5">
                      <CreditCard className="size-3.5" />
                      {formatMoney(upcoming[0].totalPrice)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-[1.2rem] border border-dashed border-border bg-card/60 p-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                <CalendarDays className="size-4" />
              </div>
              <div>
                <p className="text-sm font-extrabold text-foreground">Sem reservas futuras</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Escolha um serviço acima para marcar.</p>
              </div>
            </div>
          )}

          {/* Stats 2×2 */}
          <div className="grid grid-cols-2 gap-2.5">
            <DashboardTile
              icon={<CalendarDays className="size-4" />}
              label="Reservas passadas"
              value={history.length > 0 ? `${history.length}` : "—"}
              sub={history.length > 0 ? `Última: ${formatDateTimeShort(history[0]!.startsAt)}` : "Ainda sem histórico"}
              color="blue"
            />
            <DashboardTile
              icon={<CreditCard className="size-4" />}
              label="Total pago"
              value={formatMoney(clientTotals.paid ?? 0)}
              sub="Valores confirmados"
              color="emerald"
            />
            <DashboardTile
              icon={<Star className="size-4" />}
              label="Avaliações"
              value={completedReviews.length > 0 ? `${completedReviews.length}` : pendingReviews.length > 0 ? `${pendingReviews.length}` : "—"}
              sub={completedReviews.length > 0 ? "realizadas" : pendingReviews.length > 0 ? "por fazer" : "sem avaliações"}
              color="amber"
            />
            <DashboardTile
              icon={<Wallet className="size-4" />}
              label="Pré-pagamentos"
              value={formatMoney(clientTotals.deposits ?? 0)}
              sub={upcoming.length > 0 ? `${upcoming.length} reserva${upcoming.length > 1 ? "s" : ""} futura${upcoming.length > 1 ? "s" : ""}` : "sem reservas futuras"}
              color="purple"
            />
          </div>
        </div>
      )}

      {/* ══════════════════ RESERVAS ══════════════════ */}
      {tab === "notifications" && (
        <div className="mt-3 overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                Avisos
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Historico de notificacoes deste estudio.
              </p>
            </div>
            {unreadNotifications > 0 && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={markAllNotificationsRead}
                  disabled={markingAllNotifications}
                  className="rounded-full border border-border px-3 py-1.5 text-[10px] font-black text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
                >
                  Marcar todas como vistas
                </button>
                <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-black text-white">
                  {unreadNotifications} nova{unreadNotifications > 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <Bell className="size-9 text-muted-foreground" />
              <p className="text-sm font-extrabold text-foreground">Sem avisos por enquanto</p>
              <p className="text-xs text-muted-foreground">
                Confirmacoes, lembretes e disponibilidade aparecem aqui.
              </p>
            </div>
          ) : (
            <ExpandableList
              items={notifications}
              initialCount={5}
              className="divide-y divide-border"
              getKey={(item) => item.id}
              moreLabel={(hidden) => `Ver mais ${hidden} aviso${hidden !== 1 ? "s" : ""}`}
              renderItem={(item) => {
                const unread = item.status !== "read";
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => unread && onMarkNotificationRead(item.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/35",
                      unread && "bg-emerald-500/8",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl",
                        unread
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Bell className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-extrabold text-foreground">
                          {item.title}
                        </span>
                        {unread && <span className="size-2 shrink-0 rounded-full bg-emerald-500" />}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {item.body}
                      </span>
                      <span className="mt-2 block text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                        {formatDateTimeShort(item.createdAt)}
                      </span>
                    </span>
                  </button>
                );
              }}
            />
          )}
        </div>
      )}

      {tab === "bookings" && (() => {
        // ── Filter & search logic ──
        const searchLower = historySearch.trim().toLowerCase();
        const filteredHistory = history.filter((a) => {
          if (historyStatus !== "all" && a.status !== historyStatus) return false;
          if (searchLower) {
            const serviceName = (a.services[0]?.name ?? "").toLowerCase();
            const staffName = (a.staffName ?? "").toLowerCase();
            if (!serviceName.includes(searchLower) && !staffName.includes(searchLower)) return false;
          }
          return true;
        });
        // Reset expand when filters change so user always starts from top
        const visibleHistory = historyExpanded ? filteredHistory : filteredHistory.slice(0, HISTORY_INITIAL);
        const hasMore = filteredHistory.length > HISTORY_INITIAL;

        const statusFilters: Array<{ value: string; label: string }> = [
          { value: "all", label: "Todas" },
          { value: "confirmed", label: "Confirmadas" },
          { value: "completed", label: "Concluídas" },
          { value: "cancelled", label: "Canceladas" },
          { value: "no_show", label: "Falta" },
        ];

        return (
          <div className="mt-3 space-y-3">
            {/* ── Próximas ── */}
            <div className="rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 px-4 pb-0 pt-4">
                <div className="grid size-7 place-items-center rounded-lg bg-emerald-500/10">
                  <CalendarDays className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Próximas reservas</p>
                {upcoming.length > 0 && (
                  <span className="ml-auto rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                    {upcoming.length}
                  </span>
                )}
              </div>
              {upcoming.length === 0 ? (
                <div className="flex items-center gap-3 px-4 pb-4 pt-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <CalendarDays className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold text-foreground">Sem reservas futuras</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Escolha um serviço acima para marcar.</p>
                  </div>
                </div>
              ) : (
                <ExpandableList
                  items={upcoming}
                  initialCount={4}
                  className="mt-2 divide-y divide-border"
                  getKey={(appointment) => appointment.id}
                  moreLabel={(hidden) => `Ver mais ${hidden} reserva${hidden !== 1 ? "s" : ""}`}
                  renderItem={(appointment) => (
                    <div className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="w-[4.25rem] shrink-0 rounded-2xl bg-emerald-500/10 px-2 py-2 text-center text-emerald-700 dark:text-emerald-300">
                          <p className="text-base font-black leading-none tabular-nums">
                            {formatTimeOnly(appointment.startsAt)}
                          </p>
                          <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                            {formatDateTimeShort(appointment.startsAt).split(",")[0]}
                          </p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-[11px] font-black uppercase leading-snug tracking-[0.14em] text-muted-foreground">
                            {studioName}
                          </p>
                          <p className="break-words text-sm font-extrabold leading-snug text-foreground">
                            {appointment.services[0]?.name ?? "Serviço"}
                          </p>
                          <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
                            {formatDateTimeShort(appointment.startsAt)}
                            {appointment.staffName ? ` · ${appointment.staffName}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                          {clientStatusLabel(appointment.status)}
                        </span>
                      </div>
                      {appointment.totalPrice > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {formatMoney(appointment.totalPrice)}
                          </span>
                          {appointment.paidAmount > 0 && (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                              Pago {formatMoney(appointment.paidAmount)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                />
              )}
            </div>

            {/* ── Histórico com filtros ── */}
            <div className="rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              {/* Header */}
              <div className="flex items-center justify-between gap-2 px-4 pb-0 pt-4">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center rounded-lg bg-blue-500/10">
                    <Clock className="size-3.5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Histórico</p>
                  {history.length > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {history.length}
                    </span>
                  )}
                </div>
                {pendingReviews.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onTabChange("reviews")}
                    className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-bold text-accent transition hover:bg-accent/20"
                  >
                    {pendingReviews.length} por avaliar
                  </button>
                )}
              </div>

              {/* Search bar */}
              {history.length > 0 && (
                <div className="px-4 pt-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      placeholder="Pesquisar serviço ou profissional…"
                      value={historySearch}
                      onChange={(e) => { setHistorySearch(e.target.value); setHistoryExpanded(false); }}
                      className="h-9 w-full rounded-xl border border-border bg-muted/50 pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/20 focus:bg-background focus:outline-none"
                    />
                    {historySearch && (
                      <button
                        type="button"
                        onClick={() => { setHistorySearch(""); setHistoryExpanded(false); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 grid size-5 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Status filter chips */}
              {history.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto px-4 pb-0 pt-2 scrollbar-none">
                  {statusFilters.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => { setHistoryStatus(f.value); setHistoryExpanded(false); }}
                      className={cn(
                        "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition",
                        historyStatus === f.value
                          ? "bg-foreground text-background"
                          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Results */}
              {history.length === 0 ? (
                <div className="px-4 pb-4 pt-3">
                  <p className="text-xs text-muted-foreground">Sem histórico ainda.</p>
                </div>
              ) : filteredHistory.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 pb-8 pt-6 text-center">
                  <Search className="size-7 text-muted-foreground/40" />
                  <p className="text-sm font-extrabold text-foreground">Sem resultados</p>
                  <p className="text-xs text-muted-foreground">Tente outro filtro ou pesquisa.</p>
                  <button
                    type="button"
                    onClick={() => { setHistorySearch(""); setHistoryStatus("all"); }}
                    className="mt-1 rounded-full border border-border px-3 py-1.5 text-[11px] font-bold transition hover:bg-muted"
                  >
                    Limpar filtros
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-2 divide-y divide-border">
                    {visibleHistory.map((appointment) => (
                      <HistoryCard key={appointment.id} appointment={appointment} />
                    ))}
                  </div>
                  {/* Ver mais / Ver menos toggle */}
                  {hasMore && (
                    <div className="border-t border-border px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setHistoryExpanded((e) => !e)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-muted/40 py-2.5 text-[12px] font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-[0.98]"
                      >
                        {historyExpanded
                          ? "Ver menos"
                          : `Ver mais (${filteredHistory.length - HISTORY_INITIAL} reservas)`}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ══════════════════ AVALIAÇÕES ══════════════════ */}
      {tab === "reviews" && (
        <div className="mt-3 space-y-3">

          {/* Pendentes */}
          <div className="overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="border-b border-border bg-accent/4 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center rounded-lg bg-accent/15">
                    <Star className="size-3.5 text-accent" />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-accent">Pendentes</p>
                </div>
                {pendingReviews.length > 0 && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-black text-white">
                    {pendingReviews.length}
                  </span>
                )}
              </div>
            </div>

            {pendingReviews.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <CheckCircle2 className="size-9 text-emerald-500" />
                <p className="text-sm font-extrabold text-foreground">Tudo avaliado!</p>
                <p className="text-xs text-muted-foreground">Nenhum atendimento aguarda avaliação.</p>
              </div>
            ) : (
              <ExpandableList
                items={pendingReviews}
                initialCount={4}
                className="divide-y divide-border"
                getKey={(appointment) => appointment.id}
                moreLabel={(hidden) => `Ver mais ${hidden} avaliação${hidden !== 1 ? "ões" : ""}`}
                renderItem={(appointment) => {
                  const isOpen = reviewApptId === appointment.id;
                  return (
                    <div>
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-extrabold text-foreground">
                            {appointment.services[0]?.name ?? "Serviço"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatDateTimeShort(appointment.startsAt)}
                            {appointment.staffName ? ` · ${appointment.staffName}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleReview(appointment.id)}
                          className={cn(
                            "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-black transition",
                            isOpen
                              ? "bg-muted text-muted-foreground"
                              : "bg-accent text-white shadow-[0_2px_8px_rgba(0,0,0,0.1)] hover:opacity-90",
                          )}
                        >
                          <Star className={cn("size-3", !isOpen && "fill-white")} />
                          {isOpen ? "Fechar" : "Avaliar"}
                        </button>
                      </div>
                      {isOpen && (
                        <div className="border-t border-border bg-muted/30 px-4 pb-4 pt-3">
                          <ReviewForm
                            studioId={studioId}
                            appointmentId={appointment.id}
                            professionals={professionals}
                            reviewerName={displayName}
                            onDone={() => setReviewApptId(null)}
                            onSubmitted={() => {
                              setReviewedApptIds((prev) => new Set(prev).add(appointment.id));
                              onReviewSubmitted?.();
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            )}
          </div>

          {/* Realizadas */}
          {completedReviews.length > 0 && (
            <div className="overflow-hidden rounded-[1.2rem] border border-emerald-500/20 bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              <div className="border-b border-emerald-500/15 bg-emerald-500/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="grid size-7 place-items-center rounded-lg bg-emerald-500/15">
                    <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-400">Realizadas</p>
                </div>
              </div>
              <ExpandableList
                items={completedReviews}
                initialCount={4}
                className="divide-y divide-border"
                getKey={(appointment) => appointment.id}
                moreLabel={(hidden) => `Ver mais ${hidden} avaliação${hidden !== 1 ? "ões" : ""}`}
                renderItem={(appointment) => (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-foreground">
                        {appointment.services[0]?.name ?? "Serviço"}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDateTimeShort(appointment.startsAt)}</p>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓</span>
                  </div>
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ PAGAMENTOS ══════════════════ */}
      {tab === "payments" && (
        <div className="mt-3 space-y-3">
          {/* Metric strip */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[1rem] border border-border bg-card px-3 py-3 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground">Pago</p>
              <p className="mt-1 text-sm font-extrabold text-emerald-600 dark:text-emerald-400">{formatMoney(clientTotals.paid ?? 0)}</p>
            </div>
            <div className="rounded-[1rem] border border-border bg-card px-3 py-3 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground">Pré-pagamento</p>
              <p className="mt-1 text-sm font-extrabold text-blue-600 dark:text-blue-400">{formatMoney(clientTotals.deposits ?? 0)}</p>
            </div>
            <div className="rounded-[1rem] border border-border bg-card px-3 py-3 shadow-sm">
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-muted-foreground">Pendente</p>
              <p className={cn("mt-1 text-sm font-extrabold", (clientTotals.pending ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                {formatMoney(clientTotals.pending ?? 0)}
              </p>
            </div>
          </div>

          {/* Pending payments */}
          <div className="overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Pagamentos pendentes</p>
            </div>
            {pendingPayments.length === 0 ? (
              <div className="px-4 py-4">
                <p className="text-sm font-extrabold text-foreground">Sem pagamentos pendentes</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Tudo processado.</p>
              </div>
            ) : (
              <ExpandableList
                items={pendingPayments}
                initialCount={4}
                className="divide-y divide-border"
                getKey={(p, i) => `${p.appointmentId ?? p.bookingRequestId ?? i}`}
                moreLabel={(hidden) => `Ver mais ${hidden} pagamento${hidden !== 1 ? "s" : ""}`}
                renderItem={(p) => (
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-foreground">{formatMoney(p.amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        {p.method === "card" ? "Cartão" : p.method === "mbway" ? "MBWay" : p.method}
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                      {p.status === "pending" ? "Aguarda" : p.status === "processing" ? "A processar" : p.status}
                    </span>
                  </div>
                )}
              />
            )}
          </div>

          {/* Payment breakdown */}
          {([...upcoming, ...history].length > 0) && (
            <div className="overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              <div className="border-b border-border px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Detalhe por marcação</p>
              </div>
              <ExpandableList
                items={[...upcoming, ...history]}
                initialCount={5}
                className="divide-y divide-border"
                getKey={(appointment) => appointment.id}
                moreLabel={(hidden) => `Ver mais ${hidden} marcação${hidden !== 1 ? "ões" : ""}`}
                renderItem={(appointment) => (
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-foreground">{appointment.services[0]?.name ?? "Serviço"}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTimeShort(appointment.startsAt)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs font-extrabold text-foreground">{formatMoney(appointment.totalPrice)}</p>
                      {appointment.paidAmount > 0 && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">Pago {formatMoney(appointment.paidAmount)}</p>
                      )}
                    </div>
                  </div>
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ PERFIL ══════════════════ */}
      {tab === "profile" && (
        <div className="mt-3 space-y-3">

          {/* Personal data */}
          <div className="overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Dados pessoais</p>
            </div>
            <div className="px-4 py-4 space-y-2">
              <div className="rounded-xl bg-muted/50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Nome</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{clientProfile?.name || displayName}</p>
              </div>
              <div className="rounded-xl bg-muted/50 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Email</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{clientProfile?.email || userEmail}</p>
              </div>
              {birthdayEditorOpen ? (
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs font-extrabold text-foreground">Data de aniversário</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Campo opcional. Ajuda o estúdio a lembrar datas especiais.
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <FieldInput
                      label="Data de aniversário"
                      value={birthdayDraft}
                      onChange={setBirthdayDraft}
                      type="date"
                      autoComplete="bday"
                    />
                    <button
                      type="button"
                      onClick={() => onSaveBirthday(birthdayDraft).then(() => setBirthdayEditorOpen(false))}
                      disabled={savingProfile}
                      className="h-12 rounded-xl bg-foreground px-5 text-xs font-black uppercase tracking-[0.14em] text-background disabled:opacity-50"
                    >
                      {savingProfile ? "A guardar" : "Guardar"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Data de aniversário
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">
                      {formatProfileBirthday(clientProfile?.dateOfBirth)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBirthdayEditorOpen(true)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition hover:border-foreground/20"
                  >
                    {clientProfile?.dateOfBirth ? "Editar" : "Adicionar"}
                  </button>
                </div>
              )}
              {needsPhone || phoneEditorOpen ? (
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <p className="text-xs font-extrabold text-foreground">{needsPhone ? "Confirme o WhatsApp" : "Atualizar WhatsApp"}</p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <SharedInternationalPhoneInput value={phoneDraft} onChange={onPhoneDraftChange} />
                    <button
                      type="button"
                      onClick={() => {
                        void onSavePhone(phoneDraft)
                          .then(() => onPhoneEditorOpenChange(false))
                          .catch(() => undefined);
                      }}
                      disabled={savingProfile}
                      className="h-12 rounded-xl bg-foreground px-5 text-xs font-black uppercase tracking-[0.14em] text-background disabled:opacity-50"
                    >
                      {savingProfile ? "A guardar" : "Guardar"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">WhatsApp</p>
                    <p className="mt-0.5 text-sm font-semibold text-foreground">{savedPhone}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPhoneEditorOpenChange(true)}
                    className="rounded-full border border-border bg-background px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition hover:border-foreground/20"
                  >
                    Editar
                  </button>
                </div>
              )}
            </div>
          </div>

          {upcoming.length > 0 && (
            <div className="overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <div className="grid size-7 place-items-center rounded-lg bg-emerald-500/10">
                  <CalendarDays className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Próximas reservas</p>
                <span className="ml-auto rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                  {upcoming.length}
                </span>
              </div>
              <ExpandableList
                items={upcoming}
                initialCount={4}
                className="divide-y divide-border"
                getKey={(appointment) => appointment.id}
                moreLabel={(hidden) => `Ver mais ${hidden} reserva${hidden !== 1 ? "s" : ""}`}
                renderItem={(appointment) => (
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-foreground">
                          {appointment.services[0]?.name ?? "Serviço"}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDateTimeShort(appointment.startsAt)}
                          {appointment.staffName ? ` · ${appointment.staffName}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                        {clientStatusLabel(appointment.status)}
                      </span>
                    </div>
                    {appointment.totalPrice > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {formatMoney(appointment.totalPrice)}
                        </span>
                        {appointment.paidAmount > 0 && (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                            Pago {formatMoney(appointment.paidAmount)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          )}

          {/* App + actions */}
          <div className="overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Configurações</p>
            </div>
            <div className="divide-y divide-border">
              {!isPwaInstalled && canInstallApp && (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">App do estúdio</p>
                    <p className="text-xs text-muted-foreground">Acesso rápido na ecrã inicial</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onInstall}
                      className="h-8 rounded-lg bg-foreground px-3 text-[11px] font-black uppercase tracking-[0.12em] text-background"
                    >
                      {canPrompt ? "Instalar" : "Como"}
                    </button>
                    <button
                      type="button"
                      onClick={onDismissInstall}
                      className="h-8 rounded-lg border border-border px-2.5 text-[11px] font-black uppercase tracking-[0.12em] text-muted-foreground"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
              {isPwaInstalled && notificationStatus !== "granted" && (
                <button
                  type="button"
                  onClick={onEnableNotifications}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-muted/40"
                >
                  <div>
                    <p className="text-sm font-bold text-foreground">Notificações do app</p>
                    <p className="text-xs text-muted-foreground">
                      Receba lembretes, alterações de horário e novidades.
                    </p>
                  </div>
                  <Bell className="size-4 text-muted-foreground" />
                </button>
              )}
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-red-500/5"
              >
                <p className="text-sm font-bold text-red-600 dark:text-red-400">Terminar sessão</p>
                <LogIn className="size-4 rotate-180 text-red-400" />
              </button>
            </div>
          </div>

          {/* Followed studios */}
          <div className="overflow-hidden rounded-[1.2rem] border border-border bg-card shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
            <div className="border-b border-border px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Estúdios seguidos</p>
            </div>
            {followedStudios.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <div className="grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <Heart className="size-5" />
                </div>
                <p className="text-sm font-extrabold text-foreground">Ainda sem favoritos</p>
                <p className="text-xs text-muted-foreground">Toque no ❤ na página de um estúdio para seguir.</p>
              </div>
            ) : (
              <ExpandableList
                items={followedStudios}
                initialCount={5}
                className="divide-y divide-border"
                getKey={(s) => s.id}
                moreLabel={(hidden) => `Ver mais ${hidden} estúdio${hidden !== 1 ? "s" : ""}`}
                renderItem={(s) => (
                  <a
                    href={`/s/${s.slug}`}
                    className="group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/30"
                  >
                    <div className="size-10 shrink-0 overflow-hidden rounded-xl bg-muted">
                      {s.logo_url ? (
                        <img src={s.logo_url} alt={s.name} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-accent">
                          <Sparkles className="size-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-foreground group-hover:text-accent">{s.name}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        {(s.rating ?? 0) > 0 && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Star className="size-3 fill-accent text-accent" />
                            <span className="font-bold text-foreground">{Number(s.rating).toFixed(1)}</span>
                            {(s.reviews_count ?? 0) > 0 && <span>· {s.reviews_count}</span>}
                          </span>
                        )}
                        {s.location && (
                          <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                            <MapPin className="size-3 shrink-0" /> {s.location}
                          </span>
                        )}
                      </div>
                    </div>
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/40 transition group-hover:text-accent" />
                  </a>
                )}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DashboardTile({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  color: "emerald" | "blue" | "amber" | "purple";
}) {
  const palette = {
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    blue: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    purple: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  } as const;
  return (
    <div className="flex flex-col gap-2 rounded-[1.1rem] border border-border bg-card p-3.5 shadow-sm">
      <div className={cn("grid size-8 place-items-center rounded-lg", palette[color])}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-base font-extrabold tracking-tight text-foreground">{value}</p>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

function ClientSummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="flex min-h-[8.25rem] flex-col rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-extrabold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{detail}</p>
    </article>
  );
}

const phoneCountries = [
  { code: "PT", flag: "🇵🇹", dial: "+351", name: "Portugal", minDigits: 9 },
  { code: "BR", flag: "🇧🇷", dial: "+55", name: "Brasil", minDigits: 10 },
  { code: "ES", flag: "🇪🇸", dial: "+34", name: "Espanha", minDigits: 9 },
  { code: "FR", flag: "🇫🇷", dial: "+33", name: "França", minDigits: 9 },
  { code: "GB", flag: "🇬🇧", dial: "+44", name: "Reino Unido", minDigits: 10 },
  { code: "US", flag: "🇺🇸", dial: "+1", name: "Estados Unidos", minDigits: 10 },
];

function LegacyInternationalPhoneInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inferredCountry =
    phoneCountries.find((country) => value.replace(/\s/g, "").startsWith(country.dial)) ??
    phoneCountries[0];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState(inferredCountry);
  const nationalDigits = value
    .replace(country.dial, "")
    .replace(/[^\d]/g, "")
    .slice(0, 16);
  const valid = nationalDigits.length >= country.minDigits;
  const filteredCountries = phoneCountries.filter((item) => {
    const haystack = `${item.name} ${item.dial} ${item.code}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  useEffect(() => {
    setCountry(inferredCountry);
  }, [inferredCountry]);

  function updatePhone(nextCountry = country, digits = nationalDigits) {
    onChange(formatPhoneInput(`${nextCountry.dial} ${digits}`));
  }

  return (
    <div className="relative min-w-0">
      <div className="flex h-12 min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition focus-within:border-foreground/25 focus-within:ring-2 focus-within:ring-foreground/10">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex h-full shrink-0 items-center gap-2 border-r border-border bg-background/70 px-3 text-sm font-extrabold"
          aria-label="Selecionar país"
        >
          <span className="text-base leading-none">{country.flag}</span>
          <span>{country.dial}</span>
        </button>
        <input
          value={nationalDigits}
          onChange={(event) => updatePhone(country, event.target.value.replace(/[^\d]/g, ""))}
          placeholder="912 345 678"
          type="tel"
          autoComplete="tel"
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/45"
        />
        <span
          className={cn(
            "grid h-full w-12 shrink-0 place-items-center text-[10px] font-black uppercase",
            valid ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground",
          )}
        >
          {valid ? "OK" : "—"}
        </span>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-20 rounded-2xl border border-border bg-card p-2 shadow-2xl">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar país ou código"
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-foreground/10"
          />
          <div className="mt-2 max-h-52 overflow-y-auto">
            {filteredCountries.map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => {
                  setCountry(item);
                  updatePhone(item, nationalDigits);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold transition hover:bg-muted"
              >
                <span>{item.flag}</span>
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="text-muted-foreground">{item.dial}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const defaultPhoneCountry = phoneCountries[0];

function inferPhoneCountry(value: string) {
  const compact = value.replace(/\s/g, "");
  return phoneCountries.find((country) => compact.startsWith(country.dial)) ?? defaultPhoneCountry;
}

function getNationalPhoneDigits(value: string, country = inferPhoneCountry(value)) {
  const digits = value.replace(/\D/g, "");
  const dialDigits = country.dial.replace(/\D/g, "");
  const withoutDial =
    digits.startsWith(dialDigits) && digits.length > dialDigits.length
      ? digits.slice(dialDigits.length)
      : digits;
  return withoutDial.slice(0, 16);
}

function normalizeInternationalPhone(value: string, country = inferPhoneCountry(value)) {
  if (value.includes("@")) return "";
  const nationalDigits = getNationalPhoneDigits(value, country);
  return nationalDigits ? formatPhoneInput(`${country.dial} ${nationalDigits}`) : "";
}

function isValidInternationalPhone(value: string) {
  const country = inferPhoneCountry(value);
  return getNationalPhoneDigits(value, country).length >= country.minDigits;
}

function phonePlaceholder(countryCode: string) {
  switch (countryCode) {
    case "BR":
      return "11 91234 5678";
    case "ES":
      return "612 345 678";
    case "FR":
      return "6 12 34 56 78";
    case "GB":
      return "7400 123456";
    case "US":
      return "202 555 0123";
    default:
      return "912 345 678";
  }
}

function InternationalPhoneInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const inferredCountry = inferPhoneCountry(value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState(inferredCountry);
  const nationalDigits = getNationalPhoneDigits(value, country);
  const valid = nationalDigits.length >= country.minDigits;
  const filteredCountries = phoneCountries.filter((item) => {
    const haystack = `${item.name} ${item.dial} ${item.code}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  useEffect(() => {
    setCountry(inferredCountry);
  }, [inferredCountry]);

  function updatePhone(nextCountry = country, digits = nationalDigits) {
    onChange(digits ? formatPhoneInput(`${nextCountry.dial} ${digits}`) : "");
  }

  return (
    <label className="block min-w-0">
      {label && (
        <span className="mb-1.5 block font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex h-12 min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition focus-within:border-foreground/25 focus-within:ring-2 focus-within:ring-foreground/10">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-full min-w-[5.8rem] shrink-0 items-center justify-center gap-1.5 border-r border-border bg-background/80 px-2.5 text-sm font-extrabold transition hover:bg-muted"
              aria-label="Selecionar pais"
            >
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-muted-foreground">
                {country.code}
              </span>
              <span>{country.dial}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="bottom"
            sideOffset={8}
            className="z-[140] w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl p-2"
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pesquisar pais ou codigo"
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm font-semibold outline-none transition focus:ring-2 focus:ring-foreground/10"
            />
            <div className="mt-2 max-h-[min(17rem,45vh)] overflow-y-auto pr-1">
              {filteredCountries.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setCountry(item);
                    updatePhone(item, nationalDigits);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex h-11 w-full items-center gap-2 rounded-xl px-2.5 text-left text-sm font-semibold transition hover:bg-muted",
                    item.code === country.code && "bg-muted text-foreground",
                  )}
                >
                  <span className="grid h-7 w-9 shrink-0 place-items-center rounded-lg bg-background text-[10px] font-black uppercase tracking-[0.08em] text-muted-foreground ring-1 ring-border">
                    {item.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="shrink-0 text-muted-foreground">{item.dial}</span>
                </button>
              ))}
              {filteredCountries.length === 0 && (
                <p className="px-2 py-5 text-center text-xs font-semibold text-muted-foreground">
                  Nenhum indicativo encontrado.
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <input
          value={nationalDigits}
          onChange={(event) => updatePhone(country, event.target.value.replace(/[^\d]/g, ""))}
          placeholder={phonePlaceholder(country.code)}
          type="tel"
          autoComplete="tel"
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground/45"
        />
        <span
          className={cn(
            "grid h-full w-12 shrink-0 place-items-center text-[10px] font-black uppercase",
            valid ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground",
          )}
        >
          {valid ? "OK" : "-"}
        </span>
      </div>
    </label>
  );
}

function AccountDrawer({
  title,
  subheader,
  children,
  onClose,
}: {
  title: string;
  /** Optional non-scrolling slot rendered between the title bar and content (e.g. tab bar). */
  subheader?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}) {
  // Escape key to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Prevent background scroll while drawer is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[70] bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <main className="mx-auto flex h-dvh w-full max-w-5xl flex-col overflow-hidden bg-background">
        {/* ── Title bar + close ── */}
        <div
          className="shrink-0 border-b border-border bg-background/95 px-4 backdrop-blur md:px-6"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))", paddingBottom: "0.75rem" }}
        >
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <p className="text-sm font-black uppercase tracking-[0.16em] text-foreground">{title}</p>
            <button
              type="button"
              onClick={onClose}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground ring-1 ring-border transition hover:bg-muted/70 active:scale-95"
              aria-label="Fechar"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* ── Subheader (e.g. tab bar) — NEVER scrolls ── */}
        {subheader && (
          <div className="shrink-0 border-b border-border bg-background px-4 pb-2 pt-2 md:px-6">
            <div className="mx-auto max-w-4xl">{subheader}</div>
          </div>
        )}

        {/* ── Scrollable content ── */}
        <div
          className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto max-w-4xl">{children}</div>
        </div>
      </main>
    </div>
  );
}

// Google One Tap hook.
// Shows the native Google account picker WITHIN the page - no redirect needed.
// To activate: add VITE_GOOGLE_CLIENT_ID=xxx to .env (same client ID as Supabase Google provider).
// Also add your domain to Authorized JavaScript origins in Google Cloud Console.
// Unified Google auth hook:
// 1. Loads the GSI script once
// 2. Initialises google.accounts.id with a fresh nonce on every mount
// 3. Renders a button into `buttonContainerId` (optional)
// 4. Triggers the floating One Tap prompt
// This approach stores the session via signInWithIdToken — no redirects — so it works
// correctly in iOS PWA where localStorage is isolated from the browser.
function useGoogleAuth({ onSignedIn }: { onSignedIn?: () => void } = {}) {
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
    if (!clientId || typeof window === "undefined") return;

    let cancelled = false;

    async function init() {
      const { rawNonce, hashedNonce } = await createGoogleNoncePair();

      if (cancelled) return;

      const scriptEl = loadGoogleIdentityScript();

      function setup() {
        if (cancelled) return;
        const gsi = getGoogleIdentity();
        if (!gsi) {
          setTimeout(setup, 200);
          return;
        }

        gsi.initialize({
          client_id: clientId!,
          nonce: hashedNonce,
          use_fedcm_for_prompt: true,
          callback: async (response: { credential: string }) => {
            const { error } = await supabase.auth.signInWithIdToken({
              provider: "google",
              token: response.credential,
              nonce: rawNonce,
            });
            if (error) {
              toast.error("Não foi possível entrar com Google. Tente novamente.");
            } else {
              toast.success("Sessão iniciada com Google.");
              onSignedIn?.();
            }
          },
        });

        // Show One Tap floating prompt (works on Android / desktop)
        gsi.prompt();
      }

      if (getGoogleIdentity()) {
        setup();
      } else {
        scriptEl.addEventListener("load", setup, { once: true });
      }
    }

    init().catch(() => { /* non-critical */ });

    return () => {
      cancelled = true;
      try {
        getGoogleIdentity()?.cancel();
      } catch { /* ignore */ }
    };
  }, [onSignedIn]);
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

function PublicClientAuthForm({ studioName }: { studioName: string }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const hasGoogleClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  // When VITE_GOOGLE_CLIENT_ID is configured, load GSI and render the button.
  // signInWithIdToken stores the session in the *current* localStorage (PWA or
  // browser) so the session persists after the app is closed and reopened.
  useGoogleAuth(hasGoogleClientId ? { onSignedIn: undefined } : undefined);

  async function signInWithGoogleRedirect() {
    rememberPublicReturn();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: buildPublicAuthCallbackUrl(window.location.origin),
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
          scope: "openid email profile https://www.googleapis.com/auth/user.birthday.read",
        },
      },
    });
    if (error) toast.error("Não foi possível iniciar sessão com Google.");
  }

  async function promptGoogle() {
    rememberPublicReturn();

    const gsi = getGoogleIdentity();
    if (!gsi) {
      await signInWithGoogleRedirect();
      return;
    }

    gsi.prompt((notification) => {
      const unavailable =
        notification.isNotDisplayed?.() ||
        notification.isSkippedMoment?.() ||
        notification.isDismissedMoment?.();
      if (unavailable) void signInWithGoogleRedirect();
    });
  }

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || password.length < 6) {
      toast.error("Indique um e-mail válido e uma senha com pelo menos 6 caracteres.");
      return;
    }
    if (mode === "signup" && !isValidSharedInternationalPhone(phone)) {
      toast.error("Indique um WhatsApp válido para criar a conta.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        rememberPublicReturn();
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: buildPublicAuthCallbackUrl(window.location.origin),
            data: {
              full_name: name.trim() || undefined,
              phone: normalizeSharedInternationalPhone(phone),
              phone_number: normalizeSharedInternationalPhone(phone),
              account_type: "customer",
              bellza_account_type: "customer",
            },
          },
        });
        if (error) throw error;
        toast.success("Conta criada. Confirme o e-mail se for solicitado.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        toast.success("Sessão iniciada.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível iniciar sessão.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border px-4 pb-4 pt-3">
      <div className="mb-3 rounded-2xl border border-border bg-card/80 px-3.5 py-3 shadow-sm">
        <p className="text-sm font-extrabold text-foreground">Entrar mais rápido</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Use a sua conta Google para preencher os dados automaticamente, ou continue com e-mail e senha.
        </p>
      </div>
      {/* ── Google sign-in ── */}
      {hasGoogleClientId ? (
        // GSI renders Google's own button here — in-page, no redirect, works in PWA.
        // The button calls signInWithIdToken which stores the session in the current
        // localStorage context (browser or PWA), so the session survives app restarts.
        <button
          type="button"
          onClick={promptGoogle}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background text-sm font-bold text-foreground shadow-sm transition hover:bg-muted/55"
        >
          <GoogleIcon className="size-4" />
          Entrar com Google
        </button>
      ) : (
        // Fallback for environments without the Google Identity client ID.
        <button
          type="button"
          onClick={signInWithGoogleRedirect}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background text-sm font-bold text-foreground shadow-sm transition hover:bg-muted/55"
        >
          <LogIn className="size-4" />
          Entrar com Google
        </button>
      )}

      {/* Divider */}
      <div className="relative my-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[11px] text-muted-foreground">ou</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* ── Email / password ── */}
      <form onSubmit={submitEmail} className="space-y-2">
        {mode === "signup" && (
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome"
              autoComplete="name"
              className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition focus:ring-2 focus:ring-foreground/15"
            />
            <SharedInternationalPhoneInput value={phone} onChange={setPhone} />
          </>
        )}
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="E-mail"
          type="email"
          autoComplete="email"
          className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition focus:ring-2 focus:ring-foreground/15"
        />
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Senha"
          type="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-sm outline-none transition focus:ring-2 focus:ring-foreground/15"
        />
        <button
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-2xl border border-border bg-card text-xs font-bold uppercase tracking-[0.16em] text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {busy ? "A validar" : mode === "signup" ? "Criar conta" : "Entrar"}
        </button>
      </form>
      <button
        type="button"
        onClick={() => setMode((current) => (current === "login" ? "signup" : "login"))}
        className="mt-3 text-xs font-semibold text-muted-foreground underline underline-offset-4"
      >
        {mode === "login" ? `Criar conta rápida para ${studioName}` : "Já tenho conta"}
      </button>
    </div>
  );
}

function ClientMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-[1.35rem] border border-border bg-card p-3.5 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-lg font-extrabold tracking-tight text-foreground">{value}</p>
      <span className="mt-2 h-1 w-8 rounded-full bg-foreground/10" />
    </div>
  );
}

function ReviewForm({
  studioId,
  appointmentId,
  professionals,
  reviewerName,
  onDone,
  onSubmitted,
}: {
  studioId: string;
  appointmentId: string;
  professionals: Professional[];
  reviewerName: string;
  onDone: () => void;
  onSubmitted?: () => void;
}) {
  const submitReview = useServerFn(submitStudioReview);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [taggedIds, setTaggedIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function toggleTag(id: string) {
    setTaggedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (rating === 0) return;
    setSubmitting(true);
    try {
      await submitReview({
        data: {
          studioId,
          appointmentId,
          rating,
          comment: comment.trim() || undefined,
          staffIds: taggedIds,
          reviewerName: reviewerName || undefined,
        },
      });
      setDone(true);
      onSubmitted?.();
      setTimeout(onDone, 1800);
    } catch (err: any) {
      toast.error(err?.message ?? "Não foi possível guardar a avaliação.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-2 py-3 text-center">
        <div className="grid size-9 place-items-center rounded-full bg-emerald-500/15 text-emerald-600">
          <Star className="size-4 fill-emerald-500 text-emerald-500" />
        </div>
        <p className="text-sm font-extrabold">Avaliação enviada!</p>
        <p className="text-xs text-muted-foreground">Obrigada pelo feedback.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">A tua avaliação</p>

      {/* Star picker */}
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            onMouseEnter={() => setHovered(s)}
            onMouseLeave={() => setHovered(0)}
            onClick={() => setRating(s)}
            className="transition-transform hover:scale-110"
          >
            <Star
              className={cn(
                "size-7 transition-colors",
                (hovered || rating) >= s ? "fill-accent text-accent" : "text-border",
              )}
            />
          </button>
        ))}
        {rating > 0 && (
          <span className="ml-1 self-center text-xs font-semibold text-muted-foreground">
            {["", "Fraca", "Razoável", "Boa", "Muito boa", "Excelente"][rating]}
          </span>
        )}
      </div>

      {/* Professional tags */}
      {professionals.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Profissional (opcional)</p>
          <div className="flex flex-wrap gap-1.5">
            {professionals.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleTag(p.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                  taggedIds.includes(p.id)
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-border bg-background/70 text-muted-foreground hover:border-accent/50",
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="Partilha a tua experiência (opcional)…"
        className="w-full resize-none rounded-xl border border-border bg-background/70 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="h-10 flex-1 rounded-xl bg-foreground px-4 text-[11px] font-black uppercase tracking-[0.14em] text-background disabled:opacity-40"
        >
          {submitting ? "A enviar…" : "Enviar avaliação"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="h-10 rounded-xl border border-border px-3 text-[11px] font-black uppercase tracking-[0.14em] text-muted-foreground"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function ClientAppointmentList({
  title,
  items,
  empty,
  compact = false,
}: {
  title: string;
  items: PublicClientAreaPayload["appointments"];
  empty: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[1.35rem] border border-border bg-card p-4 shadow-[0_16px_42px_rgba(15,23,42,0.06)]",
        compact && "border-0 bg-transparent p-0 shadow-none",
      )}
    >
      {title && <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{title}</p>}
      <div className={cn("space-y-2", title && "mt-3")}>
        {items.length === 0 ? (
          <p className="py-2 text-sm leading-relaxed text-muted-foreground">{empty}</p>
        ) : (
          items.map((appointment) => (
            <div key={appointment.id} className="rounded-2xl border border-border bg-background/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold text-foreground">
                    {appointment.services[0]?.name ?? "Serviço"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateTimeShort(appointment.startsAt)} · {appointment.staffName}
                  </p>
                </div>
                <span className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold",
                  appointment.status === "confirmed" && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
                  appointment.status === "completed" && "bg-blue-500/12 text-blue-700 dark:text-blue-400",
                  appointment.status === "cancelled" && "bg-red-500/12 text-red-700 dark:text-red-400",
                  appointment.status === "no_show" && "bg-orange-500/12 text-orange-700 dark:text-orange-400",
                  !["confirmed","completed","cancelled","no_show"].includes(appointment.status) && "bg-muted text-muted-foreground",
                )}>
                  {clientStatusLabel(appointment.status)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {appointment.totalPrice > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    {formatMoney(appointment.totalPrice)}
                  </span>
                )}
                {appointment.paidAmount > 0 && (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                    Pago {formatMoney(appointment.paidAmount)}
                  </span>
                )}
                {appointment.pendingAmount > 0 && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                    Pendente {formatMoney(appointment.pendingAmount)}
                  </span>
                )}
                {appointment.token && (
                  <a
                    href={`/marcacao/${appointment.token}`}
                    className="ml-auto font-semibold text-foreground underline underline-offset-4"
                  >
                    Gerir →
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PublicPwaCard({
  studioName,
  canPrompt,
  notificationStatus,
  onInstall,
  onDismiss,
  onEnableNotifications,
}: {
  studioName: string;
  canPrompt: boolean;
  notificationStatus: "unknown" | "granted" | "denied";
  onInstall: () => void;
  onDismiss: () => void;
  onEnableNotifications: () => void;
}) {
  const installLabel =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches
      ? "Adicionar à tela inicial"
      : "Instalar aplicativo";
  return (
    <div className="rounded-[1.75rem] border border-border bg-card/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
            <Download className="size-4" />
          </div>
          <div>
            <p className="text-sm font-extrabold tracking-tight text-foreground">App oficial de {studioName}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Abra conta, histórico, reservas, pagamentos e notificações sem procurar o link outra vez.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onInstall}
          className="rounded-full bg-foreground px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-background transition hover:opacity-90"
        >
          {canPrompt ? installLabel : "Como instalar"}
        </button>
        <button
          type="button"
          onClick={onEnableNotifications}
          disabled={notificationStatus === "granted"}
          className="rounded-full border border-border px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {notificationStatus === "granted" ? "Notificações ativas" : "Ativar notificações"}
        </button>
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
  if (type === "date") {
    return (
      <div className="block rounded-2xl border border-border/70 bg-background/60 px-3.5 py-3 shadow-sm transition focus-within:border-foreground/25 focus-within:bg-background/90 focus-within:ring-2 focus-within:ring-foreground/10">
        <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <PremiumDatePicker
          value={value}
          onChange={onChange}
          placeholder={placeholder ?? "Escolher data"}
          className="mt-1.5 h-10 rounded-xl border-0 bg-transparent px-0 py-1.5 shadow-none"
        />
      </div>
    );
  }

  return (
    <label className="block rounded-2xl border border-border/70 bg-background/60 px-3.5 py-3 shadow-sm transition focus-within:border-foreground/25 focus-within:bg-background/90 focus-within:ring-2 focus-within:ring-foreground/10">
      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1.5 block w-full rounded-xl border-0 bg-transparent px-0 py-1.5 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
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
    <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/60 px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground shadow-sm transition hover:border-foreground/20">
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
  depositPercent,
  onClose,
}: {
  studioName: string;
  policyText: string;
  customText: string;
  depositPercent?: number | null;
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
            <h3 className="text-sm font-bold text-foreground">{Number(depositPercent ?? 100) >= 100 ? "Pagamento e cancelamento" : "Sinal e cancelamento"}</h3>
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
            comprovativo da marcação e do pagamento.
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
  depositPercent,
  onClose,
}: {
  studioName: string;
  policyText: string;
  customText: string;
  depositPercent?: number | null;
  onClose: () => void;
}) {
  const isFullPay = Number(depositPercent ?? 100) >= 100;
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
            <h3 className="text-sm font-bold text-foreground">{isFullPay ? "Pagamento e cancelamento" : "Sinal e cancelamento"}</h3>
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
    <div className="fixed inset-x-0 bottom-0 z-30 translate-y-0 transform-gpu border-t border-border bg-background/92 px-4 pb-[max(env(safe-area-inset-bottom),10px)] pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.08)] backdrop-blur-xl [backface-visibility:hidden] [contain:layout_paint]">
      <div className="mx-auto max-w-[520px] md:max-w-3xl">
        {total > 0 && (
          <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-1">
            <div className="min-w-0">
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                Total{" "}
                {savings > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    · poupa {formatUpsellMoney(savings)}
                  </span>
                )}
              </p>
              <p className={moneyClass("text-lg")}>{formatMoney(total)}</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                {duration} min
              </p>
              <p className="max-w-[9rem] truncate text-xs font-medium" title={proLabel ?? "—"}>{proLabel ?? "—"}</p>
            </div>
          </div>
        )}
        <button
          onClick={onPrimary}
          disabled={disabled}
          className={cn(
            "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all active:scale-[0.98]",
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
              ? "O pagamento foi concluído online e a marcação ficou confirmada no estúdio."
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
    twitter: `https://twitter.com/intent/tweet?text=${enc(`${shareText} ${url}`)}`,
  };

  const onCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onDownloadQr = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `${studioSlug}-qrcode.png`;
    a.click();
  };

  const onNativeShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: studioName, text: shareText, url });
    }
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
