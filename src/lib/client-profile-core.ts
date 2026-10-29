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

export const archiveClientInput = z.object({
  studioId: z.string().uuid(),
  clientId: z.string().uuid(),
  confirmation: z.literal("EXCLUIR"),
}).strict();

export type ArchiveClientInput = z.infer<typeof archiveClientInput>;

type ProfileDatabase = { from: (table: string) => any };

async function requireStudioOwner(db: ProfileDatabase, userId: string, studioId: string) {
  const { data: owner, error } = await db
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("studio_id", studioId)
    .eq("role", "studio_owner")
    .limit(1)
    .maybeSingle();
  if (error || !owner) throw new Response("studio_owner_required", { status: 403 });
}

export async function archiveClientForOwner(
  db: ProfileDatabase,
  userId: string,
  data: ArchiveClientInput,
) {
  await requireStudioOwner(db, userId, data.studioId);
  if (typeof (db as any).rpc !== "function") throw new Error("client_archive_unavailable");
  const { error } = await (db as any).rpc("archive_client_for_owner", {
    p_studio_id: data.studioId,
    p_client_id: data.clientId,
    p_confirmation: data.confirmation,
  });
  if (error) throw new Error(error.message || "client_archive_unavailable");
  return { archived: true };
}

export async function updateClientProfileForOwner(
  db: ProfileDatabase,
  userId: string,
  data: ClientProfileInput,
) {
  await requireStudioOwner(db, userId, data.studioId);

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
    .is("archived_at", null)
    .select("id,name,phone,email,notes,date_of_birth")
    .maybeSingle();
  if (error) throw new Error(error.code === "23505" ? "phone_already_used" : error.message);
  if (!client) throw new Response("client_not_found", { status: 404 });
  return client;
}
