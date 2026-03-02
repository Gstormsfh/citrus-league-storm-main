# ── Citrus API Server — Cloud Run Container ──────────────────────
# Multi-stage build for the Hono API server
# Uses tsx to run TypeScript directly (handles @citrus/shared TS imports)

# ── Stage 1: Install dependencies ────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app

# Copy workspace root config + all workspace package.json files
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

# Install all workspace dependencies (npm hoists to root node_modules)
RUN npm ci

# ── Stage 2: Production image ───────────────────────────────────
FROM node:20-slim AS runner
WORKDIR /app

# Copy installed dependencies from builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./

# Copy server source + shared package source
COPY server/ ./server/
COPY packages/shared/ ./packages/shared/

# Cloud Run injects PORT env var (default 8080)
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Use tsx to run TypeScript directly — avoids complex build chain
# since @citrus/shared exports raw .ts files
CMD ["npx", "tsx", "server/src/index.ts"]
