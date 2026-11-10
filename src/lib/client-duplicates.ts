export type DuplicateClient = {
  id: string;
  studioId: string;
  name: string;
  email: string | null;
  phone: string;
  authUserId: string | null;
  totalAppointments: number;
  completedAppointments: number;
  createdAt: string;
};

export function normalizedClientEmail(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").toLowerCase();
}

export function normalizedClientPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  const international = digits.startsWith("00") ? digits.slice(2) : digits;
  if (international.length === 9 && international.startsWith("9")) return `351${international}`;
  return international.length >= 10 && international.length <= 15 ? international : "";
}

function normalizedClientName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type DuplicateGroup<T extends DuplicateClient> = {
  id: string;
  kind: "confirmed" | "possible";
  primary: T;
  clients: T[];
  reasons: string[];
};

export function groupDuplicateClients<T extends DuplicateClient>(clients: T[]): DuplicateGroup<T>[] {
  const parent = clients.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const unite = (a: number, b: number) => { parent[root(b)] = root(a); };
  const firstByKey = new Map<string, number>();
  clients.forEach((client, index) => {
    const keys = [
      client.authUserId && `auth:${client.authUserId}`,
      normalizedClientEmail(client.email) && `email:${normalizedClientEmail(client.email)}`,
      normalizedClientPhone(client.phone) && `phone:${normalizedClientPhone(client.phone)}`,
    ].filter(Boolean) as string[];
    for (const key of keys) {
      const scopedKey = `${client.studioId}:${key}`;
      const first = firstByKey.get(scopedKey);
      if (first === undefined) firstByKey.set(scopedKey, index);
      else unite(first, index);
    }
  });
  const sets = new Map<number, T[]>();
  clients.forEach((client, index) => {
    const key = root(index);
    sets.set(key, [...(sets.get(key) ?? []), client]);
  });
  return [...sets.values()].filter((set) => set.length > 1).map((set) => {
    const sorted = [...set].sort((a, b) => Number(Boolean(b.authUserId)) - Number(Boolean(a.authUserId)) ||
      b.totalAppointments - a.totalAppointments || b.completedAppointments - a.completedAppointments ||
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const authIds = new Set(set.map((client) => client.authUserId).filter(Boolean));
    const emails = new Set(set.map((client) => normalizedClientEmail(client.email)).filter(Boolean));
    const phones = new Set(set.map((client) => normalizedClientPhone(client.phone)).filter(Boolean));
    const names = new Set(set.map((client) => normalizedClientName(client.name)).filter(Boolean));
    const reasons = [authIds.size === 1 && set.every((client) => client.authUserId) ? "mesma conta" : "", emails.size === 1 ? "e-mail igual" : "", phones.size === 1 ? "telefone equivalente" : "", names.size === 1 ? "nome semelhante" : ""].filter(Boolean);
    return {
      id: sorted[0].id,
      kind: authIds.size === 1 && set.every((client) => client.authUserId) ? "confirmed" as const : "possible" as const,
      primary: sorted[0],
      clients: sorted,
      reasons,
    };
  });
}
