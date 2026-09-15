#!/usr/bin/env bash
# Build the Scopewright image on the cluster from the working tree and roll it out.
#   deploy/openshift/build.sh
# Uses deploy/openshift/overlays/local if present (your cluster values, git-ignored),
# otherwise the OpenShift base. See docs/openshift.md.
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
echo "Uploading the source and starting the build (the app pod shows ImagePullBackOff until the first build has pushed an image; that is expected)."
BUILD=$(COPYFILE_DISABLE=1 oc start-build scopewright -n "$NAMESPACE" --from-dir="$STAGE" -o name)
BUILD=${BUILD#build.build.openshift.io/}
echo "Started $BUILD; waiting for its pod to run"
for i in $(seq 1 60); do
  PHASE=$(oc get build "$BUILD" -n "$NAMESPACE" -o jsonpath='{.status.phase}')
  case "$PHASE" in
    Running|Complete) break ;;
    Failed|Error|Cancelled)
      echo "Build $BUILD ended with $PHASE before running:"; oc get build "$BUILD" -n "$NAMESPACE" -o jsonpath='{.status.reason}: {.status.message}{"\n"}'; exit 1 ;;
  esac
  sleep 5
done
if [ "$PHASE" != "Running" ] && [ "$PHASE" != "Complete" ]; then
  echo "Build $BUILD is still $PHASE after 5 minutes. Recent events for its pod:"
  oc describe pod "$BUILD-build" -n "$NAMESPACE" 2>/dev/null | sed -n '/^Events/,$p' | tail -8
  echo "See docs/openshift.md, Troubleshooting."; exit 1
fi
oc logs -f "build/$BUILD" -n "$NAMESPACE"
# The build reports Running for a moment after its log ends; wait for a final phase.
for i in $(seq 1 60); do
  PHASE=$(oc get build "$BUILD" -n "$NAMESPACE" -o jsonpath='{.status.phase}')
  case "$PHASE" in Complete|Failed|Error|Cancelled) break ;; esac
  sleep 2
done
[ "$PHASE" = "Complete" ] || { echo "Build $BUILD finished with $PHASE"; exit 1; }
oc rollout status deployment/scopewright -n "$NAMESPACE" --timeout=300s
echo "https://$(oc get route scopewright -n "$NAMESPACE" -o jsonpath='{.spec.host}')"
