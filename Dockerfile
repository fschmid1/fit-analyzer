# Stage 1: Install dependencies and build
FROM node:22-slim AS build

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace config files first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy all package.json files for dependency resolution
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages (shared -> web + server)
RUN pnpm build

# Stage 2: Production runtime
FROM node:22-slim

# Install build tools for native modules (better-sqlite3 needs them at runtime on some platforms)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install pnpm for pruning
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy the full workspace for proper node_modules resolution
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/turbo.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist/
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist/
COPY --from=build /app/apps/web/package.json apps/web/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy frontend build as static files for the server to serve
COPY --from=build /app/apps/web/dist apps/server/public/

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/fit-analyzer.db

WORKDIR /app/apps/server

EXPOSE 3001

CMD ["node", "dist/index.js"]
