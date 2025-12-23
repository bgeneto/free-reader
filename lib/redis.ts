import { Redis } from "@upstash/redis";

// Lazy initialization to avoid build-time warnings when env vars aren't available
let _redis: Redis | null = null;

export const redis = new Proxy({} as Redis, {
  get(_, prop) {
    if (!_redis) {
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;

      if (!url || !token) {
        // Return a mock that throws on any method call
        throw new Error(
          "Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
        );
      }

      _redis = new Redis({ url, token });
    }
    return (_redis as unknown as Record<string, unknown>)[prop as string];
  },
});
