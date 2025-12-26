"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

import { siteConfig } from "@/app/config/site";

export function SiteFooter({ className }: React.HTMLAttributes<HTMLElement>) {
  const t = useTranslations("footer");
  const siteName = siteConfig.name;
  const currentYear = new Date().getFullYear();

  return (
    <footer className={cn("border-t border-border", className)}>
      <div className="container flex flex-col items-center justify-center py-8 space-y-3">
        {/* Decorative Element */}
        <div className="flex items-center gap-3">
          <div className="h-px w-8 bg-border" />
          <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("colophon")}</span>
          <div className="h-px w-8 bg-border" />
        </div>
        <p className="text-center text-sm text-muted-foreground font-serif">
          {t.rich("madeBy", {
            siteName,
            siteVersion: siteConfig.version,
            author: "bgeneto",
            bold: (chunks: React.ReactNode) => <span className="font-heading font-bold">{chunks}</span>
          })}. {t("tagline")}.
        </p>
      </div>
    </footer>
  );
}
