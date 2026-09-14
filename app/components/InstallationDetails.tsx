"use client";

import { selectionKey } from "../lib/estimate";
import type { ProductBreakdown } from "../lib/estimate";
import type { Catalog, DetailLine, Estimate } from "../lib/types";

type Props = { catalog: Catalog; estimate: Estimate; breakdown: ProductBreakdown[]; update: (patch: Partial<Estimate>) => void };

export function InstallationDetails({ catalog, estimate, breakdown, update }: Props) {
  if (!breakdown.length) return <div className="empty-state"><b>Select a product first</b><span>Installation questions for each product appear here.</span></div>;
  const setEnvironment = (id: string, state: "new" | "existing") => update({ environments: { ...estimate.environments, [id]: state } });
  const setChoice = (productId: string, fieldId: string, choiceId: string) => update({ selections: { ...estimate.selections, [selectionKey(productId, fieldId)]: choiceId } });
  const setLines = (id: string, lines: DetailLine[]) => update({ details: { ...estimate.details, [id]: lines } });
  const add = (id: string) => setLines(id, [...(estimate.details[id] ?? []), { id: `line-${Date.now()}`, description: "", hours: 0 }]);
  return (
    <div className="installation-stack">
      {breakdown.map((item) => {
        const { product } = item;
        const fields = catalog.installation[product.id] ?? [];
        const lines = estimate.details[product.id] ?? [];
        return (
          <section className="installation-frame" key={product.id}>
            <header>
              <i>{product.mark}</i>
              <span>
                <small>{product.portfolio}{item.foundation && " · Required foundation"}</small>
                <b>{product.name}</b>
              </span>
              <em>{item.existing ? "Existing" : `${item.hours}h`}</em>
            </header>
            <div className="environment-state">
              <span><b>Environment status</b><small>Assume a new deployment unless the customer already runs this platform.</small></span>
              <div className="segmented" role="group" aria-label={`${product.short} environment`}>
                <button type="button" className={!item.existing ? "active" : ""} onClick={() => setEnvironment(product.id, "new")}>New deployment</button>
                <button type="button" className={item.existing ? "active" : ""} onClick={() => setEnvironment(product.id, "existing")}>Already exists</button>
              </div>
            </div>
            {item.existing ? (
              <p className="frame-note">The team validates access to the existing environment. No installation hours are added, and its deliverables stay available in the next step.</p>
            ) : fields.length ? (
              <div className="fields">
                {product.hours > 0 && <div className="base-package"><span>Base work package</span><b>{product.hours}h</b><small>Set per product in the Estimate Catalog.</small></div>}
                {fields.map((field) => {
                  const current = estimate.selections[selectionKey(product.id, field.id)] ?? field.choices[0]?.id ?? "";
                  return (
                    <label key={field.id}>
                      <span>{field.label}</span>
                      <select value={current} onChange={(event) => setChoice(product.id, field.id, event.target.value)}>
                        {field.choices.map((choice) => <option value={choice.id} key={choice.id}>{choice.label} · {choice.hours}h</option>)}
                      </select>
                      {field.help && <small>{field.help}</small>}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="frame-note">No installation questions are defined for {product.short} yet. {product.hours > 0 && `The ${product.hours}h base work package still applies.`} Add questions under Estimate Catalog → Installation Details.</p>
            )}
            <div className="other-details">
              <div className="other-title">
                <span><b>Other details</b><small>Anything not covered above. Hours are included in the estimate and the scope document.</small></span>
                <button type="button" onClick={() => add(product.id)} aria-label={`Add ${product.short} detail`}>＋</button>
              </div>
              {lines.map((line) => (
                <div className="detail-row" key={line.id}>
                  <input aria-label="Detail description" placeholder="Describe the additional work…" value={line.description} onChange={(event) => setLines(product.id, lines.map((item) => item.id === line.id ? { ...item, description: event.target.value } : item))} />
                  <label><input aria-label="Hours" type="number" min="0" step="0.5" value={line.hours} onChange={(event) => setLines(product.id, lines.map((item) => item.id === line.id ? { ...item, hours: Number(event.target.value) } : item))} /><span>hours</span></label>
                  <button type="button" onClick={() => setLines(product.id, lines.filter((item) => item.id !== line.id))} aria-label="Remove detail">−</button>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
