# Release builders must record resolved image digests alongside the commit.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY . .
RUN pnpm install --frozen-lockfile
# Build every shipped surface; WeChat artifacts still need a real AppID for device acceptance.
RUN pnpm --dir apps/api build && pnpm --dir apps/pc exec vite build --base=/ && pnpm --dir apps/supplier-h5 exec vite build --base=/supplier/ && pnpm --dir apps/mini build:h5
# A deploy-only file is intentionally never copied into images from the host.
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=3000 TRIAL_PASSWORD_LOGIN=false REMINDER_SEND_WECHAT=false DB_POOL_MAX=5
COPY --from=build --chown=node:node /app /app
# If heavy creates backup-work first, preserve the backup image postgres UID ownership.
RUN mkdir -p /monitor/backup /monitor/postgres && chown 999:999 /monitor/backup
USER node
CMD ["node", "apps/api/dist/apps/api/src/main.js"]
FROM nginx:1.28-bookworm AS web
COPY --from=build /app/apps/pc/dist /usr/share/nginx/html
COPY --from=build /app/apps/supplier-h5/dist /usr/share/nginx/html/supplier
# mini H5 is an optional preview surface, not a substitute for mp-weixin acceptance.
COPY --from=build /app/apps/mini/dist/build/h5 /usr/share/nginx/html/mobile
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
