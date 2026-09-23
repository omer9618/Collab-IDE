# ==============================================================================
# CollabIDE - Node.js Backend Service Container
# ==============================================================================

FROM node:22-alpine

WORKDIR /app

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production --prefer-offline --no-audit

# Copy application code
COPY . .

# Expose internal backend port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
