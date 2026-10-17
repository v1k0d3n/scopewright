"use client";

import { PLACEHOLDERS, framingFrom, noFraming, templateChanged, unknownPlaceholders } from "../lib/estimate";
import type { Catalog, DocumentFraming } from "../lib/types";

type Props = { catalog: Catalog; framing: DocumentFraming; setFraming: (framing: DocumentFraming) => void };

const placeholderList = PLACEHOLDERS.map((name) => `{${name}}`).join(" ");

/** Part of step 5: the optional introduction and closing printed around the numbered sections. */
export function Framing({ catalog, framing, setFraming }: Props) {
  const templates = catalog.documentTemplates ?? [];
  const current = framing.source === "template" ? templates.find((item) => item.id === framing.templateId) : undefined;
  const offered = templates.filter((item) => item.enabled || item.id === framing.templateId);
  const value = framing.source === "template" ? `template:${framing.templateId}` : framing.source;
  const written = framing.introduction.trim() || framing.closing.trim();
  // Wording someone typed is only replaced on purpose. Unchanged template text can always be fetched again.
  const keep = () => !written || (framing.source === "template" && !framing.edited) || window.confirm("Replace the introduction and closing written for this estimate?");
  const choose = (next: string) => {
    if (next === value) return;
    // Unlocked wording is kept as a starting point; locked wording is not copied into a version that can be changed.
    if (next === "custom") { setFraming(framing.locked ? { ...noFraming, source: "custom" } : { ...framing, source: "custom", templateId: "", templateName: "", edited: false, locked: false }); return; }
    if (!keep()) return;
    const template = templates.find((item) => `template:${item.id}` === next);
    setFraming(template ? framingFrom(template) : noFraming);
  };
  const edit = (changes: Partial<DocumentFraming>) => { if (!framing.locked) setFraming({ ...framing, ...changes, edited: framing.source === "template" }); };
  const newer = templateChanged(catalog, framing);
  const unknown = unknownPlaceholders(`${framing.introduction}\n${framing.closing}`);
  return (
    <div className="engagement framing">
      <section>
        <h3>Introduction and closing</h3>
        <p className="section-copy">Optional wording printed before the numbered sections and after the last one, such as the purpose of the proof of concept. Pick one of your team’s templates or write your own.</p>
        <label>Wording
          <select value={value} onChange={(event) => choose(event.target.value)}>
            <option value="none">None</option>
            {offered.map((item) => <option key={item.id} value={`template:${item.id}`}>{item.name}{item.enabled ? "" : " (no longer offered)"}</option>)}
            {framing.source === "template" && !current && <option value={value}>{framing.templateName || "Template"} (no longer in the catalog)</option>}
            <option value="custom">Write my own</option>
          </select>
          {current?.description && <small>{current.description}</small>}
        </label>
        {newer && (
          <div className="notice">
            <b>The catalog has {newer.locked !== framing.locked ? (newer.locked ? "locked" : "unlocked") : "new wording for"} “{newer.name}”</b>
            <span>{framing.edited ? "This estimate keeps its edited wording until you choose to use the locked wording instead." : "This estimate keeps the wording it was given until you choose to update it."}</span>
            <button type="button" className="link" onClick={() => keep() && setFraming(framingFrom(newer))}>Use the new wording</button>
          </div>
        )}
        {framing.source !== "none" && (
          <>
            <div className="engagement-row">
              <label>Introduction <small>printed after the title</small><textarea rows={7} readOnly={framing.locked} value={framing.introduction} onChange={(event) => edit({ introduction: event.target.value })} /></label>
              <label>Closing <small>printed after the last section</small><textarea rows={7} readOnly={framing.locked} value={framing.closing} onChange={(event) => edit({ closing: event.target.value })} /></label>
            </div>
            {framing.locked
              ? <p className="section-copy framing-locked"><b>Locked wording.</b> This template is used exactly as written, so it cannot be edited here. {placeholderList} are still filled in from this estimate. To use different wording, choose another template or Write my own.</p>
              : <p className="section-copy">Leave a blank line between paragraphs. {placeholderList} are filled in from this estimate when the document is printed.</p>}
            {unknown.length > 0 && <p className="section-copy needs-answer">Not a placeholder, so it prints as typed: {unknown.map((name) => `{${name}}`).join(" ")}</p>}
            {framing.source === "template" && (
              <p className="section-copy framing-source">
                {framing.edited ? <>Based on “{framing.templateName}”, edited for this estimate. </> : <>Copied from “{framing.templateName}”{framing.locked ? " (locked)" : ""}. </>}
                {framing.edited && current && <button type="button" className="link" onClick={() => keep() && setFraming(framingFrom(current))}>Restore the template wording</button>}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
