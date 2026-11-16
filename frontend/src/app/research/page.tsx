"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Header from "@/components/header";

type StrategyKey = "dense" | "sparse" | "hybrid" | "rrf";
type ViewMode = "selected" | "compare";

type JudgmentMetadata = {
  title?: string;
  citation?: string;
  para?: string | number;
  text?: string;
};

type RankedChunk = {
  chunk_id: string;
  score: number;
  metadata: JudgmentMetadata;
  rerank_score?: number;
};

type RetrievalResponse = {
  query: string;
  alpha: number;
  results: Record<StrategyKey, RankedChunk[]>;
};

type RerankResponse = {
  strategy: StrategyKey;
  results: RankedChunk[];
};

type Movement = {
  direction: "up" | "down" | "same";
  label: string;
};

type ReaderSelection = {
  chunk: RankedChunk;
  strategy: StrategyKey;
};

type ReaderSource = {
  url: string | null;
  loading: boolean;
  error: string;
};

const strategies: { key: StrategyKey; label: string }[] = [
  { key: "dense", label: "Dense" },
  { key: "sparse", label: "Sparse (BM25)" },
  { key: "hybrid", label: "Weighted Hybrid" },
  { key: "rrf", label: "RRF" },
];

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.text();
  try {
    return (JSON.parse(body) as { detail?: string }).detail || fallback;
  } catch {
    return body || fallback;
  }
}

function formatScore(score: number | undefined) {
  return typeof score === "number" ? score.toFixed(4) : "—";
}

function getMovement(originalRank: number, rerankRank: number): Movement {
  if (rerankRank === originalRank) return { label: "Stayed", direction: "same" };
  if (rerankRank < originalRank) {
    return { label: `Up ${originalRank - rerankRank}`, direction: "up" };
  }
  return { label: `Down ${rerankRank - originalRank}`, direction: "down" };
}

function PassageCard({
  chunk,
  rank,
  kind,
  originalRank,
  movement,
  showOutsideReranked,
  sharedCount,
  compact = false,
  selected = false,
  onOpen,
}: {
  chunk: RankedChunk;
  rank: number;
  kind: "original" | "reranked";
  originalRank?: number;
  movement?: Movement;
  showOutsideReranked?: boolean;
  sharedCount?: number;
  compact?: boolean;
  selected?: boolean;
  onOpen: () => void;
}) {
  const paragraph = chunk.metadata.para !== undefined
    ? `Paragraph ${chunk.metadata.para}`
    : undefined;
  const citation = [chunk.metadata.citation, paragraph].filter(Boolean).join(" · ");

  return (
    <article className={`passage-card${compact ? " compact" : ""}${selected ? " selected" : ""}`}>
      <button
        className="passage-select"
        type="button"
        aria-pressed={selected}
        onClick={onOpen}
      >
        <span className="passage-card-topline">
          <span className="passage-rank">
            {kind === "reranked" ? `Reranked #${rank}` : `Original #${rank}`}
          </span>
          <span className="passage-score">
            {kind === "reranked"
              ? `Rerank ${formatScore(chunk.rerank_score)}`
              : `Retrieval ${formatScore(chunk.score)}`}
          </span>
        </span>
        {kind === "reranked" && (
          <span className="passage-original-score">
            Original #{originalRank ?? "—"} · Retrieval {formatScore(chunk.score)}
          </span>
        )}
        {movement && (
          <span className={`movement-badge movement-${movement.direction}`}>
            {movement.label}
          </span>
        )}
        {showOutsideReranked && !movement && (
          <span className="movement-badge movement-same">Outside reranked Top 5</span>
        )}
        {sharedCount !== undefined && sharedCount > 1 && (
          <span className="shared-badge">Shared across {sharedCount}</span>
        )}
        <span className="passage-title">{chunk.metadata.title || "Untitled judgment"}</span>
        {citation && <span className="passage-citation">{citation}</span>}
      </button>
      <div className="passage-actions">
        <button className="read-source-button" type="button" onClick={onOpen}>
          Read Source
        </button>
        <details className="passage-expand">
          <summary>Read passage</summary>
          <p>{chunk.metadata.text || "No text available for this passage."}</p>
        </details>
      </div>
    </article>
  );
}

export default function ResearchPage() {
  const [query, setQuery] = useState("");
  const [alpha, setAlpha] = useState(0.5);
  const [results, setResults] = useState<RetrievalResponse | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyKey>("dense");
  const [viewMode, setViewMode] = useState<ViewMode>("selected");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rerankedResults, setRerankedResults] = useState<
    Partial<Record<StrategyKey, RankedChunk[]>>
  >({});
  const [rerankBusy, setRerankBusy] = useState<Record<StrategyKey, boolean>>({
    dense: false,
    sparse: false,
    hybrid: false,
    rrf: false,
  });
  const [rerankErrors, setRerankErrors] = useState<Partial<Record<StrategyKey, string>>>({});
  const [readerSelection, setReaderSelection] = useState<ReaderSelection | null>(null);
  const [readerSource, setReaderSource] = useState<ReaderSource>({
    url: null,
    loading: false,
    error: "",
  });

  const anyRerankBusy = Object.values(rerankBusy).some(Boolean);
  const sharedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!results) return counts;

    strategies.forEach(({ key }) => {
      const ids = new Set(results.results[key].slice(0, 5).map((chunk) => chunk.chunk_id));
      ids.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
    });
    return counts;
  }, [results]);

  const selectedCandidates = results?.results[selectedStrategy] ?? [];
  const selectedReranked = rerankedResults[selectedStrategy];
  const originalRanks = new Map(
    selectedCandidates.map((chunk, rank) => [chunk.chunk_id, rank + 1]),
  );
  const rerankedRanks = new Map(
    (selectedReranked ?? []).map((chunk, rank) => [chunk.chunk_id, rank + 1]),
  );
  const readerCandidates = useMemo(() => {
    if (!results) return [];
    const keys = viewMode === "compare"
      ? strategies.map(({ key }) => key)
      : [selectedStrategy];
    const candidates: ReaderSelection[] = [];
    const seen = new Set<string>();

    keys.forEach((key) => {
      const original = results.results[key].slice(0, viewMode === "compare" ? 3 : 5);
      const reranked = viewMode === "selected" ? rerankedResults[key] ?? [] : [];
      [...original, ...reranked].forEach((chunk) => {
        const id = `${key}:${chunk.chunk_id}`;
        if (seen.has(id)) return;
        seen.add(id);
        candidates.push({ chunk, strategy: key });
      });
    });
    return candidates;
  }, [results, rerankedResults, selectedStrategy, viewMode]);
  const readerIndex = readerSelection
    ? readerCandidates.findIndex(
        ({ chunk, strategy }) =>
          chunk.chunk_id === readerSelection.chunk.chunk_id
          && strategy === readerSelection.strategy,
      )
    : -1;

  useEffect(() => {
    if (!readerSelection) {
      setReaderSource({ url: null, loading: false, error: "" });
      return;
    }

    const selection = readerSelection;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setReaderSource({ url: null, loading: true, error: "" });

    async function loadSource() {
      try {
        const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
        const response = await fetch(
          `${backendUrl.replace(/\/$/, "")}/judgment-source/${encodeURIComponent(selection.chunk.chunk_id)}`,
          {
            headers: { "X-User-Role": "default" },
            signal: controller.signal,
          },
        );
        if (response.status === 404) {
          throw new Error("Full source judgment is unavailable for this result.");
        }
        if (!response.ok) {
          throw new Error(await getErrorMessage(response, "Full source judgment is unavailable."));
        }
        if (!response.headers.get("content-type")?.toLowerCase().includes("application/pdf")) {
          throw new Error("The source service did not return a full judgment PDF.");
        }

        const pdf = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(pdf);
        setReaderSource({ url: objectUrl, loading: false, error: "" });
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setReaderSource({
          url: null,
          loading: false,
          error: requestError instanceof Error
            ? requestError.message
            : "Full source judgment is unavailable.",
        });
      }
    }

    void loadSource();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [readerSelection]);

  async function runResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (!text || busy || anyRerankBusy) return;

    setBusy(true);
    setError("");
    setResults(null);
    setRerankedResults({});
    setRerankErrors({});
    setSelectedStrategy("dense");
    setViewMode("selected");
    setReaderSelection(null);

    try {
      const params = new URLSearchParams({ query: text, alpha: alpha.toString() });
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/retrieval-research?${params}`,
        { method: "POST", headers: { "X-User-Role": "default" } },
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not retrieve results"));
      }
      setResults((await response.json()) as RetrievalResponse);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not reach the retrieval service",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyReranking(strategy: StrategyKey) {
    if (!results || rerankBusy[strategy]) return;

    setRerankBusy((current) => ({ ...current, [strategy]: true }));
    setRerankErrors((current) => ({ ...current, [strategy]: "" }));
    setRerankedResults((current) => ({ ...current, [strategy]: undefined }));

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(`${backendUrl.replace(/\/$/, "")}/retrieval-rerank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: results.query,
          strategy,
          candidates: results.results[strategy].slice(0, 20),
        }),
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not rerank these results"));
      }
      const data = (await response.json()) as RerankResponse;
      setRerankedResults((current) => ({ ...current, [strategy]: data.results }));
    } catch (requestError) {
      setRerankErrors((current) => ({
        ...current,
        [strategy]: requestError instanceof Error
          ? requestError.message
          : "Could not reach the reranking service",
      }));
    } finally {
      setRerankBusy((current) => ({ ...current, [strategy]: false }));
    }
  }

  function focusStrategy(strategy: StrategyKey) {
    setSelectedStrategy(strategy);
    setViewMode("selected");
  }

  function openJudgment(chunk: RankedChunk, strategy: StrategyKey) {
    setReaderSelection({ chunk, strategy });
  }

  function moveReader(offset: number) {
    const next = readerCandidates[readerIndex + offset];
    if (readerIndex >= 0 && next) setReaderSelection(next);
  }

  function rerankFromComparison(strategy: StrategyKey) {
    focusStrategy(strategy);
    void applyReranking(strategy);
  }

  return (
    <main className="app-shell">
      <Header active="research" />
      <div className="research-page">
        <header className="research-heading">
          <p className="eyebrow">LEGAL RESEARCH · EXPERIMENTAL</p>
          <h1>Retrieval Research Lab</h1>
          <p>Compare retrieval strategies across your judgment collection.</p>
        </header>

        <form className="research-form" onSubmit={runResearch}>
          <div className="research-query-field">
            <label className="research-query-label" htmlFor="research-query">Legal query</label>
            <textarea
              id="research-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask a question about a legal issue, principle or judgment…"
              rows={2}
            />
          </div>
          <div className="research-controls">
            <label className="alpha-control" htmlFor="alpha">
              <span className="alpha-values">
                <span>Dense <strong>{alpha.toFixed(2)}</strong></span>
                <span>Sparse <strong>{(1 - alpha).toFixed(2)}</strong></span>
              </span>
              <input
                id="alpha"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={alpha}
                onChange={(event) => setAlpha(Number(event.target.value))}
                aria-label="Weighted Hybrid dense alpha"
              />
            </label>
            <button
              className="research-submit"
              type="submit"
              disabled={busy || anyRerankBusy || !query.trim()}
            >
              {busy ? "Running…" : "Run Research"}
            </button>
          </div>
        </form>

        {busy && <p className="research-status" role="status">Retrieving judgment passages…</p>}
        {error && <p className="research-error" role="alert">{error}</p>}

        {results ? (
          <>
            <div className="research-results-context">
              <div>
                <span className="context-label">Results for</span>
                <p title={results.query}>{results.query}</p>
              </div>
              <div className="view-switch" aria-label="Results view">
                <button
                  type="button"
                  className={viewMode === "selected" ? "active" : ""}
                  onClick={() => setViewMode("selected")}
                >
                  Strategy
                </button>
                <button
                  type="button"
                  className={viewMode === "compare" ? "active" : ""}
                  onClick={() => setViewMode("compare")}
                >
                  Compare all
                </button>
              </div>
            </div>

            <div className={`research-lab-layout${readerSelection ? " reader-open" : ""}`}>
              <div className="research-workspace">
                <aside className="strategy-sidebar" aria-label="Retrieval strategies">
                <div className="strategy-sidebar-heading">
                  <span>Strategies</span>
                  <span>4</span>
                </div>
                <div className="strategy-nav">
                  {strategies.map(({ key, label }) => (
                    <button
                      type="button"
                      key={key}
                      className={`strategy-nav-item${selectedStrategy === key ? " selected" : ""}`}
                      aria-pressed={selectedStrategy === key}
                      onClick={() => focusStrategy(key)}
                    >
                      <span>{label}</span>
                      <span className="strategy-nav-count">{results.results[key].length}</span>
                    </button>
                  ))}
                </div>
                <p className="strategy-sidebar-note">
                  {rerankedResults[selectedStrategy] ? "Reranked results available" : "Original ranking"}
                </p>
                </aside>

                <section className="research-main-panel" aria-label="Selected retrieval results">
                {viewMode === "selected" ? (
                  <>
                    <div className="selected-strategy-header">
                      <div>
                        <p className="eyebrow">SELECTED STRATEGY</p>
                        <h2>{strategies.find(({ key }) => key === selectedStrategy)?.label}</h2>
                        <p>{selectedCandidates.length} candidates · top five shown</p>
                      </div>
                      <div className="selected-actions">
                        <button
                          className="rerank-button"
                          type="button"
                          onClick={() => void applyReranking(selectedStrategy)}
                          disabled={rerankBusy[selectedStrategy] || selectedCandidates.length === 0}
                        >
                          {rerankBusy[selectedStrategy] ? "Reranking…" : "Apply Reranking"}
                        </button>
                        {rerankBusy[selectedStrategy] && (
                          <span className="rerank-status" role="status">Scoring candidates…</span>
                        )}
                        {rerankErrors[selectedStrategy] && (
                          <p className="rerank-error" role="alert">
                            {rerankErrors[selectedStrategy]}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className={`ranking-comparison${selectedReranked ? " has-reranked" : ""}`}>
                      <section className="ranking-column">
                        <header>
                          <h3>Original Top 5</h3>
                          <span>Retrieval order</span>
                        </header>
                        {selectedCandidates.slice(0, 5).map((chunk, index) => {
                          const rerankRank = rerankedRanks.get(chunk.chunk_id);
                          const movement = rerankRank
                            ? getMovement(index + 1, rerankRank)
                            : undefined;
                          return (
                            <PassageCard
                              key={chunk.chunk_id}
                              chunk={chunk}
                              rank={index + 1}
                              kind="original"
                              movement={movement}
                              showOutsideReranked={Boolean(selectedReranked)}
                              sharedCount={sharedCounts.get(chunk.chunk_id)}
                              selected={
                                readerSelection?.strategy === selectedStrategy
                                && readerSelection.chunk.chunk_id === chunk.chunk_id
                              }
                              onOpen={() => openJudgment(chunk, selectedStrategy)}
                            />
                          );
                        })}
                        {selectedCandidates.length === 0 && (
                          <p className="empty-results">No matching passages.</p>
                        )}
                      </section>

                      {selectedReranked && (
                        <section className="ranking-column reranked-column">
                          <header>
                            <h3>Reranked Top 5</h3>
                            <span>Cross-Encoder order</span>
                          </header>
                          {selectedReranked.map((chunk, index) => {
                            const originalRank = originalRanks.get(chunk.chunk_id);
                            return (
                              <PassageCard
                                key={chunk.chunk_id}
                                chunk={chunk}
                                rank={index + 1}
                                kind="reranked"
                                originalRank={originalRank}
                                movement={originalRank
                                  ? getMovement(originalRank, index + 1)
                                  : undefined}
                                selected={
                                  readerSelection?.strategy === selectedStrategy
                                  && readerSelection.chunk.chunk_id === chunk.chunk_id
                                }
                                onOpen={() => openJudgment(chunk, selectedStrategy)}
                              />
                            );
                          })}
                        </section>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="comparison-view">
                    <div className="comparison-view-heading">
                      <div>
                        <p className="eyebrow">SIDE-BY-SIDE</p>
                        <h2>Strategy comparison</h2>
                      </div>
                      <span>Top 3 original passages per strategy</span>
                    </div>
                    <div className="strategy-compare-grid">
                      {strategies.map(({ key, label }) => (
                        <section className="strategy-compare-panel" key={key}>
                          <header>
                            <button
                              className="compare-strategy-title"
                              type="button"
                              onClick={() => focusStrategy(key)}
                            >
                              {label}
                              <span>{results.results[key].length}</span>
                            </button>
                            <button
                              className="compare-rerank-button"
                              type="button"
                              onClick={() => rerankFromComparison(key)}
                              disabled={rerankBusy[key] || results.results[key].length === 0}
                            >
                              {rerankBusy[key] ? "Reranking…" : "Apply Reranking"}
                            </button>
                          </header>
                          {rerankErrors[key] && (
                            <p className="rerank-error compare-rerank-error" role="alert">
                              {rerankErrors[key]}
                            </p>
                          )}
                          {rerankBusy[key] && (
                            <p className="rerank-status compare-rerank-status" role="status">
                              Scoring candidates…
                            </p>
                          )}
                          {results.results[key].slice(0, 3).map((chunk, index) => (
                            <PassageCard
                              key={chunk.chunk_id}
                              chunk={chunk}
                              rank={index + 1}
                              kind="original"
                              compact
                              sharedCount={sharedCounts.get(chunk.chunk_id)}
                              selected={
                                readerSelection?.strategy === key
                                && readerSelection.chunk.chunk_id === chunk.chunk_id
                              }
                              onOpen={() => openJudgment(chunk, key)}
                            />
                          ))}
                          {results.results[key].length === 0 && (
                            <p className="empty-results">No matching passages.</p>
                          )}
                        </section>
                      ))}
                    </div>
                  </div>
                )}
                </section>
              </div>

              {readerSelection && (
                <>
                  <button
                    className="reader-backdrop"
                    type="button"
                    aria-label="Close judgment reader"
                    onClick={() => setReaderSelection(null)}
                  />
                  <aside className="judgment-reader" aria-label="Judgment source reader">
                    <header className="reader-header">
                      <div>
                        <p className="eyebrow">FULL JUDGMENT</p>
                        <h2>{readerSelection.chunk.metadata.title || "Judgment source"}</h2>
                        <p>
                          {readerSelection.chunk.metadata.citation || "Citation unavailable"}
                        </p>
                      </div>
                      <div className="reader-tools">
                        <span className="reader-position">
                          {readerIndex >= 0 ? `${readerIndex + 1} of ${readerCandidates.length}` : ""}
                        </span>
                        <button
                          className="reader-nav-button"
                          type="button"
                          onClick={() => moveReader(-1)}
                          disabled={readerIndex <= 0}
                          aria-label="Previous judgment"
                        >
                          ‹
                        </button>
                        <button
                          className="reader-nav-button"
                          type="button"
                          onClick={() => moveReader(1)}
                          disabled={readerIndex < 0 || readerIndex >= readerCandidates.length - 1}
                          aria-label="Next judgment"
                        >
                          ›
                        </button>
                        <button
                          className="reader-close"
                          type="button"
                          onClick={() => setReaderSelection(null)}
                          aria-label="Close judgment reader"
                        >
                          ×
                        </button>
                      </div>
                    </header>
                    <div className="reader-body" aria-live="polite">
                      {readerSource.loading && (
                        <p className="reader-message" role="status">Loading full judgment…</p>
                      )}
                      {readerSource.error && (
                        <p className="reader-message reader-error" role="alert">
                          {readerSource.error}
                        </p>
                      )}
                      {readerSource.url && (
                        <iframe
                          className="reader-pdf"
                          title={`${readerSelection.chunk.metadata.title || "Judgment"} full source`}
                          src={readerSource.url}
                        />
                      )}
                    </div>
                  </aside>
                </>
              )}
            </div>
          </>
        ) : !busy && !error ? (
          <div className="research-empty">
            <h2>Compare retrieval strategies</h2>
            <p>Enter a legal query to inspect dense, BM25, hybrid and RRF results side by side.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
