
"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { Room } from "@colyseus/sdk";

type ChatMessage = {
  sessionId: string;
  name: string;
  message: string;
  timestamp: number;
};

export default function MultiplayerChat({
  room,
  name,
}: {
  room: Room;
  name: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");

  useEffect(() => {
    const handler = (data: ChatMessage) => {
      setMessages((prev) => [...prev, data].slice(-100));
    };

    const removeListener = room.onMessage("chat", handler);
    return () => removeListener();
  }, [room]);

  function sendMessage(e: FormEvent) {
    e.preventDefault();
    const message = text.trim().slice(0, 300);
    if (!message) return;

    room.send("chat", { name, message });
    setText("");
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-80 w-80 flex-col rounded-xl border bg-background p-3 shadow-xl">
      <h2 className="mb-2 font-semibold">Campus Chat</h2>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {messages.map((m, i) => (
          <div key={`${m.timestamp}-${i}`} className="text-sm">
            <span className="font-semibold">{m.name}: </span>
            {m.message}
          </div>
        ))}
      </div>
      <form onSubmit={sendMessage} className="mt-3 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="Type a message..."
          className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-2 text-sm"
        />
        <button className="rounded-md bg-primary px-3 text-primary-foreground">
          Send
        </button>
      </form>
    </div>
  );
}
