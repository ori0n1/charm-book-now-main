import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAdminClient } from "@/lib/supabase-admin.server";
import { dispatchPendingStudioPushNotifications } from "@/lib/notification-dispatcher.server";
import { assertStudioEntitlement } from "@/lib/server-security";

// ── Types ────────────────────────────────────────────────

export type StudioReview = {
  id: string;
  studioId: string;
  userId: string;
  appointmentId: string | null;
  rating: number;
  comment: string | null;
  staffIds: string[];
  reviewerName: string | null;
  createdAt: string;
};

// ── Submit review ────────────────────────────────────────

const SubmitReviewInput = z.object({
  studioId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
  staffIds: z.array(z.string().uuid()).default([]),
  reviewerName: z.string().max(80).optional(),
});

export const submitStudioReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => SubmitReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;
    await assertStudioEntitlement(sb, data.studioId, "reviews");

    // If appointmentId provided: verify ownership, status, and no duplicate
    if (data.appointmentId) {
      const { data: appt } = await sb
        .from("appointments")
        .select("id,status,client_id,studio_id")
        .eq("id", data.appointmentId)
        .maybeSingle();

      if (!appt) throw new Error("Marcação não encontrada.");

      if ((appt as any).studio_id !== data.studioId) {
        throw new Response("forbidden", { status: 403 });
      }

      // Verify appointment belongs to the authenticated user via clients table
      const clientId = (appt as any).client_id;

      // Primary check: by auth_user_id (most reliable)
      const { data: clientByUser } = await sb
        .from("clients")
        .select("id")
        .eq("id", clientId)
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (!clientByUser) throw new Error("Não tens permissão para avaliar esta marcação.");

      // Only allow completed or confirmed appointments
      const apptStatus = (appt as any).status as string;
      if (!["completed", "confirmed"].includes(apptStatus)) {
        throw new Error("Apenas marcações concluídas podem ser avaliadas.");
      }

      // Prevent duplicate review for the same appointment
      const { data: existing } = await sb
        .from("studio_reviews")
        .select("id")
        .eq("user_id", userId)
        .eq("appointment_id", data.appointmentId)
        .maybeSingle();

      if (existing) throw new Error("Já avaliaste esta marcação.");
    }

    const { data: insertedReview, error } = await sb.from("studio_reviews").insert({
      studio_id: data.studioId,
      user_id: userId,
      appointment_id: data.appointmentId ?? null,
      rating: data.rating,
      comment: data.comment ?? null,
      staff_ids: data.staffIds,
      reviewer_name: data.reviewerName ?? null,
    }).select("id").single();

    if (error) throw new Error(error.message);
    await dispatchPendingStudioPushNotifications({ studioId: data.studioId }).catch(
      (dispatchError) => {
        console.error("[reviews] studio_push_dispatch_failed", {
          studio_id: data.studioId,
          review_id: insertedReview?.id ?? null,
          reason:
            dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
        });
      },
    );
    return { success: true };
  });

// ── Get reviews for a studio (public) ───────────────────

const GetReviewsInput = z.object({
  studioId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const getStudioReviews = createServerFn({ method: "POST" })
  .inputValidator((input) => GetReviewsInput.parse(input))
  .handler(async ({ data }) => {
    const sb = getAdminClient();
    try {
      await assertStudioEntitlement(sb, data.studioId, "reviews");
    } catch {
      return { reviews: [] as StudioReview[] };
    }
    const { data: rows, error } = await sb
      .from("studio_reviews")
      .select("id,studio_id,user_id,appointment_id,rating,comment,staff_ids,reviewer_name,created_at")
      .eq("studio_id", data.studioId)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (error) return { reviews: [] as StudioReview[] };

    const reviews: StudioReview[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      studioId: r.studio_id,
      userId: r.user_id,
      appointmentId: r.appointment_id ?? null,
      rating: Number(r.rating),
      comment: r.comment ?? null,
      staffIds: Array.isArray(r.staff_ids) ? r.staff_ids : [],
      reviewerName: r.reviewer_name ?? null,
      createdAt: r.created_at,
    }));

    return { reviews };
  });

// ── Check if user can review an appointment ──────────────

const CanReviewInput = z.object({
  appointmentId: z.string().uuid(),
});

export const canReviewAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CanReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;

    const { data: appointment } = await sb
      .from("appointments")
      .select("studio_id")
      .eq("id", data.appointmentId)
      .maybeSingle();
    if (!appointment?.studio_id) return { canReview: false, alreadyReviewed: false };
    try {
      await assertStudioEntitlement(sb, appointment.studio_id as string, "reviews");
    } catch {
      return { canReview: false, alreadyReviewed: false };
    }

    // Check if already reviewed
    const { data: existing } = await sb
      .from("studio_reviews")
      .select("id")
      .eq("user_id", userId)
      .eq("appointment_id", data.appointmentId)
      .maybeSingle();

    return { canReview: !existing, alreadyReviewed: Boolean(existing) };
  });

// ── Get reviews submitted by the authenticated user ──────

export const getMyReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = getAdminClient();
    const userId = (context as any).userId as string;

    const { data: rows } = await sb
      .from("studio_reviews")
      .select("id,studio_id,appointment_id,rating,comment,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);

    return {
      reviews: (rows ?? []).map((r: any) => ({
        id: r.id as string,
        studioId: r.studio_id as string,
        appointmentId: r.appointment_id as string | null,
        rating: Number(r.rating),
        comment: r.comment as string | null,
        createdAt: r.created_at as string,
      })),
    };
  });
