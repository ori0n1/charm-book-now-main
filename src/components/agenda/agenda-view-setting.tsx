import { useAgendaView, type AgendaView } from "@/hooks/use-agenda-view";
import { toast } from "sonner";

export function AgendaViewSetting({ studioId }: { studioId: string }) {
  const { view, query, mutation } = useAgendaView(studioId);
  return (
    <fieldset className="space-y-2 rounded-xl border border-border/35 bg-card/50 p-3.5"
      disabled={query.isPending || Boolean(query.error) || mutation.isPending}>
      <legend className="px-1 text-sm font-semibold">Visualização da agenda</legend>
      {([
        ["separada_por_profissional", "Separada por profissional", "Visualização atual e padrão."],
        ["unificada", "Unificada (todos os profissionais)", "Atendimentos reunidos em ordem cronológica."],
      ] as const).map(([value, label, detail]) => (
        <label key={value} className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-sm">
          <input type="radio" name={`agenda-view-${studioId}`} value={value}
            checked={view === value} onChange={() => mutation.mutate(value as AgendaView, {
              onSuccess: () => toast.success("Visualização da agenda guardada"),
              onError: () => toast.error("Não foi possível guardar a visualização da agenda."),
            })} />
          <span><span className="block font-medium">{label}</span>
            <span className="block text-xs text-muted-foreground">{detail}</span></span>
        </label>
      ))}
      <p className="text-xs text-muted-foreground">Aplica-se somente a este estúdio.</p>
      {query.error && <p role="alert" className="text-xs text-destructive">Não foi possível carregar a preferência.</p>}
    </fieldset>
  );
}
