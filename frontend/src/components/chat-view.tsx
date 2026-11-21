"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

type ChatSummary = {
  chatid: string;
  title: string;
};

type ChatResponse = {
  chatid: string;
  answer: string;
  sources: Source[];
};

const backendUrl = () =>
  (process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

async function getErrorMessage(response: Response, fallback: string) {
  const body = await response.text();
  try {
    return (JSON.parse(body) as { detail?: string }).detail || fallback;
  } catch {
    return body || fallback;
  }
}

export default function ChatView({ chatid }: { chatid?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [query, setQuery] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const roleSelect = useRef<HTMLSelectElement>(null);
  const safetyToggle = useRef<HTMLInputElement>(null);

  const loadChats = useCallback(() => {
    fetch(`${backendUrl()}/chats`)
      .then((response) => (response.ok ? response.json() : { chats: [] }))
      .then((data: { chats: ChatSummary[] }) => setChats(data.chats))
      .catch(() => {
        // Sidebar simply stays empty when the list cannot be loaded.
      });
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // ChatView is remounted per chat (key={chatid}), so state starts empty here.
  useEffect(() => {
    if (!chatid) return;
    let cancelled = false;
    fetch(`${backendUrl()}/chats/${chatid}/messages`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await getErrorMessage(response, "Could not load this chat"));
        const data = (await response.json()) as { messages: Message[] };
        if (!cancelled) setMessages(data.messages);
      })
      .catch((error: unknown) => {
        if (!cancelled) setChatError(error instanceof Error ? error.message : "Could not load this chat");
      });
    return () => {
      cancelled = true;
    };
  }, [chatid]);

  useEffect(() => {
    const savedRole = localStorage.getItem("userRole");
    if (
      savedRole === "default" ||
      savedRole === "student" ||
      savedRole === "faculty" ||
      savedRole === "admin"
    ) {
      if (roleSelect.current) roleSelect.current.value = savedRole;
    }
    if (safetyToggle.current) {
      safetyToggle.current.checked = localStorage.getItem("safetyChecks") === "on";
    }
  }, []);

  function renameChat(chat: ChatSummary) {
    const title = window.prompt("Rename chat", chat.title)?.trim();
    if (!title) return;
    fetch(`${backendUrl()}/chats/${chat.chatid}?${new URLSearchParams({ title })}`, {
      method: "PATCH",
    })
      .then((response) => (response.ok ? loadChats() : undefined))
      .catch(() => {});
  }

  function deleteChat(chat: ChatSummary) {
    if (!window.confirm(`Delete "${chat.title || "Untitled chat"}" and all its messages?`)) return;
    fetch(`${backendUrl()}/chats/${chat.chatid}`, { method: "DELETE" })
      .then((response) => {
        if (!response.ok) return;
        if (chat.chatid === chatid) router.push("/chat");
        else loadChats();
      })
      .catch(() => {});
  }

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
      if (safetyToggle.current?.checked) params.set("safety", "true");
      const response = await fetch(`${backendUrl()}/chat-response?${params}`, {
        method: "POST",
        headers: { "X-User-Role": roleSelect.current?.value ?? "default" },
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, "Could not get a response"));
      }
      const data: ChatResponse = await response.json();

      if (chatid) {
        setMessages((current) => [
          ...current,
          { role: "assistant", text: data.answer, sources: data.sources },
        ]);
        loadChats();
      } else {
        router.replace(`/chat/${data.chatid}`);
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Could not reach the chat service");
    } finally {
      setChatBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <Header active="chat" onNewChat={() => router.push("/chat")} chatBusy={chatBusy} />

      <div className="workspace chat-workspace">
        {sidebarOpen && (
          <div
            className="chat-sidebar-backdrop"
            aria-hidden="true"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside className={`chat-sidebar${sidebarOpen ? " open" : ""}`} aria-label="Your chats">
          <Link className="chat-sidebar-new" href="/chat" onClick={() => setSidebarOpen(false)}>
            <span aria-hidden="true">＋</span> New chat
          </Link>
          <nav className="chat-list">
            {chats.length === 0 && <p className="chat-list-empty">No chats yet</p>}
            {chats.map((chat) => (
              <div className="chat-list-row" key={chat.chatid}>
                <Link
                  href={`/chat/${chat.chatid}`}
                  className={`chat-list-item${chat.chatid === chatid ? " active" : ""}`}
                  aria-current={chat.chatid === chatid ? "page" : undefined}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className="chat-list-title">{chat.title || "Untitled chat"}</span>
                </Link>
                <button
                  type="button"
                  className="chat-action"
                  aria-label={`Rename ${chat.title || "chat"}`}
                  title="Rename chat"
                  onClick={() => renameChat(chat)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="chat-action"
                  aria-label={`Delete ${chat.title || "chat"}`}
                  title="Delete chat"
                  onClick={() => deleteChat(chat)}
                >
                  🗑
                </button>
              </div>
            ))}
          </nav>
        </aside>

        <section className="chat-panel" aria-label="Legal research chat">
          <button
            type="button"
            className="chat-menu-button"
            aria-label="Toggle chat history"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            ☰
          </button>
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
            <label className="role-picker">
              <span>Chat as</span>
              <select
                ref={roleSelect}
                defaultValue="default"
                onChange={(event) => {
                  localStorage.setItem("userRole", event.target.value);
                }}
              >
                <option value="default">Default (all documents)</option>
                <option value="student">Student</option>
                <option value="faculty">Faculty</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label className="safety-toggle" title="Enable query and response safety checks">
              <input
                type="checkbox"
                ref={safetyToggle}
                onChange={(event) => {
                  localStorage.setItem("safetyChecks", event.target.checked ? "on" : "off");
                }}
              />
              <span>Safety checks</span>
            </label>
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
