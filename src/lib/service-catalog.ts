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

export function sumServiceDuration(items: Array<Pick<Service, "durationMin">>): number {
  return items.reduce((total, item) => total + Math.max(0, item.durationMin), 0);
}

export function hasBookableDuration(
  items: Array<Pick<Service, "durationMin">>,
): boolean {
  return sumServiceDuration(items) > 0;
}
