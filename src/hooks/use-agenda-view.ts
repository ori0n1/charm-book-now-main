import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AgendaView = "separada_por_profissional" | "unificada";
export function useAgendaView(studioId?: string) {
  const queryClient = useQueryClient();
  const queryKey = ["studio-agenda-view", studioId];
  const query = useQuery({
    queryKey,
    enabled: Boolean(studioId),
    queryFn: async (): Promise<AgendaView> => {
      const { data, error } = await supabase.from("studios")
        .select("agenda_view").eq("id", studioId!).single();
      if (error) throw error;
      return (data as unknown as { agenda_view: string }).agenda_view === "unificada"
        ? "unificada" : "separada_por_profissional";
    },
  });
  const mutation = useMutation({
    mutationFn: async (view: AgendaView) => {
      if (!studioId) throw new Error("Estúdio não encontrado.");
      const { error, data } = await supabase.from("studios")
        .update({ agenda_view: view } as never).eq("id", studioId)
        .select("id").single();
      if (error || !data) throw error ?? new Error("Não foi possível guardar a visualização.");
      return view;
    },
    onSuccess: (view) => queryClient.setQueryData(queryKey, view),
  });
  return { view: query.data ?? "separada_por_profissional", query, mutation };
}
