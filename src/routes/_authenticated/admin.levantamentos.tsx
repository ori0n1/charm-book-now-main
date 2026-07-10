/**
 * admin.levantamentos.tsx
 *
 * A página financeira antiga foi removida.
 * Os recebimentos online são agora geridos diretamente via Stripe Connect.
 * Este ficheiro redireciona automaticamente para /admin/recebimento.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/levantamentos")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/recebimento", search: { connect: undefined }, replace: true });
  },
  component: () => null,
});
