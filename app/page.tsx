"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CatalogManager } from "./components/CatalogManager";
import { Deliverables } from "./components/Deliverables";
import { InstallationDetails } from "./components/InstallationDetails";
import { Prerequisites } from "./components/Prerequisites";
import { ProductChooser } from "./components/ProductChooser";
import { EstimateCard, Review } from "./components/Review";
import { ScopeDocument } from "./components/ScopeDocument";
import { Settings } from "./components/Settings";
import { WeeklyUpdate } from "./components/WeeklyUpdate";
import { defaultBranding, defaultCatalog, emptyEstimate } from "./lib/defaults";
import { availableGroups, calculate, defaultTitle, estimateExport, mergeCatalog, mergeEstimate, parseEstimateExport } from "./lib/estimate";
import { usePersistentState, useSharedState } from "./lib/storage";
import type { SyncStatus } from "./lib/storage";
import { mergeBranding, themeVariables } from "./lib/theme";
import type { Catalog, Estimate } from "./lib/types";
import type { Identity } from "./lib/identity";

type View = "estimate" | "scope" | "updates" | "catalog" | "settings";

const views: { id: View; label: string; icon: string; section: "WORKSPACE" | "MANAGE" }[] = [
  { id: "estimate", label: "New estimate", icon: "⌁", section: "WORKSPACE" },
  { id: "scope", label: "Scope documents", icon: "□", section: "WORKSPACE" },
  { id: "updates", label: "Weekly updates", icon: "↗", section: "WORKSPACE" },
  { id: "catalog", label: "Estimate catalog", icon: "⊞", section: "MANAGE" },
  { id: "settings", label: "Settings", icon: "⚙", section: "MANAGE" },
];

const steps = [
  { label: "Products", title: "What are we helping the customer prove?", copy: "Start with a solution pattern or build the engagement by product." },
  { label: "Installation Details", title: "Installation Details", copy: "Answer the installation questions for each product. Every answer is priced." },
  { label: "Prerequisites", title: "Prerequisites", copy: "What the customer must provide before work starts. Catalog items are pre-filled for each product; add anything specific to this engagement." },
  { label: "Deliverables", title: "Deliverables", copy: "Select the catalog deliverables included in this engagement." },
  { label: "Review", title: "Review the engagement", copy: "Name the engagement and confirm the scope and estimated effort." },
];


export default function Home() {
  const [view, setView] = useState<View>("estimate");
  const [step, setStep] = useState(1);
  const [catalog, setCatalog, catalogSync] = useSharedState<Catalog>("catalog", defaultCatalog, mergeCatalog);
  const [estimate, setEstimate] = usePersistentState<Estimate>("estimate", emptyEstimate(), mergeEstimate);
  const [branding, setBranding, brandingSync] = useSharedState("branding", defaultBranding, (stored) => mergeBranding(stored));
  const [savedAt, setSavedAt] = useState(0);
  const [notice, setNotice] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  useEffect(() => {
    fetch("/api/workspace/me", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((value) => setIdentity(value as Identity | null)).catch(() => setIdentity(null));
  }, []);
  const readOnly = identity !== null && !identity.editor;
  const importInput = useRef<HTMLInputElement>(null);
  const brandingLoaded = brandingSync !== "loading";
  const sync: SyncStatus = readOnly ? "readonly" : [catalogSync, brandingSync].includes("readonly") ? "readonly" : [catalogSync, brandingSync].includes("error") ? "error" : [catalogSync, brandingSync].includes("saving") ? "saving" : [catalogSync, brandingSync].includes("loading") ? "loading" : [catalogSync, brandingSync].includes("local") ? "local" : "synced";
  const flash = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(""), 3000); };

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(themeVariables(branding))) root.style.setProperty(name, value);
    document.title = `${branding.workspaceName || branding.orgName} · Scopewright`;
    // Browsers cache favicons aggressively and some honor only the first icon
    // link, so replace every icon link with a fresh element rather than editing
    // an href in place.
    const href = branding.favicon || "/favicon.svg";
    document.querySelectorAll('link[rel~="icon"]').forEach((link) => link.remove());
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = href;
    const mime = /^data:([^;,]+)/.exec(href)?.[1];
    if (mime) icon.type = mime;
    else if (href.endsWith(".svg")) icon.type = "image/svg+xml";
    document.head.appendChild(icon);
  }, [branding]);

  const breakdown = useMemo(() => calculate(catalog, estimate), [catalog, estimate]);
  const productIds = breakdown.products.map((item) => item.product.id);
  const groups = availableGroups(catalog, productIds);

  const update = (patch: Partial<Estimate>) => { setEstimate({ ...estimate, ...patch, updatedAt: Date.now() }); setSavedAt(0); };
  const toggleProduct = (id: string) => update({ products: estimate.products.includes(id) ? estimate.products.filter((item) => item !== id) : [...estimate.products, id] });
  const save = () => { setEstimate({ ...estimate, updatedAt: Date.now() }); setSavedAt(Date.now()); };
  const startNew = () => { if (!estimate.products.length || window.confirm("Start a new estimate? The current draft will be replaced.")) { setEstimate(emptyEstimate()); setStep(1); setSavedAt(0); } };
  const exportEstimate = () => {
    const payload = estimateExport(catalog, estimate);
    const slug = (estimate.customer || "estimate").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `scopewright-estimate-${slug}-${new Date().toISOString().slice(0, 10)}.json` });
    link.click();
    URL.revokeObjectURL(url);
    flash("Estimate exported.");
  };
  const importEstimate = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseEstimateExport(JSON.parse(String(reader.result)), emptyEstimate());
        if (!parsed) throw new Error("bad file");
        const preview = calculate(catalog, parsed);
        const missing = parsed.products.filter((id) => !catalog.products.some((product) => product.id === id));
        const label = `${parsed.customer || "Untitled customer"} — ${parsed.title || defaultTitle(preview)} (${preview.total}h)`;
        if (!window.confirm(`Load "${label}"? Your current draft will be replaced.${missing.length ? ` Note: ${missing.length} product(s) in the file no longer exist in the catalog and will be dropped.` : ""}`)) return;
        setEstimate({ ...parsed, products: parsed.products.filter((id) => !missing.includes(id)), updatedAt: Date.now() });
        setStep(1);
        setSavedAt(0);
        flash("Estimate imported. Review each step; hours reflect the current catalog.");
      } catch {
        flash("Import failed: choose a POC estimate JSON export.");
      }
    };
    reader.readAsText(file);
  };
  const resetCatalog = () => { if (window.confirm("Reset the catalog to the built-in defaults? Your custom products, questions, and deliverables will be removed.")) setCatalog(defaultCatalog); };

  const current = steps[step - 1];
  const title = views.find((item) => item.id === view)?.label ?? "";

  return (
    <main className={brandingLoaded ? "" : "theme-loading"}>
      <aside className="sidebar no-print">
        <div className="brand">
          {/* The sidebar slot is square, so a square favicon mark beats a wide wordmark there. */}
          {branding.favicon || branding.logo ? <img src={branding.favicon || branding.logo} alt="" className="brand-logo" /> : <span>{branding.initials || "POC"}</span>}
          <strong>{branding.workspaceName || branding.orgName}</strong>
          <small>{branding.tagline}</small>
        </div>
        <nav>
          {(["WORKSPACE", "MANAGE"] as const).map((section) => (
            <div key={section}>
              <p>{section}</p>
              {views.filter((item) => item.section === section).map((item) => (
                <button key={item.id} type="button" className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><i>{item.icon}</i> {item.label}</button>
              ))}
            </div>
          ))}
        </nav>
        <div className="profile">
          <div>{(identity?.user || identity?.email || branding.initials || "P").slice(0, 2).toUpperCase()}</div>
          <span>
            <b>{identity?.user || identity?.email || branding.workspaceName || branding.orgName}</b>
            <small className={`sync sync-${sync}`}>{sync === "readonly" ? "View only · shared workspace" : sync === "synced" ? "Shared workspace · synced" : sync === "saving" ? "Saving to server…" : sync === "loading" ? "Loading…" : sync === "local" ? "Offline · this browser only" : "Sync failed · retrying on next change"}</small>
          </span>
          {identity?.logoutUrl && identity.user && <a className="sign-out" href={identity.logoutUrl} title="Sign out">⎋</a>}
        </div>
      </aside>
      <section className="shell">
        <header className="no-print"><div><span className="crumb">{branding.tagline || "POC workspace"} /</span> {title}</div><div className="header-actions">{estimate.customer && <span className="crumb">{estimate.customer}</span>}<span className="avatar">{(branding.initials || "P").slice(0, 2)}</span></div></header>

        {view === "estimate" && (
          <div className="content">
            <div className="title-row">
              <div><span className="eyebrow">ESTIMATE BUILDER</span><h1>{estimate.title || "New estimate"}</h1><p>Build a defensible estimate across products and services.</p></div>
              <div className="actions">
                {notice && <span className="flash">{notice}</span>}
                <button type="button" className="secondary" onClick={startNew}>New estimate</button>
                <button type="button" className="secondary" onClick={() => importInput.current?.click()}>Import</button>
                <button type="button" className="secondary" onClick={exportEstimate}>Export</button>
                <button type="button" className="secondary" onClick={save}>{savedAt ? "Saved ✓" : "Save draft"}</button>
                <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={(event) => { importEstimate(event.target.files?.[0]); event.target.value = ""; }} />
              </div>
            </div>
            <div className="stepper steps-5">
              {steps.map((item, index) => <button key={item.label} type="button" className={step === index + 1 ? "current" : step > index + 1 ? "done" : ""} onClick={() => setStep(index + 1)}><span>{step > index + 1 ? "✓" : index + 1}</span><b>{item.label}</b></button>)}
            </div>
            <div className="workspace-grid">
              <div className="form-card">
                <div className="form-heading"><span>{String(step).padStart(2, "0")}</span><div><h2>{current.title}</h2><p>{current.copy}</p></div></div>
                {step === 1 && <ProductChooser products={catalog.products} selected={estimate.products} templates={catalog.solutions} onToggle={toggleProduct} onTemplate={(ids) => { update({ products: ids }); setStep(2); }} />}
                {step === 2 && <InstallationDetails catalog={catalog} estimate={estimate} breakdown={breakdown.products} update={update} />}
                {step === 3 && <Prerequisites estimate={estimate} breakdown={breakdown.prerequisites} update={update} />}
                {step === 4 && <Deliverables groups={groups} products={catalog.products} selected={estimate.selectedTasks} setSelected={(ids) => update({ selectedTasks: ids })} />}
                {step === 5 && <Review estimate={estimate} breakdown={breakdown} update={update} />}
                <div className="form-footer">
                  <button type="button" className="back" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>← Back</button>
                  {step < 5 ? <button type="button" className="primary" onClick={() => setStep(step + 1)}>{step === 4 ? "Review estimate" : `Continue to ${steps[step].label.toLowerCase()}`} <span>→</span></button> : <button type="button" className="primary" onClick={() => { save(); setView("scope"); }}>Open scope document <span>→</span></button>}
                </div>
              </div>
              <EstimateCard breakdown={breakdown} saved={Boolean(savedAt)} />
            </div>
          </div>
        )}
        {view === "scope" && <ScopeDocument catalog={catalog} estimate={estimate} breakdown={breakdown} branding={branding} update={update} onEdit={() => { setView("estimate"); setStep(1); }} />}
        {view === "updates" && <WeeklyUpdate estimate={estimate} branding={branding} />}
        {view === "catalog" && <ReadOnlyGate readOnly={readOnly}><CatalogManager catalog={catalog} setCatalog={setCatalog} onReset={resetCatalog} /></ReadOnlyGate>}
        {view === "settings" && <ReadOnlyGate readOnly={readOnly}><Settings branding={branding} setBranding={setBranding} catalog={catalog} setCatalog={setCatalog} /></ReadOnlyGate>}
      </section>
    </main>
  );
}

/** Viewers can look at the catalog and settings but not change them. */
function ReadOnlyGate({ readOnly, children }: { readOnly: boolean; children: React.ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return (
    <div className="read-only">
      <div className="notice read-only-notice"><b>View only</b><span>You can browse the shared catalog and settings, but only editors can change them. Ask a workspace editor to add you.</span></div>
      <div className="read-only-body" aria-disabled="true">{children}</div>
    </div>
  );
}
