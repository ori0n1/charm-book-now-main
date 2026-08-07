/**
 * Runs while the initial HTML is still being parsed.
 *
 * Older iOS Home Screen installations can retain the original `/admin`
 * start URL even after the web manifest changes. Resolve that legacy launch
 * before React hydrates so the dashboard is never painted on app startup.
 */
export const PWA_STARTUP_SCRIPT = `(function(){try{var p=window.location.pathname.replace(/\\/+$/,"")||"/",n=window.navigator,s=window.matchMedia("(display-mode: standalone)").matches||n.standalone===true;if(s&&p==="/admin"){window.location.replace("/admin/agenda"+window.location.search+window.location.hash)}}catch(e){}})();`;

/** Critical paint styles are intentionally inline so no white frame is shown
 * while the versioned application stylesheet is still loading. */
export const CRITICAL_PAINT_CSS = `:root{background:#f7f3ed}html,body{min-height:100%;margin:0;background:#f7f3ed}html.dark,html.dark body{background:#18191d}`;
