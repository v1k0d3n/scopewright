"use client";

import { useState } from "react";
import { UNTITLED_SECTION, builtInSections, documentOutline } from "../lib/document";
import type { SectionOutline } from "../lib/document";
import { SECTION_LIMITS, blankSection, sectionFrom, sectionTemplateChanged } from "../lib/estimate";
import type { EstimateBreakdown } from "../lib/estimate";
import type { Catalog, CustomSection, Estimate, SectionTemplate } from "../lib/types";
import { AddSectionDialog } from "./AddSectionDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { CustomSectionEditor } from "./CustomSectionEditor";

type Props = { catalog: Catalog; estimate: Estimate; breakdown: EstimateBreakdown; update: (patch: Partial<Estimate>) => void };

/** "PRODUCTS IN SCOPE" as "Products in scope". */
const sentence = (title: string) => title.charAt(0) + title.slice(1).toLowerCase();
const uid = () => `section-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The scope document's sections: their order, and which ones print. Part of the Scope documents page. */
export function SectionLayout({ catalog, estimate, breakdown, update }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomSection | null>(null);
  const [adding, setAdding] = useState(false);
  const outline = documentOutline(catalog, estimate, breakdown);
  const layout = (items: SectionOutline[]) => items.map(({ id, hidden }) => ({ id, hidden }));
  const save = (next: SectionOutline[]) => update({ sectionLayout: layout(next) });
  const customSections = estimate.customSections;
  const offered = (catalog.sectionTemplates ?? []).filter((template) => template.enabled);
  const add = (template: SectionTemplate | null) => {
    const section = template ? sectionFrom(template, uid()) : blankSection(uid());
    update({ customSections: [...customSections, section], sectionLayout: [...layout(outline), { id: section.id, hidden: false }] });
    setAdding(false);
    // A template is ready to print; a blank section needs writing.
    if (!template) setEditing(section.id);
  };
  /** Where a custom section came from, under its name in the list. */
  const origin = (id: string) => {
    const section = customSections.find((item) => item.id === id);
    if (!section?.templateId) return "Custom · select to edit";
    return [`From “${section.templateName}”`, section.locked && "locked", section.edited && "edited", sectionTemplateChanged(catalog, section) && "update available"].filter(Boolean).join(" · ");
  };
  const remove = (id: string) => update({ customSections: customSections.filter((section) => section.id !== id), sectionLayout: layout(outline.filter((item) => item.id !== id)) });
  const current = customSections.find((section) => section.id === editing);
  const move = (from: number, to: number) => { const next = [...outline]; const [item] = next.splice(from, 1); next.splice(to, 0, item); save(next); };
  const setHidden = (id: string, hidden: boolean) => save(outline.map((item) => (item.id === id ? { ...item, hidden } : item)));
  // The default is every built-in section in its usual place, then the custom ones, all printed.
  const isDefault = outline.every((item, index) => !item.hidden && (index < builtInSections.length ? item.id === builtInSections[index].id : item.custom));
  let number = 0;
  return (
    <div className="section-layout">
      <p className="section-copy">The order of the numbered sections, here, in the PDF, and in the copied text. Sections are renumbered as they move.</p>
      <ol>
        {outline.map((item, index) => {
          const prints = !item.hidden && !item.omitted;
          const name = item.custom ? item.title || UNTITLED_SECTION : sentence(item.title);
          return (
            <li key={item.id} className={prints ? undefined : "not-printed"}>
              <span className="section-number">{prints ? ++number : "–"}</span>
              <span className="section-name">
                {item.custom ? <button type="button" className="link" title={`Edit ${name}`} onClick={() => setEditing(item.id)}>{name}</button> : <b>{name}</b>}
                {item.hidden ? <small>Not printed</small> : item.omitted ? <small>{item.omitted}</small> : item.custom && <small>{origin(item.id)}</small>}
              </span>
              <label className="workflow-toggle" title={`Print ${name}`}><input type="checkbox" aria-label={`Print ${name}`} checked={!item.hidden} onChange={(event) => setHidden(item.id, !event.target.checked)} /><span>Print</span></label>
              <div className="row-actions">
                <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>
                <button type="button" className="icon" aria-label="Move down" disabled={index === outline.length - 1} onClick={() => move(index, index + 1)}>↓</button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="section-layout-actions">
        <button type="button" className="secondary" disabled={customSections.length >= SECTION_LIMITS.sections} title={customSections.length >= SECTION_LIMITS.sections ? `An estimate holds up to ${SECTION_LIMITS.sections} custom sections` : undefined} onClick={() => (offered.length ? setAdding(true) : add(null))}>+ Add section</button>
        {!isDefault && <button type="button" className="link" title="Custom sections move to the end" onClick={() => update({ sectionLayout: [] })}>Restore the default order</button>}
      </div>
      {adding && <AddSectionDialog templates={offered} onPick={add} onCancel={() => setAdding(false)} />}
      {current && <CustomSectionEditor catalog={catalog} section={current} onChange={(section) => update({ customSections: customSections.map((item) => (item.id === section.id ? section : item)) })} onDelete={() => { setEditing(null); setDeleting(current); }} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog title={`Delete “${deleting.title || UNTITLED_SECTION}”?`} confirmLabel="Delete section" onConfirm={() => { remove(deleting.id); setDeleting(null); }} onCancel={() => setDeleting(null)}>
          <p className="modal-note">The section and everything written in it are removed from this estimate. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
