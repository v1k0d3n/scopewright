import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";
import { defaultBranding } from "../app/lib/defaults.ts";
import { buildThemePack, parseThemePack } from "../app/lib/theme-pack.ts";

const svg = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64");

test("a theme pack round-trips identity, colors, fonts, and assets", () => {
  const branding = { ...defaultBranding, orgName: "ACME", logo: svg, favicon: svg, colors: { ...defaultBranding.colors, primary: "#123456" }, fonts: { heading: "georgia", body: "system" } };
  const zip = buildThemePack(branding);
  const files = unzipSync(zip);
  assert.deepEqual(Object.keys(files).sort(), ["favicon.svg", "logo.svg", "theme.json"]);
  const manifest = JSON.parse(strFromU8(files["theme.json"]));
  assert.equal(manifest.format, "scopewright-theme");
  assert.equal(manifest.identity.orgName, "ACME");
  assert.equal(manifest.assets.logo, "logo.svg");
  const back = parseThemePack(zip, defaultBranding);
  assert.equal(back.orgName, "ACME");
  assert.equal(back.colors.primary, "#123456");
  assert.equal(back.fonts.heading, "georgia");
  assert.equal(back.logo, svg);
  assert.equal(back.favicon, svg);
  assert.equal(back.schemes[0].name, "ACME", "a pack without named schemes gets one named after the org");
  assert.equal(back.schemes[0].colors.primary, "#123456");
});

test("saved schemes travel in the pack and are not duplicated", () => {
  const scheme = { id: "s1", name: "Night", colors: { ...defaultBranding.colors, primary: "#000000" } };
  const branding = { ...defaultBranding, orgName: "ACME", colors: scheme.colors, schemes: [scheme] };
  const back = parseThemePack(buildThemePack(branding), defaultBranding);
  assert.deepEqual(back.schemes.map((item) => item.name), ["Night"]);
});

test("a pack without assets clears the logo, and junk is rejected", () => {
  const back = parseThemePack(buildThemePack({ ...defaultBranding, logo: "" }), { ...defaultBranding, logo: svg });
  assert.equal(back.logo, "");
  assert.equal(parseThemePack(new Uint8Array([1, 2, 3]), defaultBranding), null);
});

test("colors that match a built-in theme do not get a synthesized org-named theme", async () => {
  const { builtInThemes } = await import("../app/lib/defaults.ts");
  const branding = { ...defaultBranding, orgName: "ACME", colors: { ...builtInThemes[2].colors }, schemes: [] };
  const back = parseThemePack(buildThemePack(branding), defaultBranding, builtInThemes);
  assert.deepEqual(back.schemes, []);
});
