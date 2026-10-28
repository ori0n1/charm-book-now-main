export type BusinessSegment = "beauty" | "barbershop" | "nail_studio" | "clinic" | "other";

export type SegmentOption = {
  id: BusinessSegment;
  title: string;
  description: string;
};

export type ServicePreset = {
  name: string;
  category: string;
  duration: number;
  price: number;
  description?: string;
};

type SegmentConfig = SegmentOption & {
  tone: string;
  labels: {
    business: string;
    businessPlural: string;
    professional: string;
    professionalPlural: string;
    team: string;
    teamDescription: string;
    newProfessional: string;
    editProfessional: string;
    deleteProfessionalConfirm: string;
    professionalSaved: string;
    professionalDeleted: string;
    emptyProfessionals: string;
    professionalBioPlaceholder: string;
    professionalRolePlaceholder: string;
    serviceSearchPlaceholder: string;
    firstServiceHint: string;
    quickPickIntro: string;
  };
  defaultCategoryLabels: string[];
  categoryRules: { label: string; words: string[] }[];
  servicePresets: ServicePreset[];
};

export type SegmentLabels = SegmentConfig["labels"];

const BEAUTY_PRESETS: ServicePreset[] = [
  { name: "Corte de cabelo", category: "Cabelo", duration: 45, price: 30 },
  { name: "Brushing", category: "Cabelo", duration: 45, price: 25 },
  { name: "Coloração", category: "Cabelo", duration: 120, price: 65 },
  { name: "Hidratação capilar", category: "Cabelo", duration: 60, price: 35 },
  { name: "Unha em gel", category: "Unhas", duration: 90, price: 35 },
  { name: "Banho de gel", category: "Unhas", duration: 75, price: 30 },
  { name: "Manicure", category: "Unhas", duration: 45, price: 18 },
  { name: "Pedicure", category: "Unhas", duration: 50, price: 22 },
  { name: "Design de sobrancelha", category: "Sobrancelhas", duration: 30, price: 18 },
  { name: "Henna de sobrancelha", category: "Sobrancelhas", duration: 35, price: 22 },
  { name: "Extensão de pestanas", category: "Pestanas", duration: 120, price: 55 },
  { name: "Lifting de pestanas", category: "Pestanas", duration: 60, price: 35 },
  { name: "Limpeza de pele", category: "Estética", duration: 75, price: 45 },
  { name: "Tratamento facial", category: "Estética", duration: 60, price: 40 },
  { name: "Depilação a cera", category: "Depilação", duration: 30, price: 20 },
  { name: "Massagem relaxante", category: "Massagem", duration: 60, price: 50 },
];

const BARBER_PRESETS: ServicePreset[] = [
  { name: "Corte masculino", category: "Cabelo", duration: 45, price: 25 },
  { name: "Corte degradé", category: "Cabelo", duration: 45, price: 28 },
  { name: "Barba", category: "Barba", duration: 30, price: 15 },
  { name: "Cabelo e barba", category: "Combos", duration: 75, price: 38 },
  { name: "Acabamento", category: "Cabelo", duration: 20, price: 10 },
  { name: "Sobrancelha masculina", category: "Sobrancelhas", duration: 15, price: 8 },
  { name: "Coloração masculina", category: "Coloração", duration: 90, price: 45 },
  { name: "Hidratação capilar", category: "Tratamentos", duration: 40, price: 25 },
];

const BEAUTY_CATEGORIES = [
  "Cabelo",
  "Unhas",
  "Estética",
  "Sobrancelhas",
  "Pestanas",
  "Depilação",
  "Massagem",
];

const BEAUTY_RULES = [
  {
    label: "Unhas",
    words: ["unha", "gel", "verniz", "manicure", "pedicure", "nail", "acrilico", "alongamento"],
  },
  {
    label: "Cabelo",
    words: ["cabelo", "corte", "brushing", "escova", "coloracao", "madeixa", "luzes", "hidrata", "capilar"],
  },
  { label: "Sobrancelhas", words: ["sobrancelha", "brow", "design"] },
  { label: "Pestanas", words: ["pestana", "cilio", "cilios", "lash"] },
  { label: "Depilação", words: ["depilacao", "cera", "laser"] },
  { label: "Massagem", words: ["massagem", "relaxante", "drenagem"] },
  { label: "Estética", words: ["facial", "pele", "limpeza", "estetica", "corporal", "tratamento", "maquilhagem"] },
];

const BARBER_CATEGORIES = ["Cabelo", "Barba", "Combos", "Sobrancelhas", "Coloração", "Tratamentos"];
const BARBER_RULES = [
  { label: "Barba", words: ["barba", "navalha", "bigode"] },
  { label: "Combos", words: ["combo", "cabelo e barba", "corte e barba"] },
  { label: "Sobrancelhas", words: ["sobrancelha"] },
  { label: "Coloração", words: ["coloracao", "tintura", "platinado"] },
  { label: "Tratamentos", words: ["hidratacao", "tratamento", "capilar"] },
  { label: "Cabelo", words: ["cabelo", "corte", "degrade", "fade", "acabamento"] },
];

export const SEGMENT_OPTIONS: SegmentOption[] = [
  { id: "beauty", title: "Estética / Beleza", description: "Salão, lash, brows e serviços de beleza." },
  { id: "barbershop", title: "Barbearia", description: "Barbeiros, salões masculinos e cortes." },
  { id: "nail_studio", title: "Nail Studio", description: "Unhas, manicure, pedicure e nail design." },
  { id: "clinic", title: "Clínica", description: "Clínicas de estética, tratamentos e consultas." },
  { id: "other", title: "Outro", description: "Um negócio de serviços com agenda." },
];

const BASE_LABELS: SegmentConfig["labels"] = {
  business: "negócio",
  businessPlural: "negócios",
  professional: "profissional",
  professionalPlural: "profissionais",
  team: "Equipa",
  teamDescription: "Profissionais do negócio",
  newProfessional: "Nova profissional",
  editProfessional: "Editar profissional",
  deleteProfessionalConfirm: "Eliminar profissional?",
  professionalSaved: "Profissional guardada",
  professionalDeleted: "Profissional eliminada",
  emptyProfessionals: "Sem profissionais registadas.",
  professionalBioPlaceholder: "Breve apresentação da profissional",
  professionalRolePlaceholder: "Ex.: Especialista",
  serviceSearchPlaceholder: "Ex.: serviço principal",
  firstServiceHint: "Crie o primeiro serviço e ele ficará disponível para toda a equipa.",
  quickPickIntro:
    "Toque nos serviços que esta profissional realiza. Se ainda não existir no negócio, ele será criado com a categoria correta.",
};

export const SEGMENT_CONFIGS: Record<BusinessSegment, SegmentConfig> = {
  beauty: {
    ...SEGMENT_OPTIONS[0],
    tone: "premium-beauty",
    labels: BASE_LABELS,
    defaultCategoryLabels: BEAUTY_CATEGORIES,
    categoryRules: BEAUTY_RULES,
    servicePresets: BEAUTY_PRESETS,
  },
  barbershop: {
    ...SEGMENT_OPTIONS[1],
    tone: "premium-barber",
    labels: {
      ...BASE_LABELS,
      business: "barbearia",
      businessPlural: "barbearias",
      professional: "barbeiro",
      professionalPlural: "barbeiros",
      teamDescription: "Barbeiros da barbearia",
      newProfessional: "Novo barbeiro",
      editProfessional: "Editar barbeiro",
      deleteProfessionalConfirm: "Eliminar barbeiro?",
      professionalSaved: "Barbeiro guardado",
      professionalDeleted: "Barbeiro eliminado",
      emptyProfessionals: "Sem barbeiros registados.",
      professionalBioPlaceholder: "Breve apresentação do barbeiro",
      professionalRolePlaceholder: "Ex.: Barbeiro sénior",
      serviceSearchPlaceholder: "Ex.: Corte masculino, barba, degradé...",
      firstServiceHint: "Crie o primeiro serviço e ele ficará disponível para os barbeiros.",
      quickPickIntro:
        "Toque nos serviços que este barbeiro realiza. Se ainda não existir na barbearia, ele será criado com a categoria correta.",
    },
    defaultCategoryLabels: BARBER_CATEGORIES,
    categoryRules: BARBER_RULES,
    servicePresets: BARBER_PRESETS,
  },
  nail_studio: {
    ...SEGMENT_OPTIONS[2],
    tone: "premium-nails",
    labels: {
      ...BASE_LABELS,
      business: "nail studio",
      businessPlural: "nail studios",
      professionalRolePlaceholder: "Ex.: Nail designer",
      serviceSearchPlaceholder: "Ex.: Manicure, alongamento, nail art...",
      firstServiceHint: "Crie o primeiro serviço e ele ficará disponível para as nail designers.",
    },
    defaultCategoryLabels: ["Unhas", "Nail Art", "Pedicure", "Manutenção", "Extras"],
    categoryRules: BEAUTY_RULES,
    servicePresets: BEAUTY_PRESETS.filter((preset) => ["Unhas", "Sobrancelhas"].includes(preset.category)),
  },
  clinic: {
    ...SEGMENT_OPTIONS[3],
    tone: "premium-clinic",
    labels: {
      ...BASE_LABELS,
      business: "clínica",
      businessPlural: "clínicas",
      professionalRolePlaceholder: "Ex.: Esteticista clínica",
      serviceSearchPlaceholder: "Ex.: Limpeza de pele, laser, consulta...",
    },
    defaultCategoryLabels: ["Facial", "Corporal", "Laser", "Consultas", "Tratamentos"],
    categoryRules: BEAUTY_RULES,
    servicePresets: BEAUTY_PRESETS.filter((preset) => ["Estética", "Depilação", "Massagem"].includes(preset.category)),
  },
  other: {
    ...SEGMENT_OPTIONS[4],
    tone: "premium-neutral",
    labels: BASE_LABELS,
    defaultCategoryLabels: BEAUTY_CATEGORIES,
    categoryRules: BEAUTY_RULES,
    servicePresets: BEAUTY_PRESETS,
  },
};

export const DEFAULT_SEGMENT: BusinessSegment = "beauty";

export function normalizeBusinessSegment(value: unknown): BusinessSegment {
  return typeof value === "string" && value in SEGMENT_CONFIGS
    ? (value as BusinessSegment)
    : DEFAULT_SEGMENT;
}

export function getSegmentConfig(value: unknown): SegmentConfig {
  return SEGMENT_CONFIGS[normalizeBusinessSegment(value)];
}

export function normalizeSegmentText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function inferSegmentCategory(serviceName: string, segment: unknown) {
  const config = getSegmentConfig(segment);
  const normalized = normalizeSegmentText(serviceName);
  return (
    config.categoryRules.find((rule) =>
      rule.words.some((word) => normalized.includes(normalizeSegmentText(word))),
    )?.label ?? config.defaultCategoryLabels[0]
  );
}
