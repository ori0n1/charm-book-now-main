import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getRequestFingerprint, rateLimitOrThrow } from "@/lib/server-security";
import { getAdminClient } from "@/lib/supabase-admin.server";

const CreateStudioInput = z.object({
  name: z.string().trim().min(2),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/),
  businessSegment: z.enum(["beauty", "barbershop", "nail_studio", "clinic", "other"]),
  phone: z.string().trim().optional().nullable(),
  deviceFingerprint: z.string().trim().optional().nullable(),
});

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function friendlyTrialError(message: string) {
  if (message.includes("trial_reuse_detected")) {
    return "Este estúdio já usou o teste gratuito. Escolha um plano para continuar.";
  }
  if (message.includes("trial_device_reuse_detected")) {
    return "Este dispositivo já usou um teste gratuito. Escolha um plano para continuar.";
  }
  if (message.includes("duplicate") || message.includes("studios_slug_key")) {
    return "Esse link público já existe.";
  }
  return message;
}

export const createStudioWithTrialGuard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CreateStudioInput.parse(input))
  .handler(async ({ data, context }) => {
    const sb = getAdminClient() as any;
    const userId = String((context as any).userId ?? "");
    const requestFingerprint = getRequestFingerprint();
    const ipHash = await sha256Hex(`ip:${requestFingerprint}`);
    const deviceSource = data.deviceFingerprint || requestFingerprint;
    const deviceHash = await sha256Hex(`device:${deviceSource}`);

    await Promise.all([
      rateLimitOrThrow({ key: `trial-create:user:${userId}`, limit: 2, windowMs: 24 * 60 * 60_000 }),
      rateLimitOrThrow({ key: `trial-create:ip:${ipHash}`, limit: 5, windowMs: 24 * 60 * 60_000 }),
    ]);

    const { data: studioId, error } = await sb.rpc("create_studio_with_owner", {
      p_owner_user_id: userId,
      p_name: data.name,
      p_slug: data.slug,
      p_timezone: "Europe/Lisbon",
      p_currency: "EUR",
      p_business_segment: data.businessSegment,
      p_trial_phone: normalizePhone(data.phone),
      p_trial_device_fingerprint_hash: deviceHash,
      p_trial_ip_hash: ipHash,
    });

    if (error) {
      throw new Error(friendlyTrialError(error.message));
    }

    return { studioId: typeof studioId === "string" ? studioId : null };
  });
