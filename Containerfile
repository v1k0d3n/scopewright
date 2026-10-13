# Base images are pinned by digest; Dependabot proposes updates weekly.
# Build stage: install every dependency and build the Node server.
FROM registry.access.redhat.com/ubi9/nodejs-22:latest@sha256:724b994feda13753bdc8dcb38dbf2ab14decb5105d18021b8a2b092f7e3b4c69 AS build
WORKDIR /opt/app-root/src
COPY --chown=1001:0 package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=1001:0 . .
RUN npm run build

# Runtime stage: only the build output and the modules `vinext start` needs.
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:latest@sha256:8896caf8fc58a794f0746178a4803227c510b97e598efd0c62a809508ed7b662
WORKDIR /opt/app-root/src
ENV NODE_ENV=production PORT=3000 HOME=/opt/app-root/src
COPY --from=build --chown=1001:0 /opt/app-root/src/package.json ./
COPY --from=build --chown=1001:0 /opt/app-root/src/node_modules ./node_modules
COPY --from=build --chown=1001:0 /opt/app-root/src/dist ./dist
# OpenShift runs containers as an arbitrary uid in the root group.
RUN chgrp -R 0 /opt/app-root/src && chmod -R g=u /opt/app-root/src
USER 1001
EXPOSE 3000
CMD ["node", "node_modules/vinext/dist/cli.js", "start"]
