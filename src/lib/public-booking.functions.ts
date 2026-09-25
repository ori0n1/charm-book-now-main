import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  translateBookingError,
  validateBookingQuote,
  validateConfirmedBookingResult,
  type BookingQuote,
  type BookingResult,
} from "@/lib/booking";
import { getRequestFingerprint, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

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
    return validateBookingQuote(rawQuote) as BookingQuote;
  });

export const createProtectedPublicBooking = createServerFn({ method: "POST" })
  .inputValidator((input) => PublicBookingInput.parse(input))
  .handler(async ({ data }) => {
    const admin = getAdminClient() as any;
    const phone = data.clientPhone.replace(/\D/g, "");
    const fingerprintHash = await sha256Hex(getRequestFingerprint());
    const phoneHash = await sha256Hex(`${data.studioSlug}:${phone}`);
    const slotHash = await sha256Hex(
      `${data.studioSlug}:${data.staffDbId}:${data.startsAt}:${data.serviceDbIds.join(",")}`,
    );

    await Promise.all([
      rateLimitOrThrow({ key: `public-booking:ip:${fingerprintHash}`, limit: 15, windowMs: 15 * 60_000 }),
      rateLimitOrThrow({ key: `public-booking:phone:${phoneHash}`, limit: 4, windowMs: 30 * 60_000 }),
      rateLimitOrThrow({ key: `public-booking:slot:${slotHash}`, limit: 4, windowMs: 5 * 60_000 }),
      rateLimitOrThrow({ key: `public-booking:studio:${data.studioSlug}`, limit: 60, windowMs: 5 * 60_000 }),
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
    return result;
  });

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
