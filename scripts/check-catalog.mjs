#!/usr/bin/env node
// Check a catalog file before importing it:  npm run catalog:check -- path/to/catalog.json
import { readFileSync } from "node:fs";
import { lintCatalog, lintCatalogFile } from "../app/lib/lint.ts";
import { calculate, resolveProducts } from "../app/lib/estimate.ts";
import { mergeCatalog } from "../app/lib/estimate.ts";
import { defaultCatalog, emptyEstimate } from "../app/lib/defaults.ts";

const path = process.argv[2];
if (!path) { console.error("usage: npm run catalog:check -- <catalog.json>"); process.exit(2); }
let data;
try { data = JSON.parse(readFileSync(path, "utf8")); } catch (error) { console.error(`Not valid JSON: ${error.message}`); process.exit(1); }

const structural = lintCatalogFile(data);
const messages = [...structural, ...(structural.some((m) => m.level === "error") ? [] : lintCatalog(data.catalog, defaultCatalog))];
for (const m of messages) console.log(`${m.level === "error" ? "ERROR  " : "warning"} ${m.text}`);
const errors = messages.filter((m) => m.level === "error").length;
if (!structural.some((m) => m.level === "error")) {
  const c = mergeCatalog(data.catalog, defaultCatalog);
  const tasks = c.groups.reduce((n, g) => n + g.tasks.length, 0);
  console.log(`\n${c.products.length} products, ${Object.values(c.installation).flat().length} questions, ${Object.values(c.prerequisites).flat().length} prerequisites, ${c.groups.length} groups / ${tasks} tasks, ${c.solutions.length} solutions`);
  for (const p of c.products) {
    const chain = resolveProducts([p.id], c.products);
    const all = calculate(c, { ...emptyEstimate(), products: [p.id], selectedTasks: c.groups.filter((g) => !g.productId || chain.includes(g.productId)).flatMap((g) => g.tasks.map((t) => t.id)) });
    console.log(`  ${p.id.padEnd(14)} pulls in ${chain.length - 1} foundation(s); defaults + all deliverables = ${all.total}h`);
  }
}
console.log(errors ? `\n${errors} error(s): fix these, then import.` : "\nReady to import.");
process.exit(errors ? 1 : 0);
