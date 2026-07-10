export type GoogleIdentityApi = {
  accounts?: {
    id?: {
      initialize: (config: {
        client_id: string;
        nonce?: string;
        use_fedcm_for_prompt?: boolean;
        callback: (response: { credential: string }) => void | Promise<void>;
      }) => void;
      prompt: (momentListener?: (notification: GooglePromptMomentNotification) => void) => void;
      cancel: () => void;
    };
  };
};

export type GooglePromptMomentNotification = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
};

export async function createGoogleNoncePair() {
  const rawNonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const hashedNonce = await sha256Hex(rawNonce);
  return { rawNonce, hashedNonce };
}

export function loadGoogleIdentityScript() {
  const existing = document.getElementById("google-gsi-script");
  if (existing) return existing as HTMLScriptElement;

  const scriptEl = document.createElement("script");
  scriptEl.id = "google-gsi-script";
  scriptEl.src = "https://accounts.google.com/gsi/client";
  scriptEl.async = true;
  scriptEl.defer = true;
  document.head.appendChild(scriptEl);
  return scriptEl;
}

export function getGoogleIdentity() {
  return (window as typeof window & { google?: GoogleIdentityApi }).google?.accounts?.id;
}

export function isIOSDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalonePwa() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIOSStandalonePwa() {
  return isIOSDevice() && isStandalonePwa();
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(value: string) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
