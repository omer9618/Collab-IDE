/**
 * @file utils/keys.js
 * @module utils/keys
 * @description Cryptographic RSA keypair generator and loader for RS256 JWT signatures.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const keysDir = path.join(__dirname, '..', '.keys');
const privateKeyPath = path.join(keysDir, 'private.pem');
const publicKeyPath = path.join(keysDir, 'public.pem');

/**
 * Initializes or loads existing 2048-bit RSA keypair for asymmetric JWT authentication.
 *
 * SECURITY REASONING:
 * Generates PKCS#8 private and SPKI public PEM keys. Asymmetric signing allows the private
 * key to remain guarded by authentication services while public keys can be safely shared
 * with reverse proxies or microservices for signature verification without risking forgery.
 *
 * @function initKeys
 * @returns {{ privateKey: string, publicKey: string }} Loaded or newly generated PEM strings
 */
function initKeys() {
  if (fs.existsSync(privateKeyPath) && fs.existsSync(publicKeyPath)) {
    return {
      privateKey: fs.readFileSync(privateKeyPath, 'utf8'),
      publicKey: fs.readFileSync(publicKeyPath, 'utf8'),
    };
  }

  // Generate directory if missing
  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  console.log('🔑 Generating RSA keypair (2048-bit) for RS256 JWT signatures...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  fs.writeFileSync(privateKeyPath, privateKey);
  fs.writeFileSync(publicKeyPath, publicKey);
  console.log('🔑 Keypair saved to .keys/');

  return { privateKey, publicKey };
}

const { privateKey, publicKey } = initKeys();

module.exports = {
  privateKey,
  publicKey,
};
