#!/usr/bin/env python3
"""Render deployment entry points and check their storage and access boundaries.

Requires PyYAML and kustomize, kubectl, or oc. No cluster or Podman service is
needed; this checks generated configuration, not container runtime behavior.
"""

import configparser
from pathlib import Path
import re
import shutil
import subprocess
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
TARGETS = {
    "shared": "deploy/base",
    "openshift": "deploy/openshift/base",
    "openshift-example": "deploy/openshift/overlays/example",
    "systemd": "deploy/systemd/base",
    "systemd-example": "deploy/systemd/overlays/example",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def render(command, path):
    output = subprocess.check_output([*command, str(ROOT / path)], text=True)
    resources = {}
    for document in yaml.safe_load_all(output):
        if document is None:
            continue
        key = (document["kind"], document["metadata"]["name"])
        require(key not in resources, f"duplicate resource: {key}")
        resources[key] = document
    return resources


def app(resources):
    deployment = resources[("Deployment", "scopewright")]
    pod = deployment["spec"]["template"]["spec"]
    web = next(container for container in pod["containers"] if container["name"] == "web")
    return deployment, pod, web


def check_common(resources):
    deployment, pod, web = app(resources)
    require(deployment["spec"].get("replicas") == 1, "file storage requires one replica")
    labels = deployment["spec"]["template"]["metadata"]["labels"]
    require(all(labels.get(key) == value for key, value in deployment["spec"]["selector"]["matchLabels"].items()),
            "Deployment selector does not match its pod")

    config = {}
    for source in web.get("envFrom", []):
        if "configMapRef" in source:
            config.update(resources[("ConfigMap", source["configMapRef"]["name"])]["data"])
    # Source settings (Google Drive and the like) come from a Secret the deployer may or may not create.
    secret_refs = [source["secretRef"] for source in web.get("envFrom", []) if "secretRef" in source]
    require(secret_refs == [{"name": "scopewright-sources", "optional": True}],
            "source settings must come from the optional scopewright-sources Secret")
    require(not any(key.startswith("SOURCE_") for key in config),
            "SOURCE_* settings belong in the scopewright-sources Secret, not the ConfigMap")
    for (kind, name), secret in resources.items():
        if kind == "Secret" and name == "scopewright-sources":
            keys = set(secret.get("data", {})) | set(secret.get("stringData", {}))
            require(all(key.startswith("SOURCE_") for key in keys), "scopewright-sources may only hold SOURCE_* settings")
            require(not any(re.search("SECRET|PASSWORD|PRIVATE|TOKEN", key, re.IGNORECASE) for key in keys),
                    "scopewright-sources is published to browsers and must not hold real secrets")
    config.update({entry["name"]: entry["value"] for entry in web.get("env", []) if "value" in entry})
    require(config.get("AUTH_MODE") == "proxy", "deployment must require proxy identity for writes")

    volumes = {volume["name"]: volume for volume in pod["volumes"]}
    for container in pod["containers"]:
        for mount in container.get("volumeMounts", []):
            require(mount["name"] in volumes, f"missing volume for {container['name']} mount")
    for volume in volumes.values():
        if "persistentVolumeClaim" in volume:
            require(("PersistentVolumeClaim", volume["persistentVolumeClaim"]["claimName"]) in resources,
                    "volume references a missing PVC")
    mount = next(mount for mount in web["volumeMounts"] if mount["mountPath"] == config["DATA_DIR"])
    claim_name = volumes[mount["name"]]["persistentVolumeClaim"]["claimName"]
    claim = resources[("PersistentVolumeClaim", claim_name)]
    require(claim["spec"]["accessModes"] == ["ReadWriteOnce"], "shared file storage must use ReadWriteOnce")
    return claim_name, config["DATA_DIR"], config["PORT"]


def hostname(web):
    arguments = web.get("args", [])
    return arguments[arguments.index("--hostname") + 1]


def check_openshift(resources, port):
    deployment, pod, web = app(resources)
    require(deployment["spec"]["strategy"]["type"] == "Recreate", "OpenShift must replace the single writer during rollout")
    require(hostname(web) == "127.0.0.1", "OpenShift app must only accept traffic through its sidecar")
    account = pod["serviceAccountName"]
    require(("ServiceAccount", account) in resources, "OAuth service account is missing")
    proxy = next(container for container in pod["containers"] if container["name"] == "oauth-proxy")
    arguments = proxy["args"]
    for argument in ("--provider=openshift", f"--openshift-service-account={account}",
                     f"--upstream=http://127.0.0.1:{port}", "--pass-user-headers=true"):
        require(argument in arguments, f"missing OAuth boundary setting: {argument}")

    service = resources[("Service", "scopewright")]
    labels = deployment["spec"]["template"]["metadata"]["labels"]
    require(all(labels.get(key) == value for key, value in service["spec"]["selector"].items()),
            "Service does not select the app pod")
    proxy_ports = {entry["name"]: entry["containerPort"] for entry in proxy["ports"]}
    for entry in service["spec"]["ports"]:
        target = entry["targetPort"]
        require(proxy_ports.get(target, target) == 8443, "Service must route only to the OAuth HTTPS port")
    require("--https-address=:8443" in arguments, "OAuth proxy must listen on its Service target port")
    route = resources[("Route", "scopewright")]
    require(route["spec"]["to"]["name"] == service["metadata"]["name"], "Route must reference the OAuth Service")
    require(route["spec"]["port"]["targetPort"] in {entry["name"] for entry in service["spec"]["ports"]},
            "Route references a missing Service port")

    secrets = {volume["name"]: volume["secret"]["secretName"] for volume in pod["volumes"] if "secret" in volume}
    issued_secret = service["metadata"]["annotations"]["service.beta.openshift.io/serving-cert-secret-name"]
    require(secrets.get("tls") == issued_secret, "OAuth TLS volume must use the Service's issued certificate")
    require(secrets.get("session") == "scopewright-session", "OAuth session secret reference is missing")
    mounts = {mount["name"]: mount["mountPath"] for mount in proxy["volumeMounts"]}
    for name, argument, filename in (("tls", "tls-cert", "tls.crt"), ("tls", "tls-key", "tls.key"),
                                     ("session", "cookie-secret-file", "session_secret")):
        require(f"--{argument}={mounts[name]}/{filename}" in arguments, "OAuth secret file and mount do not match")


def check_systemd(resources, claim_name, image_uid):
    require({kind for kind, _ in resources} <= {"Deployment", "ConfigMap", "PersistentVolumeClaim", "Secret"},
            "systemd output contains a cluster-only resource")
    deployment, pod, web = app(resources)
    require("strategy" not in deployment["spec"], "Podman does not implement Deployment rollout strategies")
    require(len(pod["containers"]) == 1, "systemd expects the existing external authentication proxy")
    require(hostname(web) == "0.0.0.0", "published port requires the app to listen on the pod interface")
    for field in ("serviceAccountName", "serviceAccount", "imagePullSecrets", "affinity", "nodeSelector", "tolerations"):
        require(field not in pod, f"systemd pod contains a cluster-only field: {field}")
    require(not pod.get("hostNetwork"), "systemd must use port publishing rather than host networking")
    for container in pod["containers"]:
        require("readinessProbe" not in container, "Podman does not implement Kubernetes readiness probes")
        require(all("hostPort" not in entry for entry in container.get("ports", [])), "Quadlet must own host port publishing")
    security = {**pod.get("securityContext", {}), **web.get("securityContext", {})}
    uid, gid = security["runAsUser"], security["runAsGroup"]
    require(uid == image_uid and uid > 0, "systemd user must match the nonroot image user")
    require(gid == 0, "systemd group must match the image's writable root-group paths")
    annotations = resources[("PersistentVolumeClaim", claim_name)]["metadata"]["annotations"]
    require(annotations.get("volume.podman.io/uid") == str(uid)
            and annotations.get("volume.podman.io/gid") == str(gid),
            "Podman volume ownership must match the app's user and group")


def check_quadlet(port):
    unit = configparser.ConfigParser(interpolation=None)
    unit.read(ROOT / "deploy/systemd/scopewright.kube")
    require(unit["Kube"]["Yaml"] == "scopewright.yaml", "Quadlet must load the installed rendered YAML")
    require(unit["Kube"]["PublishPort"] == f"127.0.0.1:{port}:{port}", "Quadlet must publish only to host loopback")
    require(not unit["Kube"].getboolean("KubeDownForce", fallback=True), "Quadlet teardown must preserve the data volume")
    require(unit["Service"]["Restart"] == "always", "systemd must restart the application service")


def main():
    command = next(([tool, action] for tool, action in (("kustomize", "build"), ("kubectl", "kustomize"), ("oc", "kustomize"))
                    if shutil.which(tool)), None)
    require(command is not None, "install kustomize, kubectl, or oc to render manifests")
    image_user = re.findall(r"^USER\s+(\d+)(?::\d+)?\s*$", (ROOT / "Containerfile").read_text(), re.MULTILINE)
    require(image_user, "Containerfile must declare its numeric runtime user")
    shared = None
    for name, path in TARGETS.items():
        try:
            resources = render(command, path)
            storage = check_common(resources)
            if shared is None:
                shared = storage
            require(storage == shared, "target changed the shared PVC name, data path, or app port")
            if name.startswith("openshift"):
                check_openshift(resources, storage[2])
            elif name.startswith("systemd"):
                check_systemd(resources, storage[0], int(image_user[-1]))
            print(f"PASS {path}")
        except (KeyError, ValueError, StopIteration, IndexError) as error:
            raise ValueError(f"{path}: {error}") from error
    check_quadlet(shared[2])
    print("PASS deploy/systemd/scopewright.kube")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, subprocess.CalledProcessError, yaml.YAMLError, configparser.Error) as error:
        sys.exit(f"Deployment validation failed: {error}")
