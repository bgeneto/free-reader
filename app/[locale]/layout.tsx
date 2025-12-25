import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { Metadata } from 'next';
import { siteConfig } from '@/app/config/site';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;

  // Dynamic import of messages for the locale
  const messages = (await import(`@/messages/${locale}.json`)).default;
  const metadata = messages.metadata || {};

  return {
    title: metadata.title?.replace('Smry', siteConfig.name) || siteConfig.name,
    description: metadata.description || siteConfig.description,
    openGraph: {
      type: 'website',
      title: metadata.ogTitle?.replace('Smry', siteConfig.name) || siteConfig.name,
      siteName: siteConfig.name,
      url: `${siteConfig.url}/${locale}`,
      description: metadata.ogDescription || siteConfig.description,
      images: [
        {
          url: `${siteConfig.url}/api/og?locale=${locale}`,
          width: 1200,
          height: 630,
          alt: metadata.ogAlt?.replace('Smry', siteConfig.name) || siteConfig.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: metadata.ogTitle?.replace('Smry', siteConfig.name) || siteConfig.name,
      description: metadata.twitterDescription || siteConfig.description,
      images: [`${siteConfig.url}/api/og?locale=${locale}`],
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
