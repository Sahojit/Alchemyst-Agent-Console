"use client";

import { useRef, useState } from "react";

export function Composer({ onSend, hint }: { onSend: (content: string) => void; hint: string | null }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const canSend = value.trim().length > 0;

  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-[#080809]/80 px-4 pb-4 pt-3 backdrop-blur-sm">
      {hint && (
        <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-amber-800/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-400">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
            <path d="M6 1.5L10.5 9.5H1.5L6 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M6 5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="6" cy="8.5" r="0.5" fill="currentColor" />
          </svg>
          {hint}
        </div>
      )}

      <div className={`flex items-end gap-2.5 rounded-2xl border bg-white/[0.03] p-2 transition-all duration-200 ${
        canSend
          ? "border-violet-500/40 shadow-lg shadow-violet-500/5"
          : "border-white/[0.07]"
      }`}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          placeholder="Message the agent…"
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          style={{ minHeight: "2.25rem", maxHeight: "11.25rem" }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
            canSend
              ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/25 hover:from-violet-500 hover:to-indigo-500"
              : "bg-zinc-800 text-zinc-600"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M12 7L2.5 12L5 7L2.5 2L12 7Z" fill="currentColor" stroke="currentColor" strokeWidth="0.4" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="mt-2 text-center text-[10px] text-zinc-700">
        Enter to send · Shift+Enter for newline · /drop · /droptool · /error
      </p>
    </div>
  );
}
