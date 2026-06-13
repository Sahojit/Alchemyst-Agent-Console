"use client";

import { useState } from "react";

export function Composer({
  onSend,
  hint,
}: {
  onSend: (content: string) => void;
  hint: string | null;
}) {
  const [value, setValue] = useState("");

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed === "") return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="border-t border-zinc-800 bg-zinc-950 p-3">
      {hint !== null && (
        <div className="mb-2 text-xs text-amber-400">{hint}</div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
          className="min-h-[3rem] flex-1 resize-none rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-sky-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={submit}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          disabled={value.trim() === ""}
        >
          Send
        </button>
      </div>
    </div>
  );
}
