import type { ReactNode } from "react";
import { useCurrentStudio } from "@/hooks/use-current-studio";

export function OwnerFinancialRoute({ children }: { children: ReactNode }) {
  const { studio, loading } = useCurrentStudio();
  if (loading || !studio) return <p className="text-sm text-muted-foreground">A carregar...</p>;
  if (studio.role !== "studio_owner" && studio.role !== "saas_owner" && studio.role !== "manager") {
    return <p className="text-sm text-muted-foreground">Acesso financeiro não autorizado.</p>;
  }
  return <>{children}</>;
}
