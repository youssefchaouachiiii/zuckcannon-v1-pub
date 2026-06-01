// backend/utils/redact-axios-error.js

const TOKEN_QUERY_RE = /(access_token=)[^&\s"]+/gi;
const TOKEN_JSON_RE = /("access_token"\s*:\s*")[^"]+/gi;

/**
 * Mutate an axios error in place to strip live access tokens before it
 * propagates or gets logged. A raw axios error otherwise leaks the token via
 * util.inspect of:
 *   - err.config.params.access_token
 *   - err.config.url / err.config.data (token in query string / body)
 *   - err.config.headers.Authorization
 *   - the raw ClientRequest path (err.request / err.response.request)
 *
 * Safe to call on any value; no-ops on non-axios errors. Nothing downstream
 * reads error.config / error.request (verified), so scrubbing/dropping them is
 * safe. Returns the same error reference for chaining.
 */
export function redactAxiosError(error) {
  try {
    if (!error || typeof error !== "object") return error;

    const cfg = error.config;
    if (cfg) {
      if (cfg.params && cfg.params.access_token) cfg.params.access_token = "[REDACTED]";
      if (typeof cfg.url === "string") cfg.url = cfg.url.replace(TOKEN_QUERY_RE, "$1[REDACTED]");
      if (typeof cfg.data === "string") {
        // Body may be query-encoded (access_token=...) or JSON ("access_token":"...").
        cfg.data = cfg.data.replace(TOKEN_QUERY_RE, "$1[REDACTED]").replace(TOKEN_JSON_RE, "$1[REDACTED]");
      } else if (cfg.data && typeof cfg.data === "object") {
        if (cfg.data.access_token) {
          cfg.data.access_token = "[REDACTED]";
        } else if (typeof cfg.data.pipe === "function" || cfg.data.constructor?.name === "FormData") {
          // A multipart/stream body can hold the token in an internal buffer
          // that deep inspection (console.dir / raised depth) would print —
          // the body is already sent by error time, so omit it entirely.
          cfg.data = "[multipart body omitted]";
        }
      }
      if (cfg.headers) {
        delete cfg.headers.Authorization;
        delete cfg.headers.authorization;
      }
    }

    // The raw ClientRequest carries the request path (with the token) and is
    // not read after the request settles — drop it so it can't be inspected.
    if (error.request) error.request = undefined;
    if (error.response && error.response.request) error.response.request = undefined;
  } catch {
    /* redaction must never throw */
  }
  return error;
}
