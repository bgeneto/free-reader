import { describe, expect, it } from "bun:test";
import { normalizeUrl, isValidUrl, extractArticleUrl } from "./url";

describe("normalizeUrl", () => {
  it("normalizes full https URL", () => {
    const result = normalizeUrl("https://www.nytimes.com/2025/12/08/us/politics/example.html");
    expect(result).toBe("https://www.nytimes.com/2025/12/08/us/politics/example.html");
  });

  it("adds https to bare domain", () => {
    const result = normalizeUrl("nyt.com");
    expect(result).toBe("https://nyt.com");
  });

  it("decodes percent-encoded URLs", () => {
    const encoded = "https%3A%2F%2Fwww.nytimes.com%2F2025%2F12%2F08%2Fus%2Fpolitics%2Fexample.html";
    const result = normalizeUrl(encoded);
    expect(result).toBe("https://www.nytimes.com/2025/12/08/us/politics/example.html");
  });

  it("repairs single-slash protocol", () => {
    const result = normalizeUrl("https:/www.nytimes.com/path");
    expect(result).toBe("https://www.nytimes.com/path");
  });

  it("handles URLs with query params", () => {
    const result = normalizeUrl("https://example.com/article?search=test&page=2");
    expect(result).toBe("https://example.com/article?search=test&page=2");
  });

  it("handles encoded URL with query params", () => {
    const encoded = "https%3A%2F%2Fexample.com%2Farticle%3Fsearch%3Dtest%26page%3D2";
    const result = normalizeUrl(encoded);
    expect(result).toBe("https://example.com/article?search=test&page=2");
  });

  it("throws on empty input", () => {
    expect(() => normalizeUrl("")).toThrow("Please enter a URL.");
  });

  it("throws on invalid URL", () => {
    expect(() => normalizeUrl("not a url")).toThrow("Please enter a valid URL");
  });
});

describe("isValidUrl", () => {
  it("returns true for valid URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("example.com")).toBe(true);
  });

  it("returns false for invalid URLs", () => {
    expect(isValidUrl("")).toBe(false);
    expect(isValidUrl("not a url")).toBe(false);
  });
});

describe("extractArticleUrl", () => {
  it("removes app-specific query params (source, view, sidebar)", () => {
    const url = "https://example.com/article?source=smry-fast&view=markdown&sidebar=true";
    expect(extractArticleUrl(url)).toBe("https://example.com/article");
  });

  it("preserves article-specific query params while removing app params", () => {
    const url = "https://example.com/article?id=123&source=smry-fast&view=markdown";
    expect(extractArticleUrl(url)).toBe("https://example.com/article?id=123");
  });

  it("handles URLs without query params", () => {
    const url = "https://example.com/article";
    expect(extractArticleUrl(url)).toBe("https://example.com/article");
  });

  it("handles URLs with only article-specific params", () => {
    const url = "https://example.com/article?page=2&search=test";
    expect(extractArticleUrl(url)).toBe("https://example.com/article?page=2&search=test");
  });

  it("normalizes URL while extracting", () => {
    const url = "example.com/article?source=smry-fast";
    expect(extractArticleUrl(url)).toBe("https://example.com/article");
  });

  it("strips trailing slashes from URL path", () => {
    const url = "https://example.com/article/";
    expect(extractArticleUrl(url)).toBe("https://example.com/article");
  });

  it("handles trailing slash with query params", () => {
    const url = "https://example.com/article/?id=123&source=smry-fast";
    expect(extractArticleUrl(url)).toBe("https://example.com/article?id=123");
  });

  it("preserves root path", () => {
    const url = "https://example.com/";
    expect(extractArticleUrl(url)).toBe("https://example.com/");
  });
});
