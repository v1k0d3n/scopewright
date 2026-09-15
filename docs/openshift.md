# Deploying Scopewright on OpenShift

This is how the reference deployment runs: one pod with the app and an
`oauth-proxy` sidecar, login through the cluster's own OAuth server, the
shared catalog and theme on a persistent volume, and the image built on the
cluster so no external registry is needed.

```
browser ── Route (re-encrypt) ── Service ── [ oauth-proxy :8443 ─► app :3000 (localhost) ]
                                                   │                    │
                                        cluster OAuth server       PVC /opt/app-root/data
                                        (GitLab, OIDC, ... IdP)    catalog.json, branding.json
```

## Prerequisites

- An OpenShift 4.x cluster and `oc` logged in as a user who can create a
  namespace and a ClusterRole (the proxy needs to create TokenReviews and
  SubjectAccessReviews).
- At least one identity provider configured on the cluster (GitLab, GitHub,
  any OpenID Connect provider such as Authentik or Keycloak, LDAP, htpasswd).
  Scopewright never sees credentials; the cluster's OAuth server handles
  login and the proxy asserts the result. See the OpenShift documentation on
  "Configuring identity providers".
- A default StorageClass for the 1 GiB volume.

## 1. Set your values

```bash
cp -r deploy/openshift/overlays/example deploy/openshift/overlays/local
```

Edit `deploy/openshift/overlays/local/kustomization.yaml`:

- **Route host**: the public hostname, under your cluster's apps domain
  (for example `scopewright.apps.ocp.example.com`).
- **`AUTH_EDITORS`**: who may change the shared catalog and theme, as
  comma-separated usernames exactly as the identity provider reports them,
  or emails. Leave it empty to make every admitted user an editor.

`overlays/local` is git-ignored, so your values never reach the repository.

## 2. Build and deploy

```bash
deploy/openshift/build.sh
```

The script applies the manifests, creates the proxy's session secret on the
first run, uploads the working tree as a binary build, waits for the rollout,
and prints the URL. Re-run it to deploy a new version; the volume and the
secret persist.

### Using your own image instead of the cluster build

The build script uploads the source and builds the image on the cluster. If
you would rather build with podman or docker and push to a registry the
cluster can pull from:

```bash
podman build -t quay.io/you/scopewright:0.1.0 -f Containerfile .
podman push quay.io/you/scopewright:0.1.0
```

then uncomment the Deployment patch in your overlay to point at that image
(see `overlays/example/kustomization.yaml`) and apply with
`oc apply -k deploy/openshift/overlays/local`. The BuildConfig and ImageStream
are harmless when unused. Build for the cluster's architecture (`--platform
linux/amd64` on Apple Silicon).

## 3. Grant access

Who may open Scopewright is ordinary RBAC. The proxy admits a user only if
they can `get` the `scopewright-access` ConfigMap in the namespace. The base
manifests bind that permission to a group named `scopewright-users`; cluster
admins pass automatically.

```bash
oc adm groups new scopewright-users alice
oc adm groups add-users scopewright-users bob
```

Users see their name at the bottom of the sidebar. Editors see "Shared
workspace · synced"; everyone else sees "View only" and can browse but not
change the catalog or settings. A user's cluster username is what
`oc get users` shows after their first login; put that in `AUTH_EDITORS`.

## 4. First content

A fresh deployment has an empty catalog and a neutral brand. Sign in as an
editor, open Settings, and import a theme pack and a catalog. The
`packs/solstice` directory is a complete fictitious example; zip its theme
with `npm run pack:theme -- packs/solstice` and import
`packs/solstice/catalog.json` and, on the New estimate page,
`packs/solstice/sample-estimate.json`.

## How the pieces fit

`deploy/base/` contains the app resources shared with the systemd deployment.
`deploy/openshift/base/` adds cluster authentication, TLS, and image builds.
The existing `deploy/openshift/overlays/` directories customize that complete
OpenShift deployment.

| File | Purpose |
|------|---------|
| `deploy/base/deployment.yaml` | App container, data mount, and liveness check |
| `deploy/base/configmap.yaml` | Shared `AUTH_MODE=proxy` and `AUTH_EDITORS` defaults |
| `deploy/base/pvc.yaml` | Persistent storage for the shared catalog and theme |
| `deploy/openshift/base/deployment.yaml` | Patch binding the app to `127.0.0.1:3000`, adding the `oauth-proxy` sidecar, and configuring cluster rollouts |
| `deploy/openshift/base/serviceaccount.yaml` | Registers the Route as the OAuth redirect target |
| `deploy/openshift/base/rbac.yaml` | ClusterRole for the proxy's review calls; Role + RoleBinding deciding who may log in |
| `deploy/openshift/base/configmap.yaml` | The access marker ConfigMap checked by the proxy |
| `deploy/openshift/base/kustomization.yaml` | Combines shared and OpenShift resources and sets `AUTH_LOGOUT_URL` |
| `deploy/openshift/base/service.yaml` | Annotated so the cluster issues the proxy's TLS certificate |
| `deploy/openshift/base/route.yaml` | Re-encrypt TLS to the proxy |
| `deploy/openshift/base/buildconfig.yaml`, `deploy/openshift/base/imagestream.yaml` | On-cluster image build |

The app itself only knows about identity headers (see `app/lib/identity.ts`
and the Authentication section of the README). Replacing the OpenShift proxy
with oauth2-proxy pointed at an OIDC provider, Cloudflare Access, or a
Traefik ForwardAuth setup is a manifest change: set `AUTH_USER_HEADER`,
`AUTH_EMAIL_HEADER`, `AUTH_GROUPS_HEADER`, and optionally
`AUTH_EDITOR_GROUP` to match what that proxy sends.

## Publishing through an external reverse proxy

If a reverse proxy outside the cluster (Pangolin, Traefik, nginx, Cloudflare
Tunnel) fronts the router, publish **both** hostnames: Scopewright's and the
cluster's OAuth server (`oauth-openshift.<apps domain>`), because login
redirects the browser there. The OAuth route is TLS passthrough, so the
router identifies it by TLS server name (SNI). Configure the external proxy
to send the hostname as SNI when it connects to the router; without it the
router answers "Application is not available".

## Troubleshooting

**The app pod shows `ImagePullBackOff` for `scopewright:latest`.** Expected
until the first build has pushed an image into the ImageStream; the
Deployment's image trigger then rewrites the reference and the pod starts.
If a build has completed and the pod is still failing, check
`oc get istag scopewright:latest -n scopewright`.

**The build never starts ("timed out waiting for build … to run").** The
build pod could not run. Look at why:

```bash
oc get pods,builds -n scopewright
oc describe pod scopewright-1-build -n scopewright | sed -n '/^Events/,$p'
```

- `FailedScheduling … Insufficient cpu/memory`: the cluster cannot fit the
  build's requests (250m CPU, 512Mi by default in
  `base/buildconfig.yaml`); free capacity or lower the limits.
- `Failed to pull image … registry.access.redhat.com`: the cluster cannot
  reach Red Hat's public registry for the UBI Node.js base image. Fix
  outbound access or mirror the two images named in the `Containerfile`.
- `Failed to pull image … quay.io/openshift-release-dev/… unauthorized`: the
  build pod's builder image comes from the OpenShift release payload, and the
  cluster's global pull secret cannot fetch it (expired, replaced, or an
  installation that never had one). Repair the pull secret
  (`oc get secret pull-secret -n openshift-config`), or skip the cluster
  build and use your own image as described above.

**The build fails while running.** `oc logs build/scopewright-<n> -n
scopewright` shows the npm or build error.

**Login redirects fail or loop.** See "Publishing through an external
reverse proxy" above, and confirm the Route host in your overlay matches the
hostname users type; the OAuth callback is registered for that exact host.

## Removing everything

```bash
oc delete project scopewright
oc delete clusterrole scopewright-oauth-proxy clusterrolebinding scopewright-oauth-proxy
```
