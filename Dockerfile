# Stage 1: Install dependencies and build
FROM oven/bun:1-debian AS build

WORKDIR /app

# Copy workspace config files first for better layer caching
COPY package.json bun.lock pnpm-workspace.yaml turbo.json ./

# Copy all package.json files for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages (shared -> web + server)
RUN bun run build

# Stage 2: Production runtime
FROM oven/bun:1-slim

WORKDIR /app

# Copy server build output
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/package.json ./

# Copy frontend build as static files for the server to serve
COPY --from=build /app/apps/web/dist ./public

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/fit-analyzer.db

EXPOSE 3001

CMD ["bun", "dist/index.js"]
