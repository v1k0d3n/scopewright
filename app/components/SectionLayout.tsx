"use client";

import { builtInSections, documentOutline } from "../lib/document";
import type { SectionOutline } from "../lib/document";
import type { EstimateBreakdown } from "../lib/estimate";
import type { Catalog, Estimate } from "../lib/types";

type Props = { catalog: Catalog; estimate: Estimate; breakdown: EstimateBreakdown; update: (patch: Partial<Estimate>) => void };

/** "PRODUCTS IN SCOPE" as "Products in scope". */
const sentence = (title: string) => title.charAt(0) + title.slice(1).toLowerCase();

/** The scope document's sections: their order, and which ones print. Part of the Scope documents page. */
export function SectionLayout({ catalog, estimate, breakdown, update }: Props) {
  const outline = documentOutline(catalog, estimate, breakdown);
  const save = (next: SectionOutline[]) => update({ sectionLayout: next.map(({ id, hidden }) => ({ id, hidden })) });
  const move = (from: number, to: number) => { const next = [...outline]; const [item] = next.splice(from, 1); next.splice(to, 0, item); save(next); };
  const setHidden = (id: string, hidden: boolean) => save(outline.map((item) => (item.id === id ? { ...item, hidden } : item)));
  const isDefault = outline.every((item, index) => !item.hidden && item.id === builtInSections[index].id);
  let number = 0;
  return (
    <div className="section-layout">
      <p className="section-copy">The order of the numbered sections, here, in the PDF, and in the copied text. Sections are renumbered as they move.</p>
      <ol>
        {outline.map((item, index) => {
          const prints = !item.hidden && !item.omitted;
          const name = sentence(item.title);
          return (
            <li key={item.id} className={prints ? undefined : "not-printed"}>
              <span className="section-number">{prints ? ++number : "–"}</span>
              <span className="section-name"><b>{name}</b>{item.hidden ? <small>Not printed</small> : item.omitted && <small>{item.omitted}</small>}</span>
              <label className="workflow-toggle" title={`Print ${name}`}><input type="checkbox" aria-label={`Print ${name}`} checked={!item.hidden} onChange={(event) => setHidden(item.id, !event.target.checked)} /><span>Print</span></label>
              <div className="row-actions">
                <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>
                <button type="button" className="icon" aria-label="Move down" disabled={index === outline.length - 1} onClick={() => move(index, index + 1)}>↓</button>
              </div>
            </li>
          );
        })}
      </ol>
      {!isDefault && <button type="button" className="link" onClick={() => update({ sectionLayout: [] })}>Restore the default order</button>}
    </div>
  );
}
