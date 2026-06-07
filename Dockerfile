# Multi-stage build for optimized production image
FROM node:24-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY build.mjs ./

# Install all dependencies, including optional platform bindings needed by native packages.
RUN npm ci --include=optional

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:24-slim AS production

# Install runtime dependencies (dumb-init for signal handling)
RUN apt-get update && apt-get install -y \
    dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home mcp-search

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package files
COPY package*.json ./

# Install production dependencies plus Playwright for SPA extraction in the Docker image.
# Playwright remains optional for npm consumers, but the container should be self-contained.
# Install Playwright in a temp prefix because the root devDependency is omitted in production.
RUN npm ci --omit=dev --include=optional \
    && npm install --prefix /tmp/playwright --ignore-scripts playwright@1.60.0 \
    && cp -R /tmp/playwright/node_modules/playwright /tmp/playwright/node_modules/playwright-core ./node_modules/ \
    && node ./node_modules/playwright/cli.js install --with-deps chromium \
    && rm -rf /tmp/playwright \
    && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data and browser cache directories with proper permissions
RUN mkdir -p /app/data /ms-playwright && chown -R mcp-search:nodejs /app /ms-playwright

# Switch to non-root user
USER mcp-search

# Set environment variables
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Expose health check port (if needed for orchestration)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node dist/cli.js health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Default command
CMD ["node", "dist/cli.js", "server"]
