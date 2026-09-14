"use client";

import { useState } from "react";
import { defaultTitle, scopeText, statusLabel } from "../lib/estimate";
import type { EstimateBreakdown } from "../lib/estimate";
import type { Branding, Catalog, Estimate } from "../lib/types";

type Props = { catalog: Catalog; estimate: Estimate; breakdown: EstimateBreakdown; branding: Branding; update: (patch: Partial<Estimate>) => void; onEdit: () => void };

export function ScopeDocument({ catalog, estimate, breakdown, branding, update, onEdit }: Props) {
  const [copied, setCopied] = useState(false);
  const title = estimate.title || defaultTitle(breakdown);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(scopeText(catalog, estimate, branding.orgName));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const list = (text: string) => text.split("\n").map((line) => line.trim()).filter(Boolean);
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return (
    <div className="content scope-page">
      <div className="title-row no-print">
        <div><span className="eyebrow">SCOPE DOCUMENTS</span><h1>Customer-facing scope</h1><p>Generated from the current estimate. Everyone signs off on this document before the POC starts.</p></div>
        <div className="actions"><button type="button" className="secondary" onClick={copy}>{copied ? "Copied ✓" : "Copy as text"}</button><button type="button" className="primary" onClick={() => window.print()}>Print / Save PDF</button></div>
      </div>
      <div className="document-grid">
        <div className="editor-panel scope-editor no-print">
          <h3>Engagement</h3>
          <label>Customer name<input placeholder="Enter customer name" value={estimate.customer} onChange={(event) => update({ customer: event.target.value })} /></label>
          <label>Engagement title<input placeholder={title} value={estimate.title} onChange={(event) => update({ title: event.target.value })} /></label>
          <label>POC goal<textarea placeholder="Describe what the customer needs to prove and the intended outcome." value={estimate.goal} onChange={(event) => update({ goal: event.target.value })} /></label>
          <h3>Agreement</h3>
          <label>Success criteria <small>one per line</small><textarea value={estimate.successCriteria} onChange={(event) => update({ successCriteria: event.target.value })} /></label>
          <label>Assumptions <small>one per line</small><textarea value={estimate.assumptions} onChange={(event) => update({ assumptions: event.target.value })} /></label>
          <div className="scope-source-note">
            <b>Generated from the estimate</b>
            <span>{breakdown.products.length} product{breakdown.products.length === 1 ? "" : "s"} in scope</span>
            <span>{breakdown.products.reduce((sum, item) => sum + item.decisions.length, 0)} installation decisions</span>
            <span>{breakdown.prerequisites.reduce((sum, item) => sum + item.items.length, 0)} prerequisites{breakdown.pendingPrerequisites ? ` (${breakdown.pendingPrerequisites} pending)` : ""}</span>
            <span>{breakdown.deliverables.reduce((sum, item) => sum + item.tasks.length, 0)} deliverables</span>
            <button type="button" className="link" onClick={onEdit}>Change scope items in the Estimate Builder →</button>
          </div>
        </div>
        <article className="doc-preview">
          <header className="doc-header">
            <div>
              {branding.document.showLogo && branding.logo ? <img src={branding.logo} alt={`${branding.orgName} logo`} className="doc-logo" /> : <span className="doc-org">{branding.orgName}</span>}
              <span className="doc-tag">DRAFT · POC SCOPE · {date}</span>
            </div>
          </header>
          <h2>{title}</h2>
          <h4>Prepared for {estimate.customer || "Customer name"} by {branding.orgName}{branding.workspaceName && ` · ${branding.workspaceName}`}</h4>
          <hr />
          <h5>1 / GOAL</h5>
          <p className={!estimate.goal ? "placeholder-copy" : ""}>{estimate.goal || "Add a concise POC goal using the editor."}</p>
          <h5>2 / PRODUCTS IN SCOPE</h5>
          {breakdown.products.length ? (
            <table className="doc-table">
              <thead><tr><th>Product</th><th>Environment</th><th>Effort</th></tr></thead>
              <tbody>{breakdown.products.map((item) => <tr key={item.product.id}><td>{item.product.name}{item.foundation && <small> (required foundation)</small>}</td><td>{item.existing ? "Existing" : "New deployment"}</td><td>{item.hours}h</td></tr>)}</tbody>
            </table>
          ) : <p className="placeholder-copy">No products selected in the Estimate Builder.</p>}
          <h5>3 / INSTALLATION SCOPE</h5>
          {breakdown.products.map((item) => (
            <section className="scope-product" key={item.product.id}>
              <b>{item.product.name}</b>
              <ul>
                {item.existing && <li>Validate access to the existing environment. No installation effort.</li>}
                {item.baseHours > 0 && <li>Base work package <span>{item.baseHours}h</span></li>}
                {item.decisions.map((decision) => <li key={decision.field.id}>{decision.field.label}: <b>{decision.choice.label}</b> <span>{decision.choice.hours}h</span></li>)}
                {(estimate.details[item.product.id] ?? []).filter((line) => line.description).map((line) => <li key={line.id}>{line.description} <span>{line.hours}h</span></li>)}
              </ul>
            </section>
          ))}
          <h5>4 / PREREQUISITES</h5>
          {breakdown.prerequisites.length ? breakdown.prerequisites.map((item) => (
            <section className="scope-product" key={item.product.id}>
              <b>{item.product.name}</b>
              <table className="doc-table prereq-table">
                <thead><tr><th>Customer provides</th><th>Value</th><th>Status</th></tr></thead>
                <tbody>{item.items.map((line) => <tr key={line.id}><td>{line.label}{!line.required && <small> (optional)</small>}</td><td>{line.value || "—"}</td><td className={`status-${line.status}`}>{statusLabel(line.status)}</td></tr>)}</tbody>
              </table>
            </section>
          )) : <p className="placeholder-copy">No prerequisites are defined for the selected products.</p>}
          <h5>5 / DELIVERY PLAN</h5>
          {breakdown.deliverables.length ? breakdown.deliverables.map((item) => (
            <section className="scope-product" key={item.group.id}>
              <b>{item.group.scopeNumber && `${item.group.scopeNumber}. `}{item.group.name}</b>
              <ul>{item.tasks.map((task) => <li key={task.id}>{task.scopeNumber && `${task.scopeNumber}. `}{task.name} <small>({task.phase})</small> <span>{task.hours}h</span></li>)}</ul>
            </section>
          )) : <p className="placeholder-copy">No deliverables selected in the Estimate Builder.</p>}
          <h5>6 / EFFORT SUMMARY</h5>
          <table className="doc-table">
            <tbody>
              <tr><td>Installation and configuration</td><td>{breakdown.installationHours}h</td></tr>
              <tr><td>Deliverables</td><td>{breakdown.deliverableHours}h</td></tr>
              <tr className="doc-total"><td>Total estimated effort</td><td>{breakdown.total}h</td></tr>
              <tr><td>Planning range</td><td>{breakdown.low}–{breakdown.high}h</td></tr>
            </tbody>
          </table>
          <h5>7 / SUCCESS CRITERIA</h5>
          <ul>{list(estimate.successCriteria).map((line, index) => <li key={index}>{line}</li>)}</ul>
          <h5>8 / ASSUMPTIONS</h5>
          <ul>{list(estimate.assumptions).map((line, index) => <li key={index}>{line}</li>)}</ul>
          <div className="signatures">
            <div><span>Customer</span></div>
            <div><span>Account team</span></div>
            <div><span>{branding.workspaceName || branding.orgName}</span></div>
          </div>
          <footer>{[branding.document.footer, branding.document.confidentiality].filter(Boolean).join(" · ").toUpperCase()}</footer>
        </article>
      </div>
    </div>
  );
}
