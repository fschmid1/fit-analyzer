# Stage 1: Install dependencies and build
FROM oven/bun:1-debian AS build

WORKDIR /app

# Copy workspace config files first for better layer caching
COPY package.json bun.lock turbo.json bunfig.toml ./

# Copy all package.json files for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Fix broken symlinks left by bun's hoisted linker in sub-package node_modules
RUN find apps/*/node_modules -xtype l -delete 2>/dev/null || true

# Build all packages (shared -> web + server)
RUN bun run build

# Stage 2: Production runtime
FROM oven/bun:1-slim

WORKDIR /app

# Copy server build output
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/package.json ./

# Copy the server-prepared static bundle.
# The server build step assembles this from the web build, so Docker and
# local production runs serve the same artifact set.
COPY --from=build /app/apps/server/public ./public

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/fit-analyzer.db

EXPOSE 3001

CMD ["bun", "dist/index.js"]
