## What and why

<!-- What changes for people using Scopewright, and why. Link the issue: "Closes #NN". -->

## How it was checked

<!-- Tests added or changed, and what was reviewed on the demo deployment. -->

## Checklist

- [ ] `npm run check` passes (lint, type-check, tests, build).
- [ ] Docs match the code: the [user guide](../docs/guide.md) for anything people see, [authoring.md](../docs/authoring.md) for catalog fields, and the README where it describes the feature.
- [ ] **File formats:** this PR does not change what is stored in an estimate, catalog, or theme file, **or** it bumps the version in `app/lib/formats.ts`, adds an upgrade step and a frozen `tests/fixtures/vN/` folder, and updates [docs/formats.md](../docs/formats.md). Existing fixture folders are unchanged.
- [ ] No credentials, internal hostnames, customer data, or environment-specific values (this repository is public).
