// components/ProfileChat.tsx
import { useEffect, useMemo, useRef, useState } from "react";

type Msg = { role: "system" | "user" | "assistant"; content: string; id: string };

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const SYSTEM_PROMPT = `Ты — умный ассистент внутри профиля пользователя.
Отвечай кратко и по делу. Можешь помогать с интерпретациями натальной карты,
влиянием планет, архетипами Таро, а также подсказывать по дApp (Solana/Anchor).
Избегай медицинских и финансовых советов.`;

export default function ProfileChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // грузим/сохраняем историю в localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("profile_chat");
      if (saved) setMessages(JSON.parse(saved));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("profile_chat", JSON.stringify(messages));
    } catch {}
  }, [messages]);

  // системка всегда первая
  const wireMessages = useMemo(() => {
    const sys: Msg = { id: "sys", role: "system", content: SYSTEM_PROMPT };
    return [sys, ...messages.map(({ role, content }) => ({ role, content }))];
  }, [messages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Msg = { id: uuid(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: wireMessages.concat({ role: "user", content: text }) }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Chat error");
      const assistantContent = data?.message?.content || "…";
      const botMsg: Msg = { id: uuid(), role: "assistant", content: assistantContent };
      setMessages((prev) => [...prev, botMsg]);
    } catch (e: any) {
      const errMsg: Msg = {
        id: uuid(),
        role: "assistant",
        content: `⚠️ Ошибка: ${e.message || "неизвестно"}`,
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function clearChat() {
    setMessages([]);
    try { localStorage.removeItem("profile_chat"); } catch {}
  }

  return (
    <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Чат ассистента (GPT)</h3>
        <button
          onClick={clearChat}
          className="rounded-lg border border-neutral-700 px-3 py-1 text-sm hover:bg-neutral-800"
        >
          Очистить
        </button>
      </div>

      <div
        ref={listRef}
        className="max-h-[380px] overflow-y-auto rounded-xl border border-neutral-800 bg-black/20 p-3"
      >
        {messages.length === 0 && (
          <div className="select-none rounded-lg border border-dashed border-neutral-700 p-4 text-center text-sm opacity-70">
            Начни диалог — спроси про твою карту, архетипы или что угодно по профилю.
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "bg-indigo-600 text-white"
                  : "bg-neutral-800 text-neutral-100"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="mt-2 text-center text-xs opacity-70">Мыслю…</div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Напиши сообщение… (Enter — отправить, Shift+Enter — перенос)"
          className="h-20 w-full resize-none rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="h-20 min-w-[120px] self-end rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Отправить
        </button>
      </div>
    </section>
  );
}
