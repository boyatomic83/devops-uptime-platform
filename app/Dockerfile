# syntax=docker/dockerfile:1.7

# ---- deps: production dependencies only ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA secret lets builds work behind TLS-intercepting proxies; no-op otherwise
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export npm_config_cafile=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- runtime: minimal, non-root ----
FROM node:26-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
# server.js traps SIGTERM/SIGINT itself, so node can safely run as PID 1
CMD ["node", "src/server.js"]
