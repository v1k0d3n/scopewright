# Authoring a Scopewright catalog

> **Want help building an Estimate Catalog?** Point your AI assistant at this
> page. Together with your product documentation it has everything needed to
> produce a catalog file that imports cleanly into Scopewright. Humans: it is
> the same guide, just read it top to bottom.

A catalog describes what a team delivers and how much solutions-architect
effort each piece takes, in hours. Scopewright turns it into a guided
estimate and a customer-facing scope document. This page explains the model,
the file format, the conventions, and how to check your work. It is written
so that a language model can follow it directly; every rule is stated
explicitly, and a complete example is included.

**The output is exactly this shape, and nothing else.** Five sections inside a
`catalog` object; no other top-level keys, no sections of your own:

```json
{
  "format": "scopewright-catalog",
  "version": 1,
  "catalog": {
    "products": [],
    "installation": {},
    "prerequisites": {},
    "groups": [],
    "solutions": [],
    "outOfScope": []
  }
}
```

(`outOfScope` is optional; the other five sections are required.)

Check a file before importing it: `npm run catalog:check -- my-catalog.json`
prints every problem in plain language and a summary of what the catalog
will estimate.

Contents

1. [The model in one picture](#the-model-in-one-picture)
2. [The four sorting rules](#the-four-sorting-rules)
3. [File format](#file-format)
4. [Conventions](#conventions)
5. [Hours](#hours)
6. [Worked example](#worked-example)
7. [Checklist before importing](#checklist-before-importing)
8. [Prompt for an AI assistant](#prompt-for-an-ai-assistant)
9. [Safety](#safety)

## The model in one picture

```
Product ──requires──► Product              (a dependency graph; foundations are pulled in automatically)
   │
   ├── installation questions             (each answer has hours; asked when the product is deployed new)
   ├── prerequisites                       (what the customer must provide; tracked with a status, no hours)
   └── deliverable groups                  (tasks with a phase and hours; offered when the product is in scope)

Solution ──selects──► Products             (a card that fills the first step in one click)
```

An estimate is built by picking products (or a solution), answering each
product's installation questions, recording prerequisites, and choosing
deliverables. Hours add up from three places: a product's **base work
package**, its chosen **installation answers**, and the selected
**deliverable tasks**.

## The four sorting rules

Every fact in your product documentation lands in exactly one place. Decide
with these questions, in order:

1. **Does the answer change how much work the solutions architect does?**
   Then it is an **installation question** with two or more **choices**, each
   carrying hours. Examples: topology (single node / HA), target platform
   (bare metal / VMware / cloud), connectivity (connected / proxy /
   air-gapped), identity (local / LDAP / SSO), scale (1 site / 3 / 10).
2. **Must the customer supply it before work can start?** Then it is a
   **prerequisite**: an IP, a network range, DNS, credentials, a license,
   sample data, hardware, sign-off. Prerequisites have no hours; they carry a
   value and a status during the engagement.
3. **Is it work the architect does after the product is up?** Then it is a
   **deliverable task**, in a **group**, in one of five **phases**: Planning,
   Prerequisites, Deployment, Configuration, Testing and Validation. Each task
   has hours.
4. **Can product B not be deployed without product A?** Then A is a
   **required foundation** of B (`requires: ["a"]`). Chains are fine (C
   requires B requires A) and a product may require several. Selecting B
   pulls A into the estimate automatically, and A can be marked as already
   existing at the customer.

And one more: **do you demonstrate the same bundle repeatedly?** Then add a
**solution** card naming those products.

Things that are none of the above (marketing claims, feature lists, pricing)
do not belong in the catalog.

## File format

A catalog is one JSON file:

```json
{
  "format": "scopewright-catalog",
  "version": 1,
  "catalog": {
    "products": [ ... ],
    "installation": { "<productId>": [ ... ] },
    "prerequisites": { "<productId>": [ ... ] },
    "groups": [ ... ],
    "solutions": [ ... ]
  }
}
```

All five sections are required (use `[]` or `{}` when empty). Field by field:

### `products[]`

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string, `[A-Za-z0-9_.:-]`, unique | yes | Referenced by every other section. |
| `name` | string | yes | Full product name. |
| `short` | string | yes | Short name for chips and summaries. |
| `portfolio` | string | yes | Heading the product appears under in the Products step. |
| `mark` | string, 2–3 characters | yes | Badge shown on the product. |
| `hours` | number ≥ 0 | yes | Base work package when deployed new; `0` if all effort comes from questions. |
| `description` | string | no | One line under the name. |
| `requires` | string[] of product ids | no | Required foundations. |

### `installation["<productId>"][]` (questions)

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string, unique within the product | yes | |
| `label` | string | yes | The question as shown on the drop-down. |
| `help` | string | no | One line of guidance under the question. |
| `choices[]` | array, at least one | yes | `{ "id", "label", "hours", "note"? }`. The first choice is the default. |

### `prerequisites["<productId>"][]`

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string, unique within the product | yes | |
| `label` | string | yes | What the customer provides. |
| `placeholder` | string | no | An example value, shown in the empty field. |
| `help` | string | no | Guidance. |
| `required` | boolean | yes | Required items count as pending until provided. |

### `groups[]` (deliverables)

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string, unique | yes | |
| `name` | string | yes | |
| `category` | string | yes | Free text: Storage, Network, Security, Engagement, ... |
| `productId` | product id or `""` | yes | The product this group belongs to; `""` means every engagement. |
| `scopeNumber` | string | no | Section number in the scope document, e.g. `"2"`. |
| `tasks[]` | array | yes | `{ "id", "name", "phase", "hours", "enabled", "scopeNumber"? }`; `phase` is one of the five phases; `enabled: true` offers the task in estimates. |

### `solutions[]`

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string, unique | yes | |
| `label` | string | no | Tag on the card: `POPULAR`, `SOLUTION`, `SECURITY`, ... |
| `title` | string | yes | |
| `subtitle` | string | no | |
| `products` | string[] of product ids | yes | Selected when the card is clicked. Foundations need not be listed; they follow. |

### `outOfScope[]` (optional)

| Field | Type | Required | Meaning |
|-------|------|----------|---------|
| `id` | string, unique | yes | |
| `label` | string | yes | Something your team commonly excludes, e.g. "Production hardening and performance tuning". |

These are workspace-wide, not per product. They appear as checkboxes in the
Engagement step; the ones the architect ticks are printed in the scope
document's "Out of scope" section, along with any free-text items added for
that engagement.

## Conventions

- **ids** are lowercase kebab-case and stable: `core`, `edge-runtime`,
  `api-vip`. Never reuse an id for a different thing; estimates reference ids.
- **Order matters.** Products appear in the order listed, grouped by
  portfolio; list foundations before what depends on them. Questions appear
  in listed order; put the decision with the biggest effort swing first.
- **Choices**: three to five per question, the least effort first, labels
  short enough for a drop-down, hours on every choice (use `0` when a choice
  adds nothing).
- **Scope numbering**: groups `"1"`, `"2"`, ...; tasks `"1.1"`, `"1.2"`.
  Keep an engagement-wide group (`productId: ""`) numbered `"1"` for kickoff,
  architecture, and readout.
- **Prerequisites** should be things the customer can hand over: prefer
  "Control plane VIP" with placeholder `10.20.0.10` over "Networking".
- **Every product should have at least one of** questions, prerequisites, or
  a deliverable group; otherwise it estimates at zero and prints an empty
  section.
- Do not include customer names, internal hostnames, credentials, or prices.
  Placeholders should be obviously examples (`10.20.0.0/24`,
  `time.example.com`).

## Hours

Hours are a single solutions architect's hands-on effort for that item
during a proof of concept, excluding waiting on the customer. They are
deliberately coarse: whole or half hours, typically 1–8 per choice or task.
As a rough scale: a checkbox-level setting is 1, a component install with
validation is 2–4, an integration with a customer system is 4–8, and anything
above 8 is probably two tasks. When generating from documentation, treat
hours as a first draft; the architect calibrates them in the app, where every
number is editable.

## Worked example

`packs/solstice/catalog.json` in this repository is a complete catalog for a
fictitious vendor with nine products, a dependency chain, and everything
above filled in. Read it alongside this guide; it is the reference for shape
and tone. A minimal two-product excerpt:

```json
{
  "format": "scopewright-catalog",
  "version": 1,
  "catalog": {
    "products": [
      { "id": "core", "name": "Solstice Core Platform", "short": "Core", "portfolio": "Platform", "mark": "SC", "hours": 0,
        "description": "The control plane every Solstice product runs on." },
      { "id": "streams", "name": "Solstice Streams", "short": "Streams", "portfolio": "Data", "mark": "SS", "hours": 6,
        "description": "Managed event streaming.", "requires": ["core"] }
    ],
    "installation": {
      "core": [
        { "id": "footprint", "label": "Control plane footprint", "help": "Production-shaped POCs should use HA.",
          "choices": [ { "id": "lab", "label": "Single-node lab", "hours": 2 }, { "id": "ha", "label": "Highly available (3 nodes)", "hours": 6 } ] }
      ],
      "streams": [
        { "id": "brokers", "label": "Broker topology",
          "choices": [ { "id": "single", "label": "Single broker", "hours": 1 }, { "id": "three", "label": "3 brokers", "hours": 3 } ] }
      ]
    },
    "prerequisites": {
      "core": [ { "id": "api-vip", "label": "Control plane VIP", "placeholder": "10.20.0.10", "required": true } ],
      "streams": [ { "id": "topics", "label": "Initial topic list", "placeholder": "Names, partitions, retention", "required": true } ]
    },
    "groups": [
      { "id": "engagement", "name": "Engagement Planning", "category": "Engagement", "productId": "", "scopeNumber": "1",
        "tasks": [ { "id": "eng-kickoff", "name": "Kickoff and success criteria", "phase": "Planning", "hours": 3, "enabled": true, "scopeNumber": "1.1" } ] },
      { "id": "streams-pipeline", "name": "Streaming Pipeline", "category": "Data", "productId": "streams", "scopeNumber": "2",
        "tasks": [ { "id": "str-connect", "name": "Wire a source connector and validate throughput", "phase": "Testing and Validation", "hours": 4, "enabled": true, "scopeNumber": "2.1" } ] }
    ],
    "solutions": [
      { "id": "streaming", "label": "SOLUTION", "title": "Streaming starter", "subtitle": "Core + Streams", "products": ["core", "streams"] }
    ]
  }
}
```

## Common mistakes

These are the ways a catalog goes wrong when it is written from a different
mental model, by a person or a language model. Each one is a sign that
structure was invented instead of using the five sections.

- **Inventing top-level sections** for things like offerings, engagement
  metadata, work tracks, deployment options, a separate deliverables list,
  or out-of-scope items. Scopewright has none of these. Offerings are
  **solutions**; deployment options are **installation questions** on the
  product they deploy; a deliverable **is** a task (there is no separate
  deliverables list); common out-of-scope items go in the optional
  `outOfScope` section.
- **Inventing phases.** The five phases are fixed: Planning, Prerequisites,
  Deployment, Configuration, Testing and Validation. Map your own workflow
  onto them; do not define new ones.
- **A flat prerequisites list.** Prerequisites are keyed by the product they
  belong to (`"prerequisites": { "core": [ ... ] }`), never a single list.
- **Three-point or ranged estimates.** Each choice and task has one `hours`
  number. If your source has best/likely/worst, use the likely value.
- **Tasks without a group.** Every task lives in a group with a `productId`
  (or `""`), a `phase`, `hours`, and `enabled: true`.
- **Extra fields on products** (`category`, `components`, `vendor`, ...).
  Use `portfolio` for grouping and `description` for prose; anything else is
  ignored.
- **Prefixed ids** like `prod-core` or `task-install`. Fine but unnecessary;
  plain kebab-case (`core`, `install-operator`) is the convention.

## Checklist before importing

- Valid JSON; `format` is `scopewright-catalog`, `version` is `1`.
- Every `requires`, `productId`, and solution product names an existing
  product id; no product requires itself or forms a cycle.
- Every question has at least one choice; every choice and task has a
  numeric `hours`.
- Every task `phase` is one of the five phases, spelled exactly.
- ids are unique where the tables above say unique.
- No customer data, hostnames, credentials, or prices.

The app validates on import and repairs what it can: unknown product
references are dropped, missing numbers become `0`, unknown phases become
`Deployment`, and over-long text is trimmed. It never executes anything in
the file (see Safety). Import from Settings → Estimate catalog → Import
.json, then walk through New estimate to see the result.

## Prompt for an AI assistant

Paste this together with this page and your product documentation:

> Using the attached product documentation and the Scopewright authoring
> guide, produce a Scopewright catalog as a single JSON file. The output must
> have exactly the top-level keys `format`, `version`, and `catalog`, and
> `catalog` must contain exactly `products`, `installation`, `prerequisites`,
> `groups`, and `solutions` as defined in the guide's File format section. Do
> not add sections, fields, or phases of your own; read "Common mistakes"
> before you start. Follow the four sorting rules to decide what becomes an installation question, a
> prerequisite, a deliverable, or a required foundation. Model dependencies
> between products with `requires`. Give every choice and task hours on the
> guide's scale, and mark them as first-draft estimates. Use lowercase
> kebab-case ids, the five phases exactly as spelled, and the scope numbering
> convention. Do not include prices, customer names, or internal hostnames.
> Add two or three solution cards for the bundles the documentation presents
> together. Output only the JSON, then a short list of assumptions you made
> about hours.

Validate the result against the checklist, import it, and adjust hours in
the app.

## Safety

Catalog, estimate, and theme files are data, never code. Scopewright never
evaluates anything in them: text is rendered as text, numbers are checked to
be finite, colors must be six-digit hex, images must be inline data URLs of
image types, fonts must be one of the built-in choices, and theme packs are
size-limited with only the manifest and small image files read from the zip.
A file cannot make the app load a remote resource, run a script, or send data
anywhere. If you receive a catalog from someone you do not trust, the worst
it can do is contain wrong hours.
