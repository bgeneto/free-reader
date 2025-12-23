/**
 * Ad Content Sanitizer
 * 
 * Removes isolated ad-related keywords from article content.
 * Only removes when the keyword appears as the sole content of an element or line.
 * Does NOT remove keywords that appear mid-sentence.
 */

// Expandable list of ad keywords (case-insensitive)
// Add new keywords here to extend the sanitizer
export const AD_KEYWORDS = [
    // Portuguese
    'publicidade',
    'patrocinado',
    'anúncio',
    'propaganda',
    // English
    'advertisement',
    'sponsored',
    'sponsored content',
    'ads',
    'ad',
    'advertising',
    // Spanish
    'publicidad',
    'patrocinado',
    'anuncio',
    // German
    'werbung',
    'anzeige',
    'gesponsert',
    // French
    'publicité',
    'sponsorisé',
    'annonce',
    // Italian
    'pubblicità',
    'sponsorizzato',
    // Dutch
    'advertentie',
    'gesponsord',
    // Additional keywords
    'skip advertisement',
    'skip ad',
];

// Exact HTML patterns to remove verbatim (case-insensitive)
// These are removed as literal strings before regex processing
export const AD_HTML_PATTERNS = [
    '<p><a href="#after-top">SKIP ADVERTISEMENT</a></p>',
    '<p><span>Continua após publicidade</span></p>',
];

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex pattern that matches isolated ad keywords in HTML elements.
 * Matches: <tag>keyword</tag>, <tag> keyword </tag>, <tag>\nkeyword\n</tag>
 * Does NOT match: <tag>Some text with keyword in it</tag>
 */
function buildHtmlPattern(): RegExp {
    const keywordsPattern = AD_KEYWORDS.map(escapeRegex).join('|');
    // Match opening tag, optional whitespace, keyword only, optional whitespace, closing tag
    // Supports: p, div, span, aside, section, figure, figcaption
    const pattern = `<(p|div|span|aside|section|figure|figcaption|li|small|strong|em|b|i)[^>]*>\\s*(${keywordsPattern})\\s*<\\/\\1>`;
    return new RegExp(pattern, 'gi');
}

/**
 * Build a regex pattern that matches isolated ad keywords as entire lines in text.
 * Matches lines that contain ONLY the keyword (with optional surrounding whitespace).
 */
function buildTextLinePattern(): RegExp {
    const keywordsPattern = AD_KEYWORDS.map(escapeRegex).join('|');
    // Match entire line that is just a keyword
    const pattern = `^\\s*(${keywordsPattern})\\s*$`;
    return new RegExp(pattern, 'gim');
}

/**
 * Build a regex pattern that matches nested elements with only ad keywords.
 * E.g., <div><p>Publicidade</p></div>
 */
function buildNestedHtmlPattern(): RegExp {
    const keywordsPattern = AD_KEYWORDS.map(escapeRegex).join('|');
    // Match wrapper element containing only another element with just the keyword
    const pattern = `<(div|aside|section|figure)[^>]*>\\s*<(p|span|small|strong|em|b|i)[^>]*>\\s*(${keywordsPattern})\\s*<\\/\\2>\\s*<\\/\\1>`;
    return new RegExp(pattern, 'gi');
}

/**
 * Sanitize HTML content by removing isolated ad elements.
 * 
 * @param html - The HTML content to sanitize
 * @returns Sanitized HTML with ad elements removed
 * 
 * @example
 * sanitizeHtml('<p>Publicidade</p>') // returns ''
 * sanitizeHtml('<p>Some text about publicidade here</p>') // returns unchanged
 */
export function sanitizeHtml(html: string): string {
    if (!html) return html;

    let result = html;

    // First pass: remove exact HTML patterns (case-insensitive)
    for (const pattern of AD_HTML_PATTERNS) {
        const regex = new RegExp(escapeRegex(pattern), 'gi');
        result = result.replace(regex, '');
    }

    // Second pass: remove nested structures like <div><p>Publicidade</p></div>
    const nestedPattern = buildNestedHtmlPattern();
    result = result.replace(nestedPattern, '');

    // Third pass: remove simple elements like <p>Publicidade</p>
    const simplePattern = buildHtmlPattern();
    result = result.replace(simplePattern, '');

    // Clean up any resulting empty wrapper elements
    // e.g., <div>\s*</div> left behind after removing content
    result = result.replace(/<(div|aside|section|figure)[^>]*>\s*<\/\1>/gi, '');

    return result;
}

/**
 * Sanitize plain text by removing isolated ad lines.
 * 
 * @param text - The plain text content to sanitize
 * @returns Sanitized text with ad lines removed
 * 
 * @example
 * sanitizeText('Content\nPublicidade\nMore content') // returns 'Content\nMore content'
 * sanitizeText('Content about publicidade here') // returns unchanged
 */
export function sanitizeText(text: string): string {
    if (!text) return text;

    const linePattern = buildTextLinePattern();

    // Replace isolated ad lines with empty string, then clean up extra blank lines
    let result = text.replace(linePattern, '');

    // Clean up multiple consecutive newlines (reduce to max 2)
    result = result.replace(/\n{3,}/g, '\n\n');

    // Trim leading/trailing whitespace
    result = result.trim();

    return result;
}

/**
 * Sanitize both HTML and text content of an article.
 * Convenience function for processing article objects.
 */
export function sanitizeArticle<T extends { content?: string; textContent?: string }>(
    article: T
): T {
    return {
        ...article,
        content: article.content ? sanitizeHtml(article.content) : article.content,
        textContent: article.textContent ? sanitizeText(article.textContent) : article.textContent,
    };
}
