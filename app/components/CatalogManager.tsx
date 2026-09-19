"use client";

import { useState } from "react";
import { groupHours } from "../lib/estimate";
import { phases } from "../lib/types";
import type { Catalog, DeliverableGroup, DeliverableTask, InstallationChoice, InstallationField, Phase, PrerequisiteItem, Product, SolutionTemplate } from "../lib/types";

type Props = { catalog: Catalog; setCatalog: (catalog: Catalog) => void; onReset: () => void };
type Tab = "products" | "installation" | "prerequisites" | "deliverables" | "solutions" | "outofscope";

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function CatalogManager({ catalog, setCatalog, onReset }: Props) {
  const [tab, setTab] = useState<Tab>("products");
  const products = catalog.products;
  const patch = (next: Partial<Catalog>) => setCatalog({ ...catalog, ...next });

  const updateProduct = (id: string, changes: Partial<Product>) => patch({ products: products.map((product) => product.id === id ? { ...product, ...changes } : product) });
  const addProduct = () => patch({ products: [...products, { id: uid("product"), name: "New product", short: "New", portfolio: products[products.length - 1]?.portfolio ?? "Portfolio", mark: "NP", hours: 0 }] });
  const removeProduct = (id: string) => {
    if (!window.confirm("Delete this product, its installation questions, and its deliverable groups?")) return;
    const { [id]: _dropped, ...installation } = catalog.installation;
    const { [id]: _droppedPrereqs, ...prerequisites } = catalog.prerequisites;
    void _dropped; void _droppedPrereqs;
    setCatalog({
      products: products.filter((product) => product.id !== id).map((product) => ({ ...product, requires: (product.requires ?? []).filter((dep) => dep !== id) })),
      installation,
      prerequisites,
      groups: catalog.groups.filter((group) => group.productId !== id),
      solutions: catalog.solutions.map((solution) => ({ ...solution, products: solution.products.filter((item) => item !== id) })),
      outOfScope: catalog.outOfScope,
    });
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

  return (
    <div className="designer">
      <div className="designer-tabs" role="tablist">
        {([["products", "01", "Products"], ["solutions", "02", "Solutions"], ["installation", "03", "Installation Details"], ["prerequisites", "04", "Prerequisites"], ["deliverables", "05", "Deliverables"], ["outofscope", "06", "Out of Scope"]] as const).map(([id, number, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{number}</span> {label}</button>
        ))}
      </div>

      {tab === "products" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Products and portfolios</h1><p>Products appear in the first step of New Estimate, grouped by portfolio. A required foundation is pulled into every estimate that needs it.</p></div><div className="actions"><button type="button" className="secondary" onClick={onReset}>Reset catalog</button><button type="button" className="primary" onClick={addProduct}>+ Add product</button></div></div>
          <div className="designer-list">
            {products.map((product) => (
              <details key={product.id}>
                <summary><i>{product.mark}</i><span><b>{product.short}</b><small>{product.portfolio} · {product.name}</small></span><em>{product.hours}h base · {(catalog.installation[product.id] ?? []).length} questions · {(catalog.prerequisites[product.id] ?? []).length} prerequisites · {catalog.groups.filter((group) => group.productId === product.id).length} groups</em></summary>
                <div className="designer-fields">
                  <label>Portfolio<input value={product.portfolio} onChange={(event) => updateProduct(product.id, { portfolio: event.target.value })} /></label>
                  <label>Product name<input value={product.name} onChange={(event) => updateProduct(product.id, { name: event.target.value })} /></label>
                  <label>Short name<input value={product.short} onChange={(event) => updateProduct(product.id, { short: event.target.value })} /></label>
                  <label>Badge<input value={product.mark} maxLength={3} onChange={(event) => updateProduct(product.id, { mark: event.target.value.toUpperCase() })} /></label>
                  <label>Base work package (hours)<input type="number" min="0" step="0.5" value={product.hours} onChange={(event) => updateProduct(product.id, { hours: Number(event.target.value) })} /></label>
                  <label className="wide">Description<input value={product.description ?? ""} onChange={(event) => updateProduct(product.id, { description: event.target.value })} /></label>
                  <fieldset className="wide product-picks"><legend>Required foundations · pulled into every estimate that includes {product.short}</legend>
                    {products.filter((item) => item.id !== product.id).map((item) => <label key={item.id} className="pick"><input type="checkbox" checked={(product.requires ?? []).includes(item.id)} onChange={(event) => updateProduct(product.id, { requires: event.target.checked ? [...(product.requires ?? []), item.id] : (product.requires ?? []).filter((id) => id !== item.id) })} /><i>{item.mark}</i>{item.short}</label>)}
                    {products.length < 2 && <small>Add another product to define a dependency.</small>}
                  </fieldset>
                  <button type="button" className="danger" onClick={() => removeProduct(product.id)}>Delete product</button>
                </div>
              </details>
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
          <div className="designer-list">
            {catalog.solutions.length === 0 && <p className="panel-copy list-empty">No solutions yet. The Products step shows only the product list.</p>}
            {catalog.solutions.map((solution, index) => (
              <details key={solution.id} open={index === catalog.solutions.length - 1 && solution.title === "New solution"}>
                <summary><i>{index + 1}</i><span><b>{solution.title || "Untitled"}</b><small>{solution.label || "no tag"} · {solution.products.map((id) => products.find((product) => product.id === id)?.short ?? id).join(" + ") || "no products"}</small></span></summary>
                <div className="designer-fields solution-fields">
                  <label>Tag<input placeholder="POPULAR" value={solution.label} onChange={(event) => updateSolution(solution.id, { label: event.target.value.toUpperCase() })} /></label>
                  <label>Title<input value={solution.title} onChange={(event) => updateSolution(solution.id, { title: event.target.value })} /></label>
                  <label>Subtitle<input placeholder="What the customer gets" value={solution.subtitle} onChange={(event) => updateSolution(solution.id, { subtitle: event.target.value })} /></label>
                  <fieldset className="wide product-picks"><legend>Products included in this solution</legend>
                    {products.map((product) => <label key={product.id} className="pick"><input type="checkbox" checked={solution.products.includes(product.id)} onChange={(event) => updateSolution(solution.id, { products: event.target.checked ? [...solution.products, product.id] : solution.products.filter((id) => id !== product.id) })} /><i>{product.mark}</i>{product.short}</label>)}
                  </fieldset>
                  <div className="row-actions wide">
                    <button type="button" className="secondary" aria-label="Move up" onClick={() => setSolutions(move(catalog.solutions, index, index - 1))}>↑ Move up</button>
                    <button type="button" className="secondary" aria-label="Move down" onClick={() => setSolutions(move(catalog.solutions, index, index + 1))}>↓ Move down</button>
                    <button type="button" className="danger" onClick={() => window.confirm(`Delete “${solution.title}”?`) && setSolutions(catalog.solutions.filter((item) => item.id !== solution.id))}>Delete solution</button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {tab === "installation" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Installation decisions</h1><p>Each question becomes a drop-down in the Installation Details step. The chosen answer adds its hours to the estimate and is printed in the scope document.</p></div></div>
          <div className="designer-list">
            {products.map((product) => {
              const fields = catalog.installation[product.id] ?? [];
              return (
                <details key={product.id}>
                  <summary><i>{product.mark}</i><span><b>{product.short}</b><small>{fields.length} question{fields.length === 1 ? "" : "s"} · {fields.reduce((sum, field) => sum + field.choices.length, 0)} choices</small></span></summary>
                  <div className="field-builder">
                    {fields.map((field, index) => (
                      <section key={field.id}>
                        <header>
                          <input aria-label="Question" value={field.label} onChange={(event) => updateField(product.id, field.id, { label: event.target.value })} />
                          <div className="row-actions">
                            <button type="button" aria-label="Move up" onClick={() => setFields(product.id, move(fields, index, index - 1))}>↑</button>
                            <button type="button" aria-label="Move down" onClick={() => setFields(product.id, move(fields, index, index + 1))}>↓</button>
                            <button type="button" className="danger" onClick={() => setFields(product.id, fields.filter((item) => item.id !== field.id))}>Remove</button>
                          </div>
                        </header>
                        <input className="help" placeholder="Optional help text shown under the question" value={field.help ?? ""} onChange={(event) => updateField(product.id, field.id, { help: event.target.value })} />
                        {field.choices.map((choice) => (
                          <div key={choice.id} className="choice-row">
                            <input aria-label="Choice" value={choice.label} onChange={(event) => updateChoice(product.id, field, choice.id, { label: event.target.value })} />
                            <label><input type="number" min="0" step="0.5" value={choice.hours} onChange={(event) => updateChoice(product.id, field, choice.id, { hours: Number(event.target.value) })} /><span>h</span></label>
                            <button type="button" aria-label="Remove choice" onClick={() => updateField(product.id, field.id, { choices: field.choices.filter((item) => item.id !== choice.id) })}>−</button>
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
          <div className="designer-list">
            {products.map((product) => {
              const items = catalog.prerequisites[product.id] ?? [];
              return (
                <details key={product.id}>
                  <summary><i>{product.mark}</i><span><b>{product.short}</b><small>{items.length} prerequisite{items.length === 1 ? "" : "s"} · {items.filter((item) => item.required).length} required</small></span></summary>
                  <div className="field-builder">
                    {items.length > 0 && <div className="prereq-head"><span>Prerequisite</span><span>Example value</span><span>Help text</span><span>Required</span><span></span></div>}
                    {items.map((item, index) => (
                      <div key={item.id} className="prereq-edit">
                        <input aria-label="Prerequisite" value={item.label} onChange={(event) => updatePrereq(product.id, item.id, { label: event.target.value })} />
                        <input aria-label="Example value" placeholder="e.g. 192.168.10.5" value={item.placeholder ?? ""} onChange={(event) => updatePrereq(product.id, item.id, { placeholder: event.target.value })} />
                        <input aria-label="Help text" placeholder="Optional guidance" value={item.help ?? ""} onChange={(event) => updatePrereq(product.id, item.id, { help: event.target.value })} />
                        <label className="workflow-toggle"><input type="checkbox" checked={item.required} onChange={(event) => updatePrereq(product.id, item.id, { required: event.target.checked })} /><span>Required</span></label>
                        <div className="row-actions">
                          <button type="button" aria-label="Move up" onClick={() => setPrereqs(product.id, move(items, index, index - 1))}>↑</button>
                          <button type="button" aria-label="Move down" onClick={() => setPrereqs(product.id, move(items, index, index + 1))}>↓</button>
                          <button type="button" aria-label="Remove prerequisite" onClick={() => setPrereqs(product.id, items.filter((line) => line.id !== item.id))}>−</button>
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
          <div className="designer-list oos-list">
            {catalog.outOfScope.length === 0 && <p className="panel-copy list-empty">No common out-of-scope items yet.</p>}
            {catalog.outOfScope.map((item, index) => (
              <div className="oos-edit" key={item.id}>
                <input aria-label="Out-of-scope item" placeholder="e.g. Production hardening and performance tuning" value={item.label} onChange={(event) => patch({ outOfScope: catalog.outOfScope.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value } : entry) })} />
                <div className="row-actions">
                  <button type="button" aria-label="Move up" onClick={() => patch({ outOfScope: move(catalog.outOfScope, index, index - 1) })}>↑</button>
                  <button type="button" aria-label="Move down" onClick={() => patch({ outOfScope: move(catalog.outOfScope, index, index + 1) })}>↓</button>
                  <button type="button" aria-label="Remove item" onClick={() => patch({ outOfScope: catalog.outOfScope.filter((entry) => entry.id !== item.id) })}>−</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "deliverables" && (
        <div className="content designer-content">
          <div className="title-row"><div><span className="eyebrow">ESTIMATE CATALOG</span><h1>Deliverable workflows</h1><p>Group tasks by the product they belong to. Only groups tied to a product in the engagement, or to no product, are offered in the Deliverables step.</p></div><div className="actions"><button type="button" className="secondary" onClick={() => offerAll(true)}>Offer all</button><button type="button" className="secondary" onClick={() => offerAll(false)}>Offer none</button><button type="button" className="primary" onClick={addGroup}>+ Add group</button></div></div>
          <div className="catalog-groups">
            {catalog.groups.map((group, index) => (
              <details key={group.id} open={index === 0}>
                <summary><span><b>{group.scopeNumber && `${group.scopeNumber} · `}{group.name}</b><small>{group.category} · {products.find((product) => product.id === group.productId)?.short ?? "Any product"} · {group.tasks.length} tasks</small></span><em>{group.tasks.filter((task) => task.enabled).length} offered</em><strong>{groupHours(group)}h</strong></summary>
                <div className="catalog-group-body">
                  <div className="group-settings">
                    <label>Section no.<input placeholder="2" value={group.scopeNumber ?? ""} onChange={(event) => updateGroup(group.id, { scopeNumber: event.target.value })} /></label>
                    <label>Group name<input value={group.name} onChange={(event) => updateGroup(group.id, { name: event.target.value })} /></label>
                    <label>Category<input value={group.category} onChange={(event) => updateGroup(group.id, { category: event.target.value })} /></label>
                    <label>Product<select value={group.productId} onChange={(event) => updateGroup(group.id, { productId: event.target.value })}><option value="">Any product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.short}</option>)}</select></label>
                    <div className="row-actions">
                      <button type="button" aria-label="Move group up" onClick={() => setGroups(move(catalog.groups, index, index - 1))}>↑</button>
                      <button type="button" aria-label="Move group down" onClick={() => setGroups(move(catalog.groups, index, index + 1))}>↓</button>
                      <button type="button" className="danger" onClick={() => window.confirm(`Delete “${group.name}” and its tasks?`) && setGroups(catalog.groups.filter((item) => item.id !== group.id))}>Delete</button>
                    </div>
                  </div>
                  <div className="catalog-task-head"><span>Item no.</span><span>Task</span><span>Delivery phase</span><span>Effort</span><span>Workflow <button type="button" className="link tiny" onClick={() => offerAll(!group.tasks.every((task) => task.enabled), group.id)}>{group.tasks.every((task) => task.enabled) ? "none" : "all"}</button></span><span></span></div>
                  {group.tasks.map((task) => (
                    <div className="catalog-task" key={task.id}>
                      <input className="scope-number" placeholder="2.1" value={task.scopeNumber ?? ""} onChange={(event) => updateTask(group.id, task.id, { scopeNumber: event.target.value })} />
                      <input aria-label="Task" value={task.name} onChange={(event) => updateTask(group.id, task.id, { name: event.target.value })} />
                      <select value={task.phase} onChange={(event) => updateTask(group.id, task.id, { phase: event.target.value as Phase })}>{phases.map((phase) => <option key={phase}>{phase}</option>)}</select>
                      <label><input type="number" min="0" step="0.5" value={task.hours} onChange={(event) => updateTask(group.id, task.id, { hours: Number(event.target.value) })} /><span>h</span></label>
                      <label className="workflow-toggle"><input type="checkbox" checked={task.enabled} onChange={(event) => updateTask(group.id, task.id, { enabled: event.target.checked })} /><span>Offer</span></label>
                      <button type="button" aria-label="Remove task" onClick={() => updateGroup(group.id, { tasks: group.tasks.filter((item) => item.id !== task.id) })}>−</button>
                    </div>
                  ))}
                  <button type="button" className="add-task" onClick={() => updateGroup(group.id, { tasks: [...group.tasks, { id: uid("task"), name: "New task", phase: "Deployment", hours: 1, enabled: true, scopeNumber: `${group.scopeNumber || ""}${group.scopeNumber ? "." : ""}${group.tasks.length + 1}` }] })}>+ Add task to group</button>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
