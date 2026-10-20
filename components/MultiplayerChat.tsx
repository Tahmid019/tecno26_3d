"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, X, Send } from "lucide-react";
import type { Room } from "@colyseus/sdk";

type ChatMessage = {
  sessionId: string;
  name: string;
  message: string;
  timestamp: number;
};

const colors = [
  "#60a5fa", "#f472b6", "#a78bfa", "#34d399",
  "#fbbf24", "#fb7185", "#22d3ee", "#c084fc",
];

function nameColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

export default function MultiplayerChat({ room }: { room: Room }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (chatRef.current && !chatRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    const remove = room.onMessage("chat", (data: ChatMessage) => {
      setMessages((prev) => [...prev, data].slice(-100));
    });
    return () => remove();
  }, [room]);

  useEffect(() => {
    if (open) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function sendMessage(e: FormEvent) {
    e.preventDefault();
    const message = text.trim().slice(0, 300);
    if (!message) return;
    room.send("chat", { message });
    setText("");
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle chat"
        className={`fixed bottom-24 right-4 z-[60] flex h-11 w-11 items-center justify-center rounded-full border  bg-[#24272c]/10 text-white shadow-lg backdrop-blur-md transition hover:bg-[#34383e]/50 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 ${
          open ? "pointer-events-none translate-x-5 opacity-0" : ""
        }`}
      >
        <MessageCircle size={20} />
        
      </button>

      <section
        aria-label="Chat"
        ref={chatRef}
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-[55] flex h-[100dvh] w-full flex-col overflow-hidden border border-white/10 bg-[#191b1f]/15 text-sm text-gray-200 shadow-2xl backdrop-blur-sm transition-transform duration-200 sm:right-4 sm:top-1/2 sm:h-[min(460px,75vh)] sm:w-[320px] sm:-translate-y-1/2 sm:rounded-lg ${
          open ? "translate-x-0" : "translate-x-[110%] pointer-events-none"
        }`}
      >

        <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {messages.map((m, i) => (
            <p
              key={`${m.sessionId}-${m.timestamp}-${i}`}
              className="break-words leading-relaxed"
            >
              <span
                className="font-medium"
                style={{ color: nameColor(m.sessionId || m.name || "Guest") }}
              >
                {m.name || "Guest"}:
              </span>{" "}
              <span className="text-gray-300">{m.message}</span>
            </p>
          ))}
          <div ref={bottom} />
        </div>

        <form
          onSubmit={sendMessage}
          className="shrink-0 border-white/10 p-2"
        >
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#25272b]/10 px-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              placeholder="Write a message..."
              aria-label="Write a message"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-gray-200 outline-none placeholder:text-gray-500"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              aria-label="Send message"
              className="text-gray-400 transition hover:text-white disabled:opacity-30"
            >
              <Send size={17} />
            </button>
          </div>
        </form>
      </section>
    </>
  );
}