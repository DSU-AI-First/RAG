"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Header from "@/components/header";

type DocumentItem = {
  document_id: string;
  filename: string;
  roles: string[];
  uploaded_at: string | null;
  status: string;
  chunk_count: number | null;
};

type UserRole = "default" | "student" | "faculty" | "admin";

const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000")
  .replace(/\/$/, "");

function getUserRole(): UserRole {
  const savedRole = localStorage.getItem("userRole");
  return savedRole === "student" || savedRole === "faculty" || savedRole === "admin"
    ? savedRole
    : "default";
}

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function requestDocuments(userRole: UserRole) {
  const response = await fetch(`${backendUrl}/documents`, {
    headers: { "X-User-Role": userRole },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body || "Could not load documents";
    try {
      message = (JSON.parse(body) as { detail?: string }).detail || message;
    } catch {
      // Keep the response text when the server does not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<{ documents: DocumentItem[] }>;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDocuments = useCallback(async (userRole: UserRole, refreshing = true) => {
    if (refreshing) setLoading(true);
    try {
      const result = await requestDocuments(userRole);
      setDocuments(result.documents);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestDocuments(getUserRole())
      .then((result) => {
        if (!cancelled) setDocuments(result.documents);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "Could not load documents");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openDocument(documentId: string) {
    const pdfUrl = new URL(`/documents/${encodeURIComponent(documentId)}/pdf`, backendUrl);
    pdfUrl.searchParams.set("role", getUserRole());
    window.open(pdfUrl.toString(), "_blank", "noopener,noreferrer");
  }

  return (
    <main className="app-shell">
      <Header active="library" />
      <section className="documents-page">
        <header className="documents-heading">
          <div>
            <p className="eyebrow">YOUR LIBRARY</p>
            <h1>Document library</h1>
            <p>Browse uploaded judgments and open the original PDF.</p>
          </div>
          <div className="documents-actions">
            <button
              className="documents-refresh"
              type="button"
              onClick={() => void loadDocuments(getUserRole())}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link className="documents-upload" href="/upload">＋ Upload PDF</Link>
          </div>
        </header>

        {error && <p className="documents-error" role="alert">{error}</p>}

        <section className="documents-list" aria-label="Uploaded documents" aria-busy={loading}>
          {loading && documents.length === 0 ? (
            <p className="documents-empty">Loading documents…</p>
          ) : documents.length ? (
            documents.map((document) => {
              return (
                <article className="document-card" key={document.document_id}>
                  <div className="document-icon" aria-hidden="true">PDF</div>
                  <div className="document-details">
                    <h2>{document.filename}</h2>
                    <p className="document-uploaded">{formatDate(document.uploaded_at)}</p>
                    <div className="document-meta">
                      <span className={`document-status status-${document.status.toLowerCase()}`}>
                        {document.status.replaceAll("_", " ")}
                      </span>
                      {document.chunk_count !== null && (
                        <span>{document.chunk_count} chunks</span>
                      )}
                      <span>{document.roles.join(", ")}</span>
                    </div>
                  </div>
                  <button
                    className="document-open"
                    type="button"
                    onClick={() => openDocument(document.document_id)}
                  >
                    Open PDF <span aria-hidden="true">↗</span>
                  </button>
                </article>
              );
            })
          ) : (
            <div className="documents-empty">
              <h2>{error ? "Documents couldn’t be loaded" : "No documents yet"}</h2>
              <p>{error ? "Check your connection and try refreshing." : "Upload a PDF to add it to your library."}</p>
              {!error && <Link href="/upload">Upload your first PDF</Link>}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
