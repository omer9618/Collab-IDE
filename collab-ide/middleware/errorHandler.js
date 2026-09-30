/**
 * @file middleware/errorHandler.js
 * @module middleware/errorHandler
 * @description Centralized Plain-English Error Sanitization Middleware (NFR-47).
 *
 * Implements NFR-47 compliance:
 * - All errors returned to clients are formatted in clear, plain English.
 * - Zero raw error codes (e.g. E11000, ECONNREFUSED, ERR_HTTP_HEADERS_SENT, CastError) are exposed.
 * - Zero stack traces or internal file system paths are exposed to the user.
 * - Zero internal database/schema identifiers (ObjectId, collection names, index names) are leaked.
 * - Full operational diagnostic details are safely preserved in server logs via `logger.error`.
 */

const logger = require('../utils/logger');

/**
 * Maps raw technical errors (Mongoose, JWT, Express, Node.js) into plain-English messages and status codes.
 *
 * @param {Error|Object} err - Raw error instance
 * @returns {{ status: number, message: string }} Sanitized plain-English response
 */
function sanitizeErrorToPlainEnglish(err) {
  if (!err) {
    return {
      status: 500,
      message: 'An unexpected server error occurred. Please try again later.',
    };
  }

  // 1. JSON Request Body Syntax Errors (e.g. malformed JSON in POST/PUT request)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return {
      status: 400,
      message: 'The request body could not be parsed. Please check that your submission is valid JSON.',
    };
  }

  // 2. Mongoose Duplicate Key Errors (MongoDB code 11000)
  if (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000)) {
    const keyPattern = err.keyPattern || {};
    if (keyPattern.email || keyPattern.emailHash) {
      return {
        status: 409,
        message: 'An account with this email address already exists. Please log in or use a different email.',
      };
    }
    if (keyPattern.uuid) {
      return {
        status: 409,
        message: 'A workspace room with this identifier already exists.',
      };
    }
    if (keyPattern.ip || keyPattern.ipHash) {
      return {
        status: 409,
        message: 'A security entry for this IP address is already registered.',
      };
    }
    return {
      status: 409,
      message: 'A resource with these details already exists. Please provide unique information.',
    };
  }

  // 3. Mongoose CastError (Invalid ObjectId or type format in query/params)
  if (err.name === 'CastError') {
    return {
      status: 400,
      message: 'The provided identifier or parameter is invalid. Please verify your input and try again.',
    };
  }

  // 4. Mongoose Schema Validation Errors
  if (err.name === 'ValidationError') {
    if (err.errors && typeof err.errors === 'object') {
      const messages = Object.values(err.errors).map((e) => {
        // Strip technical path names from Mongoose messages
        let msg = e.message || 'Invalid value';
        if (msg.startsWith('Path `') && msg.includes('` is required')) {
          const field = e.path ? e.path.replace(/([A-Z])/g, ' $1').toLowerCase() : 'field';
          return `The ${field} is required`;
        }
        msg = msg.replace(/Path `([^`]+)`/g, (_, p) => p.charAt(0).toUpperCase() + p.slice(1));
        return msg;
      });
      return {
        status: 400,
        message: `Validation failed: ${messages.join('. ')}.`,
      };
    }
    return {
      status: 400,
      message: 'The submitted information did not pass data validation rules. Please review your input.',
    };
  }

  // 5. JSON Web Token (JWT) Signature & Session Errors
  if (err.name === 'JsonWebTokenError') {
    return {
      status: 401,
      message: 'Your authentication token is invalid. Please log in again to continue.',
    };
  }

  if (err.name === 'TokenExpiredError') {
    return {
      status: 401,
      message: 'Your session has expired. Please log in again to continue.',
    };
  }

  if (err.name === 'NotBeforeError') {
    return {
      status: 401,
      message: 'Your session token is not yet active. Please check your system clock and try again.',
    };
  }

  // 6. Express Rate Limiter Errors
  if (err.status === 429 || err.statusCode === 429) {
    return {
      status: 429,
      message: 'You have made too many requests in a short period. Please wait a moment before trying again.',
    };
  }

  // 7. Security / Decryption Errors (NFR-22)
  if (
    err.message &&
    (err.message.includes('Integrity check failed') ||
     err.message.includes('unable to authenticate data') ||
     err.message.includes('Unsupported state'))
  ) {
    return {
      status: 500,
      message: 'A security verification check failed while processing encrypted data. Please contact support.',
    };
  }

  // 8. Custom Application Errors with explicit status
  if (err.status && typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
    // If the developer provided a clean string message without stack traces or error codes, preserve it
    const msg = String(err.message || 'Invalid request.');
    if (!containsTechnicalJargon(msg)) {
      return {
        status: err.status,
        message: msg,
      };
    }
    return {
      status: err.status,
      message: 'The request could not be processed due to invalid parameters.',
    };
  }

  // 9. Generic Fallback for Internal 500 Errors
  return {
    status: 500,
    message: 'An unexpected server error occurred. Please try again later.',
  };
}

/**
 * Checks whether an error string contains raw technical error codes, stack traces, or internal paths.
 *
 * @param {string} str - Error string to inspect
 * @returns {boolean} True if string contains technical jargon
 */
function containsTechnicalJargon(str) {
  if (typeof str !== 'string') return true;
  const technicalPatterns = [
    /\bat\s+[A-Za-z0-9_./\\-]+\s*\(?/, // Stack trace frames: "at Function.run ("
    /[a-zA-Z]:\\[a-zA-Z0-9_\-\\]+/,     // Windows absolute paths
    /\/var\/|\/home\/|\/usr\/|\/app\//,  // Linux absolute paths
    /node_modules/,                      // Library paths
    /\bE\d{4,5}\b/,                      // MongoDB error codes e.g. E11000
    /\bE(CONNREFUSED|CONNRESET|ADDRINUSE|NOTFOUND|TIMEDOUT|PIPE)\b/, // Node system error codes
    /Mongo(Server)?Error/,
    /CastError/,
    /\bCast to\b/i,
    /\bObjectId\b/,
    /BSONTypeError/,
    /JsonWebTokenError|TokenExpiredError/,
    /\bjwt\s+(malformed|expired|must be provided)\b/i,
    /TypeError:|ReferenceError:|SyntaxError:|RangeError:/,
    /UnhandledPromiseRejection/,
    /\[object\s+Object\]/i,
  ];
  return technicalPatterns.some((pattern) => pattern.test(str));
}

/**
 * Centralized Express Error Handling Middleware (NFR-47).
 *
 * @param {Error} err - Captured error instance
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Express next callback
 */
function errorHandler(err, req, res, next) {
  // Log the complete diagnostic error for server administrators in restricted chmod 640 log files
  logger.error(err, {
    method: req.method,
    path: req.originalUrl,
    userId: req.user?._id,
    ip: req.ip,
  });

  const { status, message } = sanitizeErrorToPlainEnglish(err);

  // Return strictly plain-English response. Never expose stack traces or raw codes.
  return res.status(status).json({ message });
}

/**
 * 404 Handler for Unmatched API Endpoints (NFR-47).
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
function notFoundHandler(req, res) {
  return res.status(404).json({
    message: 'The requested resource could not be found. Please check the URL and try again.',
  });
}

/**
 * Helper to safely respond to errors in route catch blocks with plain English (NFR-47).
 *
 * @param {import('express').Response} res - Express response object
 * @param {Error|string} err - Captured error
 * @param {string} [defaultMessage='An unexpected server error occurred. Please try again later.'] - Fallback message
 * @param {number} [statusCode=500] - HTTP status code
 */
function sendPlainEnglishError(res, err, defaultMessage = 'An unexpected server error occurred. Please try again later.', statusCode = 500) {
  if (err instanceof Error) {
    logger.error(err);
    const sanitized = sanitizeErrorToPlainEnglish(err);
    return res.status(sanitized.status).json({ message: sanitized.message });
  }

  logger.error(String(err));
  return res.status(statusCode).json({ message: defaultMessage });
}

module.exports = {
  errorHandler,
  notFoundHandler,
  sanitizeErrorToPlainEnglish,
  sendPlainEnglishError,
  containsTechnicalJargon,
};
