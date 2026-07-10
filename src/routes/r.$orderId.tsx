import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/r/$orderId")({
  validateSearch: (search: Record<string, unknown>) => ({
    acao: typeof search.acao === "string" ? search.acao : undefined,
  }),
  loader: ({ params, location }) => {
    throw redirect({
      to: "/marcacao/$token",
      params: { token: params.orderId },
      search: { acao: (location.search as { acao?: string }).acao },
      replace: true,
    });
  },
});
