import { z } from "zod";

export const clientProfileInput = z.object({
  studioId: z.string().uuid(),
  clientId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(6).max(32),
  email: z.union([z.string().trim().email().max(254), z.literal("")]),
  notes: z.string().trim().max(2000),
  dateOfBirth: z.union([z.string().date(), z.literal("")]),
}).strict();

export type ClientProfileInput = z.infer<typeof clientProfileInput>;

type ProfileDatabase = { from: (table: string) => any };

export async function updateClientProfileForOwner(
  db: ProfileDatabase,
  userId: string,
  data: ClientProfileInput,
) {
  const { data: owner, error: ownerError } = await db
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("studio_id", data.studioId)
    .eq("role", "studio_owner")
    .limit(1)
    .maybeSingle();
  if (ownerError || !owner) throw new Response("studio_owner_required", { status: 403 });

  const { data: client, error } = await db
    .from("clients")
    .update({
      name: data.name,
      phone: data.phone,
      email: data.email || null,
      notes: data.notes || null,
      date_of_birth: data.dateOfBirth || null,
    })
    .eq("id", data.clientId)
    .eq("studio_id", data.studioId)
    .select("id,name,phone,email,notes,date_of_birth")
    .maybeSingle();
  if (error) throw new Error(error.code === "23505" ? "phone_already_used" : error.message);
  if (!client) throw new Response("client_not_found", { status: 404 });
  return client;
}
