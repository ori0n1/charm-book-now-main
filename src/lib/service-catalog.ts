import type { Category, Service } from "@/data/studio";

export const ALL_SERVICES_CATEGORY: Category = {
  id: "all",
  label: "Todos os serviços",
};

export function buildPublicServiceCategories(
  categories: Category[],
  services: Service[],
): Category[] {
  const usedCategories = categories.filter(
    (category) =>
      category.id !== ALL_SERVICES_CATEGORY.id &&
      services.some((service) => service.category === category.id),
  );

  return [ALL_SERVICES_CATEGORY, ...usedCategories];
}

export function filterPublicServices(
  services: Service[],
  categoryId: string,
): Service[] {
  if (categoryId === ALL_SERVICES_CATEGORY.id) return services;
  return services.filter((service) => service.category === categoryId);
}

export type ServiceSelectionSummary = {
  total: number;
  durationMin: number;
};

export function summarizeServiceSelection(
  items: Array<{ price: unknown; durationMin: unknown }>,
): ServiceSelectionSummary | null {
  let totalCents = 0;
  let durationMin = 0;

  for (const item of items) {
    if (
      typeof item.price !== "number" ||
      !Number.isFinite(item.price) ||
      item.price < 0 ||
      typeof item.durationMin !== "number" ||
      !Number.isFinite(item.durationMin) ||
      item.durationMin < 0
    ) {
      return null;
    }

    totalCents += Math.round(item.price * 100);
    durationMin += item.durationMin;
  }

  if (!Number.isFinite(totalCents) || !Number.isFinite(durationMin)) return null;
  return { total: totalCents / 100, durationMin };
}

export function sumServiceDuration(items: Array<Pick<Service, "durationMin">>): number {
  return items.reduce((total, item) => total + Math.max(0, item.durationMin), 0);
}

export function hasBookableDuration(
  items: Array<Pick<Service, "durationMin">>,
): boolean {
  const summary = summarizeServiceSelection(
    items.map((item) => ({ price: 0, durationMin: item.durationMin })),
  );
  return summary !== null && summary.durationMin > 0;
}
