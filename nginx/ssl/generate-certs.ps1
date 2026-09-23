# ==============================================================================
# Generate Self-Signed TLS Certificates for Localhost Development (PowerShell)
# Outputs standard Certbot-compatible filenames: fullchain.pem and privkey.pem
# ==============================================================================

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$fullchain = Join-Path $scriptDir "fullchain.pem"
$privkey = Join-Path $scriptDir "privkey.pem"

Write-Host "Generating 2048-bit self-signed SSL/TLS certificate for localhost..." -ForegroundColor Cyan

# Locate openssl executable
$openssl = Get-Command "openssl" -ErrorAction SilentlyContinue
if (-not $openssl) {
    $gitOpenSsl = "C:\Program Files\Git\usr\bin\openssl.exe"
    if (Test-Path $gitOpenSsl) {
        $opensslCmd = $gitOpenSsl
    } else {
        Write-Error "OpenSSL was not found. Please ensure Git for Windows or OpenSSL is installed and in PATH."
    }
} else {
    $opensslCmd = $openssl.Source
}

$tempConfig = [System.IO.Path]::GetTempFileName()
$cnfContent = @"
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
"@

Set-Content -Path $tempConfig -Value $cnfContent -Encoding Ascii

try {
    $argsList = @(
        "req", "-x509", "-nodes", "-days", "365",
        "-newkey", "rsa:2048",
        "-keyout", $privkey,
        "-out", $fullchain,
        "-config", $tempConfig
    )
    & $opensslCmd @argsList
} finally {
    if (Test-Path $tempConfig) {
        Remove-Item -Path $tempConfig -Force
    }
}

Write-Host "Certificates successfully generated:" -ForegroundColor Green
Write-Host "   - Certificate / Chain: $fullchain"
Write-Host "   - Private Key:        $privkey"
Write-Host ""
Write-Host "Production Note: In production, Certbot creates fullchain.pem and privkey.pem in" -ForegroundColor Yellow
Write-Host "   /etc/letsencrypt/live/<domain>/ which can be mounted directly into /etc/nginx/ssl/." -ForegroundColor Yellow
