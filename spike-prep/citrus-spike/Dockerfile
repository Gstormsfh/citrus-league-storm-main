# Phase 4.5 chunk 11g.2.0 — spike container.
# Multi-stage so the runtime image stays small.
# See docs/PHASE_4_5_GCE_SPIKE_RUNBOOK.md Step 3.

# ---- Stage 1: install deps ------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /build

# uWebSockets.js installs from a GitHub tarball; npm needs git for that.
RUN apk add --no-cache git

COPY package.json ./
RUN npm install --omit=dev

# ---- Stage 2: minimal runtime ---------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

COPY --from=build /build/node_modules ./node_modules
COPY package.json index.js ./

ENV NODE_ENV=production
ENV PORT=3001
ENV DRAFT_WS_PORT=3002

EXPOSE 3001 3002

CMD ["node", "index.js"]
