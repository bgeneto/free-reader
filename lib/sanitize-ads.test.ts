import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeText, sanitizeArticle, AD_KEYWORDS } from './sanitize-ads';

describe('sanitize-ads', () => {
    describe('AD_KEYWORDS', () => {
        it('should include common ad keywords', () => {
            expect(AD_KEYWORDS).toContain('publicidade');
            expect(AD_KEYWORDS).toContain('advertisement');
            expect(AD_KEYWORDS).toContain('werbung');
        });
    });

    describe('sanitizeHtml', () => {
        it('should remove isolated ad keyword in paragraph', () => {
            expect(sanitizeHtml('<p>Publicidade</p>')).toBe('');
            expect(sanitizeHtml('<p>PUBLICIDADE</p>')).toBe('');
            expect(sanitizeHtml('<p> Publicidade </p>')).toBe('');
        });

        it('should remove isolated ad keyword in div', () => {
            expect(sanitizeHtml('<div>Advertisement</div>')).toBe('');
            expect(sanitizeHtml('<div> Ads </div>')).toBe('');
        });

        it('should remove nested ad elements', () => {
            expect(sanitizeHtml('<div><p>Publicidade</p></div>')).toBe('');
            expect(sanitizeHtml('<aside><span>Sponsored</span></aside>')).toBe('');
        });

        it('should NOT remove ad keywords mid-sentence', () => {
            const html = '<p>The publicidade industry is growing.</p>';
            expect(sanitizeHtml(html)).toBe(html);
        });

        it('should NOT remove ad keywords mixed with other content', () => {
            const html = '<p>Click here: Publicidade</p>';
            expect(sanitizeHtml(html)).toBe(html);
        });

        it('should remove multiple isolated ad elements', () => {
            const html = '<p>Content</p><p>Publicidade</p><p>More content</p><div>Ads</div>';
            expect(sanitizeHtml(html)).toBe('<p>Content</p><p>More content</p>');
        });

        it('should handle empty input', () => {
            expect(sanitizeHtml('')).toBe('');
            expect(sanitizeHtml(null as any)).toBe(null);
            expect(sanitizeHtml(undefined as any)).toBe(undefined);
        });

        it('should be case-insensitive', () => {
            expect(sanitizeHtml('<p>WERBUNG</p>')).toBe('');
            expect(sanitizeHtml('<p>werbung</p>')).toBe('');
            expect(sanitizeHtml('<p>Werbung</p>')).toBe('');
        });
    });

    describe('sanitizeText', () => {
        it('should remove isolated ad keyword lines', () => {
            expect(sanitizeText('Publicidade')).toBe('');
            expect(sanitizeText('  Publicidade  ')).toBe('');
        });

        it('should remove ad lines from multiline text', () => {
            const text = 'First paragraph.\nPublicidade\nSecond paragraph.';
            expect(sanitizeText(text)).toBe('First paragraph.\nSecond paragraph.');
        });

        it('should NOT remove ad keywords mid-sentence', () => {
            const text = 'The publicidade industry is growing.';
            expect(sanitizeText(text)).toBe(text);
        });

        it('should handle multiple ad lines', () => {
            const text = 'Content\nPublicidade\nMore content\nAds\nFinal content';
            expect(sanitizeText(text)).toBe('Content\nMore content\nFinal content');
        });

        it('should clean up excessive newlines', () => {
            const text = 'Content\n\n\n\nPublicidade\n\n\n\nMore content';
            const result = sanitizeText(text);
            expect(result).not.toContain('\n\n\n');
        });

        it('should handle empty input', () => {
            expect(sanitizeText('')).toBe('');
            expect(sanitizeText(null as any)).toBe(null);
            expect(sanitizeText(undefined as any)).toBe(undefined);
        });

        it('should be case-insensitive', () => {
            expect(sanitizeText('ADVERTISEMENT')).toBe('');
            expect(sanitizeText('advertisement')).toBe('');
            expect(sanitizeText('Advertisement')).toBe('');
        });
    });

    describe('sanitizeArticle', () => {
        it('should sanitize both content and textContent', () => {
            const article = {
                title: 'Test Article',
                content: '<p>Content</p><p>Publicidade</p>',
                textContent: 'Content\nPublicidade',
            };

            const result = sanitizeArticle(article);

            expect(result.title).toBe('Test Article');
            expect(result.content).toBe('<p>Content</p>');
            expect(result.textContent).toBe('Content');
        });

        it('should handle missing content fields', () => {
            const article: { content?: string; textContent?: string } = {};
            const result = sanitizeArticle(article);
            expect(result.content).toBeUndefined();
            expect(result.textContent).toBeUndefined();
        });
    });
});
