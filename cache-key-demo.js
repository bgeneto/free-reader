#!/usr/bin/env node

/**
 * Cache Key Demonstration
 * 
 * This script demonstrates how cache keys are generated for the summary API
 * with the fix applied. It shows how different combinations of URL, source,
 * and language produce different cache keys.
 */

// Simulate the extractArticleUrl function
function extractArticleUrl(inputUrl) {
  try {
    const url = new URL(inputUrl);
    
    // Remove app-specific parameters
    const APP_QUERY_PARAMS = ['source', 'view', 'sidebar'];
    APP_QUERY_PARAMS.forEach(param => url.searchParams.delete(param));
    
    // Normalize trailing slashes in pathname (except for root path "/")
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    
    return url.toString();
  } catch {
    return inputUrl;
  }
}

// Generate cache key (matching API logic)
function generateCacheKey(url, source, language) {
  const normalizedUrl = url ? extractArticleUrl(url) : null;
  
  if (normalizedUrl) {
    return `summary:${source}:${language}:${normalizedUrl}`;
  } else {
    // Fallback for content-based caching (not used in this demo)
    return `summary:${source}:${language}:content-hash`;
  }
}

console.log('='.repeat(80));
console.log('Summary Cache Key Demonstration');
console.log('='.repeat(80));
console.log();

// Test Case 1: Same URL, Source, Language -> Same Cache Key
console.log('Test 1: Same URL, Source, Language (Should produce same cache key)');
console.log('-'.repeat(80));
const url1a = 'https://example.com/article?source=smry-fast&sidebar=true';
const url1b = 'https://example.com/article/';
const url1c = 'https://example.com/article';

console.log('Input URLs:');
console.log(`  - ${url1a}`);
console.log(`  - ${url1b}`);
console.log(`  - ${url1c}`);
console.log();

const key1a = generateCacheKey(url1a, 'smry-fast', 'en');
const key1b = generateCacheKey(url1b, 'smry-fast', 'en');
const key1c = generateCacheKey(url1c, 'smry-fast', 'en');

console.log('Generated Cache Keys:');
console.log(`  - ${key1a}`);
console.log(`  - ${key1b}`);
console.log(`  - ${key1c}`);
console.log();
console.log(`✓ All normalize to same key: ${key1a === key1b && key1b === key1c ? 'YES' : 'NO'}`);
console.log();

// Test Case 2: Different Sources -> Different Cache Keys
console.log('Test 2: Different Sources (Should produce different cache keys)');
console.log('-'.repeat(80));
const url2 = 'https://example.com/article';

const keyFast = generateCacheKey(url2, 'smry-fast', 'en');
const keySlow = generateCacheKey(url2, 'smry-slow', 'en');
const keyWayback = generateCacheKey(url2, 'wayback', 'en');
const keyJina = generateCacheKey(url2, 'jina.ai', 'en');

console.log('Source: Quick (smry-fast)');
console.log(`  Cache Key: ${keyFast}`);
console.log();
console.log('Source: Precise (smry-slow)');
console.log(`  Cache Key: ${keySlow}`);
console.log();
console.log('Source: Wayback');
console.log(`  Cache Key: ${keyWayback}`);
console.log();
console.log('Source: Jina.ai');
console.log(`  Cache Key: ${keyJina}`);
console.log();
console.log(`✓ All keys are unique: ${new Set([keyFast, keySlow, keyWayback, keyJina]).size === 4 ? 'YES' : 'NO'}`);
console.log();

// Test Case 3: Different Languages -> Different Cache Keys
console.log('Test 3: Different Languages (Should produce different cache keys)');
console.log('-'.repeat(80));
const url3 = 'https://example.com/article';

const keyEn = generateCacheKey(url3, 'smry-fast', 'en');
const keyEs = generateCacheKey(url3, 'smry-fast', 'es');
const keyFr = generateCacheKey(url3, 'smry-fast', 'fr');
const keyDe = generateCacheKey(url3, 'smry-fast', 'de');

console.log('Language: English (en)');
console.log(`  Cache Key: ${keyEn}`);
console.log();
console.log('Language: Spanish (es)');
console.log(`  Cache Key: ${keyEs}`);
console.log();
console.log('Language: French (fr)');
console.log(`  Cache Key: ${keyFr}`);
console.log();
console.log('Language: German (de)');
console.log(`  Cache Key: ${keyDe}`);
console.log();
console.log(`✓ All keys are unique: ${new Set([keyEn, keyEs, keyFr, keyDe]).size === 4 ? 'YES' : 'NO'}`);
console.log();

// Test Case 4: Complex URL with Query Parameters
console.log('Test 4: URL with Query Parameters (Should preserve non-app params)');
console.log('-'.repeat(80));
const url4 = 'https://example.com/article?id=123&page=2&source=smry-fast&sidebar=true';

console.log('Input URL:');
console.log(`  ${url4}`);
console.log();

const normalized4 = extractArticleUrl(url4);
console.log('Normalized URL (app params stripped):');
console.log(`  ${normalized4}`);
console.log();

const key4 = generateCacheKey(url4, 'smry-fast', 'en');
console.log('Cache Key:');
console.log(`  ${key4}`);
console.log();
console.log(`✓ App params (source, sidebar) removed: ${!normalized4.includes('source=') && !normalized4.includes('sidebar=') ? 'YES' : 'NO'}`);
console.log(`✓ Original params (id, page) preserved: ${normalized4.includes('id=123') && normalized4.includes('page=2') ? 'YES' : 'NO'}`);
console.log();

// Summary
console.log('='.repeat(80));
console.log('Summary');
console.log('='.repeat(80));
console.log('✓ URLs are normalized consistently before cache key generation');
console.log('✓ App-specific query parameters (source, view, sidebar) are removed');
console.log('✓ Trailing slashes are normalized');
console.log('✓ Cache keys include: source, language, and normalized URL');
console.log('✓ Different sources/languages create separate cache entries');
console.log('='.repeat(80));
