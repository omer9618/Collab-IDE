# CollabIDE Nginx Reverse Proxy & TLS Infrastructure (NFR-33)

This directory contains the production-grade reverse proxy configuration, TLS termination, static asset serving, rate limiting, and containerization setup for **CollabIDE**, satisfying **NFR-33**, **NFR-34**, **NFR-41**, and **NFR-42**.

---

## 1. Architectural Highlights

| Feature | Specification | Implementation Details |
| :--- | :--- | :--- |
| **TLS Termination** | NFR-33 | Listens on port 443; supports TLSv1.2 and TLSv1.3 with modern AEAD ciphers (`ECDHE-ECDSA/RSA-AES128/256-GCM-SHA256/384`). |
| **HTTP to HTTPS Redirection** | NFR-33 | Port 80 returns a 301 Permanent Redirect to `https://$host$request_uri`. |
| **WebSocket Upgrade Proxying** | NFR-33 | Passes RFC 6455 `Upgrade` and `Connection` headers for `/ws/` (Yjs document synchronization) and `/socket.io/` (voice signalling). |
| **Zero WS Disconnects** | NFR-07 | Sets `proxy_read_timeout 86400s;` and `proxy_send_timeout 86400s;` with `proxy_buffering off;` on WebSocket paths to prevent the default 60s timeout drop. |
| **Static Asset Caching** | NFR-41 | `/assets/` served with `Cache-Control: public, max-age=31536000, immutable`; `/index.html` served with `Cache-Control: no-cache`. |
| **Gzip Compression** | NFR-42 | Compresses all text-based responses (`text/html`, `application/javascript`, `text/css`, `application/json`, `image/svg+xml`) > 1KB at level 6. |
| **Connection Rate Limiting** | NFR-34 | `20r/s` baseline (`limit_req_zone`) with `burst=40 nodelay;` and `200` concurrent connections per IP (`limit_conn_zone`). |
| **Lab / Campus NAT Protection** | NFR-34 | WebSocket handshakes (`/ws/`, `/socket.io/`) are exempt from HTTP `limit_req` to prevent 20+ students behind a single NAT from dropping. |
| **Certbot Drop-in Contract** | NFR-33 | Uses strict `fullchain.pem` and `privkey.pem` filenames for zero-config Let's Encrypt / Certbot compatibility. |
| **Dev-Safe HSTS** | Security | Dynamic `map` suppresses `Strict-Transport-Security` for `localhost` and `127.0.0.1` to prevent browser HSTS cache poisoning. |
| **Request Body Size** | Security | `client_max_body_size 25M;` prevents HTTP 413 Payload Too Large errors on code executions and file uploads. |

---

## 2. Directory Layout

```
nginx/
├── nginx.conf                 # Main Nginx configuration (performance, gzip, rate-limiting zones, maps)
├── conf.d/
│   └── collabide.conf         # Site virtual host (port 80 redirect, port 443 TLS, proxy passes, caching)
├── templates/
│   └── collabide.conf.template# Docker envsubst template for dynamic container backend resolution
├── ssl/
│   ├── fullchain.pem          # Generated / Certbot certificate & CA chain (git-ignored)
│   ├── privkey.pem            # Generated / Certbot private key (git-ignored)
│   ├── generate-certs.sh      # Bash script to generate 2048-bit self-signed localhost certificates
│   └── generate-certs.ps1     # PowerShell script to generate 2048-bit self-signed localhost certificates
├── Dockerfile                 # Multi-stage Dockerfile (builds React SPA and configures Nginx Alpine)
└── README.md                  # Operational guide
```

---

## 3. Quick Start: Local Development with Self-Signed TLS

### Step 1: Generate Self-Signed Certificates
Run the certificate generator for your operating system:

- **Windows (PowerShell):**
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\nginx\ssl\generate-certs.ps1
  ```
- **Linux / macOS:**
  ```bash
  chmod +x ./nginx/ssl/generate-certs.sh
  ./nginx/ssl/generate-certs.sh
  ```
This generates `nginx/ssl/fullchain.pem` and `nginx/ssl/privkey.pem` with Subject Alternative Names for `localhost` and `127.0.0.1`.

### Step 2: Build the Frontend Bundle
```bash
cd frontend
npm run build
```

---

## 4. Running with Docker Compose

CollabIDE includes a root `docker-compose.yml` orchestrating the Node.js backend and the Nginx reverse proxy:

```bash
# Start backend and Nginx proxy
docker compose up --build -d

# Check running status
docker compose ps

# View Nginx access & error logs
docker compose logs -f nginx
```

Access CollabIDE at:
- **HTTPS:** `https://localhost` (Accept self-signed certificate warning in browser)
- **HTTP:** `http://localhost` (Automatically redirects with 301 to `https://localhost`)

---

## 5. Production VPS Deployment (per SC-01)

CollabIDE targets deployment on a single Linux VPS (minimum 2 vCPUs, 4GB RAM) running Node.js under PM2 cluster mode (NFR-32) and native Nginx (NFR-33).

### Step 1: Install Nginx
```bash
sudo apt update
sudo apt install -y nginx
```

### Step 2: Obtain Let's Encrypt SSL Certificates with Certbot
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --webroot -w /var/www/certbot -d yourdomain.com
```

### Step 3: Symlink Certificates to the Standard Filename Contract
```bash
sudo mkdir -p /etc/nginx/ssl
sudo ln -sf /etc/letsencrypt/live/yourdomain.com/fullchain.pem /etc/nginx/ssl/fullchain.pem
sudo ln -sf /etc/letsencrypt/live/yourdomain.com/privkey.pem /etc/nginx/ssl/privkey.pem
```

### Step 4: Deploy Nginx Configurations
```bash
# Copy main config
sudo cp nginx/nginx.conf /etc/nginx/nginx.conf

# Copy site virtual host
sudo cp nginx/conf.d/collabide.conf /etc/nginx/conf.d/collabide.conf

# Build frontend and copy dist
cd frontend && npm run build
sudo mkdir -p /var/www/collabide/frontend/dist
sudo cp -r dist/* /var/www/collabide/frontend/dist/

# Test syntax and reload Nginx
sudo nginx -t
sudo systemctl reload nginx
```

### Step 5: Automated Zero-Downtime Certificate Renewal
Let's Encrypt certificates renew automatically via Certbot's systemd timer. Add a post-renewal reload hook:
```bash
echo "systemctl reload nginx" | sudo tee /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh
```

If using Docker Compose in production:
```bash
echo "docker compose -f /path/to/Collab-IDE/docker-compose.yml exec -T nginx nginx -s reload" | sudo tee /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh
```
Certificates rotate with zero container rebuilds and zero downtime.

---

## 6. Rate Limit Tuning for University Labs & NATs

CollabIDE is designed for instructor-led computer labs where 20+ students connect from behind a single university NAT IP.

- **HTTP Requests (`/api/`, `/`):** Enforces a baseline of `20r/s` with a `burst=40 nodelay;` buffer. The burst absorbs concurrent page loads and script requests without dropping packets.
- **Concurrent Connections:** Set to `200` per IP to comfortably accommodate 20–30 simultaneous student workstations on one campus network.
- **WebSocket Handshakes (`/ws/`, `/socket.io/`):** Completely exempt from `limit_req` so simultaneous room joins at the start of a class never drop. Room concurrency limits are enforced at the application layer per room (NFR-36).
