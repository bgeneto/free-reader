import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { GoogleAnalytics } from '@next/third-parties/google'
import { QueryProvider } from "@/components/shared/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
// CLERK DISABLED - commented out to remove auth dependency
// import { ClerkProvider } from "@clerk/nextjs";
import { getLocale } from 'next-intl/server';

import { siteConfig } from "@/app/config/site";

export const metadata: Metadata = {
  title: `Bypass Paywalls & Read Full Articles Free – No Login | ${siteConfig.name}`,
  description:
    siteConfig.description,
  keywords: ["bypass paywall", "paywall remover", "read paywalled articles", "free paywall bypass", "article summarizer", "remove paywall"],
  openGraph: {
    type: "website",
    title: `Bypass Paywalls & Read Full Articles Free | ${siteConfig.name}`,
    siteName: siteConfig.name,
    url: siteConfig.url,
    description:
      siteConfig.description,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: `${siteConfig.name} - Free Paywall Bypass Tool & Article Summarizer`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `Bypass Paywalls & Read Full Articles Free | ${siteConfig.name}`,
    description:
      "Paste any paywalled article link and get the full text plus an AI summary. Free, no account, no extension.",
    images: [siteConfig.ogImage],
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    // CLERK DISABLED - ClerkProvider removed
    // <ClerkProvider>
    <html lang={locale} className="bg-background dark:bg-background" suppressHydrationWarning>
      <body
        className={`${GeistSans.className} bg-background text-foreground`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <GoogleAnalytics gaId="G-RFC55FX414" />
          <NuqsAdapter>
            <QueryProvider>
              {children}
            </QueryProvider>
          </NuqsAdapter>
        </ThemeProvider>
      </body>
    </html>
    // </ClerkProvider>
  );
}

