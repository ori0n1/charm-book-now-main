import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { archiveClientForOwner, archiveClientInput, clientProfileInput, getClientProfilePermissions, inspectClientForOwner, inspectClientInput, removeClientsForOwner, removeClientsInput, unifyEmptyClientForOwner, unifyEmptyClientInput, updateClientProfileForMember } from "@/lib/client-profile-core";
import { getAdminClient } from "@/lib/supabase-admin.server";

export const getClientProfileEditPermission = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ studioId: z.string().uuid() }).strict().parse(input))
  // Desk staff may not see their own user_roles row through RLS; verify membership on the server.
  .handler(({ data, context }) => getClientProfilePermissions(getAdminClient(), context.userId, data.studioId));

export const updateClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => clientProfileInput.parse(input))
  // The core function verifies the studio membership and limits this privileged write to five profile fields.
  .handler(({ data, context }) => updateClientProfileForMember(getAdminClient(), context.userId, data));

export const archiveClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => archiveClientInput.parse(input))
  .handler(({ data, context }) => archiveClientForOwner(context.supabase, context.userId, data));

export const inspectClientProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inspectClientInput.parse(input))
  .handler(({ data, context }) => inspectClientForOwner(context.supabase, context.userId, data));

export const removeClientProfiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => removeClientsInput.parse(input))
  .handler(({ data, context }) => removeClientsForOwner(context.supabase, context.userId, data));

export const unifyEmptyClientProfiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => unifyEmptyClientInput.parse(input))
  .handler(({ data, context }) => unifyEmptyClientForOwner(context.supabase, context.userId, data));
