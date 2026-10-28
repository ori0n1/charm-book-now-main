import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  translateBookingError,
  validateBookingQuote,
  validateConfirmedBookingResult,
  type BookingQuote,
  type BookingResult,
} from "@/lib/booking";
import { PUBLIC_BOOKING_RATE_LIMITS } from "@/lib/public-booking-rate-limits";
import { getRequestFingerprint, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { assertJointBookingCreationEnabled } from "@/lib/joint-booking-creation.server";
import { getRequest } from "@tanstack/react-start/server";
import { createRequestSupabaseClient, setPrivateAuthResponseHeaders } from "@/integrations/supabase/server-client";
import { calculateDepositCharge, readDepositRule, readDepositSnapshot } from "@/lib/deposit-rule";

async function requirePublicBookingUser() {
  const request = getRequest();
  const authorization = request.headers.get("authorization");
  if (authorization && !/^Bearer\s+\S+$/.test(authorization)) {
    throw Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = authorization?.slice(7).trim();
  const auth = createRequestSupabaseClient();
  const { data, error } = await auth.auth.getUser(token || undefined);
  if (error || !data.user?.id) {
    throw Response.json({ error: "authentication_required" }, {
      status: 401,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" },
    });
  }
  setPrivateAuthResponseHeaders();
  return data.user;
}

const PolicyAcceptance = z.object({
  studioId: z.string().uuid(),
  policyVersion: z.string().trim().min(1).max(120),
  cancellationNoticeHours: z.number().int().min(0).max(8760),
  afterDeadlinePolicy: z.string().trim().min(1).max(120),
});

const PublicBookingInput = z.object({
  studioSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(120),
  staffDbId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  serviceDbIds: z.array(z.string().uuid()).min(1).max(12),
  clientName: z.string().trim().min(2).max(120),
  clientPhone: z.string().trim().min(9).max(40),
  clientEmail: z.string().trim().email().max(254).optional(),
  notes: z.string().trim().max(1000).optional(),
  customerReferralCode: z.string().trim().max(100).optional(),
  policyAcceptance: PolicyAcceptance.optional(),
});

const PublicBookingQuoteInput = z.object({
  studioSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(120),
  serviceDbIds: z.array(z.string().uuid()).min(1).max(12),
});

const PublicJointBookingInput = z.object({
  studioSlug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(120),
  startsAt: z.string().datetime({ offset: true }),
  serviceAssignments: z.array(z.object({
    serviceDbId: z.string().uuid(),
    staffDbId: z.string().uuid(),
  })).min(2).max(12).superRefine((assignments, context) => {
    if (new Set(assignments.map((line) => line.serviceDbId)).size !== assignments.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_service" });
    }
    if (new Set(assignments.map((line) => line.staffDbId)).size < 2) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "joint_staff_required" });
    }
  }),
  clientName: z.string().trim().min(2).max(120),
  clientPhone: z.string().trim().min(9).max(40),
  clientEmail: z.string().trim().email().max(254).optional(),
  notes: z.string().trim().max(1000).optional(),
  customerReferralCode: z.string().trim().max(100).optional(),
  policyAcceptance: PolicyAcceptance.optional(),
});

export const createProtectedPublicJointBooking = createServerFn({ method: "POST" })
  .inputValidator((input) => PublicJointBookingInput.parse(input))
  .handler(async ({ data }) => {
    await requirePublicBookingUser();
    assertJointBookingCreationEnabled();
    const admin = getAdminClient() as any;
    const phone = data.clientPhone.replace(/\D/g, "");
    const fingerprintHash = await sha256Hex(getRequestFingerprint());
    const phoneHash = await sha256Hex(`${data.studioSlug}:${phone}`);
    const slotHash = await sha256Hex(
      `${data.studioSlug}:${data.startsAt}:${data.serviceAssignments
        .map((line) => `${line.serviceDbId}:${line.staffDbId}`).join(",")}`,
    );
    await Promise.all([
      rateLimitOrThrow({ key: `public-booking:ip:${fingerprintHash}`, ...PUBLIC_BOOKING_RATE_LIMITS.ip }),
      rateLimitOrThrow({ key: `public-booking:phone:${phoneHash}`, ...PUBLIC_BOOKING_RATE_LIMITS.phone }),
      rateLimitOrThrow({ key: `public-booking:slot:${slotHash}`, ...PUBLIC_BOOKING_RATE_LIMITS.slot }),
      rateLimitOrThrow({ key: `public-booking:studio:${data.studioSlug}`, ...PUBLIC_BOOKING_RATE_LIMITS.studio }),
    ]);

    let { data: studioMode, error: studioModeError } = await admin
      .from("studios").select("id,booking_flow_mode")
      .eq("slug", data.studioSlug).eq("is_active", true).maybeSingle();
    if (
      studioModeError &&
      (studioModeError.code === "42703" || /booking_flow_mode.*does not exist/i.test(studioModeError.message))
    ) {
      const fallback = await admin.from("studios").select("id")
        .eq("slug", data.studioSlug).eq("is_active", true).maybeSingle();
      studioMode = fallback.data ? { id: fallback.data.id, booking_flow_mode: "online" } : null;
      studioModeError = fallback.error;
    }
    if (studioModeError || !studioMode) throw new Error(translateBookingError("studio_not_available"));
    const { data: whatsappEntitled, error: entitlementError } = await admin.rpc(
      "studio_has_entitlement", { _studio_id: studioMode.id, _feature: "whatsapp" },
    );
    if (entitlementError) throw new Error(translateBookingError("studio_not_available"));
    if (whatsappEntitled === true && studioMode.booking_flow_mode === "request") {
      throw new Error(translateBookingError("booking_request_mode_only"));
    }

    const { data: rawResult, error } = await admin.rpc("create_public_joint_booking", {
      p_studio_slug: data.studioSlug,
      p_starts_at: data.startsAt,
      p_service_assignments: data.serviceAssignments.map((line, position) => ({
        service_id: line.serviceDbId,
        staff_id: line.staffDbId,
        position,
      })),
      p_client_name: data.clientName,
      p_client_phone: data.clientPhone,
      p_client_email: data.clientEmail ?? null,
      p_notes: data.notes ?? null,
      p_customer_referral_code: data.customerReferralCode ?? null,
    });
    if (error) {
      console.error("[public-joint-booking] booking failed", {
        code: error.code, studioSlug: data.studioSlug, startsAt: data.startsAt,
      });
      throw new Error(translateBookingError(
        [error.message, error.details, error.hint, error.code].filter(Boolean).join(" "),
      ));
    }
    const result = validateConfirmedBookingResult(rawResult) as BookingResult;
    if (result.studio_id !== studioMode.id) {
      throw new Error(translateBookingError("studio_not_available"));
    }
    if (data.policyAcceptance?.studioId === result.studio_id) {
      const { error: policyError } = await admin.rpc("record_public_policy_acceptance", {
        p_studio_id: result.studio_id,
        p_booking_request_id: result.booking_request_id,
        p_appointment_id: result.appointment_id,
        p_policy_version: data.policyAcceptance.policyVersion,
        p_payload: {
          cancellation_notice_hours: data.policyAcceptance.cancellationNoticeHours,
          after_deadline_policy: data.policyAcceptance.afterDeadlinePolicy,
          accepted_label: "Li e concordo com as políticas de cancelamento e pagamento.",
        },
      });
      if (policyError) console.error("[public-joint-booking] policy acceptance failed", {
        code: policyError.code, bookingRequestId: result.booking_request_id,
      });
    }
    return { ...result, deposit_rule: await loadCreatedDepositRule(admin, result) };
  });

export const getProtectedPublicBookingQuote = createServerFn({ method: "POST" })
  .inputValidator((input) => PublicBookingQuoteInput.parse(input))
  .handler(async ({ data }) => {
    const fingerprintHash = await sha256Hex(getRequestFingerprint());
    await rateLimitOrThrow({
      key: `public-booking-quote:ip:${fingerprintHash}`,
      limit: 120,
      windowMs: 5 * 60_000,
    });
    const admin = getAdminClient() as any;
    const { data: rawQuote, error } = await admin.rpc("quote_public_booking", {
      p_studio_slug: data.studioSlug,
      p_service_ids: [...new Set(data.serviceDbIds)],
    });
    if (error) throw new Error(translateBookingError(error.message));
    const quote = validateBookingQuote(rawQuote) as BookingQuote;
    const { data: studio, error: studioError } = await admin.from("studios")
      .select("deposit_percent,studio_policy_settings,payment_policy")
      .eq("id", quote.studio_id).eq("is_active", true).single();
    if (studioError || !studio) throw new Error("Não foi possível calcular o sinal.");
    const rule = readDepositRule(studio);
    if (studio.payment_policy === "pre_payment") {
      calculateDepositCharge(Math.round(quote.total_price * 100), rule);
    }
    return { ...quote, deposit_rule: rule };
  });

export const createProtectedPublicBooking = createServerFn({ method: "POST" })
  .inputValidator((input) => PublicBookingInput.parse(input))
  .handler(async ({ data }) => {
    await requirePublicBookingUser();
    const admin = getAdminClient() as any;
    const phone = data.clientPhone.replace(/\D/g, "");
    const fingerprintHash = await sha256Hex(getRequestFingerprint());
    const phoneHash = await sha256Hex(`${data.studioSlug}:${phone}`);
    const slotHash = await sha256Hex(
      `${data.studioSlug}:${data.staffDbId}:${data.startsAt}:${data.serviceDbIds.join(",")}`,
    );

    await Promise.all([
      rateLimitOrThrow({ key: `public-booking:ip:${fingerprintHash}`, ...PUBLIC_BOOKING_RATE_LIMITS.ip }),
      rateLimitOrThrow({ key: `public-booking:phone:${phoneHash}`, ...PUBLIC_BOOKING_RATE_LIMITS.phone }),
      rateLimitOrThrow({ key: `public-booking:slot:${slotHash}`, ...PUBLIC_BOOKING_RATE_LIMITS.slot }),
      rateLimitOrThrow({ key: `public-booking:studio:${data.studioSlug}`, ...PUBLIC_BOOKING_RATE_LIMITS.studio }),
    ]);

    let { data: studioMode, error: studioModeError } = await admin
      .from("studios")
      .select("id,booking_flow_mode")
      .eq("slug", data.studioSlug)
      .eq("is_active", true)
      .maybeSingle();
    if (
      studioModeError &&
      (studioModeError.code === "42703" || /booking_flow_mode.*does not exist/i.test(studioModeError.message))
    ) {
      // Safe rolling-deploy compatibility: before the migration every studio
      // necessarily uses the historic online flow.
      const fallbackStudio = await admin
        .from("studios")
        .select("id")
        .eq("slug", data.studioSlug)
        .eq("is_active", true)
        .maybeSingle();
      studioMode = fallbackStudio.data
        ? { id: fallbackStudio.data.id, booking_flow_mode: "online" }
        : null;
      studioModeError = fallbackStudio.error;
    }
    if (studioModeError || !studioMode) throw new Error(translateBookingError("studio_not_available"));
    const { data: whatsappEntitled, error: entitlementError } = await admin.rpc(
      "studio_has_entitlement",
      {
        _studio_id: studioMode.id,
        _feature: "whatsapp",
      },
    );
    if (entitlementError) {
      console.error("[public-booking] plan entitlement lookup failed", {
        studioId: studioMode.id,
        code: entitlementError.code,
      });
      throw new Error(translateBookingError("studio_not_available"));
    }
    const effectiveBookingMode = whatsappEntitled === true
      ? studioMode.booking_flow_mode
      : "online";
    if (effectiveBookingMode === "request") {
      throw new Error(translateBookingError("booking_request_mode_only"));
    }

    const { data: rawResult, error } = await admin.rpc("create_public_booking", {
      p_studio_slug: data.studioSlug,
      p_staff_id: data.staffDbId,
      p_starts_at: data.startsAt,
      p_service_ids: [...new Set(data.serviceDbIds)],
      p_client_name: data.clientName,
      p_client_phone: data.clientPhone,
      p_client_email: data.clientEmail ?? null,
      p_notes: data.notes ?? null,
      p_customer_referral_code: data.customerReferralCode ?? null,
    });

    if (error) {
      console.error("[public-booking] protected booking failed", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        studioSlug: data.studioSlug,
        staffDbId: data.staffDbId,
        startsAt: data.startsAt,
        phoneFingerprint: phone.length > 4 ? `***${phone.slice(-4)}` : "****",
      });
      throw new Error(
        translateBookingError(
          [error.message, error.details, error.hint, error.code].filter(Boolean).join(" "),
        ),
      );
    }

    const result = validateConfirmedBookingResult(rawResult) as BookingResult;
    if (!studioMode.id || result.studio_id !== studioMode.id) {
      console.error("[public-booking] booking result tenant mismatch", {
        expectedStudioId: studioMode.id ?? null,
        receivedStudioId: result.studio_id,
      });
      throw new Error(translateBookingError("studio_not_available"));
    }
    if (data.policyAcceptance) {
      if (data.policyAcceptance.studioId !== result.studio_id) {
        console.error("[public-booking] policy studio mismatch", {
          expectedStudioId: result.studio_id,
        });
      } else {
        const { error: policyError } = await admin.rpc("record_public_policy_acceptance", {
          p_studio_id: result.studio_id,
          p_booking_request_id: result.booking_request_id,
          p_appointment_id: result.appointment_id,
          p_policy_version: data.policyAcceptance.policyVersion,
          p_payload: {
            cancellation_notice_hours: data.policyAcceptance.cancellationNoticeHours,
            after_deadline_policy: data.policyAcceptance.afterDeadlinePolicy,
            accepted_label: "Li e concordo com as políticas de cancelamento e pagamento.",
          },
        });
        if (policyError) {
          console.error("[public-booking] policy acceptance failed", {
            appointmentId: result.appointment_id,
            bookingRequestId: result.booking_request_id,
            code: policyError.code,
          });
        }
      }
    }
    return { ...result, deposit_rule: await loadCreatedDepositRule(admin, result) };
  });

async function loadCreatedDepositRule(admin: any, result: BookingResult) {
  if (!result.requires_payment) return undefined;
  const table = result.booking_request_id ? "booking_payment_requests" : "appointments";
  const id = result.booking_request_id ?? result.appointment_id;
  const { data, error } = await admin.from(table)
    .select("deposit_rule_snapshot")
    .eq("id", id).eq("studio_id", result.studio_id).single();
  if (error || !data?.deposit_rule_snapshot) {
    throw new Error("Não foi possível confirmar o sinal desta reserva.");
  }
  return readDepositSnapshot(data.deposit_rule_snapshot, {});
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
