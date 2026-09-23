# ==============================================================================
# CollabIDE - Production Nginx Reverse Proxy Container (NFR-33)
# Multi-stage build: Builds React frontend bundle and serves via Nginx Alpine
# SECURITY NOTE: TLS certificates are NEVER baked into this image;
# they must be mounted at runtime via volume: ./nginx/ssl:/etc/nginx/ssl:ro
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build Frontend SPA Client Bundle
# ------------------------------------------------------------------------------
FROM node:22-alpine AS frontend-builder

WORKDIR /app

# Install dependencies
COPY frontend/package*.json ./
RUN npm ci --prefer-offline --no-audit

# Copy source and build production bundle
COPY frontend/ ./
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Nginx Reverse Proxy & Static Asset Server
# ------------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runner

# Create required directory hierarchy
RUN mkdir -p /var/www/collabide/frontend/dist \
             /etc/nginx/ssl \
             /etc/nginx/conf.d \
             /var/www/certbot \
             /var/log/nginx

# Copy production Nginx configurations
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/conf.d/collabide.conf /etc/nginx/conf.d/collabide.conf
COPY nginx/templates/ /etc/nginx/templates/

# Copy compiled frontend assets from builder stage
COPY --from=frontend-builder /app/dist /var/www/collabide/frontend/dist

# Expose HTTP (80) and HTTPS (443) ports
EXPOSE 80 443

# Health check verifies Nginx is responsive and proxying
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --no-check-certificate --spider https://127.0.0.1/health || exit 1

# Launch Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
