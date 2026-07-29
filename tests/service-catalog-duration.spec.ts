import { expect, test } from "@playwright/test";
import type { Category, Service } from "../src/data/studio";
import {
  buildPublicServiceCategories,
  filterPublicServices,
  hasBookableDuration,
  sumServiceDuration,
} from "../src/lib/service-catalog";

const categories: Category[] = [
  { id: "all", label: "Todos" },
  { id: "hair", label: "Cabelo" },
  { id: "extras", label: "Extras" },
  { id: "unused", label: "Sem serviços" },
];

const services: Service[] = [
  {
    id: "cut",
    category: "hair",
    name: "Corte",
    durationMin: 45,
    price: 25,
    media: [],
  },
  {
    id: "product",
    category: "extras",
    name: "Produto adicional",
    durationMin: 0,
    price: 8,
    media: [],
  },
];

test.describe("public service catalog", () => {
  test("keeps Todos os serviços first and hides only empty specific categories", () => {
    const result = buildPublicServiceCategories(categories, services);

    expect(result.map((category) => category.id)).toEqual(["all", "hair", "extras"]);
    expect(result[0].label).toBe("Todos os serviços");
  });

  test("lists every service in Todos os serviços and preserves specific filters", () => {
    expect(filterPublicServices(services, "all").map((service) => service.id)).toEqual([
      "cut",
      "product",
    ]);
    expect(filterPublicServices(services, "extras").map((service) => service.id)).toEqual([
      "product",
    ]);
  });
});

test.describe("zero-minute services", () => {
  test("do not add time to a mixed reservation", () => {
    expect(sumServiceDuration(services)).toBe(45);
    expect(hasBookableDuration(services)).toBe(true);
  });

  test("remain non-bookable alone because an appointment needs a real time span", () => {
    expect(sumServiceDuration([services[1]])).toBe(0);
    expect(hasBookableDuration([services[1]])).toBe(false);
  });
});
