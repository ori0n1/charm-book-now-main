import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  connectGooglePlace,
  disconnectGooglePlace,
  getGooglePlaceConnection,
  searchGooglePlaces,
} from "@/lib/google-places.functions";
import type { GooglePlace, GoogleReviewsState } from "@/lib/google-places.types";

export function GooglePlacesSettings({ studioId }: { studioId: string }) {
  const status = useServerFn(getGooglePlaceConnection);
  const search = useServerFn(searchGooglePlaces);
  const connect = useServerFn(connectGooglePlace);
  const disconnect = useServerFn(disconnectGooglePlace);
  const [connection, setConnection] = useState<{ enabled: boolean; placeId: string | null } | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GooglePlace[]>([]);
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const version = ++generation.current;
    setConnection(null);
    setResults([]);
    setQuery("");
    setError("");
    setChanging(false);
    setBusy(false);
    setSearched(false);
    status({ data: { studioId } })
      .then((value) => {
        if (version === generation.current) setConnection(value);
      })
      .catch(() => {
        if (version === generation.current)
          setError("Não foi possível carregar as avaliações Google.");
      });
    return () => {
      generation.current++;
    };
  }, [studioId, status]);
  async function run(action: () => Promise<void>) {
    const version = generation.current;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      if (version === generation.current)
        setError(
          "Não foi possível concluir. Verifique a configuração e tente novamente mais tarde.",
        );
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  const buttonClass =
    "min-h-11 rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50";
  if (connection && !connection.enabled) return null;
  return (
    <section
      aria-label="Avaliações Google"
      className="space-y-3 rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="font-semibold">Avaliações Google</h2>
      <p className="text-sm text-muted-foreground">
        Pesquise o nome e confirme o endereço do estabelecimento.
      </p>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {!connection && !error && <p role="status">A carregar…</p>}
      {connection && !connection.enabled && (
        <p className="text-sm">A integração Google ainda não está disponível.</p>
      )}
      {connection?.placeId && (
        <div className="space-y-2">
          <p className="break-all text-sm">Estabelecimento vinculado: {connection.placeId}</p>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => {
              setChanging(true);
              setResults([]);
            }}
          >
            Trocar estabelecimento
          </button>{" "}
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const version = generation.current;
                await disconnect({ data: { studioId } });
                if (version === generation.current) {
                  setConnection((current) => current && { ...current, placeId: null });
                  setResults([]);
                  setChanging(false);
                }
              })
            }
          >
            Desconectar Google
          </button>
        </div>
      )}
      {connection?.enabled && (!connection.placeId || changing) && (
        <>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const version = generation.current;
                setResults([]);
                setSearched(false);
                const found = await search({ data: { studioId, query } });
                if (version === generation.current) {
                  setResults(found);
                  setSearched(true);
                }
              });
            }}
          >
            <label className="min-w-0 flex-1 text-sm">
              Nome do estabelecimento
              <input
                value={query}
                disabled={busy}
                maxLength={120}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setResults([]);
                  setSearched(false);
                }}
                className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3"
              />
            </label>
            <button className={`${buttonClass} h-11 self-end`} disabled={busy || query.trim().length < 3}>
              Pesquisar
            </button>
          </form>
          {busy && <p role="status">A consultar Google…</p>}
          {searched && !busy && results.length === 0 && (
            <p role="status">Nenhum estabelecimento encontrado. Tente incluir a cidade.</p>
          )}
          {results.map((place) => (
            <div key={place.id} className="rounded-xl border border-border p-3">
              <p className="font-semibold">{place.name}</p>
              <p className="text-sm text-muted-foreground">{place.address}</p>
              <button
                type="button"
                className={`${buttonClass} mt-2`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const version = generation.current;
                    await connect({ data: { studioId, placeId: place.id } });
                    if (version === generation.current) {
                      setConnection({ enabled: true, placeId: place.id });
                      setChanging(false);
                      setResults([]);
                    }
                  })
                }
              >
                Selecionar {place.name}
              </button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Resultados fornecidos por Google Maps.</p>
        </>
      )}
    </section>
  );
}

export function GooglePlacesPublicReviews({ state }: { state: GoogleReviewsState }) {
  return (
    <section className="mt-6 space-y-4" aria-label="Avaliações Google">
      <h2 className="text-2xl font-extrabold">Avaliações Google</h2>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
        {state.status === "available" ? (
          <>
            <p className="text-xl font-bold">
              {state.rating?.toFixed(1) ?? "—"}{" "}
              <span className="text-sm font-normal">· {state.count} avaliações no Google</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Avaliações disponibilizadas pelo Google, por relevância. Esta amostra não representa
              todas as avaliações.
            </p>
            {state.reviews.length === 0 && <p>Sem avaliações disponibilizadas pelo Google.</p>}
            {state.reviews.map((review) => (
              <article key={review.id} className="space-y-1 border-t border-border pt-3">
                <p className="font-semibold">
                  {review.authorUri ? (
                    <a href={review.authorUri} target="_blank" rel="noreferrer">
                      {review.author}
                    </a>
                  ) : (
                    review.author
                  )}{" "}
                  <span className="text-sm">· {review.rating} ★</span>
                </p>
                {review.publishedAt && (
                  <time className="text-xs text-muted-foreground" dateTime={review.publishedAt}>
                    {new Date(review.publishedAt).toLocaleDateString("pt-PT")}
                  </time>
                )}
                {review.text && <p className="whitespace-pre-line text-sm">{review.text}</p>}
                {review.uri && (
                  <a
                    className="text-xs underline"
                    href={review.uri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ver avaliação no Google Maps
                  </a>
                )}
              </article>
            ))}
            {state.mapsUri && (
              <a
                className="block text-sm underline"
                href={state.mapsUri}
                target="_blank"
                rel="noreferrer"
              >
                Ver estabelecimento no Google Maps
              </a>
            )}
          </>
        ) : (
          <p role="status">As avaliações Google estão temporariamente indisponíveis.</p>
        )}
        <p className="text-xs text-muted-foreground">Google Maps</p>
      </div>
    </section>
  );
}
