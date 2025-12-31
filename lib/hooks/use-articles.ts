"use client";

import { useQueries, useQuery, UseQueryResult } from "@tanstack/react-query";
import { articleAPI } from "@/lib/api/client";
import { ArticleResponse, Source } from "@/types/api";
import { fetchJinaArticle } from "@/lib/api/jina";

const SERVER_SOURCES = ["fetch-fast", "fetch-slow", "wayback"] as const satisfies readonly Source[];

/**
 * Custom hook to fetch Jina article via server-side endpoint
 * IMPORTANT: Jina is NOT fetched automatically - only when explicitly triggered
 * 
 * The API key is kept secure on the server (not exposed to browser)
 */
function useJinaArticle(
  url: string,
  enabled: boolean = false
): UseQueryResult<ArticleResponse, Error> & { triggerFetch: () => void } {
  const query = useQuery({
    queryKey: ["article", "jina.ai", url],
    queryFn: async () => {
      // Fetch from server-side endpoint (keeps API key secure)
      const result = await fetchJinaArticle(url);

      if ("error" in result) {
        throw new Error(result.error.message);
      }

      return result.article;
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
  // Fetch server-side sources (fetch-fast, fetch-slow, wayback) in parallel
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
    "fetch-fast": serverQueries[0] as UseQueryResult<ArticleResponse, Error>,
    "fetch-slow": serverQueries[1] as UseQueryResult<ArticleResponse, Error>,
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
