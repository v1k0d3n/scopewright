"use client";

import { useState } from "react";
import { defaultTitle, outOfScopeLines, scopeText, statusLabel } from "../lib/estimate";
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
  const showHours = estimate.options.showHours;
  const excluded = outOfScopeLines(catalog, estimate);
  // Sections are numbered as they are rendered, so hiding one never leaves a gap.
  let sectionNumber = 0;
  const heading = (name: string) => <h5>{++sectionNumber} / {name}</h5>;
  const hours = (value: number) => (showHours ? <span>{value}h</span> : null);
  return (
    <div className="content scope-page">
      <div className="title-row no-print">
        <div><span className="eyebrow">SCOPE DOCUMENTS</span><h1>Customer-facing scope</h1><p>Generated from the current estimate. Everyone signs off on this document before the POC starts.</p></div>
        <div className="actions"><button type="button" className="secondary" onClick={copy}>{copied ? "Copied ✓" : "Copy as text"}</button><button type="button" className="primary" onClick={() => window.print()}>Print / Save PDF</button></div>
      </div>
      <div className="document-grid">
        <div className="editor-panel scope-editor no-print">
          <h3>Options</h3>
          <label className="switch" htmlFor="option-show-hours">
            <input id="option-show-hours" type="checkbox" role="switch" aria-label="Show hours" checked={showHours} onChange={(event) => update({ options: { ...estimate.options, showHours: event.target.checked } })} />
            <span><b>Show hours</b><small>Turn off to discuss scope and prerequisites without effort. Hides every hour figure and the effort summary, here, in the PDF, and in the copied text.</small></span>
          </label>
          <div className="scope-source-note">
            <b>Generated from the estimate</b>
            <span>{breakdown.products.length} product{breakdown.products.length === 1 ? "" : "s"} in scope</span>
            <span>{breakdown.products.reduce((sum, item) => sum + item.decisions.length, 0)} installation decisions</span>
            <span>{breakdown.prerequisites.reduce((sum, item) => sum + item.items.length, 0)} prerequisites{breakdown.pendingPrerequisites ? ` (${breakdown.pendingPrerequisites} pending)` : ""}</span>
            <span>{breakdown.deliverables.reduce((sum, item) => sum + item.tasks.length, 0)} deliverables</span>
            <span>{excluded.length} out-of-scope item{excluded.length === 1 ? "" : "s"}</span>
            <button type="button" className="link" onClick={onEdit}>Edit the engagement in the Estimate Builder →</button>
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
          {heading("GOAL")}
          <p className={!estimate.goal ? "placeholder-copy" : ""}>{estimate.goal || "Add a concise POC goal in the Engagement step."}</p>
          {heading("PRODUCTS IN SCOPE")}
          {breakdown.products.length ? (
            <table className="doc-table">
              <thead><tr><th>Product</th><th>Environment</th>{showHours && <th>Effort</th>}</tr></thead>
              <tbody>{breakdown.products.map((item) => <tr key={item.product.id}><td>{item.product.name}{item.foundation && <small> (required foundation)</small>}</td><td>{item.existing ? "Existing" : "New deployment"}</td>{showHours && <td>{item.hours}h</td>}</tr>)}</tbody>
            </table>
          ) : <p className="placeholder-copy">No products selected in the Estimate Builder.</p>}
          {heading("INSTALLATION SCOPE")}
          {breakdown.products.map((item) => (
            <section className="scope-product" key={item.product.id}>
              <b>{item.product.name}</b>
              <ul>
                {item.existing && <li>Validate access to the existing environment. No installation effort.</li>}
                {showHours && item.baseHours > 0 && <li>Base work package {hours(item.baseHours)}</li>}
                {item.decisions.map((decision) => <li key={decision.field.id}>{decision.field.label}: <b>{decision.choice.label}</b> {hours(decision.choice.hours)}</li>)}
                {(estimate.details[item.product.id] ?? []).filter((line) => line.description).map((line) => <li key={line.id}>{line.description} {hours(line.hours)}</li>)}
              </ul>
            </section>
          ))}
          {heading("PREREQUISITES")}
          {breakdown.prerequisites.length ? breakdown.prerequisites.map((item) => (
            <section className="scope-product" key={item.product.id}>
              <b>{item.product.name}</b>
              <table className="doc-table prereq-table">
                <thead><tr><th>Customer provides</th><th>Value</th><th>Status</th></tr></thead>
                <tbody>{item.items.map((line) => <tr key={line.id}><td>{line.label}{!line.required && <small> (optional)</small>}</td><td>{line.value || "—"}</td><td className={`status-${line.status}`}>{statusLabel(line.status)}</td></tr>)}</tbody>
              </table>
            </section>
          )) : <p className="placeholder-copy">No prerequisites are defined for the selected products.</p>}
          {heading("DELIVERY PLAN")}
          {breakdown.deliverables.length ? breakdown.deliverables.map((item) => (
            <section className="scope-product" key={item.group.id}>
              <b>{item.group.scopeNumber && `${item.group.scopeNumber}. `}{item.group.name}</b>
              <ul>{item.tasks.map((task) => <li key={task.id}>{task.scopeNumber && `${task.scopeNumber}. `}{task.name} <small>({task.phase})</small> {hours(task.hours)}</li>)}</ul>
            </section>
          )) : <p className="placeholder-copy">No deliverables selected in the Estimate Builder.</p>}
          {excluded.length > 0 && <>{heading("OUT OF SCOPE")}<ul>{excluded.map((line, index) => <li key={index}>{line}</li>)}</ul></>}
          {showHours && <>
            {heading("EFFORT SUMMARY")}
            <table className="doc-table">
              <tbody>
                <tr><td>Installation and configuration</td><td>{breakdown.installationHours}h</td></tr>
                <tr><td>Deliverables</td><td>{breakdown.deliverableHours}h</td></tr>
                <tr className="doc-total"><td>Total estimated effort</td><td>{breakdown.total}h</td></tr>
                <tr><td>Planning range</td><td>{breakdown.low}–{breakdown.high}h</td></tr>
              </tbody>
            </table>
          </>}
          {heading("SUCCESS CRITERIA")}
          <ul>{list(estimate.successCriteria).map((line, index) => <li key={index}>{line}</li>)}</ul>
          {heading("ASSUMPTIONS")}
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
