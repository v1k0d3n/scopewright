# Frozen fixtures

Each `vN` folder holds files written by format version N of Scopewright, and
`scope.txt`, the plain-text scope document they printed at the time. The data
is fictitious (the Solstice pack).

These files are never edited. `tests/formats.test.mjs` opens every folder with
today's code and requires the same `scope.txt`, so a change that alters a
document someone already produced fails the build.

When a format version is bumped (see `docs/formats.md`), add a new folder for
it and leave the older ones as they are.

**One recorded exception.** Estimate format 3 replaced the introduction and
closing with custom sections, and an earlier introduction or closing now
prints as a numbered "Introduction" section first and "Closing" section last,
with the same wording. `v2/scope.txt` was updated once to match: the feature
had not reached anyone's documents, and the diff only adds those two headings
and renumbers the sections between them.
