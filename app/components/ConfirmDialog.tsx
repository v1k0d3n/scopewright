"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  /** When set, the confirm button stays disabled until this exact word is typed. */
  typeToConfirm?: string;
  /** An extra, non-closing action shown beside Cancel, such as exporting a backup first. */
  aside?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A destructive action, asked about once, in words. Escape or a click outside cancels. */
export function ConfirmDialog({ title, children, confirmLabel, typeToConfirm, aside, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // Start on the safe choice: the typed word when one is asked for, otherwise Cancel.
  useEffect(() => { (field.current ?? cancel.current)?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onCancel]);
  const ready = !typeToConfirm || typed.trim() === typeToConfirm;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form className="modal confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onSubmit={(event) => { event.preventDefault(); if (ready) onConfirm(); }}>
        <h2 id="confirm-title">{title}</h2>
        {children}
        {typeToConfirm && (
          <label>Type {typeToConfirm} to confirm
            <input ref={field} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        )}
        <div className="modal-actions">
          {aside}
          <button ref={cancel} type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="destructive" disabled={!ready}>{confirmLabel}</button>
        </div>
      </form>
    </div>
  );
}
