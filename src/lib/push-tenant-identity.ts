export type TrustedPushStudio = {
  id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  updated_at: string | null;
};

type PushStudioRow = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  logo_url?: unknown;
  updated_at?: unknown;
};

/**
 * Resolves the notification identity from the studio row selected by the
 * backend. The id equality check keeps a row from another tenant from ever
 * becoming the visible push identity.
 */
export function resolveTrustedPushStudio(
  row: PushStudioRow | null | undefined,
  expectedStudioId: string,
): TrustedPushStudio | null {
  const id = typeof row?.id === "string" ? row.id.trim() : "";
  if (!id || id !== expectedStudioId) return null;

  const name = typeof row?.name === "string" ? row.name.replace(/\s+/g, " ").trim() : "";
  if (!name) return null;

  return {
    id,
    name,
    slug: readNullableText(row?.slug),
    logo_url: readNullableText(row?.logo_url),
    updated_at: readNullableText(row?.updated_at),
  };
}

export async function loadTrustedPushStudios(
  sb: any,
  studioIds: string[],
): Promise<Map<string, TrustedPushStudio>> {
  const ids = Array.from(new Set(studioIds.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return new Map();

  const { data, error } = await sb
    .from("studios")
    .select("id,name,slug,logo_url,updated_at")
    .in("id", ids);
  if (error) throw new Error(error.message);

  const studios = new Map<string, TrustedPushStudio>();
  for (const row of (data ?? []) as PushStudioRow[]) {
    const rowId = typeof row.id === "string" ? row.id.trim() : "";
    if (!ids.includes(rowId)) continue;
    const studio = resolveTrustedPushStudio(row, rowId);
    if (studio) studios.set(rowId, studio);
  }
  return studios;
}

export async function loadTrustedPushStudio(
  sb: any,
  studioId: string,
): Promise<TrustedPushStudio | null> {
  const studios = await loadTrustedPushStudios(sb, [studioId]);
  return studios.get(studioId) ?? null;
}

function readNullableText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
