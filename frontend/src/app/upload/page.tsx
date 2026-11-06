"use client";

import { FormEvent, useRef, useState } from "react";
import Header from "@/components/header";

type IngestResponse = {
  count: number;
  doc_id: string;
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
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function uploadPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file || busy) return;

    setMessage("");
    setError(false);
    if (file.size > 15 * 1024 * 1024) {
      setMessage("PDF must be 15 MB or smaller.");
      setError(true);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setBusy(true);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(`${backendUrl.replace(/\/$/, "")}/ingest`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) throw new Error(await getErrorMessage(response));
      const data: IngestResponse = await response.json();
      setMessage(`Added ${data.count} chunks · ${data.doc_id}`);
      if (fileInput.current) fileInput.current.value = "";
      setFileName("");
    } catch (uploadError) {
      setMessage(uploadError instanceof Error ? uploadError.message : "Could not reach the ingest service");
      setError(true);
    } finally {
      setBusy(false);
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
              <span>{fileName || "Choose a PDF"}</span>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
              />
            </label>
            <button className="upload-button" type="submit" disabled={busy || !fileName}>
              {busy ? "Indexing PDF…" : "Upload and index"}
            </button>
          </form>
          {message && (
            <p className={`upload-message${error ? " error" : ""}`} role="status">
              {message}
            </p>
          )}
          {busy && <p className="upload-note">This can take a few minutes for a large document.</p>}
        </div>
      </section>
    </main>
  );
}
