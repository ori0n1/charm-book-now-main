import { useEffect } from "react";
import { toast } from "sonner";

export function useAuthRedirectError() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const message =
      params.get("error_description") ||
      params.get("error") ||
      hashParams.get("error_description") ||
      hashParams.get("error");

    if (!message) return;
    if (message === "auth_callback") {
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    toast.error(decodeURIComponent(message).replace(/\+/g, " "));

    const cleanUrl = `${window.location.pathname}${window.location.search
      .replace(/([?&])error(_description)?=[^&]*/g, "")
      .replace(/[?&]$/, "")}`;
    window.history.replaceState({}, document.title, cleanUrl || window.location.pathname);
  }, []);
}
