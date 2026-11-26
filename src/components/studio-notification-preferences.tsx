import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { notificationCategories, type NotificationCategory } from "@/lib/studio-notification-preferences";
import {
  getStudioNotificationPreferences,
  saveStudioNotificationPreference,
} from "@/lib/studio-notification-preferences.functions";

type Values = Partial<Record<NotificationCategory, boolean>>;

export function StudioNotificationPreferences({ studioId }: { studioId: string }) {
  const load = useServerFn(getStudioNotificationPreferences);
  const save = useServerFn(saveStudioNotificationPreference);
  const [values, setValues] = useState<Values>({});
  const [pending, setPending] = useState<NotificationCategory[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    setReady(false);
    setLoadError(false);
    void load({ data: { studioId } }).then((rows) => {
      if (!active) return;
      setValues(Object.fromEntries(rows.map((row) => [row.category, row.enabled])) as Values);
      setReady(true);
    }).catch(() => {
      if (active) setLoadError(true);
    });
    return () => { active = false; };
  }, [load, studioId]);

  async function setPreference(category: NotificationCategory, enabled: boolean) {
    const previous = values[category] !== false;
    setValues((current) => ({ ...current, [category]: enabled }));
    setPending((current) => [...current, category]);
    try {
      await save({ data: { studioId, category, enabled } });
      window.dispatchEvent(new CustomEvent("bellza:notification-preferences-changed"));
    } catch {
      setValues((current) => ({ ...current, [category]: previous }));
      toast.error("Não foi possível guardar a preferência.");
    } finally {
      setPending((current) => current.filter((item) => item !== category));
    }
  }

  return (
    <section id="notification-preferences" className="rounded-[1.35rem] border border-border/80 bg-card px-3 py-2 shadow-sm md:px-4">
      <div className="mb-1 flex items-center justify-between gap-3 px-1 py-1">
        <h2 className="text-sm font-semibold">As minhas notificações</h2>
        <span className="text-[11px] text-muted-foreground" aria-live="polite">
          {pending.length ? "A guardar…" : ready ? "Guardado" : ""}
        </span>
      </div>
      {loadError ? (
        <p className="px-1 text-xs text-destructive">Não foi possível carregar as preferências. Atualize a página.</p>
      ) : (
        <div className="grid gap-x-5 sm:grid-cols-2 xl:grid-cols-3">
          {notificationCategories.filter((category) => category.id !== "other").map((category) => (
            <div key={category.id} className="flex min-h-10 items-center justify-between gap-3 border-t border-border/60 px-1 py-1.5">
              <label htmlFor={`notification-${category.id}`} className="min-w-0 text-sm font-medium">
                {category.label}
              </label>
              <Switch
                id={`notification-${category.id}`}
                aria-label={category.label}
                style={{ minHeight: 20 }}
                checked={values[category.id] !== false}
                disabled={!ready || pending.includes(category.id)}
                onCheckedChange={(enabled) => void setPreference(category.id, enabled)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
