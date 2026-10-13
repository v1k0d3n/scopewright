#!/usr/bin/env node
// Fail on any high or critical advisory in the full dependency tree, except
// ones listed in scripts/audit-exceptions.json with a reason and an expiry.
// An expired exception fails too, so each one gets looked at again.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const exceptions = JSON.parse(readFileSync(new URL("audit-exceptions.json", import.meta.url), "utf8"));
const today = new Date().toISOString().slice(0, 10);
let output;
try {
  output = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
} catch (error) {
  // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
  output = error.stdout;
}
const report = JSON.parse(output);
if (report.error) { console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`); process.exit(2); }

const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
    const id = via.url.split("/").pop();
    advisories.set(id, { id, package: via.name, severity: via.severity, title: via.title });
  }
}

let failures = 0;
for (const a of advisories.values()) {
  const exception = exceptions.find((e) => e.id === a.id);
  if (!exception) {
    console.log(`FAIL     ${a.severity} ${a.package} ${a.id}: ${a.title}`);
    failures++;
  } else if (exception.expires < today) {
    console.log(`EXPIRED  ${a.severity} ${a.package} ${a.id}: exception expired ${exception.expires}; fix it or review and extend`);
    failures++;
  } else {
    console.log(`excepted ${a.severity} ${a.package} ${a.id} until ${exception.expires}: ${exception.reason}`);
  }
}
for (const e of exceptions) {
  if (!advisories.has(e.id)) console.log(`::notice::${e.id} (${e.package}) no longer applies; remove it from scripts/audit-exceptions.json`);
}
console.log(failures ? `\n${failures} high or critical advisory(ies) to fix.` : `\nNo unexcepted high or critical advisories.`);
process.exit(failures ? 1 : 0);
