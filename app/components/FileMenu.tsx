"use client";

import { useEffect, useRef, useState } from "react";

export type FileAction = { label: string; hint?: string; disabled?: boolean; run: () => void };

/** The estimate builder's one menu for everything that happens to the estimate as a file. */
export function FileMenu({ actions, status }: { actions: FileAction[]; status: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div className="file-menu" ref={root}>
      <button type="button" className="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Estimate <span aria-hidden="true">▾</span>{status && <em>{status}</em>}</button>
      {open && (
        <div className="file-menu-list" role="menu">
          {actions.map((action) => (
            <button key={action.label} type="button" role="menuitem" disabled={action.disabled} onClick={() => { setOpen(false); action.run(); }}><b>{action.label}</b>{action.hint && <span>{action.hint}</span>}</button>
          ))}
        </div>
      )}
    </div>
  );
}
