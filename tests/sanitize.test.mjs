import assert from "node:assert/strict";
import test from "node:test";
import { mergeBranding, themeVariables } from "../app/lib/theme.ts";
import { mergeCatalog, mergeEstimate } from "../app/lib/estimate.ts";
import { buildThemePack, parseThemePack } from "../app/lib/theme-pack.ts";
import { defaultBranding, defaultCatalog, emptyEstimate } from "../app/lib/defaults.ts";
import { zipSync, strToU8 } from "fflate";

test("a hostile theme cannot smuggle URLs into CSS, images, or fonts", () => {
  const hostile = {
    orgName: "x".repeat(10_000),
    colors: { ...defaultBranding.colors, paper: "url(https://tracker.example/pixel)", primary: "red; background:url(https://t.example)" },
    logo: "https://tracker.example/logo.png",
    favicon: "javascript:alert(1)",
    fonts: { heading: "'a', url(https://t.example)", body: "system" },
    schemes: [{ id: "s", name: "S", colors: { primary: "expression(1)" } }],
  };
  const b = mergeBranding(hostile);
  assert.equal(b.orgName.length, 120);
  assert.equal(b.colors.paper, defaultBranding.colors.paper);
  assert.equal(b.colors.primary, defaultBranding.colors.primary);
  assert.equal(b.logo, "");
  assert.equal(b.favicon, "");
  assert.equal(b.fonts.heading, "system");
  assert.equal(b.schemes[0].colors.primary, b.colors.primary);
  const css = Object.values(themeVariables(b)).join(" ");
  assert.ok(!/url\(|expression|javascript/.test(css));
});

test("inline images are kept, remote ones are not", () => {
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64");
  assert.equal(mergeBranding({ logo: svg }).logo, svg);
  assert.equal(mergeBranding({ logo: "data:text/html;base64,PHNjcmlwdD4=" }).logo, "");
});

test("a theme pack only yields the manifest and small image assets", () => {
  const big = new Uint8Array(500_000);
  const zip = zipSync({ "theme.json": strToU8(JSON.stringify({ format: "scopewright-theme", version: 1, identity: { orgName: "Z" }, assets: { logo: "logo.png", favicon: "../../evil.svg" } })), "logo.png": big, "notes.txt": strToU8("x"), "evil.svg": strToU8("<svg/>") });
  const b = parseThemePack(zip, defaultBranding);
  assert.equal(b.orgName, "Z");
  assert.equal(b.logo, "", "oversized asset is skipped");
  assert.equal(b.favicon, "", "path-shaped asset names are rejected");
  assert.equal(parseThemePack(new Uint8Array(7_000_000), defaultBranding), null, "oversized packs are refused");
  const ok = parseThemePack(buildThemePack({ ...defaultBranding, orgName: "OK" }), defaultBranding);
  assert.equal(ok.orgName, "OK");
});

test("a malformed catalog is coerced, not trusted", () => {
  const c = mergeCatalog({
    products: [{ id: "bad id!", name: 5, hours: "NaN", requires: ["ghost", 7] }, { id: "core", name: "Core", hours: -3 }, "junk"],
    installation: { core: [{ id: "q", label: "Q", choices: [{ id: "a", label: "A", hours: Infinity }] }, { id: "empty", choices: [] }], ghost: [] },
    prerequisites: { core: [{ id: "p", label: "P", required: "yes" }] },
    groups: [{ id: "g", name: "G", productId: "ghost", tasks: [{ id: "t", name: "T", phase: "Magic", hours: "9" }] }],
    solutions: [{ id: "s", title: "S", products: ["core", "ghost"] }],
  }, defaultCatalog);
  assert.equal(c.products.length, 2);
  assert.equal(c.products[0].id, "product-0");
  assert.equal(c.products[0].name, "product-0");
  assert.equal(c.products[0].hours, 0);
  assert.deepEqual(c.products[0].requires, []);
  assert.equal(c.products[1].hours, 0);
  assert.equal(c.installation.core.length, 1, "questions without choices are dropped");
  assert.equal(c.installation.core[0].choices[0].hours, 0);
  assert.equal(c.installation.ghost, undefined, "sections for unknown products are dropped");
  assert.equal(c.prerequisites.core[0].required, true);
  assert.equal(c.groups[0].productId, "", "unknown product link becomes any-product");
  assert.equal(c.groups[0].tasks[0].phase, "Deployment");
  assert.equal(c.groups[0].tasks[0].hours, 0);
  assert.deepEqual(c.solutions[0].products, ["core"]);
});

test("a malformed estimate is coerced", () => {
  const e = mergeEstimate({ customer: 42, products: ["core", 1], environments: { core: "maybe", edge: "existing" }, prerequisites: { "core:x": { value: 1, status: "done" } }, selectedTasks: "t", updatedAt: "now" }, emptyEstimate());
  assert.equal(e.customer, "");
  assert.deepEqual(e.products, ["core"]);
  assert.deepEqual(e.environments, { edge: "existing" });
  assert.deepEqual(e.prerequisites["core:x"], { value: "", status: "pending" });
  assert.deepEqual(e.selectedTasks, []);
  assert.equal(e.updatedAt, 0);
});
