"use client";

import { useState } from "react";
import { groupHours, removeFromCatalog, selectionKey } from "../lib/estimate";
import type { CatalogRemoval } from "../lib/estimate";
import { phases } from "../lib/types";
import type { Catalog, DeliverableGroup, DeliverableTask, InstallationChoice, InstallationField, Phase, PrerequisiteItem, Product, SolutionTemplate } from "../lib/types";
import { ConfirmDialog } from "./ConfirmDialog";

type Props = { catalog: Catalog; setCatalog: (catalog: Catalog) => void };
type Tab = "products" | "installation" | "prerequisites" | "deliverables" | "solutions" | "outofscope";

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const byName = (a: Product, b: Product) => a.short.localeCompare(b.short, undefined, { sensitivity: "base", numeric: true }) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Which part of the catalog each tab's selection deletes from. */
const removalField: Record<Tab, keyof CatalogRemoval> = { products: "products", solutions: "solutions", installation: "fields", prerequisites: "prerequisites", deliverables: "groups", outofscope: "outOfScope" };

/** What a checkbox on each tab selects, and what deleting the selection is called. */
const nouns: Record<Tab, [string, string]> = { products: ["product", "products"], solutions: ["solution", "solutions"], installation: ["question", "questions"], prerequisites: ["prerequisite", "prerequisites"], deliverables: ["deliverable group", "deliverable groups"], outofscope: ["out-of-scope item", "out-of-scope items"] };

export function CatalogManager({ catalog, setCatalog }: Props) {
  const [tab, setTab] = useState<Tab>("products");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<Product | null>(null);
  const products = catalog.products;
  const patch = (next: Partial<Catalog>) => setCatalog({ ...catalog, ...next });

  // Alphabetical, but only re-sorted when products are added or removed, so a card doesn't jump away while its name is being typed.
  const idsKey = products.map((product) => product.id).join("\n");
  const [order, setOrder] = useState(() => ({ key: idsKey, ids: [...products].sort(byName).map((product) => product.id) }));
  if (order.key !== idsKey) setOrder({ key: idsKey, ids: [...products].sort(byName).map((product) => product.id) });
  const sorted = order.ids.map((id) => products.find((product) => product.id === id)).filter((product): product is Product => Boolean(product));

  const updateProduct = (id: string, changes: Partial<Product>) => patch({ products: products.map((product) => product.id === id ? { ...product, ...changes } : product) });
  const draftReady = Boolean(draft?.name.trim() && draft.short.trim());
  const saveDraft = () => {
    if (!draft || !draftReady) return;
    const short = draft.short.trim();
    patch({ products: [...products, { ...draft, name: draft.name.trim(), short, portfolio: draft.portfolio.trim() || "Products", mark: draft.mark.trim() || short.replace(/\s+/g, "").slice(0, 3).toUpperCase() }] });
    setDraft(null);
  };

  const switchTab = (next: Tab) => { setTab(next); setSelected(new Set()); };
  const toggle = (key: string, on: boolean) => setSelected((current) => { const next = new Set(current); if (on) next.add(key); else next.delete(key); return next; });
  const check = (key: string, label: string) => <input type="checkbox" className="row-check" aria-label={`Select ${label || "untitled"}`} checked={selected.has(key)} onChange={(event) => toggle(key, event.target.checked)} />;

  /** Every row the current tab can select, with the name the confirmation shows. */
  const rows: { key: string; label: string }[] =
    tab === "products" ? sorted.map((product) => ({ key: product.id, label: product.short || product.name }))
    : tab === "solutions" ? catalog.solutions.map((solution) => ({ key: solution.id, label: solution.title }))
    : tab === "installation" ? sorted.flatMap((product) => (catalog.installation[product.id] ?? []).map((field) => ({ key: selectionKey(product.id, field.id), label: `${product.short}: ${field.label}` })))
    : tab === "prerequisites" ? sorted.flatMap((product) => (catalog.prerequisites[product.id] ?? []).map((item) => ({ key: selectionKey(product.id, item.id), label: `${product.short}: ${item.label}` })))
    : tab === "deliverables" ? catalog.groups.map((group) => ({ key: group.id, label: group.name }))
    : catalog.outOfScope.map((item) => ({ key: item.id, label: item.label }));
  const chosen = rows.filter((row) => selected.has(row.key));
  const [one, many] = nouns[tab];

  const deleteSelected = () => {
    const keys = chosen.map((row) => row.key);
    setCatalog(removeFromCatalog(catalog, { [removalField[tab]]: keys }));
    setSelected(new Set());
    setConfirming(false);
  };

  /** What else goes when products or groups are deleted, spelled out before it happens. */
  const consequences = () => {
    const ids = new Set(chosen.map((row) => row.key));
    if (tab === "products") {
      const questions = [...ids].reduce((sum, id) => sum + (catalog.installation[id] ?? []).length, 0);
      const prereqs = [...ids].reduce((sum, id) => sum + (catalog.prerequisites[id] ?? []).length, 0);
      const groups = catalog.groups.filter((group) => ids.has(group.productId)).length;
      const solutions = catalog.solutions.filter((solution) => solution.products.some((id) => ids.has(id))).length;
      return `This also deletes their ${plural(questions, "installation question")}, ${plural(prereqs, "prerequisite")}, and ${plural(groups, "deliverable group")}${solutions ? `, and removes them from ${plural(solutions, "solution")}` : ""}.`;
    }
    if (tab === "deliverables") return `This also deletes their ${plural(catalog.groups.filter((group) => ids.has(group.id)).reduce((sum, group) => sum + group.tasks.length, 0), "task")}.`;
    if (tab === "installation") return "Estimates that already answered these questions lose those answers.";
    return "";
  };

  const setFields = (productId: string, fields: InstallationField[]) => patch({ installation: { ...catalog.installation, [productId]: fields } });
  const updateField = (productId: string, fieldId: string, changes: Partial<InstallationField>) => setFields(productId, (catalog.installation[productId] ?? []).map((field) => field.id === fieldId ? { ...field, ...changes } : field));
  const updateChoice = (productId: string, field: InstallationField, choiceId: string, changes: Partial<InstallationChoice>) => updateField(productId, field.id, { choices: field.choices.map((choice) => choice.id === choiceId ? { ...choice, ...changes } : choice) });
  const move = <T,>(items: T[], from: number, to: number) => { if (to < 0 || to >= items.length) return items; const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

  const setPrereqs = (productId: string, items: PrerequisiteItem[]) => patch({ prerequisites: { ...catalog.prerequisites, [productId]: items } });
  const updatePrereq = (productId: string, itemId: string, changes: Partial<PrerequisiteItem>) => setPrereqs(productId, (catalog.prerequisites[productId] ?? []).map((item) => item.id === itemId ? { ...item, ...changes } : item));

  const setSolutions = (solutions: SolutionTemplate[]) => patch({ solutions });
  const updateSolution = (id: string, changes: Partial<SolutionTemplate>) => setSolutions(catalog.solutions.map((item) => item.id === id ? { ...item, ...changes } : item));
  const addSolution = () => setSolutions([...catalog.solutions, { id: uid("solution"), label: "SOLUTION", title: "New solution", subtitle: "", products: [] }]);

  const setGroups = (groups: DeliverableGroup[]) => patch({ groups });
  const updateGroup = (id: string, changes: Partial<DeliverableGroup>) => setGroups(catalog.groups.map((group) => group.id === id ? { ...group, ...changes } : group));
  const updateTask = (groupId: string, taskId: string, changes: Partial<DeliverableTask>) => updateGroup(groupId, { tasks: catalog.groups.find((group) => group.id === groupId)!.tasks.map((task) => task.id === taskId ? { ...task, ...changes } : task) });
  /** Turn the "Offer" switch on or off for every task, or for one group. */
  const offerAll = (enabled: boolean, groupId?: string) => setGroups(catalog.groups.map((group) => (!groupId || group.id === groupId) ? { ...group, tasks: group.tasks.map((task) => ({ ...task, enabled })) } : group));
  const addGroup = () => setGroups([...catalog.groups, { id: uid("group"), name: "New deliverable group", category: "Platform", productId: "", scopeNumber: String(catalog.groups.length + 1), tasks: [] }]);

  const selectionBar = rows.length > 0 && (
    <div className="selection-bar">
      <label>
        <input type="checkbox" aria-label={`Select all ${many}`} checked={chosen.length > 0 && chosen.length === rows.length} ref={(box) => { if (box) box.indeterminate = chosen.length > 0 && chosen.length < rows.length; }} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.key)) : new Set())} />
        <span>{chosen.length ? `${chosen.length} of ${plural(rows.length, one, many)} selected` : `Select ${many} to delete`}</span>
      </label>
      {chosen.length > 0 && <button type="button" className="link" onClick={() => setSelected(new Set())}>Clear</button>}
      <button type="button" className="destructive-outline" disabled={!chosen.length} onClick={() => setConfirming(true)}>Delete selected{chosen.length ? ` (${chosen.length})` : ""}</button>
    </div>
  );
  /** How many of one product's questions or prerequisites are ticked, shown on its collapsed card. */
  const selectedIn = (productId: string) => { const prefix = selectionKey(productId, ""); const count = chosen.filter((row) => row.key.startsWith(prefix)).length; return count ? ` · ${count} selected` : ""; };

  return (
    <div className="designer">
      <div className="designer-tabs" role="tablist">
        {([["products", "01", "Products"], ["solutions", "02", "Solutions"], ["installation", "03", "Installation Details"], ["prerequisites", "04", "Prerequisites"], ["deliverables", "05", "Deliverables"], ["outofscope", "06", "Out of Scope"]] as const).map(([id, number, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => switchTab(id)}><span>{number}</span> {label}</button>
        ))}
      </div>

      {tab === "products" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Products and portfolios</h1><p>Products appear in the first step of New Estimate, grouped by portfolio. A required foundation is pulled into every estimate that needs it.</p></div><div className="actions"><button type="button" className="primary" disabled={Boolean(draft)} onClick={() => setDraft({ id: uid("product"), name: "", short: "", portfolio: sorted[sorted.length - 1]?.portfolio ?? "", mark: "", hours: 0 })}>+ Add product</button></div></div>
          {draft && (
            <section className="product-draft" aria-label="New product">
              <header><span><b>New product</b><small>Not in the catalog until you save it. Product name and short name are required.</small></span><div className="actions"><button type="button" className="secondary" onClick={() => setDraft(null)}>Cancel</button><button type="button" className="primary" disabled={!draftReady} onClick={saveDraft}>Save product</button></div></header>
              <ProductFields product={draft} others={sorted} onChange={(changes) => setDraft({ ...draft, ...changes })} />
            </section>
          )}
          {selectionBar}
          <div className="designer-list">
            {!sorted.length && !draft && <p className="panel-copy list-empty">No products yet. Add one, or import a catalog in Settings.</p>}
            {sorted.map((product) => (
              <div className="select-row" key={product.id}>
                {check(product.id, product.short)}
                <details>
                  <summary><i>{product.mark}</i><span><b>{product.short}</b><small>{product.portfolio} · {product.name}</small></span><em>{product.hours}h base · {(catalog.installation[product.id] ?? []).length} questions · {(catalog.prerequisites[product.id] ?? []).length} prerequisites · {catalog.groups.filter((group) => group.productId === product.id).length} groups</em></summary>
                  <ProductFields product={product} others={sorted.filter((item) => item.id !== product.id)} onChange={(changes) => updateProduct(product.id, changes)} />
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "solutions" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Solutions</h1><p>Pre-canned demonstrations shown as cards at the top of the Products step. One click selects the products they include. Leave this empty and the step starts straight at the product list.</p></div><button type="button" className="primary" onClick={addSolution}>+ Add solution</button></div>
          {catalog.solutions.length > 0 && (
            <div className="solution-preview">
              <span className="preview-label">Preview</span>
              <div className="template-strip">
                {catalog.solutions.map((solution) => <div className="template-card" key={solution.id}>{solution.label && <span>{solution.label}</span>}<b>{solution.title || "Untitled"}</b>{solution.subtitle && <small>{solution.subtitle}</small>}</div>)}
              </div>
            </div>
          )}
          {selectionBar}
          <div className="designer-list">
            {catalog.solutions.length === 0 && <p className="panel-copy list-empty">No solutions yet. The Products step shows only the product list.</p>}
            {catalog.solutions.map((solution, index) => (
              <div className="select-row" key={solution.id}>
                {check(solution.id, solution.title)}
                <details open={index === catalog.solutions.length - 1 && solution.title === "New solution"}>
                  <summary><i>{index + 1}</i><span><b>{solution.title || "Untitled"}</b><small>{solution.label || "no tag"} · {solution.products.map((id) => products.find((product) => product.id === id)?.short ?? id).join(" + ") || "no products"}</small></span></summary>
                  <div className="designer-fields solution-fields">
                    <label>Tag<input placeholder="POPULAR" value={solution.label} onChange={(event) => updateSolution(solution.id, { label: event.target.value.toUpperCase() })} /></label>
                    <label>Title<input value={solution.title} onChange={(event) => updateSolution(solution.id, { title: event.target.value })} /></label>
                    <label>Subtitle<input placeholder="What the customer gets" value={solution.subtitle} onChange={(event) => updateSolution(solution.id, { subtitle: event.target.value })} /></label>
                    <fieldset className="wide product-picks"><legend>Products included in this solution</legend>
                      {sorted.map((product) => <label key={product.id} className="pick"><input type="checkbox" checked={solution.products.includes(product.id)} onChange={(event) => updateSolution(solution.id, { products: event.target.checked ? [...solution.products, product.id] : solution.products.filter((id) => id !== product.id) })} /><i>{product.mark}</i>{product.short}</label>)}
                    </fieldset>
                    <div className="row-actions wide">
                      <span className="order-label">Order in the Products step</span>
                      <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => setSolutions(move(catalog.solutions, index, index - 1))}>↑</button>
                      <button type="button" className="icon" aria-label="Move down" disabled={index === catalog.solutions.length - 1} onClick={() => setSolutions(move(catalog.solutions, index, index + 1))}>↓</button>
                    </div>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "installation" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Installation decisions</h1><p>Each question becomes a drop-down in the Installation Details step. The chosen answer adds its hours to the estimate and is printed in the scope document.</p></div></div>
          {selectionBar}
          <div className="designer-list">
            {sorted.map((product) => {
              const fields = catalog.installation[product.id] ?? [];
              return (
                <details key={product.id}>
                  <summary><i>{product.mark}</i><span><b>{product.short}</b><small>{fields.length} question{fields.length === 1 ? "" : "s"} · {fields.reduce((sum, field) => sum + field.choices.length, 0)} choices{selectedIn(product.id)}</small></span></summary>
                  <div className="field-builder">
                    {fields.map((field, index) => (
                      <section key={field.id}>
                        <header>
                          {check(selectionKey(product.id, field.id), field.label)}
                          <input aria-label="Question" value={field.label} onChange={(event) => updateField(product.id, field.id, { label: event.target.value })} />
                          <div className="row-actions">
                            <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => setFields(product.id, move(fields, index, index - 1))}>↑</button>
                            <button type="button" className="icon" aria-label="Move down" disabled={index === fields.length - 1} onClick={() => setFields(product.id, move(fields, index, index + 1))}>↓</button>
                          </div>
                        </header>
                        <input className="help" placeholder="Optional help text shown under the question" value={field.help ?? ""} onChange={(event) => updateField(product.id, field.id, { help: event.target.value })} />
                        {field.choices.map((choice) => (
                          <div key={choice.id} className="choice-row">
                            <input aria-label="Choice" value={choice.label} onChange={(event) => updateChoice(product.id, field, choice.id, { label: event.target.value })} />
                            <label><input type="number" min="0" step="0.5" value={choice.hours} onChange={(event) => updateChoice(product.id, field, choice.id, { hours: Number(event.target.value) })} /><span>h</span></label>
                            <button type="button" className="icon" aria-label="Remove choice" title="Remove choice" disabled={field.choices.length === 1} onClick={() => updateField(product.id, field.id, { choices: field.choices.filter((item) => item.id !== choice.id) })}>×</button>
                          </div>
                        ))}
                        <button type="button" className="add-task" onClick={() => updateField(product.id, field.id, { choices: [...field.choices, { id: uid("choice"), label: "New option", hours: 0 }] })}>+ Add choice</button>
                      </section>
                    ))}
                    <button type="button" className="add-field" onClick={() => setFields(product.id, [...fields, { id: uid("field"), label: "New installation question", choices: [{ id: uid("choice"), label: "New option", hours: 0 }] }])}>+ Add question for {product.short}</button>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {tab === "prerequisites" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Prerequisites</h1><p>What the customer must provide before each product can be deployed. These pre-populate the Prerequisites step for every estimate that includes the product, and the SA can add engagement-specific ones there.</p></div></div>
          {selectionBar}
          <div className="designer-list">
            {sorted.map((product) => {
              const items = catalog.prerequisites[product.id] ?? [];
              return (
                <details key={product.id}>
                  <summary><i>{product.mark}</i><span><b>{product.short}</b><small>{items.length} prerequisite{items.length === 1 ? "" : "s"} · {items.filter((item) => item.required).length} required{selectedIn(product.id)}</small></span></summary>
                  <div className="field-builder">
                    {items.length > 0 && <div className="prereq-head"><span></span><span>Prerequisite</span><span>Example value</span><span>Help text</span><span>Required</span><span></span></div>}
                    {items.map((item, index) => (
                      <div key={item.id} className="prereq-edit">
                        {check(selectionKey(product.id, item.id), item.label)}
                        <input aria-label="Prerequisite" value={item.label} onChange={(event) => updatePrereq(product.id, item.id, { label: event.target.value })} />
                        <input aria-label="Example value" placeholder="e.g. 192.168.10.5" value={item.placeholder ?? ""} onChange={(event) => updatePrereq(product.id, item.id, { placeholder: event.target.value })} />
                        <input aria-label="Help text" placeholder="Optional guidance" value={item.help ?? ""} onChange={(event) => updatePrereq(product.id, item.id, { help: event.target.value })} />
                        <label className="workflow-toggle"><input type="checkbox" checked={item.required} onChange={(event) => updatePrereq(product.id, item.id, { required: event.target.checked })} /><span>Required</span></label>
                        <div className="row-actions">
                          <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => setPrereqs(product.id, move(items, index, index - 1))}>↑</button>
                          <button type="button" className="icon" aria-label="Move down" disabled={index === items.length - 1} onClick={() => setPrereqs(product.id, move(items, index, index + 1))}>↓</button>
                        </div>
                      </div>
                    ))}
                    <button type="button" className="add-field" onClick={() => setPrereqs(product.id, [...items, { id: uid("prereq"), label: "New prerequisite", required: true }])}>+ Add prerequisite for {product.short}</button>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      )}

      {tab === "outofscope" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Out of scope</h1><p>Things your team commonly excludes from an engagement. They appear as checkboxes in the Engagement step, and the ones an SA ticks are printed in the scope document. SAs can always add engagement-specific items there too.</p></div><button type="button" className="primary" onClick={() => patch({ outOfScope: [...catalog.outOfScope, { id: uid("oos"), label: "" }] })}>+ Add item</button></div>
          {selectionBar}
          <div className="designer-list oos-list">
            {catalog.outOfScope.length === 0 && <p className="panel-copy list-empty">No common out-of-scope items yet.</p>}
            {catalog.outOfScope.map((item, index) => (
              <div className="oos-edit" key={item.id}>
                {check(item.id, item.label)}
                <input aria-label="Out-of-scope item" placeholder="e.g. Production hardening and performance tuning" value={item.label} onChange={(event) => patch({ outOfScope: catalog.outOfScope.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry) })} />
                <div className="row-actions">
                  <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => patch({ outOfScope: move(catalog.outOfScope, index, index - 1) })}>↑</button>
                  <button type="button" className="icon" aria-label="Move down" disabled={index === catalog.outOfScope.length - 1} onClick={() => patch({ outOfScope: move(catalog.outOfScope, index, index + 1) })}>↓</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "deliverables" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Deliverable workflows</h1><p>Group tasks by the product they belong to. Only groups tied to a product in the engagement, or to no product, are offered in the Deliverables step.</p></div><div className="actions"><button type="button" className="secondary" onClick={() => offerAll(true)}>Offer all</button><button type="button" className="secondary" onClick={() => offerAll(false)}>Offer none</button><button type="button" className="primary" onClick={addGroup}>+ Add group</button></div></div>
          {selectionBar}
          <div className="catalog-groups">
            {catalog.groups.map((group, index) => (
              <div className="select-row" key={group.id}>
                {check(group.id, group.name)}
                <details open={index === 0}>
                  <summary><span><b>{group.scopeNumber && `${group.scopeNumber} · `}{group.name}</b><small>{group.category} · {products.find((product) => product.id === group.productId)?.short ?? "Any product"} · {group.tasks.length} tasks</small></span><em>{group.tasks.filter((task) => task.enabled).length} offered</em><strong>{groupHours(group)}h</strong></summary>
                  <div className="catalog-group-body">
                    <div className="group-settings">
                      <label>Section no.<input placeholder="2" value={group.scopeNumber ?? ""} onChange={(event) => updateGroup(group.id, { scopeNumber: event.target.value })} /></label>
                      <label>Group name<input value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} /></label>
                      <label>Category<input value={group.category} onChange={(event) => updateGroup(group.id, { category: event.target.value })} /></label>
                      <label>Product<select value={group.productId} onChange={(event) => updateGroup(group.id, { productId: event.target.value })}><option value="">Any product</option>{sorted.map((product) => <option key={product.id} value={product.id}>{product.short}</option>)}</select></label>
                      <div className="row-actions">
                        <button type="button" className="offer-toggle" disabled={!group.tasks.length} onClick={() => offerAll(!group.tasks.every((task) => task.enabled), group.id)}>{group.tasks.length && group.tasks.every((task) => task.enabled) ? "Offer none" : "Offer all"}</button>
                        <button type="button" className="icon" aria-label="Move group up" disabled={index === 0} onClick={() => setGroups(move(catalog.groups, index, index - 1))}>↑</button>
                        <button type="button" className="icon" aria-label="Move group down" disabled={index === catalog.groups.length - 1} onClick={() => setGroups(move(catalog.groups, index, index + 1))}>↓</button>
                      </div>
                    </div>
                    <div className="catalog-task-head"><span>Item no.</span><span>Task</span><span>Delivery phase</span><span>Effort</span><span>Workflow</span><span></span></div>
                    {group.tasks.map((task) => (
                      <div className="catalog-task" key={task.id}>
                        <input className="scope-number" placeholder="2.1" value={task.scopeNumber ?? ""} onChange={(event) => updateTask(group.id, task.id, { scopeNumber: event.target.value })} />
                        <input aria-label="Task" value={task.name} onChange={(event) => updateTask(group.id, task.id, { name: event.target.value })} />
                        <select value={task.phase} onChange={(event) => updateTask(group.id, task.id, { phase: event.target.value as Phase })}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select>
                        <label><input type="number" min="0" step="0.5" value={task.hours} onChange={(event) => updateTask(group.id, task.id, { hours: Number(event.target.value) })} /><span>h</span></label>
                        <label className="workflow-toggle"><input type="checkbox" checked={task.enabled} onChange={(event) => updateTask(group.id, task.id, { enabled: event.target.checked })} /><span>Offer</span></label>
                        <button type="button" className="icon" aria-label="Remove task" title="Remove task" onClick={() => updateGroup(group.id, { tasks: group.tasks.filter((item) => item.id !== task.id) })}>×</button>
                      </div>
                    ))}
                    <button type="button" className="add-task" onClick={() => updateGroup(group.id, { tasks: [...group.tasks, { id: uid("task"), name: "New task", phase: "Deployment", hours: 1, enabled: true, scopeNumber: `${group.scopeNumber || ""}${group.scopeNumber ? "." : ""}${group.tasks.length + 1}` }] })}>+ Add task to group</button>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirming && chosen.length > 0 && (
        <ConfirmDialog title={`Delete ${plural(chosen.length, one, many)}?`} confirmLabel={`Delete ${plural(chosen.length, one, many)}`} onCancel={() => setConfirming(false)} onConfirm={deleteSelected}>
          <ul className="confirm-list">
            {chosen.slice(0, 8).map((row) => <li key={row.key}>{row.label || "Untitled"}</li>)}
            {chosen.length > 8 && <li>…and {chosen.length - 8} more</li>}
          </ul>
          {consequences() && <p className="modal-note">{consequences()}</p>}
          <p className="modal-warning">This changes the shared catalog for everyone and cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** The editable fields of one product, shared by a saved product and a new, unsaved one. */
function ProductFields({ product, others, onChange }: { product: Product; others: Product[]; onChange: (changes: Partial<Product>) => void }) {
  const requires = product.requires ?? [];
  return (
    <div className="designer-fields">
      <label>Portfolio<input value={product.portfolio} onChange={(event) => onChange({ portfolio: event.target.value })} /></label>
      <label>Product name<input value={product.name} onChange={(event) => onChange({ name: event.target.value })} /></label>
      <label>Short name<input value={product.short} onChange={(event) => onChange({ short: event.target.value })} /></label>
      <label>Badge<input value={product.mark} maxLength={3} onChange={(event) => onChange({ mark: event.target.value.toUpperCase() })} /></label>
      <label>Base work package (hours)<input type="number" min="0" step="0.5" value={product.hours} onChange={(event) => onChange({ hours: Number(event.target.value) })} /></label>
      <label className="wide">Description<input value={product.description ?? ""} onChange={(event) => onChange({ description: event.target.value })} /></label>
      <fieldset className="wide product-picks"><legend>Required foundations · pulled into every estimate that includes {product.short || "this product"}</legend>
        {others.map((item) => <label key={item.id} className="pick"><input type="checkbox" checked={requires.includes(item.id)} onChange={(event) => onChange({ requires: event.target.checked ? [...requires, item.id] : requires.filter((id) => id !== item.id) })} /><i>{item.mark}</i>{item.short}</label>)}
        {!others.length && <small>Add another product to define a dependency.</small>}
      </fieldset>
    </div>
  );
}
