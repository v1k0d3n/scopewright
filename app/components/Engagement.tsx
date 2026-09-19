"use client";

import type { Catalog, Estimate } from "../lib/types";

type Props = { catalog: Catalog; estimate: Estimate; update: (patch: Partial<Estimate>) => void };

/** Step 1: who the engagement is for, what it must prove, and the agreement text. */
export function Engagement({ catalog, estimate, update }: Props) {
  const toggle = (id: string) => update({ outOfScope: estimate.outOfScope.includes(id) ? estimate.outOfScope.filter((item) => item !== id) : [...estimate.outOfScope, id] });
  return (
    <div className="engagement">
      <section>
        <h3>Customer</h3>
        <div className="engagement-row">
          <label>Customer name<input placeholder="Enter customer name" value={estimate.customer} onChange={(event) => update({ customer: event.target.value })} /></label>
          <label>Engagement title<input placeholder="Defaults to the selected products" value={estimate.title} onChange={(event) => update({ title: event.target.value })} /></label>
        </div>
        <label>POC goal<textarea placeholder="Describe what the customer needs to prove and the intended outcome." value={estimate.goal} onChange={(event) => update({ goal: event.target.value })} /></label>
      </section>
      <section>
        <h3>Agreement</h3>
        <div className="engagement-row">
          <label>Success criteria <small>one per line</small><textarea value={estimate.successCriteria} onChange={(event) => update({ successCriteria: event.target.value })} /></label>
          <label>Assumptions <small>one per line</small><textarea value={estimate.assumptions} onChange={(event) => update({ assumptions: event.target.value })} /></label>
        </div>
      </section>
      <section>
        <h3>Out of scope</h3>
        <p className="section-copy">What this engagement will not cover. Stating it up front is often as useful as the scope itself.</p>
        {catalog.outOfScope.length > 0 && (
          <div className="oos-picks">
            {catalog.outOfScope.map((item) => (
              <label key={item.id} className="oos-pick"><input type="checkbox" checked={estimate.outOfScope.includes(item.id)} onChange={() => toggle(item.id)} /><span>{item.label}</span></label>
            ))}
          </div>
        )}
        <label>{catalog.outOfScope.length ? "Anything else" : "Out-of-scope items"} <small>one per line</small><textarea placeholder="e.g. Production hardening, performance benchmarking, data migration" value={estimate.customOutOfScope} onChange={(event) => update({ customOutOfScope: event.target.value })} /></label>
        {catalog.outOfScope.length === 0 && <p className="section-copy">Editors can add common items under Estimate catalog → Out of scope so they appear here as checkboxes.</p>}
      </section>
    </div>
  );
}
