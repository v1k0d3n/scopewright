"use client";

import { useEffect, useRef } from "react";
import { PLACEHOLDERS, sectionFrom, sectionTemplateChanged } from "../lib/estimate";
import { useDialogFocus } from "../lib/useDialogFocus";
import type { Catalog, CustomSection } from "../lib/types";
import { SectionFields } from "./SectionFields";

type Props = { catalog: Catalog; section: CustomSection; onChange: (section: CustomSection) => void; onDelete: () => void; onClose: () => void };

const placeholderList = PLACEHOLDERS.map((name) => `{${name}}`).join(" ");

/** Writes one custom section of the estimate. Changes apply as they are typed. */
export function CustomSectionEditor({ catalog, section, onChange, onDelete, onClose }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLInputElement>(null);
  useDialogFocus(dialog);
  useEffect(() => { title.current?.focus(); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  const template = (catalog.sectionTemplates ?? []).find((item) => item.id === section.templateId);
  const newer = sectionTemplateChanged(catalog, section);
  // What someone wrote is only replaced on purpose; an unchanged copy can always be fetched again.
  const replace = (from: NonNullable<typeof template>) => { if (!section.edited || window.confirm("Replace what was written for this estimate with the catalog version?")) onChange(sectionFrom(from, section.id)); };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialog} className="modal section-editor" role="dialog" aria-modal="true" aria-labelledby="section-editor-title">
        <h2 id="section-editor-title">Custom section</h2>
        <p className="modal-note">
          {!section.templateId ? <>Written for this estimate. </> : section.edited ? <>Based on “{section.templateName}”, edited for this estimate. </> : <>Copied from the catalog template “{section.templateName}”{section.locked ? " (locked)" : ""}. </>}
          {placeholderList} are filled in from the estimate when the document is printed.
        </p>
        {newer && (
          <div className="notice">
            <b>The catalog has {newer.locked !== section.locked ? (newer.locked ? "locked" : "unlocked") : "a new version of"} “{newer.title || section.templateName}”</b>
            <span>{section.edited ? "This estimate keeps its edited copy until you choose the locked version instead." : "This estimate keeps the copy it was given until you choose to update it."}</span>
            <button type="button" className="link" onClick={() => replace(newer)}>Use the catalog version</button>
          </div>
        )}
        {section.locked && <p className="modal-note locked-note"><b>Locked.</b> This template is used exactly as written, so it cannot be edited here. To change it, delete it and add a blank section instead.</p>}
        <SectionFields value={section} readOnly={section.locked} titleRef={title} onChange={(value) => onChange({ ...section, ...value, edited: Boolean(section.templateId) })} />
        {section.edited && template && !newer && <p className="modal-note"><button type="button" className="link" onClick={() => replace(template)}>Restore the template version</button></p>}
        <div className="modal-actions">
          <button type="button" className="destructive-outline modal-aside" onClick={onDelete}>Delete section</button>
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
