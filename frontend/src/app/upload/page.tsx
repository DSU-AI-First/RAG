"use client";

import { FormEvent, useRef, useState } from "react";
import Header from "@/components/header";

type IngestResponse = {
  jobs: {
    document_id: string;
    task_id: string;
    status: "QUEUED";
  }[];
};

type IngestionStatus = {
  document_id: string;
  task_id: string;
  status: "QUEUED" | "EXTRACTING_TEXT" | "CHUNKING" | "EMBEDDING_AND_UPSERTING" | "COMPLETED" | "FAILED";
  chunk_count: number | null;
  attempt_count: number;
  error: string | null;
};

async function getErrorMessage(response: Response) {
  const body = await response.text();
  try {
    return (JSON.parse(body) as { detail?: string }).detail || "Could not upload this PDF";
  } catch {
    return body || "Could not upload this PDF";
  }
}

export default function UploadPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [jobs, setJobs] = useState<IngestionStatus[]>([]);
  const [checkingStatus, setCheckingStatus] = useState(false);

  async function uploadPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length || busy) return;

    setMessage("");
    setError(false);
    setJobs([]);
    const oversized = files.find((file) => file.size > 15 * 1024 * 1024);
    if (oversized) {
      setMessage(`${oversized.name} exceeds the 15 MB limit.`);
      setError(true);
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    setBusy(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(`${backendUrl.replace(/\/$/, "")}/ingest`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const data: IngestResponse = await response.json();
      setJobs(data.jobs.map((job) => ({ ...job, chunk_count: null, attempt_count: 0, error: null })));
      setMessage(`${data.jobs.length} PDF(s) uploaded and queued (202 Accepted).`);
      if (fileInput.current) fileInput.current.value = "";
      setFiles([]);
    } catch (uploadError) {
      setMessage(uploadError instanceof Error ? uploadError.message : "Could not reach the ingest service");
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  async function checkStatuses() {
    if (!jobs.length || checkingStatus) return;
    setCheckingStatus(true);
    setError(false);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const updatedJobs = await Promise.all(jobs.map(async (job) => {
        const response = await fetch(
          `${backendUrl.replace(/\/$/, "")}/ingest/status/${encodeURIComponent(job.document_id)}`,
        );
        if (!response.ok) throw new Error(await getErrorMessage(response));
        return response.json() as Promise<IngestionStatus>;
      }));
      setJobs(updatedJobs);
    } catch (statusError) {
      setMessage(statusError instanceof Error ? statusError.message : "Could not check ingestion status");
      setError(true);
    } finally {
      setCheckingStatus(false);
    }
  }

  return (
    <main className="app-shell">
      <Header active="upload" />
      <section className="upload-page">
        <div className="upload-card">
          <p className="eyebrow">YOUR LIBRARY</p>
          <h1>Add a judgment</h1>
          <p>Upload a PDF to index it for your legal research chats.</p>
          <form onSubmit={uploadPdf}>
            <label className="file-picker">
              <span aria-hidden="true">＋</span>
              <span>{files.length ? `${files.length} PDF(s) selected` : "Choose PDF(s)"}</span>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            <button className="upload-button" type="submit" disabled={busy || !files.length}>
              {busy ? "Uploading PDFs…" : "Upload and index"}
            </button>
          </form>
          {message && (
            <p className={`upload-message${error ? " error" : ""}`} role="status">
              {message}
            </p>
          )}
          {busy && <p className="upload-note">This can take a few minutes for a large document.</p>}
          {jobs.length > 0 && (
            <div className="upload-job" aria-live="polite">
              {jobs.map((job) => (
                <p className={`upload-message${job.error ? " error" : ""}`} key={job.document_id}>
                  {job.document_id.slice(0, 8)} · {job.status.replaceAll("_", " ")}
                  {job.chunk_count !== null && ` · ${job.chunk_count} chunks`}
                  {job.error && ` · ${job.error}`}
                </p>
              ))}
              <button
                className="upload-button"
                type="button"
                onClick={checkStatuses}
                disabled={checkingStatus}
              >
                {checkingStatus ? "Checking…" : "Check statuses"}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
