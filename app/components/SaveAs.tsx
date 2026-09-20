"use client";

import { useEffect, useRef, useState } from "react";
import type { Library } from "../lib/sources/useLibrary";

/**
 * Save as: where, and under what file name. Saving under a name that exists
 * replaces that file (after asking), the way saving a file does anywhere else.
 */
export function SaveAs({ library, suggested, onSave, onCancel, onManage }: { library: Library; suggested: string; onSave: (typedName: string) => Promise<string | null>; onCancel: () => void; onManage: () => void }) {
  const [name, setName] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const { provider, state } = library;
  const field = useRef<HTMLInputElement>(null);
  // Start where the typing happens. Once only: re-selecting on a later render would wipe what was typed.
  useEffect(() => { field.current?.select(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onCancel]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    const failed = await onSave(name);
    setBusy(false);
    if (failed) setProblem(failed);
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="save-as-title" onSubmit={submit}>
        <h2 id="save-as-title">Save estimate as</h2>
        <label>Save to
          <select value={provider.id} onChange={(event) => library.select(event.target.value)}>
            {library.offered.map((source) => <option key={source.id} value={source.id} disabled={Boolean(source.unavailable(library.context))}>{source.label}</option>)}
          </select>
        </label>
        <p className="modal-note">{state === "ready" ? provider.location() : state === "loading" ? "Checking…" : `Not connected yet. You will be asked to connect ${provider.label} when you save.`} <button type="button" className="link" onClick={onManage}>Manage save locations</button></p>
        <label>File name
          <input ref={field} value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} />
        </label>
        {problem && <p className="modal-problem" role="alert">{problem}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="primary" disabled={busy || state === "loading" || !name.trim()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
