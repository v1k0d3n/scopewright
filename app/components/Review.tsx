"use client";

import type { EstimateBreakdown } from "../lib/estimate";
import type { Estimate } from "../lib/types";

export function Review({ estimate, breakdown, update }: { estimate: Estimate; breakdown: EstimateBreakdown; update: (patch: Partial<Estimate>) => void }) {
  return (
    <div className="review">
      <div className="review-fields">
        <label>Customer name<input placeholder="Enter customer name" value={estimate.customer} onChange={(event) => update({ customer: event.target.value })} /></label>
        <label>Engagement title<input placeholder={`${breakdown.products.map((item) => item.product.short).join(" + ") || "Product"} Proof of Concept`} value={estimate.title} onChange={(event) => update({ title: event.target.value })} /></label>
        <label className="wide">POC goal<textarea placeholder="Describe what the customer needs to prove and the intended outcome." value={estimate.goal} onChange={(event) => update({ goal: event.target.value })} /></label>
      </div>
      {breakdown.prerequisites.length > 0 && (
        <div className={`notice ${breakdown.pendingPrerequisites ? "" : "notice-ok"}`}>
          <b>{breakdown.pendingPrerequisites ? `${breakdown.pendingPrerequisites} required prerequisite${breakdown.pendingPrerequisites === 1 ? "" : "s"} still pending` : "All required prerequisites provided"}</b>
          <span>{breakdown.prerequisites.map((item) => `${item.product.short}: ${item.items.length - item.pending}/${item.items.length}`).join(" · ")}</span>
        </div>
      )}
      <table className="review-table">
        <thead><tr><th>Scope item</th><th>Detail</th><th>Hours</th></tr></thead>
        <tbody>
          {breakdown.products.map((item) => (
            <tr key={item.product.id} className="product-row">
              <td><b>{item.product.name}</b>{item.foundation && <small>Required foundation</small>}</td>
              <td>{item.existing ? "Existing environment" : item.decisions.length ? item.decisions.map((decision) => decision.choice.label).join(" · ") : "New deployment"}</td>
              <td>{item.hours}h</td>
            </tr>
          ))}
          {breakdown.deliverables.map((item) => (
            <tr key={item.group.id}>
              <td>{item.group.scopeNumber && `${item.group.scopeNumber} · `}{item.group.name}</td>
              <td>{item.tasks.length} deliverable{item.tasks.length === 1 ? "" : "s"}</td>
              <td>{item.hours}h</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={2}>Estimated effort</td><td>{breakdown.total}h</td></tr></tfoot>
      </table>
      <div className="notice"><b>Ready for the scope document</b><span>Everything above is generated from your selections. Open Scope documents to add success criteria and assumptions, then print or copy the customer-facing document.</span></div>
    </div>
  );
}

export function EstimateCard({ breakdown, saved }: { breakdown: EstimateBreakdown; saved: boolean }) {
  const width = Math.min(breakdown.total * 1.5, 100);
  return (
    <aside className="estimate-card">
      <div className="estimate-head"><span>LIVE ESTIMATE</span><em>{saved ? "Saved" : "Draft"}</em></div>
      <div className="hours"><strong>{breakdown.total}</strong><div><b>hours</b><span>≈ {breakdown.days} working days</span></div></div>
      <div className="range"><span style={{ width: `${width}%` }} /></div>
      <p className="confidence">Planning range <b>{breakdown.low}–{breakdown.high}h</b></p>
      <div className="summary-list">
        {breakdown.products.map((item) => (
          <div key={item.product.id}><span>{item.product.short} {item.existing ? "existing environment" : "installation"}</span><b>{item.hours}h</b></div>
        ))}
        {breakdown.deliverables.map((item) => (
          <div key={item.group.id}><span>{item.group.name}</span><b>+{item.hours}h</b></div>
        ))}
      </div>
      <div className="total"><span>Estimated effort</span><strong>{breakdown.total}h</strong></div>
      <p className="hint">Estimate includes delivery work only. Calendar duration depends on access, dependencies, and customer readiness.</p>
    </aside>
  );
}
