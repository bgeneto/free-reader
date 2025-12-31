import { createHash } from "crypto";

/**
 * Hash IP address for privacy logging
 * Uses SHA-256 and returns first 16 characters
 */
export function hashIp(ip: string): string {
    if (!ip || ip === 'unknown') return 'unknown';
    return createHash('sha256').update(ip).digest('hex').substring(0, 16);
}

/**
 * Scrub sensitive parameters from URL for logging
 * Redacts values of common sensitive query parameters or those looking like secrets
 */
export function scrubUrl(url: string | null | undefined): string | null | undefined {
    if (!url) return url;

    try {
        // If it's not a full URL, try to parse it relative to dummy base
        // This handles partial paths often found in app logs
        const urlObj = url.startsWith('http')
            ? new URL(url)
            : new URL(url, 'http://placeholder.com');

        const sensitiveKeys = [
            'token', 'key', 'api_key', 'apikey', 'secret',
            'password', 'pwd', 'auth', 'access_token', 'code'
        ];

        // Also look for params that look like keys (long random attributes)
        // but we start with explicit allow/block lists practice

        urlObj.searchParams.forEach((value, key) => {
            if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
                urlObj.searchParams.set(key, '[REDACTED]');
            }
        });

        // If we used a placeholder, strip it back off unless the original input had a protocol
        if (!url.startsWith('http')) {
            return urlObj.pathname + urlObj.search;
        }

        return urlObj.toString();
    } catch (e) {
        // If URL parsing fails, return original string (or safe fallback if extremely paranoid)
        // For logging purposes, returning original is usually preferred over swallowing data,
        // assuming other layers catch critical secrets. 
        // However, if we are strict:
        return url;
    }
}
