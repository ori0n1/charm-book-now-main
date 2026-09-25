export const TRIAL_DURATION_DAYS = 14;

export type TrialNoticeLevel = "standard" | "notice" | "warning" | "critical";

export type TrialNotice = {
  daysRemaining: number;
  level: TrialNoticeLevel;
  title: string;
  description: string;
};

function validDateMs(value?: string | null) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getTrialDaysRemaining(trialEndsAt: string | null | undefined, now = new Date()) {
  const end = validDateMs(trialEndsAt);
  if (end === null) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

export function getTrialNotice(
  trialEndsAt: string | null | undefined,
  now = new Date(),
): TrialNotice | null {
  const end = validDateMs(trialEndsAt);
  if (end === null || end <= now.getTime()) return null;

  const daysRemaining = Math.max(1, Math.ceil((end - now.getTime()) / 86_400_000));
  if (daysRemaining === 1) {
    return {
      daysRemaining,
      level: "critical",
      title: "Último dia do teste gratuito",
      description: "Escolha um plano para manter os recursos Premium depois do fim do teste.",
    };
  }
  if (daysRemaining <= 3) {
    return {
      daysRemaining,
      level: "warning",
      title: `Restam ${daysRemaining} dias do teste gratuito`,
      description: "O teste está a terminar. Compare os planos e escolha o mais adequado ao seu estúdio.",
    };
  }
  if (daysRemaining <= 7) {
    return {
      daysRemaining,
      level: "notice",
      title: `Restam ${daysRemaining} dias do teste gratuito`,
      description: "Continue a explorar todos os recursos Premium e veja os planos quando quiser.",
    };
  }
  return {
    daysRemaining,
    level: "standard",
    title: `Restam ${daysRemaining} dias do teste gratuito`,
    description: "Durante o teste, o seu estúdio tem acesso aos recursos Premium.",
  };
}
