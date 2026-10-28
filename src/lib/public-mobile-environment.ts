export type InstallEnvironment = {
  ios: boolean;
  android: boolean;
  standalone: boolean;
  browser: "instagram" | "facebook" | "safari" | "chrome" | "other";
};

export function detectInstallEnvironment(userAgent: string, standalone: boolean): InstallEnvironment {
  return {
    ios: /iphone|ipad|ipod/i.test(userAgent),
    android: /android/i.test(userAgent),
    standalone,
    browser: /instagram/i.test(userAgent) ? "instagram"
      : /fban|fbav|fb_iab/i.test(userAgent) ? "facebook"
      : /crios|chrome/i.test(userAgent) ? "chrome"
      : /safari/i.test(userAgent) ? "safari" : "other",
  };
}

export function isSocialBrowser(environment: InstallEnvironment) {
  return environment.browser === "instagram" || environment.browser === "facebook";
}

export function canUseNativeInstall(environment: InstallEnvironment, promptAvailable: boolean) {
  return environment.android && !environment.standalone && !isSocialBrowser(environment) && promptAvailable;
}

export function installGuideSteps(environment: InstallEnvironment): string[] {
  const socialName = environment.browser === "instagram" ? "Instagram" : "Facebook";
  if (environment.ios) return [
    ...(environment.browser === "safari" ? [] : [
      isSocialBrowser(environment) ? `No ${socialName}, toque em ••• e abra no Safari.` : "Abra esta página no Safari.",
    ]),
    "No Safari, toque em Partilhar → Adicionar ao ecrã principal.",
  ];
  return [
    ...(isSocialBrowser(environment) ? [`No ${socialName}, toque em ••• e abra no navegador externo.`] : []),
    "No Chrome, use o menu ⋮ → Instalar app ou Adicionar ao ecrã principal, se disponível.",
  ];
}
