#!/usr/bin/env node
// Zip a theme directory (theme.json + logo/favicon files) into an importable theme pack.
//   npm run pack:theme -- packs/red-hat            -> packs/red-hat.zip
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { zipSync } from "fflate";

const dir = process.argv[2];
if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error("usage: pack-theme <directory containing theme.json>");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(join(dir, "theme.json"), "utf8"));
if (!["scopewright-theme", "poc-theme"].includes(manifest.format)) { console.error("theme.json is not a poc-theme manifest"); process.exit(1); }
const files = Object.fromEntries(readdirSync(dir).filter((name) => !name.startsWith(".") && name !== "catalog.json").map((name) => [name, new Uint8Array(readFileSync(join(dir, name)))]));
const out = resolve(`${dir.replace(/\/$/, "")}.zip`);
writeFileSync(out, zipSync(files, { level: 6 }));
console.log(`${basename(out)}: ${Object.keys(files).join(", ")}`);
