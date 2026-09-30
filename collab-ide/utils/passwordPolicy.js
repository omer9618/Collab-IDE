/**
 * @file utils/passwordPolicy.js
 * @module utils/passwordPolicy
 * @description Password Policy Enforcement and HaveIBeenPwned Breach Verification (NFR-16).
 *
 * Implements:
 * 1. Minimum Complexity Validation:
 *    - Minimum 8 characters in length
 *    - At least one uppercase letter (A-Z)
 *    - At least one lowercase letter (a-z)
 *    - At least one numeric digit (0-9)
 *    - At least one special character (e.g. !@#$%^&*()_+-=[]{}|;:,.<>?)
 *
 * 2. HaveIBeenPwned Breach Verification via k-Anonymity Model:
 *    - Cryptographic Privacy Guarantees:
 *      The candidate password is never transmitted in plain text or in its entirety.
 *      Instead, the password is digested via SHA-1 into a 40-character hexadecimal string.
 *      Only the first 5 characters (the prefix, e.g. "49EFE") are sent to the HaveIBeenPwned
 *      Passwords Range API (https://api.pwnedpasswords.com/range/{prefix}).
 *      The prefix maps to a cluster of hundreds of thousands of unrelated hashes.
 *      The remaining 35 characters (the suffix) are matched locally in memory against the
 *      returned list of suffixes and breach frequency counts.
 *    - Protection against side-channel analysis:
 *      Uses the `Add-Padding: true` header to ensure consistent response padding.
 *    - High Availability Fallback:
 *      Equipped with timeout bounds (AbortSignal.timeout) and fail-safe handling so that
 *      upstream third-party outages do not induce a permanent Denial of Service (DoS)
 *      on user registration or password reset workflows, while logging security audit warnings.
 */

const crypto = require('crypto');

/**
 * Standard password complexity requirements.
 */
const COMPLEXITY_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSpecial: true,
};

/**
 * Validates a password against standard complexity requirements (NFR-16).
 *
 * @function validateComplexity
 * @param {string} password - Candidate password to evaluate
 * @returns {{
 *   isValid: boolean,
 *   errors: string[],
 *   details: {
 *     length: boolean,
 *     uppercase: boolean,
 *     lowercase: boolean,
 *     digit: boolean,
 *     special: boolean
 *   }
 * }}
 */
function validateComplexity(password) {
  if (typeof password !== 'string') {
    return {
      isValid: false,
      errors: ['Password must be provided as a text string.'],
      details: {
        length: false,
        uppercase: false,
        lowercase: false,
        digit: false,
        special: false,
      },
    };
  }

  const hasLength = password.length >= COMPLEXITY_REQUIREMENTS.minLength;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const errors = [];
  if (!hasLength) {
    errors.push(`Password must be at least ${COMPLEXITY_REQUIREMENTS.minLength} characters long.`);
  }
  if (!hasUpper) {
    errors.push('Password must contain at least one uppercase letter (A-Z).');
  }
  if (!hasLower) {
    errors.push('Password must contain at least one lowercase letter (a-z).');
  }
  if (!hasDigit) {
    errors.push('Password must contain at least one numeric digit (0-9).');
  }
  if (!hasSpecial) {
    errors.push('Password must contain at least one special character (e.g. !@#$%^&*).');
  }

  const isValid = hasLength && hasUpper && hasLower && hasDigit && hasSpecial;

  return {
    isValid,
    errors,
    details: {
      length: hasLength,
      uppercase: hasUpper,
      lowercase: hasLower,
      digit: hasDigit,
      special: hasSpecial,
    },
  };
}

/**
 * Checks candidate password against HaveIBeenPwned API using the k-Anonymity model (NFR-16).
 *
 * @async
 * @function checkPwnedPassword
 * @param {string} password - Plain text candidate password
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=4000] - Request timeout in milliseconds
 * @param {string} [options.userAgent='CollabIDE-Security-Validator'] - User Agent header
 * @returns {Promise<{
 *   isPwned: boolean,
 *   breachCount: number,
 *   checked: boolean,
 *   error?: string
 * }>}
 */
async function checkPwnedPassword(password, { timeoutMs = 4000, userAgent = 'CollabIDE-Security-Validator' } = {}) {
  if (!password || typeof password !== 'string') {
    return { isPwned: false, breachCount: 0, checked: false };
  }

  // 1. Compute SHA-1 hash of password (uppercase hexadecimal)
  const sha1 = crypto.createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  try {
    // 2. Query HIBP range API with the 5-char prefix only (k-anonymity)
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Add-Padding': 'true',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.warn(`[HIBP API] Unexpected response status HTTP ${response.status} for prefix ${prefix}`);
      return { isPwned: false, breachCount: 0, checked: false, error: `HTTP ${response.status}` };
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/);

    // 3. Search locally in-memory for the 35-character suffix
    for (const line of lines) {
      const [hashSuffix, countStr] = line.split(':');
      if (hashSuffix && hashSuffix.trim() === suffix) {
        const breachCount = parseInt(countStr, 10) || 1;
        return {
          isPwned: true,
          breachCount,
          checked: true,
        };
      }
    }

    return {
      isPwned: false,
      breachCount: 0,
      checked: true,
    };
  } catch (err) {
    // Graceful fallback: If HIBP is down or network times out, log warning and fail open
    console.warn(`[HIBP API] Breach check could not be completed (${err.message}). Permitting complexity pass.`);
    return {
      isPwned: false,
      breachCount: 0,
      checked: false,
      error: err.message,
    };
  }
}

/**
 * Validates password complexity and checks for known data breach exposure (NFR-16).
 *
 * @async
 * @function validatePasswordPolicy
 * @param {string} password - Candidate password to validate
 * @param {Object} [options]
 * @param {boolean} [options.checkBreach=true] - Whether to query HaveIBeenPwned API
 * @param {number} [options.timeoutMs=4000] - Breach check timeout in milliseconds
 * @returns {Promise<{
 *   isValid: boolean,
 *   message?: string,
 *   errors: string[],
 *   details: {
 *     length: boolean,
 *     uppercase: boolean,
 *     lowercase: boolean,
 *     digit: boolean,
 *     special: boolean
 *   },
 *   isPwned: boolean,
 *   breachCount: number
 * }>}
 */
async function validatePasswordPolicy(password, options = { checkBreach: true }) {
  // Step 1: Validate complexity (length, uppercase, lowercase, digit, special character)
  const complexity = validateComplexity(password);
  if (!complexity.isValid) {
    return {
      isValid: false,
      message: complexity.errors[0] || 'Password does not meet minimum complexity requirements.',
      errors: complexity.errors,
      details: complexity.details,
      isPwned: false,
      breachCount: 0,
    };
  }

  // Step 2: Validate against HaveIBeenPwned API (k-anonymity model)
  if (options.checkBreach !== false) {
    const pwnedResult = await checkPwnedPassword(password, options);
    if (pwnedResult.isPwned) {
      return {
        isValid: false,
        isPwned: true,
        breachCount: pwnedResult.breachCount,
        message: `This password was found in a known data breach (${pwnedResult.breachCount.toLocaleString()} times) and cannot be used per security policy (NFR-16). Please choose a different password.`,
        errors: [`Password was exposed in ${pwnedResult.breachCount.toLocaleString()} known data breaches.`],
        details: complexity.details,
      };
    }
  }

  return {
    isValid: true,
    message: 'Password satisfies complexity and breach policy.',
    errors: [],
    details: complexity.details,
    isPwned: false,
    breachCount: 0,
  };
}

module.exports = {
  COMPLEXITY_REQUIREMENTS,
  validateComplexity,
  checkPwnedPassword,
  validatePasswordPolicy,
};
