import anaImg from "@/assets/pro-ana.jpg";
import marcelloImg from "@/assets/pro-marcello.jpg";
import sofiaImg from "@/assets/pro-sofia.jpg";
import upsellImg from "@/assets/upsell-mask.jpg";
import svcManicure1 from "@/assets/svc-manicure-1.jpg";
import svcManicure2 from "@/assets/svc-manicure-2.jpg";
import svcLashes1 from "@/assets/svc-lashes-1.jpg";
import svcFacial1 from "@/assets/svc-facial-1.jpg";
import svcBrows1 from "@/assets/svc-brows-1.jpg";
import svcPedicure1 from "@/assets/svc-pedicure-1.jpg";

export type Category = { id: string; label: string };
export type ServiceMedia = { type: "image" | "video"; src: string; poster?: string };
export type Service = {
  id: string;
  category: string;
  name: string;
  description?: string;
  durationMin: number;
  price: number;
  recommended?: boolean;
  media: ServiceMedia[];
};
export type StaffStatus = "online" | "available" | "busy" | "absent";

export function normalizeStaffStatus(status?: StaffStatus | string | null): Exclude<StaffStatus, "available"> {
  if (status === "busy") return "busy";
  if (status === "absent") return "absent";
  return "online";
}

export type Professional = {
  id: string;
  name: string;
  role: string;
  rating?: number;
  reviewsCount?: number;
  photo: string;
  serviceIds: string[];
  /** Manual status set in the admin panel. Absent staff are filtered out of the public page. */
  currentStatus?: StaffStatus;
};
export type Upsell = {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  originalPrice: number;
  price: number; // discounted
  photo: string;
  discountType?: "price" | "percent" | "fixed";
  discountValue?: number | null;
  displayMode?: "percent" | "amount" | "both";
  upsellDurationMin?: number | null;
};

export const studio = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Lumière Beauty",
  tagline: "Studio",
  slug: "lumiere",
  location: "Avenida da Liberdade, Lisboa",
  rating: 4.9,
  reviews: 128,
  baseUrl: "https://book.lumiere.studio",
};

// Maps mock IDs (s1..s6, p1..p3) to real database UUIDs used by the local seed data.
export const SERVICE_DB_ID: Record<string, string> = {
  s1: "20000000-0000-0000-0000-000000000001",
  s2: "20000000-0000-0000-0000-000000000002",
  s3: "20000000-0000-0000-0000-000000000003",
  s4: "20000000-0000-0000-0000-000000000004",
  s5: "20000000-0000-0000-0000-000000000005",
  s6: "20000000-0000-0000-0000-000000000006",
};

export const STAFF_DB_ID: Record<string, string> = {
  p1: "30000000-0000-0000-0000-000000000001",
  p2: "30000000-0000-0000-0000-000000000002",
  p3: "30000000-0000-0000-0000-000000000003",
};

export function getStudioPublicUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/${studio.slug}`;
  }
  return `${studio.baseUrl}/${studio.slug}`;
}

export const categories: Category[] = [
  { id: "all", label: "Todos os serviços" },
  { id: "nails", label: "Unhas" },
  { id: "skincare", label: "Facial" },
  { id: "lashes", label: "Pestanas" },
  { id: "brows", label: "Sobrancelhas" },
];

export const services: Service[] = [
  {
    id: "s1",
    category: "nails",
    name: "Manicure Gel Estrutura",
    description: "Esmaltação em gel de longa duração com acabamento espelhado.",
    durationMin: 60,
    price: 45,
    recommended: true,
    media: [
      { type: "image", src: svcManicure1 },
      { type: "image", src: svcManicure2 },
    ],
  },
  {
    id: "s2",
    category: "lashes",
    name: "Lash Lift & Tint",
    description: "Curvatura natural com tintura para um olhar marcante sem extensões.",
    durationMin: 45,
    price: 35,
    media: [{ type: "image", src: svcLashes1 }],
  },
  {
    id: "s3",
    category: "nails",
    name: "Pedicure Spa Completa",
    description: "Esfoliação, hidratação profunda e esmaltação premium.",
    durationMin: 75,
    price: 40,
    media: [{ type: "image", src: svcPedicure1 }],
  },
  {
    id: "s4",
    category: "skincare",
    name: "Limpeza Facial Profunda",
    description: "Protocolo completo com extração, máscara e protetor solar.",
    durationMin: 60,
    price: 55,
    recommended: true,
    media: [{ type: "image", src: svcFacial1 }],
  },
  {
    id: "s5",
    category: "brows",
    name: "Design de Sobrancelhas",
    description: "Mapeamento personalizado para realçar o seu olhar.",
    durationMin: 30,
    price: 18,
    media: [{ type: "image", src: svcBrows1 }],
  },
  {
    id: "s6",
    category: "lashes",
    name: "Extensão Volume Russo",
    description: "Volume denso e leve, fio a fio, com aplicação artesanal.",
    durationMin: 120,
    price: 75,
    media: [{ type: "image", src: svcLashes1 }],
  },
];

// Bundles per service (multiple upsells with discount)
export const upsellsByService: Record<string, Upsell[]> = {
  s1: [
    {
      id: "u-pedi",
      name: "+ Pedicure Spa",
      description: "Mãos e pés em harmonia",
      durationMin: 60,
      originalPrice: 40,
      price: 30,
      photo: svcPedicure1,
    },
    {
      id: "u-art",
      name: "+ Nail Art Premium",
      description: "Decoração artística personalizada",
      durationMin: 15,
      originalPrice: 12,
      price: 8,
      photo: svcManicure2,
    },
  ],
  s2: [
    {
      id: "u-brow",
      name: "+ Design Sobrancelhas",
      description: "Olhar completo e harmónico",
      durationMin: 30,
      originalPrice: 18,
      price: 12,
      photo: svcBrows1,
    },
  ],
  s3: [
    {
      id: "u-mani",
      name: "+ Manicure Gel",
      description: "Combo mãos + pés em gel",
      durationMin: 60,
      originalPrice: 45,
      price: 35,
      photo: svcManicure1,
    },
  ],
  s4: [
    {
      id: "u-mask",
      name: "+ Máscara Hidratação Profunda",
      description: "Potencia o brilho e firmeza",
      durationMin: 15,
      originalPrice: 18,
      price: 12,
      photo: upsellImg,
    },
    {
      id: "u-brow2",
      name: "+ Design Sobrancelhas",
      description: "Realça o resultado do facial",
      durationMin: 30,
      originalPrice: 18,
      price: 12,
      photo: svcBrows1,
    },
  ],
  s5: [
    {
      id: "u-lash",
      name: "+ Lash Lift",
      description: "Olhar instantaneamente realçado",
      durationMin: 45,
      originalPrice: 35,
      price: 25,
      photo: svcLashes1,
    },
  ],
  s6: [
    {
      id: "u-brow3",
      name: "+ Design Sobrancelhas",
      description: "Combo perfeito para o olhar",
      durationMin: 30,
      originalPrice: 18,
      price: 12,
      photo: svcBrows1,
    },
  ],
};

const defaultUpsell: Upsell = {
  id: "u-mask-default",
  name: "+ Máscara Hidratação",
  description: "Tratamento extra para potenciar o resultado",
  durationMin: 15,
  originalPrice: 18,
  price: 12,
  photo: upsellImg,
};

export function getUpsellsFor(serviceId: string): Upsell[] {
  return upsellsByService[serviceId] ?? [defaultUpsell];
}

export const professionals: Professional[] = [
  {
    id: "p1",
    name: "Ana Silva",
    role: "Master Esteticista",
    rating: 5.0,
    photo: anaImg,
    serviceIds: ["s1", "s3", "s4"],
  },
  {
    id: "p2",
    name: "Marcello V.",
    role: "Lash Designer",
    rating: 4.9,
    photo: marcelloImg,
    serviceIds: ["s2", "s6", "s5"],
  },
  {
    id: "p3",
    name: "Sofia L.",
    role: "Brow Artist",
    rating: 4.8,
    photo: sofiaImg,
    serviceIds: ["s5", "s2", "s4"],
  },
];

export function getNextDates(count = 14, timeZone = "Europe/Lisbon"): Date[] {
  const out: Date[] = [];
  const today = getDatePartsInTimeZone(new Date(), timeZone);
  for (let i = 0; i < count; i++) {
    const d = new Date(today.year, today.month - 1, today.day + i, 12, 0, 0, 0);
    out.push(d);
  }
  return out;
}

function getDatePartsInTimeZone(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const year = read("year");
    const month = read("month");
    const day = read("day");
    if (year && month && day) return { year, month, day };
  } catch {
    /* fall back to local date below */
  }
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

export const TIME_SLOTS = [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
];

export function groupSlotsByPeriod(slots: string[]) {
  const morning: string[] = [];
  const afternoon: string[] = [];
  const evening: string[] = [];
  for (const s of slots) {
    const h = parseInt(s.slice(0, 2), 10);
    if (h < 12) morning.push(s);
    else if (h < 17) afternoon.push(s);
    else evening.push(s);
  }
  return { morning, afternoon, evening };
}

// Promo slots (off-peak deals)
export function isPromoSlot(slot: string): boolean {
  return slot === "10:00" || slot === "14:30" || slot === "18:00";
}

// Deterministically mark some slots unavailable per day/professional
export function isSlotAvailable(date: Date, slot: string, proId: string): boolean {
  const seed = date.getDate() + slot.length + proId.charCodeAt(1);
  return seed % 5 !== 0;
}
