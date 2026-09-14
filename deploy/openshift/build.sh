#!/usr/bin/env bash
# Build the Scopewright image on the cluster from the working tree and roll it out.
#   deploy/openshift/build.sh
# Uses deploy/openshift/overlays/local if present (your cluster values, git-ignored),
# otherwise the generic base. See docs/openshift.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAMESPACE=${NAMESPACE:-scopewright}
OVERLAY=${OVERLAY:-deploy/openshift/overlays/local}
[ -d "$OVERLAY" ] || OVERLAY=deploy/openshift/base
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "Applying $OVERLAY"
oc kustomize "$OVERLAY" | oc apply -f -
# The proxy's session cookie seed: generated once per namespace, never committed.
if ! oc get secret scopewright-session -n "$NAMESPACE" >/dev/null 2>&1; then
  oc create secret generic scopewright-session -n "$NAMESPACE" \
    --from-literal=session_secret="$(head -c 32 /dev/urandom | base64 | tr -d '\n=+/' | head -c 32)"
fi
# Stage a clean copy: node_modules and dist are recreated in the image, and
# macOS resource forks confuse the build pod's tar.
rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .next \
  --exclude .vinext --exclude '._*' --exclude .DS_Store ./ "$STAGE/"
COPYFILE_DISABLE=1 oc start-build scopewright -n "$NAMESPACE" --from-dir="$STAGE" --follow --wait
oc rollout status deployment/scopewright -n "$NAMESPACE" --timeout=180s
echo "https://$(oc get route scopewright -n "$NAMESPACE" -o jsonpath='{.spec.host}')"
