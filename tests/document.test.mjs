import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { emptyEstimate } from "../app/lib/defaults.ts";
import { SECTION_LIMITS, mergeCatalog, mergeEstimate, readEstimateFile, removeFromCatalog, sectionFrom, sectionTemplateChanged } from "../app/lib/estimate.ts";
import { builtInSections, documentOutline, documentText, scopeDocument, sectionLayout } from "../app/lib/document.ts";
import { sectionIds } from "../app/lib/types.ts";

const emptyCatalog = { products: [], installation: {}, prerequisites: {}, groups: [], solutions: [], outOfScope: [], documentTemplates: [] };
const pack = (name) => JSON.parse(readFileSync(new URL(`../packs/solstice/${name}`, import.meta.url), "utf8"));
const catalog = mergeCatalog(pack("catalog.json").catalog, emptyCatalog);
const sample = readEstimateFile(pack("sample-estimate.json"), emptyEstimate()).estimate;

/** Every span in a list of blocks, however deeply grouped. */
const spans = (blocks) => blocks.flatMap((block) => {
  if (block.kind === "paragraph") return block.content;
  if (block.kind === "list") return block.items.flat();
  if (block.kind === "table") return block.rows.flatMap((row) => row.cells.flat());
  return [...block.title, ...spans(block.blocks)];
});

test("the page and the copied text print the same sections, numbered in the same order", () => {
  const document = scopeDocument(catalog, sample, "Org");
  assert.deepEqual(document.sections.map((section) => section.id), builtInSections.map((section) => section.id));
  const headings = documentText(document, "Org").split("\n").filter((line) => /^\d+\. [A-Z ]+$/.test(line));
  assert.deepEqual(headings, document.sections.map((section, index) => `${index + 1}. ${section.title}`));
});

test("a section left out of the document leaves no gap in the numbering", () => {
  const document = scopeDocument(catalog, { ...sample, options: { showHours: false }, outOfScope: [], customOutOfScope: "" }, "Org");
  const ids = document.sections.map((section) => section.id);
  assert.ok(!ids.includes("effort") && !ids.includes("out-of-scope"));
  assert.match(documentText(document, "Org"), /\n6\. SUCCESS CRITERIA\n/);
});

test("with hours hidden, no section carries an hour figure", () => {
  const document = scopeDocument(catalog, { ...sample, options: { showHours: false } }, "Org");
  const figures = document.sections.flatMap((section) => spans(section.blocks)).filter((span) => typeof span === "object" && "hours" in span);
  assert.deepEqual(figures, []);
  assert.doesNotMatch(document.sections.flatMap((section) => section.text).join("\n"), /\bhours?\b/);
});

test("the built-in sections are listed in the default order the data model names", () => {
  assert.deepEqual(builtInSections.map((section) => section.id), [...sectionIds]);
  assert.deepEqual(sectionLayout([]).map((item) => item.id), [...sectionIds]);
});

test("a saved layout sets the order, and hidden sections print nowhere", () => {
  const layout = [{ id: "assumptions", hidden: false }, { id: "goal", hidden: false }, { id: "prerequisites", hidden: true }];
  const document = scopeDocument(catalog, { ...sample, sectionLayout: layout }, "Org");
  const ids = document.sections.map((section) => section.id);
  assert.deepEqual(ids.slice(0, 2), ["assumptions", "goal"]);
  assert.ok(!ids.includes("prerequisites"));
  const text = documentText(document, "Org");
  assert.match(text, /^1\. ASSUMPTIONS\n- .+\n(- .+\n)*\n2\. GOAL\n/m, "a section moved up still ends with a blank line");
  assert.doesNotMatch(text, /PREREQUISITES/);
});

test("sections a saved layout does not mention go back in after the section they follow by default", () => {
  assert.deepEqual(sectionLayout([{ id: "effort", hidden: true }, { id: "goal", hidden: false }]).map((item) => item.id), ["effort", "goal", "products", "installation", "prerequisites", "delivery", "out-of-scope", "success", "assumptions"]);
});

test("the outline marks hidden sections and says why an empty one does not print", () => {
  const outline = documentOutline(catalog, { ...sample, options: { showHours: false }, sectionLayout: [{ id: "goal", hidden: true }] });
  assert.equal(outline.find((item) => item.id === "goal").hidden, true);
  assert.equal(outline.find((item) => item.id === "effort").omitted, "Hours are hidden");
  assert.equal(outline.find((item) => item.id === "products").omitted, null);
});

test("an untrusted layout keeps only known sections, once each", () => {
  const estimate = mergeEstimate({ sectionLayout: [{ id: "goal", hidden: true }, { id: "goal" }, { id: "nope" }, "x", { id: "effort", hidden: "yes" }] }, emptyEstimate());
  assert.deepEqual(estimate.sectionLayout, [{ id: "goal", hidden: true }, { id: "effort", hidden: false }]);
});

const contacts = {
  id: "section-contacts",
  title: "{customer} contacts",
  blocks: [
    { kind: "text", text: "Who to call during the engagement.\nAsk the account team first.\n\n- Weekdays only\n- Escalate through {organization}" },
    { kind: "table", columns: ["Role", "Name", "Contact"], rows: [["Sponsor", "Ana", "ana@example.com"], ["Engineer", "", ""]] },
  ],
};

test("a custom section prints its title, text, and table, with placeholders filled", () => {
  // The page always saves the full layout: here the custom section moved up to second place.
  const layout = sectionLayout([], [contacts]);
  const estimate = { ...sample, customSections: [contacts], sectionLayout: [layout[0], layout.at(-1), ...layout.slice(1, -1)] };
  const document = scopeDocument(catalog, estimate, "Org");
  const section = document.sections[1];
  assert.equal(section.id, "section-contacts");
  assert.equal(section.custom, true);
  assert.equal(section.title, `${sample.customer} CONTACTS`.toUpperCase());
  assert.deepEqual(section.blocks.map((block) => block.kind), ["paragraph", "list", "table"]);
  assert.deepEqual(section.blocks[0].content, ["Who to call during the engagement.\nAsk the account team first."], "a single line break stays inside its paragraph");
  assert.deepEqual(section.blocks[1].items, [["Weekdays only"], ["Escalate through Org"]]);
  assert.deepEqual(section.blocks[2].columns, ["Role", "Name", "Contact"]);
  const text = documentText(document, "Org");
  assert.match(text, /\n2\. HARBOR & VALE LOGISTICS CONTACTS\nWho to call during the engagement\.\nAsk the account team first\.\n\n- Weekdays only\n- Escalate through Org\n\nRole \| Name \| Contact\n- Sponsor \| Ana \| ana@example\.com\n- Engineer \| {2}\|\n\n3\. PRODUCTS IN SCOPE\n/);
});

test("a custom section the layout does not mention prints last, and an empty one prints only a placeholder on the page", () => {
  const empty = { id: "section-empty", title: "", blocks: [] };
  const document = scopeDocument(catalog, { ...sample, customSections: [empty] }, "Org");
  const last = document.sections.at(-1);
  assert.equal(last.id, "section-empty");
  assert.equal(last.title, "UNTITLED SECTION");
  assert.equal(last.blocks[0].placeholder, true);
  assert.deepEqual(last.text, []);
  assert.match(documentText(document, "Org"), /\d+\. UNTITLED SECTION$/);
});

test("untrusted custom sections are cleaned up: tables keep one cell per column, and the layout only names sections that exist", () => {
  const estimate = mergeEstimate({
    customSections: [
      { id: "a", title: "A", blocks: [{ kind: "table", columns: ["One", "Two"], rows: [["1"], ["1", "2", "3"], "bad"] }, { kind: "table", columns: [], rows: [] }, { kind: "image" }, { kind: "text", text: 5 }] },
      { id: "a", title: "Duplicate", blocks: [] },
    ],
    sectionLayout: [{ id: "a", hidden: true }, { id: "gone" }],
  }, emptyEstimate());
  assert.equal(estimate.customSections.length, 1);
  assert.deepEqual(estimate.customSections[0].blocks, [{ kind: "table", columns: ["One", "Two"], rows: [["1", ""], ["1", "2"]] }, { kind: "text", text: "" }]);
  assert.deepEqual(estimate.sectionLayout, [{ id: "a", hidden: true }]);
});

const contactsTemplate = { id: "contacts", title: "Contacts", category: "Proof of concept", blocks: [{ kind: "table", columns: ["Role", "Name"], rows: [["Sponsor", ""]] }], enabled: true, locked: false };

test("a section added from a template is a copy: editing either one leaves the other alone", () => {
  const section = sectionFrom(contactsTemplate, "s1");
  assert.deepEqual({ ...section, blocks: undefined }, { id: "s1", title: "Contacts", blocks: undefined, templateId: "contacts", templateName: "Contacts", edited: false, locked: false });
  section.blocks[0].rows[0][1] = "Ana";
  assert.equal(contactsTemplate.blocks[0].rows[0][1], "", "the catalog template is untouched");
});

test("a copy is offered the catalog version when the template changes, and an edited copy only when it is locked", () => {
  const catalog = { ...emptyCatalog, sectionTemplates: [contactsTemplate] };
  const copy = sectionFrom(contactsTemplate, "s1");
  assert.equal(sectionTemplateChanged(catalog, copy), null);
  const renamed = { ...catalog, sectionTemplates: [{ ...contactsTemplate, title: "Who to call" }] };
  assert.equal(sectionTemplateChanged(renamed, copy).title, "Who to call");
  const edited = { ...copy, title: "Our contacts", edited: true };
  assert.equal(sectionTemplateChanged(renamed, edited), null);
  assert.equal(sectionTemplateChanged({ ...catalog, sectionTemplates: [{ ...contactsTemplate, locked: true }] }, edited).locked, true);
  assert.equal(sectionTemplateChanged({ ...catalog, sectionTemplates: [] }, copy), null, "a template deleted from the catalog offers nothing");
});

test("section templates are read from untrusted catalogs and deleted by id", () => {
  const catalog = mergeCatalog({ ...emptyCatalog, sectionTemplates: [{ id: "a", title: "A", category: "X", blocks: [{ kind: "table", columns: ["One"], rows: [["1", "2"]] }] }, { title: "No id" }, "bad"] }, emptyCatalog);
  assert.deepEqual(catalog.sectionTemplates.map((t) => [t.id, t.enabled, t.locked]), [["a", true, false], ["section-template-1", true, false]]);
  assert.deepEqual(catalog.sectionTemplates[0].blocks[0].rows, [["1"]]);
  assert.deepEqual(removeFromCatalog(catalog, { sectionTemplates: ["a"] }).sectionTemplates.map((t) => t.id), ["section-template-1"]);
});

test("a locked copy is never also marked edited, and a section written from scratch names no template", () => {
  const estimate = mergeEstimate({ customSections: [{ id: "a", templateId: "t", templateName: "T", locked: true, edited: true }, { id: "b", templateName: "Stray", edited: true, locked: true }] }, emptyEstimate());
  assert.deepEqual(estimate.customSections.map(({ templateId, templateName, edited, locked }) => ({ templateId, templateName, edited, locked })), [
    { templateId: "t", templateName: "T", edited: false, locked: true },
    { templateId: "", templateName: "", edited: false, locked: false },
  ]);
});

test("custom text makes numbered lists from their first number, and indented lines nest under the item above", () => {
  const section = { id: "s", title: "Plan", blocks: [{ kind: "text", text: "Steps:\n3. Prepare\n  - Rack servers\n  - Cable ports\n4. Execute\n\t1) Deploy\n- Follow-up" }], templateId: "", templateName: "", edited: false, locked: false };
  const [block] = scopeDocument(catalog, { ...sample, customSections: [section] }, "Org").sections.at(-1).blocks.slice(1);
  assert.equal(block.ordered, true);
  assert.equal(block.start, 3);
  assert.deepEqual(block.items, [["Prepare"], ["Execute"]]);
  assert.deepEqual(block.nested[0], { kind: "list", items: [["Rack servers"], ["Cable ports"]] });
  assert.deepEqual(block.nested[1], { kind: "list", items: [["Deploy"]], ordered: true, start: 1 });
  const follow = scopeDocument(catalog, { ...sample, customSections: [section] }, "Org").sections.at(-1).blocks[2];
  assert.deepEqual(follow, { kind: "list", items: [["Follow-up"]] }, "a bullet after a numbered list starts a new list");
});

test("files keep exactly what the section editors allow, so nothing typed is lost on reload", () => {
  const long = (n) => "x".repeat(n + 1);
  const [section] = mergeEstimate({ customSections: [{ id: "s", title: long(SECTION_LIMITS.title), blocks: [{ kind: "text", text: long(SECTION_LIMITS.text) }, { kind: "table", columns: [long(SECTION_LIMITS.heading)], rows: [[long(SECTION_LIMITS.cell)]] }] }] }, emptyEstimate()).customSections;
  assert.equal(section.title.length, SECTION_LIMITS.title);
  assert.equal(section.blocks[0].text.length, SECTION_LIMITS.text);
  assert.equal(section.blocks[1].columns[0].length, SECTION_LIMITS.heading);
  assert.equal(section.blocks[1].rows[0][0].length, SECTION_LIMITS.cell);
  const many = (n, item) => Array.from({ length: n + 1 }, (_, index) => item(index));
  const estimate = mergeEstimate({ customSections: many(SECTION_LIMITS.sections, (index) => ({ id: `s${index}`, title: "S", blocks: many(SECTION_LIMITS.blocks, () => ({ kind: "text", text: "x" })) })) }, emptyEstimate());
  assert.equal(estimate.customSections.length, SECTION_LIMITS.sections);
  assert.equal(estimate.customSections[0].blocks.length, SECTION_LIMITS.blocks);
  const [template] = mergeCatalog({ ...emptyCatalog, sectionTemplates: [{ id: "t", title: "T", category: long(SECTION_LIMITS.category), description: long(SECTION_LIMITS.description), blocks: [] }] }, emptyCatalog).sectionTemplates;
  assert.equal(template.category.length, SECTION_LIMITS.category);
  assert.equal(template.description.length, SECTION_LIMITS.description);
});

const markdownSection = (text, customer = sample.customer) => {
  const section = { id: "s", title: "T", blocks: [{ kind: "text", text }], templateId: "", templateName: "", edited: false, locked: false };
  const document = scopeDocument(catalog, { ...sample, customer, customSections: [section] }, "Org");
  return { blocks: document.sections.at(-1).blocks, text: document.sections.at(-1).text };
};

test("custom text reads Markdown: subheadings, bold, italic, and tables", () => {
  const { blocks, text } = markdownSection("## Solstice Core Platform\nSome **bold** and *italic* words.\n\n| Role | Name |\n|------|------|\n| Sponsor | {customer} |");
  assert.deepEqual(blocks[0], { kind: "heading", content: ["Solstice Core Platform"] });
  assert.deepEqual(blocks[1], { kind: "paragraph", content: ["Some ", { strong: "bold" }, " and ", { em: "italic" }, " words."] });
  assert.deepEqual(blocks[2], { kind: "table", columns: ["Role", "Name"], rows: [{ cells: [["Sponsor"], [sample.customer]] }] });
  assert.deepEqual(text, ["Solstice Core Platform", "Some bold and italic words.", "", "Role | Name", "Sponsor | Harbor & Vale Logistics", ""], "the copied text keeps the words, not the marks");
});

test("raw HTML prints as the text that was typed, and placeholders are never read as Markdown", () => {
  const html = markdownSection("<script>alert(1)</script>").blocks;
  assert.deepEqual(html, [{ kind: "paragraph", content: ["<script>alert(1)</script>"] }]);
  const filled = markdownSection("Hello {customer}", "**Acme**").blocks;
  assert.deepEqual(filled, [{ kind: "paragraph", content: ["Hello **Acme**"] }], "a filled-in value prints as typed");
});

test("the list rules shipped before Markdown still hold", () => {
  const { blocks } = markdownSection("1. Platform\n  - Operators\n  - Storage\n2. Ceph");
  assert.equal(blocks[0].ordered, true);
  assert.deepEqual(blocks[0].nested[0].items, [["Operators"], ["Storage"]], "two spaces nest under a numbered item");
  const after = markdownSection("Steps:\n3. Prepare\n4. Execute").blocks;
  assert.deepEqual(after.map((block) => block.kind), ["paragraph", "list"], "a list may start straight after a line of text");
  assert.equal(after[1].start, 3);
});

test("a list typed indented with no list above it is indented, and its own nesting still works", () => {
  const { blocks, text } = markdownSection("This document will provide:\n  1. A review\n    - of the goals\n  2. An overview\n\nPlain list:\n- not indented");
  assert.deepEqual(blocks.map((block) => [block.kind, block.indent ?? false]), [["paragraph", false], ["list", true], ["paragraph", false], ["list", false]]);
  assert.deepEqual(blocks[1].items, [["A review"], ["An overview"]]);
  assert.deepEqual(blocks[1].nested[0].items, [["of the goals"]], "two more spaces still nest under the item above");
  assert.ok(text.includes("  1. A review"), "the copied text keeps the indent as typed");
  assert.equal(markdownSection("1. Platform\n  - Operators").blocks[0].indent, undefined, "spaces under a list item nest, they do not indent");
});

test("copied text drops Markdown's marks the way the page reads them, and never changes code, images, rules, or a filled-in value", () => {
  const { text } = markdownSection("**Bold** `__init__` snake_case [Docs](https://docs.example) ![*alt*](i.png)\n\nOne | two |\n\n---\n\nHi {customer}", "**Acme**");
  assert.deepEqual(text, ["Bold `__init__` snake_case Docs (https://docs.example) ![*alt*](i.png)", "", "One | two |", "", "---", "", "Hi **Acme**", ""]);
});

test("on the page, images, inline code, and rules print as typed", () => {
  const { blocks } = markdownSection("See `npm run check` and ![logo](l.png)\n\n---");
  assert.deepEqual(blocks[0].content, ["See ", "`npm run check`", " and ", "![logo](l.png)"]);
  assert.deepEqual(blocks[1], { kind: "paragraph", content: ["---"] });
});

test("list lines inside fenced code or raw HTML are left exactly as typed", () => {
  const fenced = markdownSection("```\n  1. not a list\n```").blocks;
  assert.deepEqual(fenced, [{ kind: "paragraph", content: ["```\n  1. not a list\n```"] }]);
  const html = markdownSection("<div>\n  - kept\n</div>").blocks;
  assert.deepEqual(html, [{ kind: "paragraph", content: ["<div>\n  - kept\n</div>"] }]);
});

test("a list inside a quote never takes the indent of a later list", () => {
  const { blocks } = markdownSection("> - quoted\n\nIntro:\n  1. indented\n\nPlain:\n- plain");
  assert.deepEqual(blocks.filter((block) => block.kind === "list").map((block) => [block.items[0][0], block.indent ?? false]), [["quoted", false], ["indented", true], ["plain", false]]);
});

test("code and raw HTML blocks end where Markdown ends them, and lists after them work as usual", () => {
  const fenced = markdownSection("```\n  - task\n``` trailing\n  3. literal\n```\nIntro:\n  1. after").blocks;
  assert.equal(fenced[0].content[0], "```\n  - task\n``` trailing\n  3. literal\n```", "a fence with text after it does not close the block");
  assert.deepEqual(fenced.at(-1), { kind: "list", items: [["after"]], ordered: true, start: 1, indent: true });
  const html = markdownSection("<pre>raw</pre>\nIntro:\n  3. Step").blocks;
  assert.deepEqual(html.map((block) => block.kind), ["paragraph", "paragraph", "list"]);
  assert.equal(html[2].start, 3);
});

test("list rules win over indented code, and fenced code keeps its lines inside a list item and in copied text", () => {
  const indented = markdownSection("Intro:\n    - four spaces\n\t- a tab").blocks;
  assert.deepEqual(indented.at(-1), { kind: "list", items: [["four spaces"], ["a tab"]], indent: true }, "an indented list line is a list, not code");
  const nested = markdownSection("- Parent\n  ```\n  - task\n  ```").blocks[0];
  assert.equal(nested.items[0].join(""), "Parent\n```\n- task\n```", "the fence in the item keeps its lines");
  const { text } = markdownSection("**Bold**\n\n```\nfirst\n\n**literal**\n```");
  assert.deepEqual(text, ["Bold", "", "```", "first", "", "**literal**", "```", ""], "a blank line inside code does not split it in the copied text");
});
