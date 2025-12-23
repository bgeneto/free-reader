"use client";

import { ArticleResponse } from "@/types/api";

export interface JinaError {
  message: string;
  status?: number;
}

/**
 * Fetch article from Jina.ai via server-side endpoint
 * This keeps the API key secure (not exposed to browser)
 * 
 * @param url - The URL to fetch
 * @returns Article response or error
 */
export async function fetchJinaArticle(
  url: string
): Promise<{ article: ArticleResponse } | { error: JinaError }> {
  try {
    const response = await fetch("/api/jina/fetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        error: {
          message: data.error || `HTTP error: ${response.status}`,
          status: response.status,
        },
      };
    }

    return { article: data as ArticleResponse };
  } catch (error) {
    return {
      error: {
        message: error instanceof Error ? error.message : "Failed to fetch from Jina.ai",
      },
    };
  }
}
