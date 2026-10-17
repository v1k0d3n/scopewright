"use client";

import { TO_BE_DECIDED } from "../lib/estimate";
import type { CatalogChanges } from "../lib/estimate";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = { name: string; changes: CatalogChanges; onReview: (step: number) => void; onClose: () => void };

/** Shown when an opened or imported estimate no longer matches the catalog: what changed, by section, and where to fix it. */
export function CatalogChangesDialog({ name, changes, onReview, onClose }: Props) {
  const sections = [
    { heading: "Installation details · choose a new answer", items: changes.unanswered.map(({ product, field }) => `${product.short}: ${field.label}`) },
    { heading: "Products · no longer in the catalog, left out", items: changes.removedProducts },
    { heading: "Deliverables · no longer offered, kept", items: changes.retiredTasks.map(({ group, task }) => `${group.name}: ${task.name}`) },
  ].filter((section) => section.items.length);
  const installation = changes.unanswered.length > 0;
  return (
    <ConfirmDialog title="This estimate needs attention" tone="primary" cancelLabel="Not now" confirmLabel={installation ? "Review installation details" : "Review products"} onConfirm={() => onReview(installation ? 3 : 2)} onCancel={onClose}>
      <p className="modal-note">The Estimate Catalog has changed since “{name}” was saved. To bring its scope document in line with the current catalog, review these sections:</p>
      <div className="confirm-list">
        {sections.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading} ({section.items.length})</h3>
            <ul>{section.items.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </section>
        ))}
      </div>
      <p className="modal-note">{installation && `Until you choose, the scope document shows “${TO_BE_DECIDED}” for these answers. `}The saved file is unchanged until you save.</p>
    </ConfirmDialog>
  );
}
