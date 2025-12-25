import { z } from "zod";
import isURL, { IsURLOptions } from "validator/lib/isURL";

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
 *  Input:  "https://example.com/article?source=smry-fast&view=markdown&sidebar=true"
 *  Output: "https://example.com/article"
 * 
 *  Input:  "https://example.com/article/?id=123&source=smry-fast"
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
 * Zod schema that normalizes and validates URLs consistently on both
 * the client and server.
 */
export const NormalizedUrlSchema = z
  .string()
  .trim()
  .min(1, "URL is required")
  .transform((value, ctx) => {
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
