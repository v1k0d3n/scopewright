# File formats and versions

Scopewright writes JSON files that outlive any one release: estimates people
keep in folders or Drive, catalog exports kept in version control, and the
shared catalog on the server. This page explains how those files are
versioned, what happens when a file and the app do not agree, and the rules
for anyone changing a format. The code lives in `app/lib/formats.ts`.

## The promise

- **An older file always opens.** It is upgraded as it is read, and prints
  the same scope document it printed before.
- **A newer file is never damaged.** Scopewright reads only the parts of a
  file it understands. Saving a file from a newer release would silently drop
  the rest, so it never does that: an estimate opens view-only, a catalog
  import is refused, and the server refuses a catalog save from a page that
  is not running the current version.

## The files

| File | `format` | Current `version` | Where it lives |
|------|----------|-------------------|----------------|
| Estimate | `scopewright-estimate` | 3 | Saved estimates (this browser, a folder, Google Drive) and exports |
| Catalog export | `scopewright-catalog` | 2 | Settings → Export / Import, `packs/` |
| Shared catalog | `scopewright-catalog` | 2 | The server's `data/catalog.json` |
| Theme pack | `scopewright-theme` | 1 | Settings → Theme pack (a zip with `theme.json`) |
| Shared brand | none | none | The server's `data/branding.json` (not versioned yet) |

Every file Scopewright writes also carries `writtenBy`, for example
`"Scopewright 0.3.0"`: the release that wrote it. It is informational, for
people and support; nothing depends on it.

A catalog export wraps the sections in a `catalog` object
(`{ "format", "version", "writtenBy", "exportedAt", "catalog": { ... } }`).
The shared catalog on the server keeps the sections at the top level, next to
`format`, `version`, and `writtenBy`, so a page from before versions existed
can still read it.

### Version history

| Format | Version | Release | Change |
|--------|---------|---------|--------|
| Estimate | 1 | 0.1 | First version. |
| Estimate | 2 | 0.3 | `framing`: the estimate's own introduction and closing. |
| Estimate | 3 | 0.4 | `sectionLayout`: the order of the scope document's sections, and the ones left out. |
| Catalog | 1 | 0.1 | First version. The shared catalog had no `format` or `version`; a file without them is version 1. |
| Catalog | 2 | 0.3 | `documentTemplates`: introduction and closing templates. |
| Theme | 1 | 0.1 | First version. |

## When a file and the app disagree

**An older estimate or catalog** is upgraded when it is read, one version at a
time, and saved in the current version the next time it is saved. Nothing is
asked; fields it did not have get their defaults.

**An estimate from a newer Scopewright** is listed in Saved estimates with a
"Newer version · view only" tag (for files in this browser or a folder;
Google Drive shows it when the file is opened). It opens view-only: every
step and the scope document can be read and printed, but nothing can be
changed, saved, or exported, and the file is not locked, so someone with the
newer release can still open it. Importing one from a file works the same
way.

**A catalog file from a newer Scopewright** is refused on import, with the
version it has and the version this release reads. `npm run catalog:check`
reports the same.

**The shared catalog** accepts writes only in the current version. A tab left
open across an update still runs the old code; its next catalog change is
refused (HTTP 409), and the page shows "Reload to keep working". Tabs from
before versions existed show "Sync failed" instead. Either way the shared
catalog on the server is untouched. The same banner appears during an update,
when a page is briefly newer than the server, and when the stored catalog is
newer than the page.

## What does not depend on versions

An estimate refers to the catalog by id, and its hours, product names, and
wording are recomputed from the current catalog when it is opened.
[authoring.md](authoring.md#estimate-files-are-not-catalogs) lists how
estimates handle catalog items that were removed or turned off. The
introduction and closing are the exception: they are copied into the
estimate, so they print the same whatever later happens to the template.

## Changing a format

Scopewright's readers are tolerant: they fill in defaults and drop fields
they do not know. That keeps old files opening, and it is also why a new
field needs a version: an older release would drop it on its next save.

When a change adds, renames, or reinterprets anything in a file:

1. **Decide whether it needs a new version.** It does if an older release
   reading the new file would lose or misread anything, which is almost
   always. Making a field optional does not avoid this: the older release
   still drops it when it saves.
2. **Bump the version** in `app/lib/formats.ts` and add an upgrade step from
   the previous version (`catalogUpgrades` or `estimateUpgrades`). A test
   fails if a step is missing.
3. **Freeze a fixture.** Add `tests/fixtures/vN/` with a catalog, an estimate,
   and the `scope.txt` they print, generated by the new code. Never edit an
   existing fixture folder: if an old fixture no longer prints its
   `scope.txt`, a document someone already produced has changed.
4. **Update the docs**: the table and history above,
   [authoring.md](authoring.md) for catalog fields, and the
   [user guide](guide.md) for anything people see.
5. **Check the PR template's format item** and say in the PR which version
   changed.

A release that adds a new version should be deployed with the `Recreate`
strategy (the OpenShift manifests already use it), so old and new servers do
not run side by side.
