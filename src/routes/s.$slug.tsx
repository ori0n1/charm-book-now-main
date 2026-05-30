import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BookingExperience = lazy(() =>
  import("@/components/booking-experience").then((mod) => ({ default: mod.BookingExperience })),
);

export const Route = createFileRoute("/s/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Agendar — ${params.slug}` },
      { name: "description", content: "Reserve o seu horário em poucos toques." },
    ],
  }),
  component: PublicStudioPage,
});

function PublicStudioPage() {
  const { slug } = Route.useParams();
  const [studioId, setStudioId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("studios")
          .select("id")
          .eq("slug", slug)
          .eq("is_active", true)
          .maybeSingle();
        if (!active) return;
        if (error) {
          console.error(error);
          setStudioId(null);
          return;
        }
        setStudioId(data?.id ?? null);
      } catch (error) {
        console.error(error);
        if (active) setStudioId(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [slug]);

  if (studioId === undefined) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        A carregar estúdio…
      </div>
    );
  }
  if (studioId === null) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">404</p>
          <h1 className="mt-2 text-2xl font-light">Estúdio não encontrado</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            O link <span className="font-mono">/s/{slug}</span> não corresponde a nenhum estúdio
            ativo.
          </p>
        </div>
      </div>
    );
  }
  return (
    <Suspense fallback={<LoadingStudio />}>
      <BookingExperience studioId={studioId} />
    </Suspense>
  );
}

function LoadingStudio() {
  return (
    <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
      A carregar estúdio…
    </div>
  );
}
