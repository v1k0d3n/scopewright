"use client";

import { useState } from "react";
import { outOfScopeLines } from "../lib/estimate";
import { documentText, scopeDocument } from "../lib/document";
import type { Block, Span } from "../lib/document";
import type { EstimateBreakdown } from "../lib/estimate";
import type { Branding, Catalog, Estimate } from "../lib/types";

type Props = { catalog: Catalog; estimate: Estimate; breakdown: EstimateBreakdown; branding: Branding; update: (patch: Partial<Estimate>) => void; onEdit: () => void };

export function ScopeDocument({ catalog, estimate, breakdown, branding, update, onEdit }: Props) {
  const [copied, setCopied] = useState(false);
  // Sections are numbered as they are rendered, so leaving one out never leaves a gap.
  const doc = scopeDocument(catalog, estimate, branding.orgName, breakdown);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(documentText(doc, branding.orgName));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const showHours = estimate.options.showHours;
  const excluded = outOfScopeLines(catalog, estimate);
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
            <span>{breakdown.products.reduce((sum, item) => sum + item.decisions.length, 0)} installation decisions{breakdown.unansweredQuestions ? ` (${breakdown.unansweredQuestions} to be decided)` : ""}</span>
            <span>{breakdown.prerequisites.reduce((sum, item) => sum + item.items.length, 0)} prerequisites{breakdown.pendingPrerequisites ? ` (${breakdown.pendingPrerequisites} pending)` : ""}</span>
            <span>{breakdown.deliverables.reduce((sum, item) => sum + item.tasks.length, 0)} deliverables</span>
            <span>{excluded.length} out-of-scope item{excluded.length === 1 ? "" : "s"}</span>
            <span>{estimate.framing.source === "none" ? "No introduction or closing" : estimate.framing.source === "custom" ? "Introduction and closing written for this estimate" : `Introduction and closing from “${estimate.framing.templateName}”${estimate.framing.edited ? " (edited)" : ""}`}</span>
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
          <h2>{doc.title}</h2>
          <h4>Prepared for {estimate.customer || "Customer name"} by {branding.orgName}{branding.workspaceName && ` · ${branding.workspaceName}`}</h4>
          <hr />
          {doc.introduction.length > 0 && <div className="doc-framing">{doc.introduction.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>}
          {doc.sections.map((section, index) => <section key={section.id}><h5>{index + 1} / {section.title}</h5><Blocks blocks={section.blocks} /></section>)}
          {doc.closing.length > 0 && <div className="doc-framing doc-closing">{doc.closing.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>}
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

/** One span on the page. Hours sit at the right edge of their line. */
function SpanView({ span }: { span: Span }) {
  if (typeof span === "string") return <>{span}</>;
  if ("strong" in span) return <b>{span.strong}</b>;
  if ("note" in span) return <> <small>({span.note})</small></>;
  if ("hours" in span) return <> <span className="doc-hours">{span.hours}h</span></>;
  return <span className={`status-${span.status}`}>{span.label}</span>;
}

const Spans = ({ spans }: { spans: Span[] }) => <>{spans.map((span, index) => <SpanView key={index} span={span} />)}</>;

function Blocks({ blocks }: { blocks: Block[] }) {
  return <>{blocks.map((block, index) => {
    switch (block.kind) {
      case "paragraph": return <p key={index} className={block.placeholder ? "placeholder-copy" : undefined}><Spans spans={block.content} /></p>;
      case "list": return <ul key={index}>{block.items.map((item, line) => <li key={line}><Spans spans={item} /></li>)}</ul>;
      case "table": return (
        <table key={index} className={`doc-table${block.numeric ? " numeric" : ""}`}>
          {block.columns.length > 0 && <thead><tr>{block.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>}
          <tbody>{block.rows.map((row, line) => <tr key={line} className={row.total ? "doc-total" : undefined}>{row.cells.map((cell, column) => <td key={column}><Spans spans={cell} /></td>)}</tr>)}</tbody>
        </table>
      );
      case "group": return <section key={index} className="scope-product"><b><Spans spans={block.title} /></b><Blocks blocks={block.blocks} /></section>;
    }
  })}</>;
}
