# Summary Cache Fix Verification

## Issue
Summary caching was not working consistently because URLs were not normalized before being used as cache keys. This caused cache misses even when the same article was being summarized.

## Root Cause
- Frontend: Uses `extractArticleUrl()` to normalize URLs before sending to API
- Backend: Was using raw `url` parameter directly in cache key without normalization
- Result: Inconsistent cache keys leading to cache misses

## Fix
1. Added `extractArticleUrl` import to `/app/api/summary/route.ts`
2. Normalize URL before building cache key: `const normalizedUrl = url ? extractArticleUrl(url) : null`
3. Use normalized URL in cache key: `summary:${source}:${language}:${normalizedUrl}`

## Cache Key Format
```
summary:${source}:${language}:${normalizedUrl}
```

Example cache keys:
- `summary:smry-fast:en:https://example.com/article`
- `summary:smry-slow:en:https://example.com/article`
- `summary:smry-fast:es:https://example.com/article`

## Verification Steps

### 1. Cache Hit for Same URL, Source, and Language
**Test**: Request summary twice for the same article with same source and language
- First request: Should generate new summary (cache miss)
- Second request: Should return cached summary (cache hit with `[CACHED]` prefix)

**Expected Behavior**:
- First request: `Cache miss - will generate new summary` in logs
- Second request: `Cache hit - returning cached summary` in logs
- Second response includes `X-Cache-Hit: true` header
- Usage counter increments only once (cached responses don't count)

### 2. Different Cache for Different Sources
**Test**: Request summary for same article but different sources
- Request 1: `smry-fast` (Quick) source
- Request 2: `smry-slow` (Precise) source

**Expected Behavior**:
- Both should generate new summaries (different cache keys)
- Cache keys differ by source: `summary:smry-fast:...` vs `summary:smry-slow:...`

### 3. Different Cache for Different Languages
**Test**: Request summary for same article but different languages
- Request 1: English (`en`)
- Request 2: Spanish (`es`)

**Expected Behavior**:
- Both should generate new summaries (different cache keys)
- Cache keys differ by language: `summary:...:en:...` vs `summary:...:es:...`

### 4. URL Normalization
**Test**: Request summary with different URL formats
- Request 1: `https://example.com/article?source=smry-fast&sidebar=true`
- Request 2: `https://example.com/article/`
- Request 3: `https://example.com/article`

**Expected Behavior**:
- All normalize to: `https://example.com/article`
- All should hit the same cache (after first request)
- App-specific params (`source`, `sidebar`) are stripped

### 5. Usage Counter with Cache
**Test**: Check that cached responses don't increment usage counter
- Request 1: Generate summary (increment counter)
- Request 2: Cached response (don't increment counter)
- Request 3: Different source (increment counter)

**Expected Behavior**:
- Usage counter increments only for cache misses
- Frontend detects `[CACHED]` prefix and skips increment

## Manual Testing
1. Set up Redis with proper credentials
2. Start the development server: `pnpm dev`
3. Open browser and navigate to an article page
4. Open browser DevTools → Network tab
5. Click "Generate" in the Summary sidebar
6. Wait for summary to complete
7. Click "Regenerate" (same source and language)
8. Check response headers for `X-Cache-Hit: true`
9. Change source (e.g., Quick → Precise) and regenerate
10. Should generate new summary (different cache key)
11. Change language and regenerate
12. Should generate new summary (different cache key)

## Implementation Details

### Before Fix
```typescript
// API route was using raw URL
const cacheKey = url
  ? `summary:${source}:${language}:${url}`
  : `summary:${source}:${language}:${Buffer.from(content.substring(0, 500)).toString('base64').substring(0, 50)}`;
```

### After Fix
```typescript
// API route now normalizes URL first
const normalizedUrl = url ? extractArticleUrl(url) : null;

const cacheKey = normalizedUrl
  ? `summary:${source}:${language}:${normalizedUrl}`
  : `summary:${source}:${language}:${Buffer.from(content.substring(0, 500)).toString('base64').substring(0, 50)}`;
```

## Benefits
1. **Consistent Cache Keys**: URLs are normalized consistently between frontend and backend
2. **Higher Cache Hit Rate**: Same articles hit cache regardless of URL formatting
3. **Proper Multi-dimensional Caching**: Different sources and languages maintain separate caches
4. **Better Resource Usage**: Fewer LLM API calls due to improved cache hits
5. **Accurate Usage Tracking**: Cache hits don't count against rate limits

## Related Files
- `/app/api/summary/route.ts` - Backend API with cache logic
- `/components/features/summary-form.tsx` - Frontend component that calls API
- `/lib/validation/url.ts` - URL normalization utilities
