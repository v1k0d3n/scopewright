# Build stage: install every dependency and build the Node server.
FROM registry.access.redhat.com/ubi9/nodejs-22:latest AS build
WORKDIR /opt/app-root/src
COPY --chown=1001:0 package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=1001:0 . .
RUN npm run build

# Runtime stage: only the build output and the modules `vinext start` needs.
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:latest
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
