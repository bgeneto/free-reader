# Summary Cache and Rate Limiting Implementation

## Overview

The summary feature implements a dual-layer caching and rate limiting system to ensure that cached summaries do not count against users' rate limits.

## Server-Side Implementation

### Location
`app/api/summary/route.ts`

### Flow

1. **Cache Check (FIRST)** - Lines 124-150
   ```typescript
   // Check cache FIRST (before rate limiting)
   cached = await redis.get<string>(cacheKey);
   
   if (cached && typeof cached === "string") {
     // Return immediately with [CACHED] prefix
     return new Response(`[CACHED]${cached}`, {
       headers: {
         "Content-Type": "text/plain; charset=utf-8",
         "X-Cache-Hit": "true"
       },
     });
   }
   ```
   - Cache key format: `summary:${source}:${language}:${url}`
   - On cache hit: **Early return** with `[CACHED]` prefix
   - Never reaches rate limiting code

2. **Rate Limiting (ONLY on cache miss)** - Lines 162-206
   ```typescript
   // Rate limiting - skip for premium users or when disabled for development
   // Only runs on cache miss to avoid counting cached responses against limit
   if (!isPremium && !disableRateLimit) {
     const { success: dailySuccess } = await dailyRatelimit.limit(
       `ratelimit_daily_${clientIp}`
     );
     // ... check limits and return 429 if exceeded
   }
   ```
   - Only executed if cache miss occurred
   - Uses Upstash Redis sliding window rate limiter
   - Default limits: 20 per day, 6 per minute

3. **Summary Generation** - Lines 233-260
   - Only reached on cache miss after passing rate limits
   - Streams response using AI SDK
   - Caches result in `onFinish` callback

## Client-Side Implementation

### Location
`components/features/summary-form.tsx`

### Flow

1. **Detect Cached Response** - Lines 154-165
   ```typescript
   const processedCompletion = useMemo(() => {
     if (!completion) return null;
     
     // Check if response is from cache (prefixed with [CACHED])
     if (completion.startsWith('[CACHED]')) {
       lastResponseWasCachedRef.current = true;
       return completion.slice(8); // Remove '[CACHED]' prefix
     }
     
     lastResponseWasCachedRef.current = false;
     return completion;
   }, [completion]);
   ```
   - Detects `[CACHED]` prefix from server
   - Strips prefix for display
   - Sets ref flag for usage tracking

2. **Track Usage (Skip for cached)** - Lines 184-195
   ```typescript
   useEffect(() => {
     if (
       processedCompletion &&
       !isLoading &&
       processedCompletion !== prevCompletionRef.current &&
       !isPremium &&
       !lastResponseWasCachedRef.current // Don't increment for cached responses
     ) {
       incrementUsage();
       prevCompletionRef.current = processedCompletion;
     }
   }, [processedCompletion, isLoading, isPremium, incrementUsage]);
   ```
   - Checks `lastResponseWasCachedRef.current` before incrementing
   - Only increments local storage counter for non-cached responses
   - Local counter used for UI display only

## Cache Key Strategy

Cache keys include:
- **Source**: Different content sources may have different article text
- **Language**: Same article, different language summary
- **URL**: Unique identifier for the article

Example: `summary:smry-fast:en:https://example.com/article`

## Rate Limit Strategy

Two-tier rate limiting:
1. **Daily Limit**: Configurable via `SUMMARY_DAILY_LIMIT` env var (default: 20)
2. **Minute Limit**: Fixed at 6 per minute

Rate limits use:
- Upstash Redis sliding window algorithm
- Client IP address as identifier
- Key format: `ratelimit_daily_${clientIp}` and `ratelimit_minute_${clientIp}`

## Benefits

1. **Server-Side**: Upstash rate limit counters are NOT incremented for cached responses
2. **Client-Side**: Local storage usage counters are NOT incremented for cached responses
3. **Performance**: Cached responses return immediately without AI API calls
4. **User Experience**: Users can access the same summary multiple times without penalty

## Testing

The implementation was verified with:
- Code review and logical flow analysis
- Unit test confirming cache hits don't trigger rate limiting
- Test showed early return path for cached responses works correctly

## Future Improvements

- Consider adding cache TTL (time-to-live) configuration
- Add metrics for cache hit/miss ratio
- Consider warming cache for popular articles
