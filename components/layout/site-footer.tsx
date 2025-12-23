"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function SiteFooter({ className }: React.HTMLAttributes<HTMLElement>) {
  const siteName = process.env.NEXT_PUBLIC_SITE_NAME || "SMRY";
  const currentYear = new Date().getFullYear();

  return (
    <footer className={cn(className)}>
      <div className="container flex items-center justify-center py-6">
        <p className="text-center text-sm text-muted-foreground">
          © {currentYear} {siteName}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
