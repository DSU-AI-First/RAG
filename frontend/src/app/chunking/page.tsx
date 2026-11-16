"use client";

import { ChangeEvent, useMemo, useRef, useState } from "react";
import Header from "@/components/header";

type Strategy = "fixed" | "fixed_overlap" | "paragraph" | "sentence" | "recursive";

type UploadedDocument = {
  filename: string;
  text: string;
  character_count: number;
};

type GeneratedChunk = {
  index: number;
  text: string;
  start: number;
  end: number;
  start_utf16: number;
  end_utf16: number;
  characters: number;
  token_count: number;
};

type ChunkResponse = {
  count: number;
  chunks: GeneratedChunk[];
};

type SourceSegment = {
  start: number;
  end: number;
  chunkIndexes: number[];
};

const strategies: { value: Strategy; label: string }[] = [
  { value: "fixed", label: "Fixed-size" },
  { value: "fixed_overlap", label: "Fixed-size with overlap" },
  { value: "paragraph", label: "Paragraph-based" },
  { value: "sentence", label: "Sentence-based" },
  { value: "recursive", label: "Recursive character splitting" },
];

const chunkColors = [
  "#e9f1ea",
  "#f2eee4",
  "#e8eef4",
  "#f3e9e7",
  "#ece8f3",
  "#e6f0ee",
  "#f1ece5",
  "#e9edf4",
];

async function responseError(response: Response, fallback: string) {
  const body = await response.text();
  try {
    return (JSON.parse(body) as { detail?: string }).detail || fallback;
  } catch {
    return body || fallback;
  }
}

function getSourceSegments(text: string, chunks: GeneratedChunk[]): SourceSegment[] {
  if (!chunks.length) return [{ start: 0, end: text.length, chunkIndexes: [] }];
  const boundaries = new Set([0, text.length]);
  const starts = new Map<number, number[]>();
  const ends = new Map<number, number[]>();
  chunks.forEach((chunk) => {
    boundaries.add(chunk.start_utf16);
    boundaries.add(chunk.end_utf16);
    starts.set(chunk.start_utf16, [...(starts.get(chunk.start_utf16) ?? []), chunk.index]);
    ends.set(chunk.end_utf16, [...(ends.get(chunk.end_utf16) ?? []), chunk.index]);
  });
  const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);
  const active = new Set<number>();
  return sortedBoundaries.slice(0, -1).map((start, index) => {
    const end = sortedBoundaries[index + 1];
    ends.get(start)?.forEach((chunkIndex) => active.delete(chunkIndex));
    starts.get(start)?.forEach((chunkIndex) => active.add(chunkIndex));
    return { start, end, chunkIndexes: Array.from(active) };
  });
}

export default function ChunkingPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceViewer = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<UploadedDocument | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("fixed_overlap");
  const [chunkSize, setChunkSize] = useState(800);
  const [chunkOverlap, setChunkOverlap] = useState(120);
  const [chunks, setChunks] = useState<GeneratedChunk[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<number | null>(null);
  const [expandedChunks, setExpandedChunks] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const sourceSegments = useMemo(
    () => document ? getSourceSegments(document.text, chunks) : [],
    [document, chunks],
  );
  const totalCharacters = chunks.reduce((total, chunk) => total + chunk.characters, 0);
  const averageChunkSize = chunks.length ? Math.round(totalCharacters / chunks.length) : 0;
  const chunkSizes = chunks.map((chunk) => chunk.characters);
  const minimumChunkSize = chunkSizes.reduce(
    (minimum, size) => Math.min(minimum, size),
    Number.POSITIVE_INFINITY,
  );
  const maximumChunkSize = chunkSizes.reduce(
    (maximum, size) => Math.max(maximum, size),
    0,
  );

  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    setChunks([]);
    setSelectedChunk(null);

    const formData = new FormData();
    formData.append("file", file);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/chunking/document`,
        { method: "POST", body: formData },
      );
      if (!response.ok) throw new Error(await responseError(response, "Could not read this document"));
      setDocument(await response.json() as UploadedDocument);
      setChunks([]);
      setSelectedChunk(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Could not read this document");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function generateChunks() {
    if (!document || busy) return;
    setError("");
    setBusy(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/chunking/chunks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: document.text,
            strategy,
            chunk_size: chunkSize,
            chunk_overlap: chunkOverlap,
          }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response, "Could not generate chunks"));
      const result = await response.json() as ChunkResponse;
      setChunks(result.chunks);
      setSelectedChunk(result.chunks.length ? 0 : null);
      setExpandedChunks(new Set());
    } catch (chunkError) {
      setError(chunkError instanceof Error ? chunkError.message : "Could not generate chunks");
    } finally {
      setBusy(false);
    }
  }

  function selectChunk(chunk: GeneratedChunk) {
    setSelectedChunk(chunk.index);
    const sourceElement = sourceViewer.current?.querySelector(
      `[data-source-offset="${chunk.start_utf16}"]`,
    );
    sourceElement?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function toggleExpanded(index: number) {
    setExpandedChunks((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const overlapApplies = strategy === "fixed_overlap" || strategy === "recursive";

  return (
    <main className="app-shell">
      <Header active="chunking" />
      <section className="chunking-page">
        <div className="chunking-heading">
          <div>
            <p className="eyebrow">DOCUMENT TOOLS</p>
            <h1>Chunking Visualizer</h1>
            <p>See how chunking choices shape the passages used in retrieval.</p>
          </div>
          <label className="chunking-upload">
            <input
              ref={fileInput}
              type="file"
              accept=".pdf,application/pdf"
              onChange={uploadDocument}
              disabled={uploading}
            />
            <span aria-hidden="true">＋</span>
            {uploading ? "Reading document…" : document ? "Replace document" : "Upload a document"}
          </label>
        </div>

        <div className="chunking-controls">
          <label>
            <span>Strategy</span>
            <select value={strategy} onChange={(event) => setStrategy(event.target.value as Strategy)}>
              {strategies.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Chunk size <small>characters</small></span>
            <input
              type="number"
              min={50}
              max={10000}
              value={chunkSize}
              onChange={(event) => setChunkSize(Number(event.target.value))}
            />
          </label>
          {overlapApplies && (
            <label>
              <span>Overlap <small>characters</small></span>
              <input
                type="number"
                min={0}
                max={Math.max(0, chunkSize - 1)}
                value={chunkOverlap}
                onChange={(event) => setChunkOverlap(Number(event.target.value))}
              />
            </label>
          )}
          <button
            className="chunking-generate"
            type="button"
            onClick={generateChunks}
            disabled={
              !document
              || busy
              || uploading
              || chunkSize < 50
              || chunkSize > 10000
              || chunkOverlap < 0
              || (overlapApplies && chunkOverlap >= chunkSize)
            }
          >
            {busy ? "Generating…" : "Generate chunks"}
          </button>
        </div>

        {error && <p className="chunking-error" role="alert">{error}</p>}

        <div className="chunking-stats" aria-label="Chunk summary">
          <div><span>Total chunks</span><strong>{chunks.length}</strong></div>
          <div><span>Document characters</span><strong>{document?.character_count.toLocaleString() ?? "—"}</strong></div>
          <div><span>Average size</span><strong>{chunks.length ? `${averageChunkSize.toLocaleString()} chars` : "—"}</strong></div>
          <div><span>Size range</span><strong>{chunks.length ? `${minimumChunkSize.toLocaleString()}–${maximumChunkSize.toLocaleString()}` : "—"}</strong></div>
        </div>

        <div className="chunking-workspace">
          <section className="chunking-panel chunking-source-panel">
            <div className="chunking-panel-header">
              <div>
                <p className="eyebrow">SOURCE</p>
                <h2>{document?.filename ?? "Original document"}</h2>
              </div>
              {document && <span>{document.character_count.toLocaleString()} characters</span>}
            </div>
            <div ref={sourceViewer} className="chunking-source" tabIndex={0}>
              {document
                ? sourceSegments.map((segment) => {
                  const visibleChunks = selectedChunk !== null
                    && segment.chunkIndexes.includes(selectedChunk)
                    ? [selectedChunk]
                    : segment.chunkIndexes.slice(0, 2);
                  const colors = visibleChunks.map((index) => chunkColors[index % chunkColors.length]);
                  const highlightStyle = colors.length > 1
                    ? { backgroundImage: `linear-gradient(90deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)` }
                    : colors.length === 1
                      ? { backgroundColor: colors[0] }
                      : undefined;
                  return (
                    <span
                      key={`${segment.start}-${segment.end}`}
                      data-source-offset={segment.start}
                      className={colors.length ? "chunking-source-highlight" : undefined}
                      style={highlightStyle}
                    >
                      {document.text.slice(segment.start, segment.end)}
                    </span>
                  );
                })
                : <p className="chunking-empty">Upload a PDF to inspect its text.</p>}
            </div>
          </section>

          <section className="chunking-panel chunking-list-panel">
            <div className="chunking-panel-header">
              <div>
                <p className="eyebrow">OUTPUT</p>
                <h2>Generated chunks</h2>
              </div>
              {chunks.length > 0 && <span>{chunks.length} passages</span>}
            </div>
            <div className="chunking-list">
              {chunks.length
                ? chunks.map((chunk) => {
                  const expanded = expandedChunks.has(chunk.index);
                  const selected = selectedChunk === chunk.index;
                  return (
                    <article
                      key={chunk.index}
                      className={`chunking-card${selected ? " selected" : ""}`}
                      style={{ borderLeftColor: chunkColors[chunk.index % chunkColors.length] }}
                    >
                      <button
                        className="chunking-card-select"
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectChunk(chunk)}
                      >
                        <span className="chunking-card-topline">
                          <strong>Chunk {String(chunk.index + 1).padStart(2, "0")}</strong>
                          <span>{chunk.characters.toLocaleString()} chars · {chunk.token_count.toLocaleString()} est. tokens</span>
                        </span>
                        <span className={`chunking-preview${expanded ? " expanded" : ""}`}>
                          {chunk.text}
                        </span>
                      </button>
                      <button
                        className="chunking-expand"
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => toggleExpanded(chunk.index)}
                      >
                        {expanded ? "Show less" : "Read full chunk"}
                      </button>
                    </article>
                  );
                })
                : <p className="chunking-empty">
                  {document
                    ? "Choose a strategy and generate chunks to compare the result."
                    : "Chunks will appear here after you upload a PDF."}
                </p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
