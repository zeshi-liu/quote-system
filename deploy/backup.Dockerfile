ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS node
FROM postgres:17.11-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends age ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN mkdir -p /backup-work && chown postgres:postgres /backup-work
WORKDIR /app
# The runtime image supplies the reviewed lockfile installation including the COS SDK.
COPY --from=runtime /app/node_modules /app/node_modules
COPY scripts/deployment-*.cjs /app/scripts/
USER postgres
ENTRYPOINT ["node"]
CMD ["scripts/deployment-backup.cjs"]
