"use client";

import { marked } from "marked";
import { sanitizeHtml, sanitizeText } from "@/lib/sanitize-ads";

marked.setOptions({
  breaks: true,
  gfm: true,
});

// Jina.ai Premium API Configuration
const JINA_TIMEOUT_MS = 75000; // 75 seconds timeout for cf-browser-rendering

export interface JinaArticle {
  title: string;
  content: string;
  textContent: string;
  length: number;
  siteName: string;
  publishedTime?: string | null;
}

export interface JinaError {
  message: string;
  status?: number;
}

/**
 * Fetch and parse article from Jina.ai Premium API (client-side)
 * Uses cf-browser-rendering engine and readerlm-v2 for best extraction quality
 * 
 * @param url - The URL to fetch
 * @param apiKey - Jina.ai API key (passed from environment)
 * @returns Parsed article or error
 */
export async function fetchJinaArticle(
  url: string,
  apiKey?: string
): Promise<{ article: JinaArticle } | { error: JinaError }> {
  try {
    // If no API key, fall back to public API (limited/no cf-browser-rendering)
    if (!apiKey) {
      return fetchJinaPublicApi(url);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
      const response = await fetch("https://r.jina.ai/", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Engine": "cf-browser-rendering",
          "X-Respond-With": "readerlm-v2",
          "X-Timeout": "20",
          "X-Token-Budget": "150000",
        },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          error: {
            message: `Jina API error: ${response.status}`,
            status: response.status,
          },
        };
      }

      const markdown = await response.text();
      return parseJinaResponse(markdown, url);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return {
          error: {
            message: `Request timed out after ${JINA_TIMEOUT_MS / 1000} seconds`,
            status: 408,
          },
        };
      }

      throw fetchError;
    }
  } catch (error) {
    return {
      error: {
        message: error instanceof Error ? error.message : "Failed to fetch from Jina.ai",
      },
    };
  }
}

/**
 * Fallback to public Jina.ai API (no API key required but limited features)
 */
async function fetchJinaPublicApi(
  url: string
): Promise<{ article: JinaArticle } | { error: JinaError }> {
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
      const response = await fetch(jinaUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          error: {
            message: `HTTP error! status: ${response.status}`,
            status: response.status,
          },
        };
      }

      const markdown = await response.text();
      return parseJinaResponse(markdown, url);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return {
          error: {
            message: `Request timed out after ${JINA_TIMEOUT_MS / 1000} seconds`,
            status: 408,
          },
        };
      }

      throw fetchError;
    }
  } catch (error) {
    return {
      error: {
        message: error instanceof Error ? error.message : "Failed to fetch from Jina.ai",
      },
    };
  }
}

/**
 * Parse Jina.ai markdown response into article structure
 */
function parseJinaResponse(
  markdown: string,
  url: string
): { article: JinaArticle } | { error: JinaError } {
  const lines = markdown.split("\n");

  // Extract title, URL source, and main content from Jina.ai markdown format
  // Format:
  // Title: <title>
  // 
  // URL Source: <url>
  // 
  // Published Time: <time> (optional)
  // 
  // Markdown Content:
  // <content>
  const title = lines[0]?.replace("Title: ", "").trim() || "Untitled";

  // Find the URL Source line
  let urlSourceLine = "";
  let publishedTime = null;
  let contentStartIndex = 4; // Default

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    if (lines[i].startsWith("URL Source:")) {
      urlSourceLine = lines[i].replace("URL Source: ", "").trim();
      // Content typically starts a few lines after URL Source
      contentStartIndex = i + 2;

      // Check if there's a Published Time line
      if (lines[i + 2]?.startsWith("Published Time:")) {
        publishedTime = lines[i + 2].replace("Published Time: ", "").trim();
        contentStartIndex = i + 4;
      }

      // Skip "Markdown Content:" header if present
      if (lines[contentStartIndex]?.includes("Markdown Content:")) {
        contentStartIndex++;
      }

      break;
    }
  }

  const urlSource = urlSourceLine || url;
  const mainContent = lines.slice(contentStartIndex).join("\n").trim();

  if (!mainContent || mainContent.length < 100) {
    return {
      error: {
        message: "Jina.ai returned insufficient content",
      },
    };
  }

  const contentHtml = convertMarkdownToHtml(mainContent);

  const article: JinaArticle = {
    title: title,
    content: sanitizeHtml(contentHtml),
    textContent: sanitizeText(mainContent),
    length: mainContent.length,
    siteName: extractHostname(urlSource),
    publishedTime: publishedTime,
  };

  return { article };
}

/**
 * Extract hostname from URL safely
 */
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function convertMarkdownToHtml(markdown: string): string {
  try {
    const html = marked.parse(markdown);
    return typeof html === "string" ? html : "";
  } catch (error) {
    console.warn("Failed to convert markdown via marked, falling back to plain text.", error);
    return fallbackHtmlFromPlainText(markdown);
  }
}

function fallbackHtmlFromPlainText(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .split(/\n{2,}/)
    .map((chunk) => `<p>${chunk.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
