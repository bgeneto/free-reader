import { describe, expect, it } from "bun:test";
import { normalizeUrl, isValidUrl, extractArticleUrl, extractFirstUrl, NormalizedUrlSchema } from "./url";

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

  it("blocks localhost", () => {
    expect(() => normalizeUrl("http://localhost:3000")).toThrow("Access to private or local networks is restricted");
    expect(() => normalizeUrl("https://localhost")).toThrow("Access to private or local networks is restricted");
  });

  it("blocks private IPv4 addresses", () => {
    expect(() => normalizeUrl("http://127.0.0.1")).toThrow("Access to private or local networks is restricted");
    expect(() => normalizeUrl("http://10.0.0.1")).toThrow("Access to private or local networks is restricted");
    expect(() => normalizeUrl("http://192.168.1.1")).toThrow("Access to private or local networks is restricted");
    expect(() => normalizeUrl("http://172.16.0.0")).toThrow("Access to private or local networks is restricted");
  });

  it("blocks 0.0.0.0", () => {
    expect(() => normalizeUrl("http://0.0.0.0")).toThrow("Access to private or local networks is restricted");
  });

  it("allows public IP addresses", () => {
    expect(normalizeUrl("http://8.8.8.8")).toBe("http://8.8.8.8");
    expect(normalizeUrl("https://1.1.1.1")).toBe("https://1.1.1.1");
  });

  it("allows public domains", () => {
    expect(normalizeUrl("https://google.com")).toBe("https://google.com");
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

describe("extractFirstUrl", () => {
  it("extracts URL from simple text", () => {
    expect(extractFirstUrl("Check this out: https://example.com")).toBe("https://example.com");
  });

  it("extracts URL from HTML href", () => {
    const html = 'Internal Link: <a href="https://www.example.com">Visit Example</a>';
    expect(extractFirstUrl(html)).toBe("https://www.example.com");
  });

  it("handles glued URLs (extracts first)", () => {
    const text = "https://oglobo.globo.com/articlehttps://another.com";
    expect(extractFirstUrl(text)).toBe("https://oglobo.globo.com/article");
  });

  it("strips trailing punctuation", () => {
    expect(extractFirstUrl("Go to https://google.com.")).toBe("https://google.com");
    expect(extractFirstUrl("Is it www.google.com?")).toBe("www.google.com");
    expect(extractFirstUrl("Visit (https://google.com)")).toBe("https://google.com");
  });

  it("handles long query params", () => {
    const url = "https://example.com/path?query=verylongstring&other=param";
    const text = `Some text ${url} matches`;
    expect(extractFirstUrl(text)).toBe(url);
  });
});

describe("NormalizedUrlSchema extraction", () => {
  it("extracts and normalizes URL from mixed text", () => {
    const result = NormalizedUrlSchema.parse("Read this https://example.com now");
    expect(result).toBe("https://example.com");
  });

  it("handles glued URLs via schema", () => {
    const text = "https://example.com/foohttps://bar.com";
    const result = NormalizedUrlSchema.parse(text);
    expect(result).toBe("https://example.com/foo");
  });

  it("enforces max length", () => {
    const longUrl = "https://example.com/" + "a".repeat(1001);
    const result = NormalizedUrlSchema.safeParse(longUrl);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("1000 characters or less");
    }
  });
});
