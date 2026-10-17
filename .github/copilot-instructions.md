# Review instructions for Scopewright

Scopewright is a public repository. When reviewing a pull request, check the
points below in addition to correctness.

## File formats are a promise

Estimates, catalogs, and theme packs are JSON files that people keep for
years; [docs/formats.md](../docs/formats.md) describes the rules. Flag a PR
that:

- adds, renames, removes, or reinterprets a field of `Estimate`, `Catalog`,
  or the theme in `app/lib/types.ts`, or what `mergeEstimate` /
  `mergeCatalog` / the theme pack reader keep, **without** bumping the version
  in `app/lib/formats.ts` and adding an upgrade step;
- edits anything under `tests/fixtures/` other than adding a new `vN` folder
  (an existing fixture changing means an old document now prints
  differently);
- changes what the scope document or `scopeText` prints for existing data
  without saying so in the PR;
- writes a file from a newer format version back (it must stay view-only or
  be refused), or lets the server accept a catalog write in another version.

## Docs match the code

Behavior people see is described in `docs/guide.md`; catalog fields in
`docs/authoring.md`; formats in `docs/formats.md`. Flag a PR whose code and
docs disagree, including a doc that describes something the code does not do.

## Public repository

Flag credentials, tokens, kubeconfigs, internal hostnames or cluster names,
customer names, and environment-specific values. Example data uses the
fictitious Solstice pack under `packs/solstice`.
