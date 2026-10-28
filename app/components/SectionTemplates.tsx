"use client";

import { useState } from "react";
import { PLACEHOLDERS, removeFromCatalog } from "../lib/estimate";
import type { Catalog, SectionTemplate } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { SectionFields } from "./SectionFields";

type Props = { catalog: Catalog; setCatalog: (catalog: Catalog) => void };

const uid = () => `section-template-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const move = <T,>(items: T[], from: number, to: number) => { if (to < 0 || to >= items.length) return items; const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

/** What a template holds, for its collapsed card. */
const contents = (template: SectionTemplate) => {
  const tables = template.blocks.filter((block) => block.kind === "table").length;
  const texts = template.blocks.length - tables;
  return [texts && `${texts} text`, tables && `${tables} table${tables === 1 ? "" : "s"}`].filter(Boolean).join(", ") || "Nothing written yet";
};

/** The Section templates tab of the Estimate catalog: custom sections teams reuse across estimates. */
export function SectionTemplates({ catalog, setCatalog }: Props) {
  const [opened, setOpened] = useState("");
  const [deleting, setDeleting] = useState<SectionTemplate | null>(null);
  const templates = catalog.sectionTemplates ?? [];
  const setTemplates = (sectionTemplates: SectionTemplate[]) => setCatalog({ ...catalog, sectionTemplates });
  const update = (id: string, changes: Partial<SectionTemplate>) => setTemplates(templates.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  const add = () => { const id = uid(); setTemplates([...templates, { id, title: "", category: templates.at(-1)?.category ?? "", blocks: [{ kind: "text", text: "" }], enabled: true, locked: false }]); setOpened(id); };
  const categories = [...new Set(templates.map((template) => template.category.trim()).filter(Boolean))];
  return (
    <div className="content designer-content">
      <div className="title-row">
        <div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Section templates</h1><p>Sections teams use again and again, such as contacts, a responsibility matrix, or a schedule. Architects add them from the Sections list on the Scope documents page, grouped by category. Adding one copies it into the estimate, so a change here never alters an estimate that already uses it; they are offered the new version instead. Architects can edit the copy unless the template is locked. {PLACEHOLDERS.map((name) => `{${name}}`).join(" ")} are filled in from each estimate.</p></div>
        <button type="button" className="primary" onClick={add}>+ Add template</button>
      </div>
      <datalist id="section-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
      <div className="designer-list">
        {templates.length === 0 && <p className="panel-copy list-empty">No section templates yet. Architects can still write their own sections.</p>}
        {templates.map((template, index) => (
          <details key={template.id} open={template.id === opened || undefined}>
            <summary><i>{index + 1}</i><span><b>{template.title || "Untitled section"}</b><small>{[template.category || "No category", template.description || contents(template)].join(" · ")}</small></span><em className={template.enabled ? "" : "pending"}>{template.enabled ? "Offered" : "Not offered"}{template.locked ? " · Locked" : ""}</em></summary>
            <div className="designer-fields template-fields">
              <label>Category<input list="section-categories" placeholder="e.g. Proof of concept" value={template.category} onChange={(event) => update(template.id, { category: event.target.value })} /></label>
              <label className="span-2">When to use it<input placeholder="e.g. Named contacts on both sides, for every proof of concept" value={template.description ?? ""} onChange={(event) => update(template.id, { description: event.target.value })} /></label>
              <div className="wide"><SectionFields value={template} onChange={(value) => update(template.id, value)} /></div>
              <div className="row-actions wide">
                <label className="workflow-toggle"><input type="checkbox" checked={template.enabled} onChange={(event) => update(template.id, { enabled: event.target.checked })} /><span>Offer in workflow</span></label>
                <label className="workflow-toggle" title="Estimates that add this template use it exactly as written; architects cannot edit it."><input type="checkbox" checked={template.locked} onChange={(event) => update(template.id, { locked: event.target.checked })} /><span>Lock wording</span></label>
                <span className="order-label">Order in the list</span>
                <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => setTemplates(move(templates, index, index - 1))}>↑</button>
                <button type="button" className="icon" aria-label="Move down" disabled={index === templates.length - 1} onClick={() => setTemplates(move(templates, index, index + 1))}>↓</button>
                <button type="button" className="destructive-outline" onClick={() => setDeleting(template)}>Delete template</button>
              </div>
            </div>
          </details>
        ))}
      </div>
      {deleting && (
        <ConfirmDialog title={`Delete “${deleting.title || "Untitled section"}”?`} confirmLabel="Delete template" onCancel={() => setDeleting(null)} onConfirm={() => { setCatalog(removeFromCatalog(catalog, { sectionTemplates: [deleting.id] })); setDeleting(null); }}>
          <p className="modal-note">Estimates that already use it keep their copy. To stop offering it but keep it here, turn off “Offer in workflow” instead.</p>
          <p className="modal-warning">This changes the shared catalog for everyone and cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
