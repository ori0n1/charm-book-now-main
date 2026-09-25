export const BELLZA_BRAND_ASSET_VERSION = "20260911-push-pwa-v2";

function versionedAsset(path: string) {
  return `${path}?v=${BELLZA_BRAND_ASSET_VERSION}`;
}

export const BELLZA_APP_ICON_SVG = versionedAsset("/bellza-app-icon.svg");
export const BELLZA_APP_ICON_192 = versionedAsset("/bellza-app-icon-192.png");
export const BELLZA_APP_ICON_512 = versionedAsset("/bellza-app-icon-512.png");
export const BELLZA_APPLE_TOUCH_ICON = versionedAsset("/bellza-apple-touch-icon.png");
export const BELLZA_FAVICON = versionedAsset("/bellza-favicon.svg");
export const BELLZA_LOGO = versionedAsset("/bellza-logo.svg");
export const BELLZA_LOGO_WHITE = versionedAsset("/bellza-logo-white.svg");
export const BELLZA_SYMBOL = versionedAsset("/bellza-symbol.svg");
export const BELLZA_SYMBOL_WHITE = versionedAsset("/bellza-symbol-white.svg");
export const BELLZA_NOTIFICATION_BADGE = versionedAsset("/bellza-symbol-dark.svg");
export const BELLZA_MANIFEST = versionedAsset("/manifest.webmanifest");
