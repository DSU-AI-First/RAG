"use client";

import { FormEvent, useState } from "react";
import Header from "@/components/header";

type Embedding = {
  label: string;
  text: string;
  vector: number[];
  dimensions: number;
  token_count: number;
};

type EmbeddingResult = {
  model: string;
  embeddings: Embedding[];
  similarities: { pair: string; score: number }[];
};

const initialSentences = [
  "The court granted a divorce after finding that the marriage had irretrievably broken down.",
  "The accused was charged with murder after the victim died from a stab wound.",
  "The court granted bail because the accused was not a flight risk.",
];

async function getErrorMessage(response: Response) {
  const body = await response.text();
  try {
    return (JSON.parse(body) as { detail?: string }).detail || "Could not generate embeddings";
  } catch {
    return body || "Could not generate embeddings";
  }
}

export default function EmbeddingSimulatorPage() {
  const [sentences, setSentences] = useState(initialSentences);
  const [result, setResult] = useState<EmbeddingResult | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateSentence(index: number, value: string) {
    setSentences((current) => current.map((sentence, currentIndex) => (
      currentIndex === index ? value : sentence
    )));
    setResult(null);
    setError("");
    setCopied(null);
  }

  async function generateEmbeddings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setResult(null);

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(`${backendUrl.replace(/\/$/, "")}/embedding-simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sentences }),
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      setResult(await response.json() as EmbeddingResult);
      setExpanded(new Set());
      setCopied(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reach the embedding service");
    } finally {
      setBusy(false);
    }
  }

  async function copyVector(embedding: Embedding) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(embedding.vector));
      setCopied(embedding.label);
    } catch {
      setError("Could not copy the vector. Check your browser clipboard permissions.");
    }
  }

  function toggleExpanded(label: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  return (
    <main className="app-shell">
      <Header active="embeddings" />
      <section className="embedding-page">
        <header className="embedding-heading">
          <p className="eyebrow">RAG CONCEPTS</p>
          <h1>Embedding Simulator</h1>
          <p>
            An embedding turns text into a list of numbers. Similar sentences tend to point
            in similar directions, which cosine similarity measures.
          </p>
        </header>

        <form className="embedding-form" onSubmit={generateEmbeddings}>
          <div className="embedding-inputs">
            {sentences.map((sentence, index) => (
              <label className="embedding-input" key={index}>
                <span>Sentence {String.fromCharCode(65 + index)}</span>
                <textarea
                  value={sentence}
                  maxLength={2000}
                  rows={3}
                  disabled={busy}
                  onChange={(event) => updateSentence(index, event.target.value)}
                  aria-label={`Sentence ${String.fromCharCode(65 + index)}`}
                />
              </label>
            ))}
          </div>
          <div className="embedding-form-footer">
            <span>Examples: divorce · murder · bail. Edit any sentence to try your own text.</span>
            <button type="submit" className="embedding-generate" disabled={busy}>
              {busy ? "Generating…" : "Generate Embeddings"}
            </button>
          </div>
        </form>

        {error && <p className="embedding-error" role="alert">{error}</p>}

        {result && (
          <div className="embedding-results">
            <section className="embedding-section" aria-labelledby="embedding-vectors-title">
              <div className="embedding-section-heading">
                <div>
                  <p className="eyebrow">MODEL OUTPUT</p>
                  <h2 id="embedding-vectors-title">Embedding vectors</h2>
                </div>
                <span>First 10 values shown</span>
              </div>
              <div className="embedding-vector-grid">
                {result.embeddings.map((embedding) => {
                  const isExpanded = expanded.has(embedding.label);
                  const visibleVector = isExpanded
                    ? embedding.vector
                    : embedding.vector.slice(0, 10);
                  return (
                    <article className="embedding-vector-card" key={embedding.label}>
                      <div className="embedding-card-heading">
                        <div>
                          <h3>Sentence {embedding.label}</h3>
                          <p>{embedding.dimensions.toLocaleString()} dimensions · about {embedding.token_count} tokens</p>
                        </div>
                        <button
                          className="embedding-copy"
                          type="button"
                          onClick={() => void copyVector(embedding)}
                        >
                          {copied === embedding.label ? "Copied" : "Copy vector"}
                        </button>
                      </div>
                      <p className="embedding-card-sentence">{embedding.text}</p>
                      <pre className="embedding-vector-values">
                        [{visibleVector.map(String).join(", ")}{isExpanded ? "" : embedding.vector.length > 10 ? ", …" : ""}]
                      </pre>
                      {embedding.vector.length > 10 && (
                        <button
                          className="embedding-expand"
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => toggleExpanded(embedding.label)}
                        >
                          {isExpanded ? "Show first 10 values" : `Show all ${embedding.dimensions.toLocaleString()} values`}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="embedding-section" aria-labelledby="embedding-similarity-title">
              <div className="embedding-section-heading">
                <div>
                  <p className="eyebrow">PAIRWISE COMPARISON</p>
                  <h2 id="embedding-similarity-title">Cosine similarity</h2>
                </div>
                <span>Closer to 1 means more aligned</span>
              </div>
              <div className="embedding-similarity-table">
                {result.similarities.map(({ pair, score }) => (
                  <div className="embedding-similarity-row" key={pair}>
                    <strong>{pair}</strong>
                    <div className="embedding-similarity-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${(Math.min(1, Math.max(-1, score)) + 1) * 50}%`,
                        }}
                      />
                    </div>
                    <output>{score.toFixed(4)}</output>
                  </div>
                ))}
              </div>
              <p className="embedding-similarity-note">
                Cosine scores range from −1 to 1. Scores are calculated from the complete vectors, not the shortened previews.
              </p>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
