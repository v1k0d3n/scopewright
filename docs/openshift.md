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

| File | Purpose |
|------|---------|
| `base/deployment.yaml` | App container (bound to `127.0.0.1:3000`) and the `oauth-proxy` sidecar |
| `base/serviceaccount.yaml` | Registers the Route as the OAuth redirect target |
| `base/rbac.yaml` | ClusterRole for the proxy's review calls; Role + RoleBinding deciding who may log in |
| `base/configmap.yaml` | `AUTH_MODE=proxy`, `AUTH_EDITORS`, `AUTH_LOGOUT_URL` |
| `base/service.yaml` | Annotated so the cluster issues the proxy's TLS certificate |
| `base/route.yaml` | Re-encrypt TLS to the proxy |
| `base/pvc.yaml` | The shared catalog and theme |
| `base/buildconfig.yaml`, `base/imagestream.yaml` | On-cluster image build |

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

## Removing everything

```bash
oc delete project scopewright
oc delete clusterrole scopewright-oauth-proxy clusterrolebinding scopewright-oauth-proxy
```
