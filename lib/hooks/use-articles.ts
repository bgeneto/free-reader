"use client";

import { useQueries, useQuery, UseQueryResult } from "@tanstack/react-query";
import { articleAPI } from "@/lib/api/client";
import { ArticleResponse, Source } from "@/types/api";
import { fetchJinaArticle } from "@/lib/api/jina";

const SERVER_SOURCES = ["smry-fast", "smry-slow", "wayback"] as const satisfies readonly Source[];

/**
 * Custom hook to fetch Jina article (client-side)
 * IMPORTANT: Jina is NOT fetched automatically - only when explicitly triggered
 * 
 * Flow:
 * 1. Check cache via GET /api/jina
 * 2. If cache miss or too short, fetch from Jina.ai client-side
 * 3. Update cache via POST /api/jina
 */
function useJinaArticle(
  url: string,
  enabled: boolean = false
): UseQueryResult<ArticleResponse, Error> & { triggerFetch: () => void } {
  const query = useQuery({
    queryKey: ["article", "jina.ai", url],
    queryFn: async () => {
      // Step 1: Check cache
      try {
        const cacheResponse = await fetch(
          `/api/jina?${new URLSearchParams({ url }).toString()}`
        );

        if (cacheResponse.ok) {
          const cachedData = await cacheResponse.json();
          return cachedData as ArticleResponse;
        }
      } catch (error) {
        // Cache check failed, continue to fetch from Jina
        console.log("Jina cache check failed, fetching fresh:", error);
      }

      // Step 2: Fetch from Jina.ai client-side with premium API
      // Get API key from environment (exposed via NEXT_PUBLIC_ prefix)
      const apiKey = process.env.NEXT_PUBLIC_JINA_API_KEY;
      const result = await fetchJinaArticle(url, apiKey);

      if ("error" in result) {
        throw new Error(result.error.message);
      }

      // Step 3: Update cache
      const articleResponse: ArticleResponse = {
        source: "jina.ai",
        cacheURL: `https://r.jina.ai/${url}`,
        article: {
          ...result.article,
          byline: "",
          dir: "ltr", // Will be detected properly when cached via API
          lang: "",
        },
        status: "success",
      };

      // Update cache in background (don't await)
      fetch("/api/jina", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          article: result.article,
        }),
      }).catch((error) => {
        console.warn("Failed to update Jina cache:", error);
      });

      return articleResponse;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
    // IMPORTANT: Jina is disabled by default, only fetches when explicitly enabled
    enabled: !!url && enabled,
  });

  return {
    ...query,
    triggerFetch: () => query.refetch(),
  };
}

/**
 * Custom hook to fetch articles from all sources
 * Uses TanStack Query for caching and state management
 * 
 * IMPORTANT: Jina is NOT fetched automatically - it must be triggered separately
 * Quick, Precise, and Wayback are fetched in parallel automatically
 */
export function useArticles(url: string) {
  // Fetch server-side sources (smry-fast, smry-slow, wayback) in parallel
  const serverQueries = useQueries({
    queries: SERVER_SOURCES.map((source) => ({
      queryKey: ["article", source, url],
      queryFn: () => articleAPI.getArticle(url, source),
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: 1,
      enabled: !!url, // Only fetch if URL is provided
    })),
  });

  // Jina is NOT fetched automatically - starts disabled
  const jinaQuery = useJinaArticle(url, false);

  // Map queries to a more convenient structure
  const results: Record<Source, UseQueryResult<ArticleResponse, Error>> = {
    "smry-fast": serverQueries[0] as UseQueryResult<ArticleResponse, Error>,
    "smry-slow": serverQueries[1] as UseQueryResult<ArticleResponse, Error>,
    wayback: serverQueries[2] as UseQueryResult<ArticleResponse, Error>,
    "jina.ai": jinaQuery,
  };

  // Compute aggregate states - Jina is excluded from "all loading" calculation
  const serverQueriesOnly = serverQueries;
  const isLoading = serverQueriesOnly.some((q) => q.isLoading);
  const isError = serverQueriesOnly.every((q) => q.isError);
  const isSuccess = serverQueriesOnly.some((q) => q.isSuccess);

  return {
    results,
    isLoading,
    isError,
    isSuccess,
    // Expose Jina trigger for on-demand fetching
    triggerJinaFetch: jinaQuery.triggerFetch,
  };
}

/**
 * Hook to fetch a single article from a specific source
 */
export function useArticle(url: string, source: Source) {
  const { results } = useArticles(url);
  return results[source];
}
