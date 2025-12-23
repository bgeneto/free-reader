"use client";

import { Crown } from "lucide-react";
// CLERK DISABLED - useAuth commented out
// import { useAuth } from "@clerk/nextjs";
import { cn } from "@/lib/utils";

interface PremiumBadgeProps {
  className?: string;
  showLabel?: boolean;
}

// CLERK DISABLED - always returns null (no premium badge without auth)
export function PremiumBadge({ className, showLabel = true }: PremiumBadgeProps) {
  // const { isLoaded, has } = useAuth();
  // if (!isLoaded) {
  //   return null;
  // }
  // const isPremium = has?.({ plan: "premium" }) ?? false;
  // if (!isPremium) {
  //   return null;
  // }

  // CLERK DISABLED - always return null
  return null;

  /* Original premium badge UI - kept for reference
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        className
      )}
    >
      <Crown className="size-3" />
      {showLabel && <span>Premium</span>}
    </div>
  );
  */
}

