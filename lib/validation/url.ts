import { z } from "zod";
import isURL, { IsURLOptions } from "validator/lib/isURL";
import isIP from "validator/lib/isIP";

const PROTOCOL_REGEX = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//;

const URL_VALIDATION_OPTIONS: IsURLOptions = {
  protocols: ["http", "https"],
  require_protocol: true,
  allow_query_components: true,
  allow_fragments: true,
  allow_underscores: true,
  require_host: true,
  require_valid_protocol: true,
  allow_protocol_relative_urls: false,
  disallow_auth: false,
};

// Regex patterns for private IP ranges
const PRIVATE_IP_RANGES = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, // 127.0.0.0/8 (Loopback)
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,  // 10.0.0.0/8 (Private Class A)
  /^192\.168\.\d{1,3}\.\d{1,3}$/,     // 192.168.0.0/16 (Private Class C)
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/, // 172.16.0.0/12 (Private Class B)
  /^0\.0\.0\.0$/,                     // Any address
  /^::1$/,                            // IPv6 Loopback
  /^[fF][cCdD][0-9a-fA-F]{2}:.*/,     // IPv6 Unique Local Address (fc00::/7)
  /^[fF][eE][89aAbB][0-9a-fA-F]:.*/,  // IPv6 Link-local Address (fe80::/10)
];

/**
 * Checks if a hostname is a private IP address or localhost.
 */
export function isPrivateIP(hostname: string): boolean {
  // Check for localhost
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    return true;
  }

  // Check if it looks like an IP address
  if (isIP(hostname)) {
    // Check against private ranges
    return PRIVATE_IP_RANGES.some((regex) => regex.test(hostname));
  }

  // It's a domain name, not a private IP (resolving domains to IPs would require async DNS)
  // We accept public domains here.
  return false;
}

/**
 * Best-effort URL decode; returns input as-is if decoding fails.
 */
export function safeDecodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Repair collapsed protocols in URL paths.
 * Browsers/servers can collapse "://" to ":/" in paths.
 * e.g., "https:/www.nytimes.com" → "https://www.nytimes.com"
 */
export function repairProtocol(url: string): string {
  return url.replace(/^([a-zA-Z][a-zA-Z\d+\-.]*):\/(?!\/)/, "$1://");
}

/**
 * Normalize user-provided URLs by ensuring they include a protocol.
 * Accepts inputs with or without http(s) and validates using validator.js.
 * Also handles:
 * - Already percent-encoded URLs (decodes first to avoid double-encoding)
 * - Malformed single-slash protocols like "https:/example.com"
 * - Safety checks for private/local IPs
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    throw new Error("Please enter a URL.");
  }

  // Decode first to handle already-encoded URLs
  const decoded = safeDecodeUrl(trimmed);

  // Repair single-slash protocols
  const repaired = repairProtocol(decoded);

  const candidate = PROTOCOL_REGEX.test(repaired)
    ? repaired
    : `https://${repaired}`;

  // Safety Check: Parse hostname and check for private IPs
  // We check this BEFORE strict validation to give better error messages for localhost/IPs
  try {
    const urlObj = new URL(candidate);
    if (isPrivateIP(urlObj.hostname)) {
      throw new Error("Access to private or local networks is restricted.");
    }
  } catch (err) {
    // If it's our safety error, rethrow it immediately
    if (err instanceof Error && err.message === "Access to private or local networks is restricted.") {
      throw err;
    }
    // If new URL() failed, ignore it here and let isURL handle validation failure below
  }

  if (!isURL(candidate, URL_VALIDATION_OPTIONS)) {
    throw new Error("Please enter a valid URL (e.g. example.com or https://example.com).");
  }

  return candidate;
}

/**
 * Quick helper to check if a string is a valid URL after normalization.
 */
export function isValidUrl(input: string): boolean {
  try {
    normalizeUrl(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * App-specific query params that should NOT be part of cache keys.
 * These are UI state params added by the app, not part of the original article URL.
 */
const APP_QUERY_PARAMS = ['source', 'view', 'sidebar'];

/**
 * Extract the clean article URL by stripping app-specific query parameters
 * and normalizing trailing slashes.
 * This ensures consistent cache keys regardless of how the user accessed the page.
 * 
 * Example:
 *  Input:  "https://example.com/article?source=fetch-fast&view=markdown&sidebar=true"
 *  Output: "https://example.com/article"
 * 
 *  Input:  "https://example.com/article/?id=123&source=fetch-fast"
 *  Output: "https://example.com/article?id=123"
 */
export function extractArticleUrl(inputUrl: string): string {
  try {
    const normalized = normalizeUrl(inputUrl);
    const url = new URL(normalized);

    // Remove app-specific parameters
    APP_QUERY_PARAMS.forEach(param => url.searchParams.delete(param));

    // Normalize trailing slashes in pathname (except for root path "/")
    // This ensures "example.com/path/" and "example.com/path" produce the same cache key
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    // If parsing fails, return the normalized URL as-is
    return normalizeUrl(inputUrl);
  }
}

/**
 * Maximum allowed length for a URL.
 */
export const MAX_URL_LENGTH = 1000;

/**
 * Heuristically extracts the first valid-looking URL from a block of text.
 * Handles:
 * - URLs embedded in sentences (strips trailing punctuation)
 * - URLs inside HTML attributes (e.g. href="...")
 * - "Glued" URLs (e.g. "site.comhttps://other.com") by looking for protocol boundaries.
 */
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;

  // 1. Look for http/https/www patterns. 
  // We use a non-greedy match for the content until we hit common delimiters or another protocol.
  // The negative lookahead (?!...) prevents matching into the next http(s)://
  const urlRegex = /(?:https?:\/\/|www\.)[^\s"<>]+?(?=(?:https?:\/\/|www\.)|[\s"<>)]|$)/i;

  const match = text.match(urlRegex);
  if (!match) return null;

  let candidate = match[0];

  // 2. Clean up trailing punctuation often found when pasting from text
  // e.g. "Visit google.com." -> "google.com"
  // We strip trailing dots, commas, parens, etc. IF they are at the very end
  const trailingPunctuationRegex = /[.,;!?)]+$/;
  candidate = candidate.replace(trailingPunctuationRegex, '');

  return candidate;
}

/**
 * Zod schema that normalizes and validates URLs consistently on both
 * the client and server.
 * Supports extracting URLs from longer text blocks.
 */
export const NormalizedUrlSchema = z
  .string()
  .trim()
  .max(MAX_URL_LENGTH, `URL must be ${MAX_URL_LENGTH} characters or less`)
  .transform((value, ctx) => {
    // 1. Try to validate as-is first (optimization for clean inputs)
    // BUT skip this if we detect a potential "glued" URL (protocol appearing in the middle)
    const hasGluedProtocol = /(?:https?:\/\/|www\.)/.test(value.slice(1));

    if (!hasGluedProtocol) {
      try {
        if (isValidUrl(value)) {
          return normalizeUrl(value);
        }
      } catch {
        // Ignore error, proceed to extraction
      }
    }

    // 2. Try to extract a URL from the text
    const extracted = extractFirstUrl(value);

    // If we extracted something different, or if we just want to try normalizing the extraction
    if (extracted) {
      try {
        return normalizeUrl(extracted);
      } catch (error) {
        // Fall through to error
      }
    }

    // 3. Fallback: If original input was meant to be the URL but failed, or extraction failed
    // We try normalizeUrl one last time on the original input to generate the correct error message
    // unless we definitely found nothing.
    try {
      return normalizeUrl(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          error instanceof Error
            ? error.message
            : "Please enter a valid URL.",
      });
      return z.NEVER;
    }
  });
