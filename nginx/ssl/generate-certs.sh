#!/usr/bin/env bash
# ==============================================================================
# Generate Self-Signed TLS Certificates for Localhost Development
# Outputs standard Certbot-compatible filenames: fullchain.pem and privkey.pem
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSL_DIR="${SCRIPT_DIR}"

FULLCHAIN="${SSL_DIR}/fullchain.pem"
PRIVKEY="${SSL_DIR}/privkey.pem"

echo "🔐 Generating 2048-bit self-signed SSL/TLS certificate for localhost..."

# OpenSSL configuration file for Subject Alternative Name (SAN)
OPENSSL_CONFIG=$(mktemp)
cat <<EOF > "${OPENSSL_CONFIG}"
[req]
default_bits        = 2048
prompt              = no
default_md          = sha256
distinguished_name  = dn
x509_extensions     = v3_req

[dn]
C  = US
ST = Development
L  = Local
O  = CollabIDE
OU = Engineering
CN = localhost

[v3_req]
basicConstraints = CA:FALSE
keyUsage         = nonRepudiation, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1  = 127.0.0.1
IP.2  = ::1
EOF

openssl req -x509 -nodes -days 365 \
    -newkey rsa:2048 \
    -keyout "${PRIVKEY}" \
    -out "${FULLCHAIN}" \
    -config "${OPENSSL_CONFIG}"

rm -f "${OPENSSL_CONFIG}"

# Secure file permissions (owner read-only for private key)
chmod 600 "${PRIVKEY}"
chmod 644 "${FULLCHAIN}"

echo "✅ Certificates successfully generated:"
echo "   - Certificate / Chain: ${FULLCHAIN}"
echo "   - Private Key:        ${PRIVKEY}"
echo ""
echo "💡 Production Note: In production, Certbot creates fullchain.pem and privkey.pem in"
echo "   /etc/letsencrypt/live/<domain>/ which can be mounted directly into /etc/nginx/ssl/."
