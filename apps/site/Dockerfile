# syntax=docker/dockerfile:1
# Public website: the landing pages and the documentation at /docs, built as a
# Next.js static export and served by nginx.

# Build stage
FROM --platform=$BUILDPLATFORM node:24.19.0-alpine AS builder

ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && \
  corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Copy package files first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/site/package.json ./apps/site/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/landing/package.json ./packages/landing/

# Install only the site and the workspace packages it depends on
RUN pnpm install --frozen-lockfile --filter "@margaya/site..."

# Copy only necessary source code. The site reads the docs content and
# openapi.json from apps/docs, and the landing copy from i18n, at build time.
COPY packages/typescript-config ./packages/typescript-config
COPY packages/landing ./packages/landing
COPY i18n ./i18n
COPY apps/docs ./apps/docs
COPY apps/site ./apps/site

# Build the static export into apps/site/out
WORKDIR /app/apps/site
RUN pnpm run build && find out -type f -name '*.map' -delete

# Production stage with specific version
FROM nginx:1.29.5-alpine AS runtime

# Create non-root user and configure nginx in a single layer
RUN addgroup -g 1001 appuser && \
  adduser -u 1001 -G appuser -D appuser && \
  chown -R appuser:appuser /var/cache/nginx && \
  chmod -R 755 /var/cache/nginx && \
  mkdir -p /var/run/nginx && \
  chown -R appuser:appuser /var/run/nginx && \
  chmod -R 755 /var/run/nginx && \
  touch /var/run/nginx.pid && \
  chown appuser:appuser /var/run/nginx.pid && \
  chmod 644 /var/run/nginx.pid && \
  sed -i 's/user  nginx;//' /etc/nginx/nginx.conf

# Copy the exported site from the builder stage
COPY --from=builder --chown=appuser:appuser /app/apps/site/out /usr/share/nginx/html

COPY --chown=appuser:appuser apps/site/nginx.conf /etc/nginx/conf.d/default.conf

# Switch to non-root user
USER appuser
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/ || exit 1

# Use exec form of CMD for proper signal handling
CMD ["nginx", "-g", "daemon off;"]
