"use client";

import { useState } from "react";
import Link from "next/link";

type HeaderProps = {
  active: "chat" | "upload" | "library" | "research" | "pipeline" | "chunking" | "embeddings";
  onNewChat?: () => void;
  chatBusy?: boolean;
};

export default function Header({ active, onNewChat, chatBusy }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const links: { id: HeaderProps["active"]; href: string; label: string }[] = [
    { id: "chat", href: "/chat", label: "Chat" },
    { id: "upload", href: "/upload", label: "Upload PDF" },
    { id: "library", href: "/documents", label: "Document library" },
    { id: "research", href: "/research", label: "Research Lab" },
    { id: "pipeline", href: "/pipeline", label: "Pipeline Explorer" },
    { id: "chunking", href: "/chunking", label: "Chunking Visualizer" },
    { id: "embeddings", href: "/embeddings", label: "Embedding Simulator" },
  ];

  return (
    <header className="topbar">
      <Link className="brand" href="/chat" aria-label="Casebook home">
        <span className="brand-mark">§</span>
        <span className="brand-copy">
          <strong>Casebook</strong>
          <small>Legal research workspace</small>
        </span>
      </Link>
      <div className="topbar-controls" onKeyDown={(event) => {
        if (event.key === "Escape") setMenuOpen(false);
      }}>
        {onNewChat && (
          <button className="new-chat" type="button" onClick={onNewChat} disabled={chatBusy}>
            <span aria-hidden="true">＋</span><span>New chat</span>
          </button>
        )}
        <button
          className={`menu-toggle${menuOpen ? " open" : ""}`}
          type="button"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="hamburger" aria-hidden="true"><i /><i /><i /></span>
          <span>Explore</span>
        </button>
        <nav
          className={`topbar-navigation${menuOpen ? " open" : ""}`}
          id="primary-navigation"
          aria-label="Main navigation"
          hidden={!menuOpen}
        >
          <p className="navigation-heading">Workspace</p>
          <div className="navigation-links">
            {links.map((link) => (
              <Link
                key={link.id}
                className={`nav-link${active === link.id ? " active" : ""}`}
                href={link.href}
                aria-current={active === link.id ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
              >
                <span>{link.label}</span>
                {active === link.id && <span className="navigation-current">Current</span>}
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}
