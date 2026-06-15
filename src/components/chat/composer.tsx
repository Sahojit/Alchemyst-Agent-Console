"use client";

import { useRef, useState } from "react";

export function Composer({
  onSend,
  hint,
}: {
  onSend: (content: string) => void;
  hint: string | null;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  return (
    <div className="shrink-0 border-t border-zinc-800/80 bg-zinc-950 px-4 py-3">
      {hint !== null && (
        <div className="mb-2.5 flex items-center gap-2 rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-1.5 text-xs text-amber-300">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
            <path d="M6 1L11 10H1L6 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
            <path d="M6 5v2.5M6 9v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {hint}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1 overflow-hidden rounded-xl border border-zinc-700/60 bg-zinc-900 transition-colors focus-within:border-violet-500/60 focus-within:ring-1 focus-within:ring-violet-500/20">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
            className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            style={{ minHeight: "2.75rem", maxHeight: "10rem" }}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={value.trim() === ""}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-indigo-500 hover:shadow-violet-500/30 disabled:opacity-30 disabled:shadow-none"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M13.5 8L3 13.5L5.5 8L3 2.5L13.5 8Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="0.5"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-zinc-700">
        Shift+Enter for newline · /drop · /droptool · /error
      </p>
    </div>
  );
}
