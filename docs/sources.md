# Estimate sources: where saved estimates live

A **source** is a place a user can save several estimates and open them
again. Scopewright ships three, and a deployment decides which are offered.
This page is for the person deploying Scopewright and for developers adding a
source. For day-to-day use, see
[Saved estimates](guide.md#saved-estimates) in the user guide.

Contents

1. [What ships](#what-ships)
2. [Where the data goes](#where-the-data-goes)
3. [Choosing which sources are offered](#choosing-which-sources-are-offered)
4. [Setting up Google Drive](#setting-up-google-drive)
5. [Locking and conflicts](#locking-and-conflicts)
6. [Adding a source](#adding-a-source)

## What ships

| Source | id | Needs | Notes |
|--------|----|-------|-------|
| This browser | `browser` | nothing | Always offered. Kept in the browser's storage, private to that browser, and gone if site data is cleared. |
| Local folder | `local-folder` | Chrome or Edge | JSON files in a folder the user picks, through the browser's File System Access API. Point it at a synced or network folder to share with a team. Other browsers show the source as unavailable and keep using Import and Export. |
| Google Drive | `google-drive` | deployment settings, below | JSON files in a Drive folder the user picks, with the user's own Google sign-in. Not shown at all until the deployment configures it. |

## Where the data goes

Estimates contain customer names, so they never touch the Scopewright server.

- Sources run entirely in the user's browser and talk to their storage
  directly: the browser's own storage, the local disk, or
  `googleapis.com`.
- The only thing the server contributes is
  `GET /api/workspace/sources`, which tells the browser which sources this
  deployment offers and hands over their public settings.
- For Google Drive, the user signs in to Google in Google's own window.
  Scopewright never sees a password. It asks for the narrow `drive.file`
  permission: files the app created or the user picked, and nothing else in
  their Drive. The access token lives in the page's memory for about an hour,
  is never written to storage, and is never sent to the Scopewright server.
  There is no OAuth client secret and no refresh token.
- Google's scripts are loaded only when a user clicks **Connect Google
  Drive**. A deployment that does not configure Drive loads no third-party
  scripts at all.

## Choosing which sources are offered

| Variable | Meaning | Default |
|----------|---------|---------|
| `SOURCES` | Comma-separated source ids to offer, for example `local-folder, google-drive`. `browser` is always offered. | every source that is configured |
| `SOURCE_<NAME>` | A setting handed to the sources in the browser as `<NAME>`. | unset |

`SOURCES` is ordinary configuration and belongs in the `scopewright-config`
ConfigMap. The `SOURCE_*` settings go in the optional `scopewright-sources`
Secret, described next.

**`SOURCE_*` values are public.** The app sends them to every signed-in
browser, because that is how browser-side sign-in works. Keeping them in a
Secret keeps deployment-specific values out of the shared ConfigMap and out
of git; it does not make them confidential. Never put a real secret there.
As a guard, the server refuses to publish any `SOURCE_*` variable whose name
contains `SECRET`, `PASSWORD`, `PRIVATE`, or `TOKEN`, and the deployment
checks in CI reject such keys.

## Setting up Google Drive

Each deployment uses **its own** Google Cloud project. There is no shared
Scopewright application at Google to get approved. A personal Google account
is enough to set this up and test it; no company or Workspace administrator
needs to be involved until you want more than 100 users.

### 1. Create the Google Cloud project

At [console.cloud.google.com](https://console.cloud.google.com), create a
project (no billing is needed) and note its **project number**, shown on the
project dashboard.

### 2. Enable two APIs

Under **APIs & Services → Library**, enable **Google Drive API** and
**Google Picker API**.

### 3. Configure the consent screen

Under **APIs & Services → OAuth consent screen** (it may open as "Google
Auth Platform"):

- **Audience: External**, publishing status **Testing**, to try it out. Add
  each person who will use it under **Test users** (up to 100). They will see
  a "Google hasn't verified this app" notice and continue past it.
- **Audience: Internal**, if the project belongs to a Google Workspace
  organization. Everyone in the organization can use it, with no test-user
  list and no verification. This is the natural choice for a team deployment.
- To open an External app to everyone, publish it. With only the
  `drive.file` scope this is Google's lighter brand verification, not a
  security assessment.

You do not need to add scopes on the consent screen; the app requests
`drive.file` when the user connects.

### 4. Create the OAuth client ID

Under **Credentials → Create credentials → OAuth client ID**:

- Application type: **Web application**.
- **Authorized JavaScript origins**: the exact origin users open, for example
  `https://scopewright.apps.example.com`. Add `http://localhost:3000` if you
  also develop locally. The site does not have to be reachable from the
  internet; the sign-in happens in the user's browser.
- Leave **Authorized redirect URIs** empty.

Copy the **Client ID**. Ignore the client secret: Scopewright does not use
one, and it must not be deployed.

### 5. Create the API key for the folder picker

Under **Credentials → Create credentials → API key**, then edit the key:

- **Application restrictions: Websites**, with your site, for example
  `https://scopewright.apps.example.com/*`.
- **API restrictions: Restrict key**, and select **Google Picker API**.

These two restrictions are what protect the key, since it is visible to
browsers by design.

### 6. Give the three values to the deployment

| Variable | Value |
|----------|-------|
| `SOURCE_GOOGLE_CLIENT_ID` | the OAuth client ID, ending in `.apps.googleusercontent.com` |
| `SOURCE_GOOGLE_API_KEY` | the restricted API key |
| `SOURCE_GOOGLE_PROJECT_NUMBER` | the project number |

All three are required; with any missing, Google Drive is simply not offered.

**OpenShift or Kubernetes.** Create the Secret, then restart the app so it
picks the values up:

```bash
oc -n scopewright create secret generic scopewright-sources \
  --from-literal=SOURCE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com \
  --from-literal=SOURCE_GOOGLE_API_KEY=AIza... \
  --from-literal=SOURCE_GOOGLE_PROJECT_NUMBER=1234567890
oc -n scopewright rollout restart deployment/scopewright
```

Or keep it with your other values: uncomment the `secretGenerator` block in
your copy of `deploy/openshift/overlays/example/kustomization.yaml`
(`overlays/local` is git-ignored) and run `deploy/openshift/build.sh`.

**systemd / Podman.** Uncomment the `secretGenerator` block in your copy of
`deploy/systemd/overlays/example/kustomization.yaml`, render
`scopewright.yaml` again, and restart the service, as described in
[Deploying with systemd](systemd.md). The Secret is written into the
rendered file and Podman loads it when the pod starts. Keep that file
readable only by the service's user.

**Local development.**

```bash
SOURCE_GOOGLE_CLIENT_ID=... SOURCE_GOOGLE_API_KEY=... SOURCE_GOOGLE_PROJECT_NUMBER=... npm run dev
```

The Deployment references the Secret as optional. Without it the app starts
normally and offers the sources that need no settings.

### 7. Check it

Open **Saved estimates**. A **Google Drive** card appears beside the others.
**Connect Google Drive** opens Google's window, then a folder chooser with
**My Drive**, **Shared with me**, and **Shared drives** tabs.

| Symptom | Cause |
|---------|-------|
| No Google Drive card | One of the three values is missing, the app was not restarted, or `SOURCES` excludes `google-drive`. `GET /api/workspace/sources` shows what the app sees. |
| "The Google sign-in window was blocked" | The browser blocked the pop-up. Allow pop-ups for the site. |
| Google error `origin_mismatch` | The site's origin is not in the client's Authorized JavaScript origins, or differs by scheme or port. |
| Google error `access_denied` with a Testing app | The account is not in the consent screen's test users. |
| The folder chooser is blank or errors | The API key's website or API restriction does not match, or the Picker API is not enabled. |
| "Google Drive refused that" | The user has view-only access to that folder or file. |

### Known limits

- Whether a colleague can see estimates you saved in a shared folder, under
  the `drive.file` permission, has not yet been verified with two accounts
  ([#23](https://github.com/v1k0d3n/scopewright/issues/23)).
- Google's folder chooser cannot create folders, so the Drive source has its
  own **New folder…** link
  ([#24](https://github.com/v1k0d3n/scopewright/issues/24)).
- After a page reload the user clicks **Connect Google Drive** again, which
  is one click while signed in to Google
  ([#27](https://github.com/v1k0d3n/scopewright/issues/27)).

## Locking and conflicts

None of these stores offers a real lock, so a lock is a small advisory
record: a sibling `<name>.json.lock` file in a folder, or the file's
`appProperties` in Drive. It names the holder and expires after ten minutes;
the app renews it every three minutes while the estimate is open, and
re-checks it immediately before every write. A record claiming to last longer
than the app ever grants is ignored, so a crafted file cannot block an
estimate forever.

The backstop is a revision check on every save: a content hash for local
files, Drive's revision id, a counter in the browser. If the stored file has
changed or disappeared since it was opened, nothing is overwritten and the
user is told.

Neither Drive nor the browser's file API can check and write in one step, so
two saves landing in the same instant, with the lock also bypassed, is the one
case that can slip through. The check is made as late as each store allows,
and on Drive an overwrite is detected afterwards and reported, with the other
version still in the file's version history
([#25](https://github.com/v1k0d3n/scopewright/issues/25)).

## Adding a source

Sources are compiled in. Nothing is loaded at runtime, so a deployment only
ever runs code that was reviewed into the repository.

1. Write `app/lib/sources/<name>.ts` exporting an object that implements
   `SourceProvider` from `app/lib/sources/types.ts`: `configured`,
   `unavailable`, `resume`, `connect`, `disconnect`, `location`, `list`,
   `read`, `write`, `remove`, `readLock`, `writeLock`, and optionally
   `changeLocation` and `createFolder`.
2. Add it to the array in `app/lib/sources/registry.ts`.

That is the whole change; the rest of the app does not know which sources
exist. A source reads its own `SOURCE_*` settings from the `config` it is
handed, so no server code changes either.

Rules a source must keep:

- Run in the browser and talk to the store directly. Do not route estimates
  through the Scopewright server.
- Treat everything read back as untrusted. Use `describe()` from
  `documents.ts` for list rows and `parseLock()` for lock records; opened
  files are validated again by the caller.
- `write` with a revision must reject with `ConflictError` when the stored
  file has moved on or is gone, checking as late as the store allows. It must
  never recreate a file that was deleted elsewhere.
- Throw `NotConnectedError` when the user has to connect again, and a
  `DOMException` named `AbortError` when the user cancels a chooser.
- Keep credentials in memory. Never write a token to storage.

`browser.ts` is the smallest complete example; `google-drive.ts` shows a
remote store with sign-in.
