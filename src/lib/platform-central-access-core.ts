export type CentralAuthUser = {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
};

export type CentralAccessRole = {
  user_id: string;
  studio_id: string | null;
  role: string;
};

export type CentralStudioAccess = {
  studioId: string;
  ownerEmail: string | null;
  lastAccessAt: string | null;
  state: "recent" | "inactive" | "never" | "unknown";
};

export type CentralAccessSnapshot = {
  generatedAt: string;
  thresholdDays: number;
  studios: CentralStudioAccess[];
  excludedAccountFound: boolean;
  excludedStudioIds: string[];
};

export function centralVolumeWithoutAccount(
  rows: Array<{ id: string; volumeCents: number | null }>,
  access: CentralAccessSnapshot | undefined,
): { visibleCents: number; excludedCents: number } | null {
  if (!access?.excludedAccountFound || rows.some((row) => row.volumeCents === null)) return null;
  const excluded = new Set(access.excludedStudioIds);
  if (access.excludedStudioIds.some((id) => !rows.some((row) => row.id === id))) return null;
  return rows.reduce(
    (total, row) => {
      total[excluded.has(row.id) ? "excludedCents" : "visibleCents"] += row.volumeCents ?? 0;
      return total;
    },
    { visibleCents: 0, excludedCents: 0 },
  );
}

const STUDIO_ROLES = new Set(["studio_owner", "manager", "staff", "desk_staff"]);
const OWNER_ROLES = new Set(["studio_owner", "saas_owner"]);
const EXCLUDED_EMAIL = "silas18.so@gmail.com";

export function buildCentralAccessSnapshot(input: {
  users: CentralAuthUser[];
  roles: CentralAccessRole[];
  now?: Date;
}): CentralAccessSnapshot {
  const now = input.now ?? new Date();
  const userById = new Map(input.users.map((user) => [user.id, user]));
  const excludedUser = input.users.find(
    (user) => user.email?.trim().toLowerCase() === EXCLUDED_EMAIL,
  );
  const excludedStudioIds = excludedUser
    ? [...new Set(input.roles
        .filter((role) => role.user_id === excludedUser.id && role.studio_id && OWNER_ROLES.has(role.role))
        .map((role) => role.studio_id as string))]
    : [];

  const byStudio = new Map<string, CentralAccessRole[]>();
  for (const role of input.roles) {
    if (!role.studio_id || !STUDIO_ROLES.has(role.role)) continue;
    const studioRoles = byStudio.get(role.studio_id) ?? [];
    studioRoles.push(role);
    byStudio.set(role.studio_id, studioRoles);
  }
  const cutoff = now.getTime() - 30 * 86400000;
  const studios: CentralStudioAccess[] = [...byStudio].map(([studioId, roles]) => {
    const owner = roles.find((role) => role.role === "studio_owner");
    const linkedUsers = roles.map((role) => userById.get(role.user_id));
    const lastAccessAt = linkedUsers
      .map((user) => user?.last_sign_in_at ?? null)
      .filter((date): date is string => typeof date === "string" && Number.isFinite(Date.parse(date)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))
      .at(-1) ?? null;
    return {
      studioId,
      ownerEmail: owner ? userById.get(owner.user_id)?.email ?? null : null,
      lastAccessAt,
      state: linkedUsers.some((user) => !user)
        ? "unknown"
        : !lastAccessAt
          ? "never"
          : Date.parse(lastAccessAt) < cutoff
            ? "inactive"
            : "recent",
    };
  });
  return {
    generatedAt: now.toISOString(),
    thresholdDays: 30,
    studios,
    excludedAccountFound: Boolean(excludedUser),
    excludedStudioIds,
  };
}
