import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// Supported locales and their OG titles
const translations: Record<string, { title: string; tagline: string }> = {
    en: {
        title: 'Read Any Article, Anywhere',
        tagline: 'Read without limits',
    },
    pt: {
        title: 'Leia Qualquer Artigo, Em Qualquer Lugar',
        tagline: 'Leia sem limites',
    },
    de: {
        title: 'Lesen Sie jeden Artikel, überall',
        tagline: 'Lesen ohne Grenzen',
    },
    es: {
        title: 'Lee Cualquier Artículo, En Cualquier Lugar',
        tagline: 'Lee sin límites',
    },
    nl: {
        title: 'Lees Elk Artikel, Overal',
        tagline: 'Lees zonder grenzen',
    },
    zh: {
        title: '阅读任何文章，随时随地',
        tagline: '无限阅读',
    },
};

// Color palette from globals.css - Newspaper Light Theme
const colors = {
    background: '#F5EFE6',      // aged parchment
    foreground: '#2C2825',      // warm charcoal
    primary: '#1A1815',         // deep warm black (header)
    primaryForeground: '#FAF8F5',
    accent: '#8B4513',          // saddle brown
    muted: '#6B665E',           // warm gray
    border: '#D9CFC0',          // parchment border
};

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get('locale') || 'en';

    const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'SMRY';
    const siteUrl = process.env.NEXT_PUBLIC_URL || 'https://smry.ai';
    const domain = siteUrl.replace(/^https?:\/\//, '');

    const t = translations[locale] || translations.en;

    return new ImageResponse(
        (
            <div
                style={{
                    height: '100%',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: colors.background,
                    fontFamily: 'Georgia, serif',
                }}
            >
                {/* Header bar - deep warm black */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        backgroundColor: colors.primary,
                        padding: '20px 50px',
                        color: colors.primaryForeground,
                    }}
                >
                    <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '0.05em' }}>
                        {siteName}
                    </span>
                    <span style={{ fontSize: 16, letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.9 }}>
                        NO PAYWALLS • AI SUMMARIES • FREE FOREVER
                    </span>
                </div>

                {/* Main content area - parchment background */}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'flex-start',
                        flex: 1,
                        padding: '60px 80px',
                    }}
                >
                    <h1
                        style={{
                            fontSize: 72,
                            fontWeight: 400,
                            color: colors.foreground,
                            margin: 0,
                            lineHeight: 1.1,
                            maxWidth: '900px',
                        }}
                    >
                        {t.title}
                    </h1>
                    {/* Accent underline - saddle brown */}
                    <div
                        style={{
                            display: 'flex',
                            width: 80,
                            height: 4,
                            backgroundColor: colors.accent,
                            marginTop: 30,
                        }}
                    />
                </div>

                {/* Footer bar */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '20px 50px',
                        borderTop: `1px solid ${colors.border}`,
                        color: colors.muted,
                        fontSize: 18,
                    }}
                >
                    <span>{t.tagline}</span>
                    <span style={{ color: colors.accent, fontWeight: 500 }}>{domain}</span>
                </div>
            </div>
        ),
        {
            width: 1200,
            height: 630,
        }
    );
}
