"use client";

import Link from "next/link";

type HeaderProps = {
  active: "chat" | "upload";
  onNewChat?: () => void;
  chatBusy?: boolean;
};

export default function Header({ active, onNewChat, chatBusy }: HeaderProps) {
  return (
    <header className="topbar">
      <Link className="brand" href="/chat" aria-label="Casebook home">
        <span className="brand-mark">§</span>
        <span>Casebook</span>
      </Link>
      <nav className="topbar-actions" aria-label="Main navigation">
        <Link className={`nav-link${active === "chat" ? " active" : ""}`} href="/chat">
          Chat
        </Link>
        <Link className={`nav-link${active === "upload" ? " active" : ""}`} href="/upload">
          Upload PDF
        </Link>
        {onNewChat && (
          <button className="new-chat" type="button" onClick={onNewChat} disabled={chatBusy}>
            <span aria-hidden="true">＋</span> New chat
          </button>
        )}
      </nav>
    </header>
  );
}
