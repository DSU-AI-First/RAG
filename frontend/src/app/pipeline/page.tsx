"use client";

import { FormEvent, ReactNode, useState } from "react";
import Header from "@/components/header";

type RetrievalStrategy = "dense" | "sparse" | "hybrid" | "rrf";
type StageName =
  | "query"
  | "embedding"
  | "retrieval"
  | "reranking"
  | "context_assembly"
  | "generation";
type StageStatus = "running" | "completed" | "failed" | "skipped" | "blocked";
type Metadata = Record<string, unknown>;

type PipelineRequest = {
  query: string;
  alpha: number;
  retrieval_strategy: RetrievalStrategy;
  rerank: boolean;
};

type StageError = {
  stage: string;
  type: string;
  message: string;
};

type PipelineStage<Input, Output> = {
  status: StageStatus;
  input: Input | null;
  output: Output | null;
  reason?: string;
  error?: StageError;
};

type QueryStage = PipelineStage<
  { question: string },
  { question: string; preprocessing: string; safety_check_passed: boolean }
>;

type EmbeddingStage = PipelineStage<
  { question: string },
  {
    model: string;
    input_type: string;
    dimensions: number;
    dense_vector_preview: number[];
    sparse_vector_preview: { indices: number[]; values: number[] };
  }
>;

type RetrievedPassage = {
  rank: number;
  chunk_id: string;
  score: number;
  metadata: Metadata;
};

type RetrievalStage = PipelineStage<
  {
    alpha: number;
    role: string;
    top_k: number;
    strategies: RetrievalStrategy[];
  },
  Record<RetrievalStrategy, RetrievedPassage[]>
>;

type RerankCandidate = {
  chunk_id: string;
  score: number;
  metadata: Metadata;
};

type RerankedPassage = {
  reranked_rank: number;
  original_rank: number;
  chunk_id: string;
  original_score: number;
  rerank_score: number;
  metadata: Metadata;
};

type RerankingStage = PipelineStage<
  {
    retrieval_strategy?: RetrievalStrategy;
    candidate_count?: number;
    candidates?: RerankCandidate[];
    enabled?: boolean;
  },
  { model: string; results: RerankedPassage[] } | null
>;

type GenerationMessage = {
  role: string;
  content: string;
};

type ContextStage = PipelineStage<
  {
    question: string;
    retrieval_strategy: RetrievalStrategy;
    reranking_enabled: boolean;
    passages: RetrievedPassage[];
  },
  { messages: GenerationMessage[] }
>;

type Citation = {
  chunk_id: string;
  case_title: string;
  case_id: string;
  paragraph_number: string | number | null;
  text: string;
};

type GenerationStage = PipelineStage<
  { messages: GenerationMessage[] },
  {
    model?: string;
    raw_response?: string | null;
    answer?: string;
    model_source_ids?: string[];
    citation_validation?: {
      valid: boolean;
      checked_source_ids: string[];
      invalid_source_ids: string[];
      reason?: string;
    };
    response_safety_passed?: boolean;
    citations?: Citation[];
  }
>;

type PipelineResponse = {
  execution_id: string;
  status: "completed" | "failed" | "blocked";
  stages: {
    query: QueryStage;
    embedding: EmbeddingStage;
    retrieval: RetrievalStage;
    reranking: RerankingStage;
    context_assembly: ContextStage;
    generation: GenerationStage;
  };
  errors: StageError[];
  final_answer: string | null;
  citations: Citation[];
};

type PipelineRun = {
  request: PipelineRequest;
  response: PipelineResponse;
};

const strategies: { value: RetrievalStrategy; label: string }[] = [
  { value: "dense", label: "Dense" },
  { value: "sparse", label: "Sparse" },
  { value: "hybrid", label: "Hybrid" },
  { value: "rrf", label: "RRF" },
];

const strategyDescriptions: Record<RetrievalStrategy, string> = {
  dense: "Finds passages with related meaning.",
  sparse: "Finds passages using matching terms.",
  hybrid: "Balances dense and sparse search using alpha.",
  rrf: "Combines ranking positions; its score is not a similarity score.",
};

const stageDefinitions: {
  key: StageName;
  title: string;
  description: string;
}[] = [
  {
    key: "query",
    title: "Query",
    description: "Keeps your question intact and screens it before any search begins.",
  },
  {
    key: "embedding",
    title: "Embedding",
    description: "Turns the question into model values so related judgments can be found.",
  },
  {
    key: "retrieval",
    title: "Retrieval",
    description: "Finds candidate passages that may support a grounded answer.",
  },
  {
    key: "reranking",
    title: "Reranking",
    description: "Moves the strongest candidates forward for the answer stage.",
  },
  {
    key: "context_assembly",
    title: "Context Assembly",
    description: "Shows the answer model which judgment passages it can rely on.",
  },
  {
    key: "generation",
    title: "Answer Generation",
    description: "Produces an answer, then checks its safety and cited sources.",
  },
];

function strategyLabel(strategy: RetrievalStrategy) {
  return strategies.find((item) => item.value === strategy)?.label ?? strategy;
}

function jsonText(value: unknown) {
  return JSON.stringify(value, null, 2) ?? String(value);
}

function displayText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function getErrorMessage(body: string, fallback: string) {
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
    if (detail !== undefined) return jsonText(detail);
  } catch {
    return body || fallback;
  }
  return body || fallback;
}

function getMovement(originalRank: number, rerankedRank: number) {
  const movement = originalRank - rerankedRank;
  if (movement > 0) return `Moved up ${movement}`;
  if (movement < 0) return `Moved down ${Math.abs(movement)}`;
  return "Rank unchanged";
}

function StageStatus({ status }: { status: StageStatus | null }) {
  const label = status ? status[0].toUpperCase() + status.slice(1) : "Not run";
  return (
    <span className={`pipeline-status${status ? ` status-${status}` : " status-not-run"}`}>
      {label}
    </span>
  );
}

function TechnicalDetails({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="pipeline-technical">
      <summary>{label}</summary>
      {children}
    </details>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="pipeline-code">{jsonText(value)}</pre>;
}

function PassageDetails({
  chunkId,
  metadata,
  rankLabel,
  scoreLabel,
  score,
  secondaryScore,
  movement,
}: {
  chunkId: string;
  metadata: Metadata;
  rankLabel: string;
  scoreLabel: string;
  score: number;
  secondaryScore?: { label: string; value: number };
  movement?: string;
}) {
  const title = displayText(metadata.title) ?? "Judgment passage";
  const citation = displayText(metadata.citation);
  const paragraph = metadata.para !== undefined && metadata.para !== null
    ? `Paragraph ${String(metadata.para)}`
    : undefined;
  const text = displayText(metadata.text);

  return (
    <details className="pipeline-passage">
      <summary>
        <span className="pipeline-passage-heading">
          <strong>{title}</strong>
          <span>{rankLabel}</span>
        </span>
        {(citation || paragraph) && (
          <span className="pipeline-passage-citation">
            {[citation, paragraph].filter(Boolean).join(" · ")}
          </span>
        )}
        <span className="pipeline-score-row">
          <span>{scoreLabel}: <strong>{score.toFixed(4)}</strong></span>
          {secondaryScore && (
            <span>{secondaryScore.label}: <strong>{secondaryScore.value.toFixed(4)}</strong></span>
          )}
          {movement && <span className="pipeline-movement">{movement}</span>}
        </span>
      </summary>
      <div className="pipeline-passage-body">
        <p className="pipeline-passage-id">Chunk ID: {chunkId}</p>
        {text && <p className="pipeline-passage-text">{text}</p>}
        {!text && <p className="pipeline-muted">No passage text was included in this response.</p>}
        <TechnicalDetails label="Judgment metadata">
          <JsonBlock value={metadata} />
        </TechnicalDetails>
      </div>
    </details>
  );
}

function CitationDetails({ citations }: { citations: Citation[] }) {
  if (!citations.length) {
    return <p className="pipeline-muted">The API returned no citations for this answer.</p>;
  }

  return (
    <ol className="pipeline-citations">
      {citations.map((citation) => (
        <li key={citation.chunk_id}>
          <strong>{citation.case_title || "Judgment citation"}</strong>
          <span>
            {citation.case_id}
            {citation.paragraph_number !== null && citation.paragraph_number !== undefined
              ? ` · Paragraph ${citation.paragraph_number}`
              : ""}
          </span>
          <details className="pipeline-technical">
            <summary>Source passage</summary>
            <p className="pipeline-passage-id">Chunk ID: {citation.chunk_id}</p>
            <p className="pipeline-passage-text">{citation.text}</p>
          </details>
        </li>
      ))}
    </ol>
  );
}

export default function PipelineExplorerPage() {
  const [query, setQuery] = useState("");
  const [retrievalStrategy, setRetrievalStrategy] = useState<RetrievalStrategy>("hybrid");
  const [alpha, setAlpha] = useState(0.5);
  const [rerank, setRerank] = useState(false);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function clearRun() {
    setRun(null);
    setError("");
  }

  async function runPipeline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim() || busy) return;

    const request: PipelineRequest = {
      query,
      alpha,
      retrieval_strategy: retrievalStrategy,
      rerank,
    };
    setBusy(true);
    setRun(null);
    setError("");

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/pipeline-explorer/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": "default",
          },
          body: JSON.stringify(request),
        },
      );
      if (!response.ok) {
        throw new Error(getErrorMessage(await response.text(), "Could not run the pipeline"));
      }
      setRun({ request, response: await response.json() as PipelineResponse });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not reach the pipeline service",
      );
    } finally {
      setBusy(false);
    }
  }

  function renderStage(key: StageName) {
    if (!run) return <p className="pipeline-muted">Run the pipeline to see this stage’s actual inputs and outputs.</p>;

    const { response, request } = run;
    switch (key) {
      case "query": {
        const stage = response.stages.query;
        return (
          <>
            <div className="pipeline-stage-columns">
              <section className="pipeline-part">
                <h3>Input</h3>
                <p>{stage.input?.question ?? "No input was recorded."}</p>
              </section>
              <section className="pipeline-part">
                <h3>Output</h3>
                {stage.output ? (
                  <>
                    <p>{stage.output.preprocessing}</p>
                    <p className="pipeline-inline-status">
                      Safety screening: <strong>{stage.output.safety_check_passed ? "Passed" : "Blocked"}</strong>
                    </p>
                  </>
                ) : <p className="pipeline-muted">No output was produced.</p>}
              </section>
            </div>
            <TechnicalDetails label="Exact stage input and output">
              <JsonBlock value={{ input: stage.input, output: stage.output }} />
            </TechnicalDetails>
          </>
        );
      }
      case "embedding": {
        const stage = response.stages.embedding;
        const output = stage.output;
        return (
          <>
            <div className="pipeline-stage-columns">
              <section className="pipeline-part">
                <h3>Input</h3>
                <p>{stage.input?.question ?? "No input was recorded."}</p>
              </section>
              <section className="pipeline-part">
                <h3>Output</h3>
                {output ? (
                  <>
                    <p className="pipeline-model">{output.model}</p>
                    <p className="pipeline-inline-status">
                      {output.dimensions.toLocaleString()} dimensions · {output.input_type}
                    </p>
                    <TechnicalDetails label="Dense vector preview · first 10 values">
                      <JsonBlock value={output.dense_vector_preview} />
                    </TechnicalDetails>
                    <TechnicalDetails label="Sparse vector preview">
                      <JsonBlock value={output.sparse_vector_preview} />
                    </TechnicalDetails>
                    <p className="pipeline-limitation">
                      The endpoint returns a 10-value preview, not the complete dense vector.
                    </p>
                  </>
                ) : <p className="pipeline-muted">No embedding was produced.</p>}
              </section>
            </div>
            <TechnicalDetails label="Exact stage input and output">
              <JsonBlock value={{ input: stage.input, output }} />
            </TechnicalDetails>
          </>
        );
      }
      case "retrieval": {
        const stage = response.stages.retrieval;
        const output = stage.output;
        return (
          <>
            <div className="pipeline-stage-columns">
              <section className="pipeline-part">
                <h3>Input</h3>
                {stage.input ? (
                  <dl className="pipeline-facts">
                    <div><dt>Selected strategy</dt><dd>{strategyLabel(request.retrieval_strategy)}</dd></div>
                    <div><dt>Hybrid alpha</dt><dd>{stage.input.alpha.toFixed(2)}</dd></div>
                    <div><dt>Top results per strategy</dt><dd>{stage.input.top_k}</dd></div>
                    <div><dt>Access role</dt><dd>{stage.input.role}</dd></div>
                  </dl>
                ) : <p className="pipeline-muted">Retrieval was not reached.</p>}
              </section>
              <section className="pipeline-part">
                <h3>Output</h3>
                {output ? (
                  <div className="pipeline-strategy-list">
                    {strategies.map(({ value, label }) => {
                      const passages = output[value];
                      return (
                        <details
                          className="pipeline-strategy-results"
                          key={value}
                          open={value === request.retrieval_strategy}
                        >
                          <summary>
                            <span>{label}</span>
                            <span>{countLabel(passages.length, "passage")}</span>
                          </summary>
                          <p className="pipeline-strategy-description">{strategyDescriptions[value]}</p>
                          {passages.length ? (
                            <div className="pipeline-passage-list">
                              {passages.map((passage) => (
                                <PassageDetails
                                  key={`${value}-${passage.chunk_id}`}
                                  chunkId={passage.chunk_id}
                                  metadata={passage.metadata}
                                  rankLabel={`Original rank #${passage.rank}`}
                                  scoreLabel="Retrieval score"
                                  score={passage.score}
                                />
                              ))}
                            </div>
                          ) : <p className="pipeline-muted">No passages were returned for this strategy.</p>}
                        </details>
                      );
                    })}
                  </div>
                ) : <p className="pipeline-muted">Retrieval did not produce results.</p>}
              </section>
            </div>
            <TechnicalDetails label="Exact retrieval input">
              <JsonBlock value={stage.input} />
            </TechnicalDetails>
          </>
        );
      }
      case "reranking": {
        const stage = response.stages.reranking;
        const output = stage.output;
        return (
          <>
            <div className="pipeline-stage-columns">
              <section className="pipeline-part">
                <h3>Input</h3>
                {stage.input?.enabled === false ? (
                  <p>Reranking was not requested.</p>
                ) : stage.input?.candidate_count !== undefined ? (
                  <>
                    <p>
                      {countLabel(stage.input.candidate_count, "candidate")} from {strategyLabel(stage.input.retrieval_strategy ?? request.retrieval_strategy)}{" "}
                      {stage.input.candidate_count === 1 ? "was" : "were"} sent to the reranker.
                    </p>
                    <TechnicalDetails label="Candidates sent to the reranker">
                      <JsonBlock value={stage.input.candidates} />
                    </TechnicalDetails>
                  </>
                ) : <p className="pipeline-muted">{stage.reason ?? "Reranking was not reached."}</p>}
              </section>
              <section className="pipeline-part">
                <h3>Output</h3>
                {output ? (
                  <>
                    <p className="pipeline-model">{output.model}</p>
                    <p className="pipeline-inline-status">Top {countLabel(output.results.length, "reranked passage")}</p>
                    <div className="pipeline-passage-list">
                      {output.results.map((passage) => (
                        <PassageDetails
                          key={passage.chunk_id}
                          chunkId={passage.chunk_id}
                          metadata={passage.metadata}
                          rankLabel={`Reranked #${passage.reranked_rank} · Original #${passage.original_rank}`}
                          scoreLabel="Reranker score"
                          score={passage.rerank_score}
                          secondaryScore={{
                            label: "Retrieval score",
                            value: passage.original_score,
                          }}
                          movement={getMovement(passage.original_rank, passage.reranked_rank)}
                        />
                      ))}
                    </div>
                  </>
                ) : <p className="pipeline-muted">No reranking output was returned.</p>}
              </section>
            </div>
            <TechnicalDetails label="Exact stage input and output">
              <JsonBlock value={{ input: stage.input, output }} />
            </TechnicalDetails>
          </>
        );
      }
      case "context_assembly": {
        const stage = response.stages.context_assembly;
        const messages = stage.output?.messages;
        return (
          <>
            <div className="pipeline-stage-columns">
              <section className="pipeline-part">
                <h3>Input</h3>
                {stage.input ? (
                  <>
                    <p><strong>Question:</strong> {stage.input.question}</p>
                    <p className="pipeline-inline-status">
                      {strategyLabel(stage.input.retrieval_strategy)}
                      {stage.input.reranking_enabled ? " · reranked" : " · original retrieval order"}
                    </p>
                    <p>{countLabel(stage.input.passages.length, "judgment passage")} assembled</p>
                    <div className="pipeline-passage-list">
                      {stage.input.passages.map((passage) => (
                        <PassageDetails
                          key={passage.chunk_id}
                          chunkId={passage.chunk_id}
                          metadata={passage.metadata}
                          rankLabel={`Context rank #${passage.rank}`}
                          scoreLabel="Retrieval score"
                          score={passage.score}
                        />
                      ))}
                    </div>
                  </>
                ) : <p className="pipeline-muted">Context assembly was not reached.</p>}
              </section>
              <section className="pipeline-part">
                <h3>Exact messages sent to generation</h3>
                {messages?.length ? messages.map((message, index) => (
                  <TechnicalDetails
                    key={`${message.role}-${index}`}
                    label={`${message.role === "system" ? "System instructions" : "User message"} · ${message.role}`}
                  >
                    <pre className="pipeline-code pipeline-message">{message.content}</pre>
                  </TechnicalDetails>
                )) : <p className="pipeline-muted">No generation messages were assembled.</p>}
              </section>
            </div>
            <TechnicalDetails label="Exact context-assembly input and output">
              <JsonBlock value={{ input: stage.input, output: stage.output }} />
            </TechnicalDetails>
          </>
        );
      }
      case "generation": {
        const stage = response.stages.generation;
        const output = stage.output;
        const validation = output?.citation_validation;
        return (
          <>
            <div className="pipeline-stage-columns">
              <section className="pipeline-part">
                <h3>Input</h3>
                {stage.input?.messages ? (
                  <p>
                    {countLabel(stage.input.messages.length, "exact message")} from Context Assembly{" "}
                    {stage.input.messages.length === 1 ? "was" : "were"} sent to the configured model.
                  </p>
                ) : <p className="pipeline-muted">Generation was not reached.</p>}
                {stage.input?.messages && (
                  <TechnicalDetails label="Messages sent">
                    <JsonBlock value={stage.input.messages} />
                  </TechnicalDetails>
                )}
              </section>
              <section className="pipeline-part">
                <h3>Output</h3>
                {output ? (
                  <>
                    {output.model && <p className="pipeline-model">{output.model}</p>}
                    {output.answer && <p className="pipeline-answer-preview">{output.answer}</p>}
                    {output.response_safety_passed !== undefined && (
                      <p className="pipeline-inline-status">
                        Response safety: <strong>{output.response_safety_passed ? "Passed" : "Blocked"}</strong>
                      </p>
                    )}
                    {validation && (
                      <p className="pipeline-inline-status">
                        Citation validation: <strong>
                          {validation.reason ? "Not run" : validation.valid ? "Passed" : "Failed"}
                        </strong>
                        {validation.checked_source_ids.length > 0
                          ? ` · ${countLabel(validation.checked_source_ids.length, "source ID")} checked`
                          : ""}
                      </p>
                    )}
                    {validation?.reason && <p className="pipeline-muted">{validation.reason}</p>}
                    {validation && !validation.valid && validation.invalid_source_ids.length > 0 && (
                      <TechnicalDetails label="Invalid source IDs">
                        <JsonBlock value={validation.invalid_source_ids} />
                      </TechnicalDetails>
                    )}
                    {output.raw_response && (
                      <TechnicalDetails label="Raw model response">
                        <pre className="pipeline-code">{output.raw_response}</pre>
                      </TechnicalDetails>
                    )}
                  </>
                ) : <p className="pipeline-muted">No model output was returned.</p>}
              </section>
            </div>
            <TechnicalDetails label="Exact generation-stage input and output">
              <JsonBlock value={{ input: stage.input, output }} />
            </TechnicalDetails>
          </>
        );
      }
    }
  }

  const response = run?.response;

  return (
    <main className="app-shell">
      <Header active="pipeline" />
      <section className="pipeline-page">
        <header className="pipeline-heading">
          <p className="eyebrow">RAG CONCEPTS</p>
          <h1>Pipeline Explorer</h1>
          <p>Follow how a legal question becomes a grounded answer.</p>
        </header>

        <form className="pipeline-form" onSubmit={runPipeline}>
          <label className="pipeline-question-label" htmlFor="pipeline-question">
            Legal question
          </label>
          <textarea
            id="pipeline-question"
            value={query}
            maxLength={4000}
            rows={3}
            required
            disabled={busy}
            placeholder="For example: What factors do courts consider when deciding whether to grant bail?"
            onChange={(event) => {
              setQuery(event.target.value);
              clearRun();
            }}
          />
          <p className="pipeline-form-hint">Enter a question to enable the pipeline.</p>
          <div className="pipeline-controls">
            <label className="pipeline-control">
              <span>Retrieval strategy</span>
              <select
                value={retrievalStrategy}
                disabled={busy}
                onChange={(event) => {
                  setRetrievalStrategy(event.target.value as RetrievalStrategy);
                  clearRun();
                }}
              >
                {strategies.map(({ value, label }) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </label>
            {retrievalStrategy === "hybrid" && (
              <label className="pipeline-alpha">
                <span>Hybrid balance <strong>{alpha.toFixed(2)}</strong></span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={alpha}
                  disabled={busy}
                  onChange={(event) => {
                    setAlpha(Number(event.target.value));
                    clearRun();
                  }}
                  aria-label="Hybrid dense alpha"
                />
                <small>0 favors sparse search · 1 favors dense search</small>
              </label>
            )}
            <label className="pipeline-rerank">
              <input
                type="checkbox"
                checked={rerank}
                disabled={busy}
                onChange={(event) => {
                  setRerank(event.target.checked);
                  clearRun();
                }}
              />
              <span>Rerank top candidates</span>
            </label>
            <button type="submit" className="pipeline-submit" disabled={busy || !query.trim()}>
              {busy ? "Running pipeline…" : "Run Pipeline"}
            </button>
          </div>
        </form>

        {busy && (
          <p className="pipeline-status-message" role="status" aria-live="polite">
            Running the real retrieval and generation pipeline…
          </p>
        )}
        {error && <p className="pipeline-error" role="alert">{error}</p>}

        <section className="pipeline-stages" aria-label="Pipeline stages">
          {stageDefinitions.map((definition, index) => {
            const stage = response?.stages[definition.key];
            const stageStatus = stage?.status ?? null;
            return (
              <details className="pipeline-stage" key={definition.key}>
                <summary>
                  <span className="pipeline-stage-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="pipeline-stage-title">
                    <strong>{definition.title}</strong>
                    <small>{definition.description}</small>
                  </span>
                  <StageStatus status={stageStatus} />
                </summary>
                <div className="pipeline-stage-content">
                  {stage?.error && (
                    <p className="pipeline-stage-error" role="alert">
                      {stage.error.message}
                    </p>
                  )}
                  {stage?.status === "skipped" && stage.reason && (
                    <p className="pipeline-muted">{stage.reason}</p>
                  )}
                  {renderStage(definition.key)}
                </div>
              </details>
            );
          })}
        </section>

        {response && (
          <>
            {response.errors.length > 0 && (
              <section className="pipeline-errors" aria-label="Pipeline errors">
                <h2>Execution errors</h2>
                {response.errors.map((item, index) => (
                  <p key={`${item.stage}-${index}`}>
                    <strong>{item.stage} · {item.type}:</strong> {item.message}
                  </p>
                ))}
              </section>
            )}
            <section className="pipeline-final" aria-labelledby="pipeline-final-title">
              <div className="pipeline-final-heading">
                <div>
                  <p className="eyebrow">PIPELINE RESULT</p>
                  <h2 id="pipeline-final-title">Final answer</h2>
                </div>
                <StageStatus status={response.status} />
              </div>
              {response.final_answer ? (
                <p className="pipeline-final-answer">{response.final_answer}</p>
              ) : (
                <p className="pipeline-muted">The API did not return a final answer.</p>
              )}
              <h3>Citations</h3>
              <CitationDetails citations={response.citations} />
              <TechnicalDetails label="Execution ID">
                <code className="pipeline-execution-id">{response.execution_id}</code>
              </TechnicalDetails>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
