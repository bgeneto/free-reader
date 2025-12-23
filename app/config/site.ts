export type SiteConfig = {
  name: string;
  description: string;
  url: string;
  ogImage: string;
  links: {
    twitter: string;
    github: string;
  };
};

export const siteConfig: SiteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || "SMRY",
  description:
    "Paste any paywalled article link and get the full text plus an AI summary. Free to use, no account, no browser extension.",
  url: process.env.NEXT_PUBLIC_URL || "https://smry.ai",
  ogImage: `${process.env.NEXT_PUBLIC_URL || "https://smry.ai"}/og-image.png`,
  links: {
    twitter: "https://twitter.com/michael_chomsky",
    github: "https://github.com/mrmps/SMRY",
  },
};
