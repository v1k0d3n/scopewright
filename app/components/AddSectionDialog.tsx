"use client";

import { useEffect, useRef } from "react";
import { useDialogFocus } from "../lib/useDialogFocus";
import type { SectionTemplate } from "../lib/types";

type Props = { templates: SectionTemplate[]; onPick: (template: SectionTemplate | null) => void; onCancel: () => void };

/** Start a custom section blank or from one of the catalog's templates, grouped by category. */
export function AddSectionDialog({ templates, onPick, onCancel }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialog);
  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onCancel]);
  // Categories in the order the catalog first uses them; templates keep their catalog order inside each.
  const categories = [...new Set(templates.map((template) => template.category.trim() || "Other"))];
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div ref={dialog} className="modal add-section" role="dialog" aria-modal="true" aria-labelledby="add-section-title">
        <h2 id="add-section-title">Add a section</h2>
        <p className="modal-note">A template is copied into this estimate, so later changes to the catalog never change it unless you choose to update it.</p>
        <button ref={first} type="button" className="section-pick" onClick={() => onPick(null)}><b>Blank section</b><small>Write your own text and tables.</small></button>
        {categories.map((category) => (
          <section key={category}>
            <h3>{category}</h3>
            {templates.filter((template) => (template.category.trim() || "Other") === category).map((template) => (
              <button key={template.id} type="button" className="section-pick" onClick={() => onPick(template)}>
                <b>{template.title || "Untitled section"}{template.locked && <em>Locked</em>}</b>
                {template.description && <small>{template.description}</small>}
              </button>
            ))}
          </section>
        ))}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  );
}
