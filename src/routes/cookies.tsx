import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/cookies")({
  head: () => ({
    meta: [
      { title: "Política de Cookies" },
      {
        name: "description",
        content: "Como usamos cookies essenciais, analíticos e de marketing.",
      },
    ],
  }),
  component: CookiesPage,
});

function CookiesPage() {
  return (
    <div className="min-h-screen bg-background px-5 py-10 md:py-16">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground hover:underline">
          Voltar
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">Política de Cookies</h1>
        <p className="mt-2 text-xs text-muted-foreground">Última atualização: 29 de maio de 2026</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-foreground/90">
          <section>
            <h2 className="text-base font-medium">O que são</h2>
            <p className="mt-2">
              Cookies são pequenos ficheiros guardados no dispositivo. Ajudam o site a funcionar,
              manter a sessão segura e lembrar algumas preferências.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium">Como usamos</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                <strong>Essenciais:</strong> necessários para segurança, login e funcionamento da
                reserva.
              </li>
              <li>
                <strong>Analíticos:</strong> ajudam-nos a perceber o que deve ser melhorado.
              </li>
              <li>
                <strong>Marketing:</strong> usados apenas quando existe consentimento para medir
                campanhas ou comunicações.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-medium">Gerir preferências</h2>
            <p className="mt-2">
              Pode aceitar, recusar ou ajustar preferências no banner de cookies. Também pode limpar
              os cookies nas definições do browser.
            </p>
          </section>

          <section>
            <h2 className="text-base font-medium">Dados pessoais</h2>
            <p className="mt-2">
              Alguns cookies podem ficar associados a dados técnicos, como sessão, dispositivo ou IP.
              Para mais detalhe, consulte a{" "}
              <Link to="/privacidade" className="underline">
                Política de Privacidade
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
