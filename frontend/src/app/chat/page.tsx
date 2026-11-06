"use client";

import { FormEvent, useState } from "react";
import Header from "@/components/header";

type Source = {
  chunk_id: string;
  case_title: string;
  paragraph_number: number | null;
  text: string;
};

type Message = {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
};

type ChatResponse = {
  chatid: string;
  answer: string;
  sources: Source[];
};

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.text();
  try {
    return (JSON.parse(body) as { detail?: string }).detail || fallback;
  } catch {
    return body || fallback;
  }
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatid, setChatid] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = query.trim();
    if (!text || chatBusy) return;

    setQuery("");
    setChatError("");
    setMessages((current) => [...current, { role: "user", text }]);
    setChatBusy(true);

    try {
      const params = new URLSearchParams({ query: text });
      if (chatid) params.set("chatid", chatid);
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";
      const response = await fetch(
        `${backendUrl.replace(/\/$/, "")}/chat-response?${params}`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not get a response"));
      }
      const data: ChatResponse = await response.json();

      setChatid(data.chatid);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: data.answer, sources: data.sources },
      ]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not reach the chat service");
    } finally {
      setChatBusy(false);
    }
  }

  function newChat() {
    setMessages([]);
    setChatid(null);
    setChatError("");
  }

  return (
    <main className="app-shell">
      <Header active="chat" onNewChat={newChat} chatBusy={chatBusy} />

      <div className="workspace chat-workspace">
        <section className="chat-panel" aria-label="Legal research chat">
          <div className="conversation">
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-icon" aria-hidden="true">§</div>
                <p className="eyebrow">LEGAL RESEARCH</p>
                <h1>What would you like to understand?</h1>
                <p>Ask a question about your judgments. Answers include the source passages used.</p>
              </div>
            ) : (
              messages.map((message, index) => (
                <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
                  <div className="message-label">{message.role === "user" ? "You" : "Casebook"}</div>
                  <p className="message-text">{message.text}</p>
                  {message.sources && message.sources.length > 0 && (
                    <details className="sources">
                      <summary>Sources · {message.sources.length}</summary>
                      <div className="source-list">
                        {message.sources.map((source) => (
                          <article className="source" key={source.chunk_id}>
                            <strong>{source.case_title}</strong>
                            <span>
                              {source.paragraph_number
                                ? `Paragraph ${source.paragraph_number}`
                                : "Case excerpt"}{" "}
                              · {source.chunk_id}
                            </span>
                            <p>{source.text}</p>
                          </article>
                        ))}
                      </div>
                    </details>
                  )}
                </article>
              ))
            )}
            {chatBusy && <p className="thinking" role="status">Searching your cases…</p>}
            {chatError && <p className="error-message" role="alert">{chatError}</p>}
          </div>

          <form className="composer" onSubmit={sendMessage}>
            <label className="sr-only" htmlFor="query">Ask a question</label>
            <textarea
              id="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="Ask a question about your cases…"
              rows={2}
            />
            <div className="composer-footer">
              <span>Enter to send · Shift + Enter for a new line</span>
              <button type="submit" disabled={chatBusy || !query.trim()} aria-label="Send question">
                {chatBusy ? "…" : "↑"}
              </button>
            </div>
          </form>
          <p className="disclaimer">Review cited sources before relying on an answer.</p>
        </section>
      </div>
    </main>
  );
}
