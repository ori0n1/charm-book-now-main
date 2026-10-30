import { toast } from "sonner";
import { agendaColors, useAgendaColor, type AgendaColor } from "@/hooks/use-agenda-color";

const options: Record<AgendaColor, { label: string; tone: string }> = {
  sky: { label: "Azul", tone: "bg-sky-200 border-sky-400" },
  teal: { label: "Verde água", tone: "bg-teal-200 border-teal-400" },
  lavender: { label: "Lavanda", tone: "bg-violet-200 border-violet-400" },
  peach: { label: "Pêssego", tone: "bg-orange-200 border-orange-400" },
};

export function AgendaColorSetting({ studioId }: { studioId: string }) {
  const { color, saveColor } = useAgendaColor(studioId);
  return <fieldset className="space-y-2 rounded-xl border border-border/35 bg-card/50 p-3.5">
    <legend className="px-1 text-sm font-semibold">Cor das marcações</legend>
    <div className="flex flex-wrap gap-2" aria-label="Cor dos cartões confirmados">
      {agendaColors.map((value) => <label key={value}
        className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${color === value ? "border-foreground" : "border-border/70"}`}>
        <input type="radio" name={`agenda-color-${studioId}`} value={value} checked={color === value}
          onChange={() => {
            if (saveColor(value)) toast.success("Cor da agenda guardada.");
            else toast.error("Não foi possível guardar a cor da agenda.");
          }} />
        <span className={`size-4 rounded border ${options[value].tone}`} aria-hidden="true" />
        {options[value].label}
      </label>)}
    </div>
    <p className="text-xs text-muted-foreground">Aplica-se às marcações confirmadas deste estúdio neste dispositivo. Os estados e alertas mantêm as suas cores.</p>
  </fieldset>;
}
