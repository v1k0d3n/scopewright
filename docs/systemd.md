# Deploying Scopewright with systemd

This target runs one app container with a rootless Podman `.kube` Quadlet.
It shares Kubernetes manifests with the OpenShift target and publishes
`http://127.0.0.1:3000` on the host. Your existing authenticating reverse
proxy handles remote login and forwards requests to that address.

```text
browser → existing proxy (login + TLS) → host 127.0.0.1:3000 → app container
                                                               │
                                                  volume scopewright-data
                                                  catalog.json, branding.json
```

## Prerequisites

- A Linux host with systemd, cgroup v2, and Podman 5.8 or newer with Quadlet
  support.
  Check with `podman --version` and
  `podman info --format '{{.Host.CgroupsVersion}}'` (expect `v2`).
- A normal user account configured for rootless Podman, including subordinate
  UID/GID ranges. Run the commands below as that user, from the repository
  root; build images and manage the service with the same account.
- `kubectl` with Kustomize support. `oc kustomize` or `kustomize build` can
  replace `kubectl kustomize`; rendering does not require a cluster.
- For remote access, an existing authenticating proxy on the same host that
  can reach its loopback address. A proxy in an isolated container sees its
  own localhost, so it needs access to the host network for this upstream.

Quadlet requires cgroup v2 and uses a generator to create the service from
the `.kube` file. See the [Podman Quadlet documentation](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html).

## 1. Set your values

```bash
cp -r deploy/systemd/overlays/example deploy/systemd/overlays/local
```

Edit `deploy/systemd/overlays/local/kustomization.yaml`:

- Set `AUTH_EDITORS` to the usernames or emails your proxy sends. The example
  uses `alice, bob@example.com`; empty means every user identified by the
  proxy can edit.
- Set `AUTH_USER_HEADER`, `AUTH_EMAIL_HEADER`, and `AUTH_GROUPS_HEADER` if
  your proxy uses different headers. The defaults are `x-forwarded-user`,
  `x-forwarded-email`, and `x-forwarded-groups`.
- Optionally set `AUTH_EDITOR_GROUP` or `AUTH_LOGOUT_URL` to match your proxy.

Add optional settings as additional JSON patch entries with `op: add`, a
path such as `/data/AUTH_USER_HEADER`, and your chosen `value`.

The default is `AUTH_MODE=proxy`. The proxy must authenticate every remote
request, remove client-supplied identity headers, and set verified identity
headers itself. Scopewright does not perform login or require identity
headers for reads; it uses them to authorize writes. Direct localhost
access without those headers is read-only. Any local user able to reach the
port can forge those headers, so this deployment requires a trusted host.

For a standalone local workspace, uncomment the example's `AUTH_MODE` patch
to set it to `open`. Everyone who can reach the app can then read and write.
Configure the authenticating proxy before making that workspace remotely
available.

### Optional: Google Drive as a save location

Users can always save estimates in their browser or, in Chrome and Edge, in a
local folder. To also offer Google Drive, create three values in your own
Google Cloud project as described in [Estimate sources](sources.md), then
uncomment the `secretGenerator` block in your overlay and fill them in:

```yaml
secretGenerator:
  - name: scopewright-sources
    literals:
      - SOURCE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
      - SOURCE_GOOGLE_API_KEY=AIza...
      - SOURCE_GOOGLE_PROJECT_NUMBER=1234567890
generatorOptions:
  disableNameSuffixHash: true
```

Kustomize writes a `Secret` into the rendered `scopewright.yaml`, and Podman
loads it when the pod starts; nothing else needs to be created. The
Deployment references the Secret as optional, so without it the app starts
and simply does not offer Drive. After changing the values, render
`scopewright.yaml` again and restart the service.

The rendered file now holds these values, which is why the install step below
writes it readable only by the service's user. They are not confidential (the app hands them
to every signed-in browser, which is how Google's browser sign-in works), but
they are specific to your deployment. Do not add the OAuth client *secret*;
Scopewright does not use one.

The Authorized JavaScript origin you register with Google must be the address
people actually open, which for this target is your proxy's public URL, not
`127.0.0.1:3000`.

To limit which locations are offered at all, add `SOURCES` to the ConfigMap
with an `op: add` patch on `/data/SOURCES`, for example
`"local-folder, google-drive"`.

Review the rendered manifests:

```bash
kubectl kustomize deploy/systemd/overlays/local
```

## 2. Build and install

Build the image in your rootless user's image store:

```bash
podman build -t localhost/scopewright:latest -f Containerfile .
```

The overlay uses that image with `imagePullPolicy: IfNotPresent`. To use a
registry image, change the image in your local overlay and pull it as the
same user before starting the service.

Install the rendered YAML beside the Quadlet. The following Bash subshell
stops on errors and stages each file before replacing the installed copy:

```bash
(
  set -eu
  scopewright_units="${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd"
  scopewright_stage="$(mktemp -d)"
  trap 'rm -rf "$scopewright_stage"' EXIT

  kubectl kustomize deploy/systemd/overlays/local > "$scopewright_stage/scopewright.yaml"
  install -d -m 0755 "$scopewright_units"
  # 0600: the rendered file holds your source settings when Google Drive is enabled.
  install -m 0600 "$scopewright_stage/scopewright.yaml" "$scopewright_units/scopewright.yaml.new"
  install -m 0644 deploy/systemd/scopewright.kube "$scopewright_units/scopewright.kube.new"
  mv "$scopewright_units/scopewright.yaml.new" "$scopewright_units/scopewright.yaml"
  mv "$scopewright_units/scopewright.kube.new" "$scopewright_units/scopewright.kube"

  systemctl --user daemon-reload
  systemctl --user start scopewright.service
)
```

Check the service and open `http://127.0.0.1:3000` locally, or use your
proxy's URL to sign in:

```bash
systemctl --user status scopewright.service
curl --fail http://127.0.0.1:3000/api/workspace/catalog
journalctl --user -u scopewright.service -f
```

The Quadlet's `[Install]` section attaches it to `default.target`, so it
starts with the user's systemd manager. Generated services are not enabled
with `systemctl enable`. To start at host boot and keep running after logout,
ask the host administrator to enable lingering for this account:

```bash
sudo loginctl enable-linger "$USER"
```

These startup rules and rootless installation paths are described in the
[Quadlet guide](https://docs.podman.io/en/latest/markdown/podman-systemd.unit.5.html#enabling-unit-files).

## Updates and restart

For an image update, rebuild with the same tag. For configuration changes,
edit and review the local overlay. Then **stop the service before replacing
the installed YAML**:

```bash
systemctl --user stop scopewright.service
```

Repeat the installation block above to render, install, reload, and start.
Stopping first lets Podman tear down resources using their original names
and configuration. The data volume survives. For a restart with no file or
image changes, use `systemctl --user restart scopewright.service`.

## Storage and backup

The shared PVC becomes the Podman named volume `scopewright-data`, mounted
at `/opt/app-root/data`. The app runs as container UID 1001, GID 0; the
systemd overlay sets matching ownership on newly created volumes. The PVC's
`1Gi` request does not impose a host disk quota. Podman's [Kubernetes YAML
support](https://docs.podman.io/en/latest/markdown/podman-kube-play.1.html) describes
how PVCs map to named volumes.

`KubeDownForce=false` preserves the named volume when the service stops or
restarts. To take a consistent backup, stop the service and export the volume:

```bash
systemctl --user stop scopewright.service
podman volume export --output scopewright-data.tar scopewright-data
systemctl --user start scopewright.service
```

Move the backup somewhere durable. See [podman volume export](https://docs.podman.io/en/latest/markdown/podman-volume-export.1.html).
Catalog and theme exports from the app also work; each person's working
estimate remains in their browser and needs its own export.

## How the manifests are shared

| Path | Purpose |
|------|---------|
| `deploy/base/` | Shared Deployment, ConfigMap, and PersistentVolumeClaim |
| `deploy/openshift/base/` | Adds cluster login, routing, RBAC, and builds |
| `deploy/systemd/base/` | Adapts the shared workload and volume for Podman |
| `deploy/systemd/overlays/example/` | Example local image and proxy configuration |
| `deploy/systemd/scopewright.kube` | Host port binding, service lifecycle, and logging |

The systemd overlay renders only a Deployment, ConfigMap, and PVC. Podman
accepts a Deployment as input and creates a single pod; systemd manages its
lifecycle. There is no Kubernetes cluster controller, Service, Route, or
RBAC in this target. The app listens on the container network so Podman can
forward traffic, while the Quadlet restricts the published host port to
`127.0.0.1`.

## Troubleshooting

- **Service not found after reload:** inspect Quadlet generator errors with
  `/usr/lib/systemd/system-generators/podman-system-generator --user --dryrun`
  (the path can vary by distribution). Older Podman versions may not support
  the supplied keys.
- **Image missing:** run `podman image inspect localhost/scopewright:latest`
  as the service's user, then build it if needed. Rootful images are in a
  different store.
- **Cannot edit through the proxy:** check the verified identity headers
  and `AUTH_EDITORS`, then render and reinstall configuration changes.
- **Data directory permission denied:** inspect `podman volume inspect
  scopewright-data`. Ownership annotations apply when the volume is created;
  an existing volume with different ownership needs adjustment or restoration
  into a correctly owned volume.

## Remove the service

Stop it while the installed YAML still exists, then remove both files:

```bash
systemctl --user stop scopewright.service
scopewright_units="${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd"
rm "$scopewright_units/scopewright.kube" "$scopewright_units/scopewright.yaml"
systemctl --user daemon-reload
```

This keeps `scopewright-data`. After backing it up, permanently delete the
shared catalog and theme only if intended:

```bash
podman volume rm scopewright-data
```
