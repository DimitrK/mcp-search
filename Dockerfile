# Multi-stage build for optimized production image
FROM node:20-slim AS builder

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

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code
COPY src ./src

# Build the application
RUN npm run build

# Production stage
FROM node:20-slim AS production

# Install runtime dependencies (dumb-init for signal handling)
RUN apt-get update && apt-get install -y \
    dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home mcp-search

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies (include optional for platform-specific binaries)
RUN npm ci --omit=dev && npm cache clean --force

# Install Playwright and browser dependencies for SPA extraction
RUN npx playwright@1.55.1 install --with-deps chromium

# Ensure Playwright cache directory is writable by mcp-search user
RUN mkdir -p /home/mcp-search/.cache && chown -R mcp-search:nodejs /home/mcp-search/.cache

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R mcp-search:nodejs /app

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
