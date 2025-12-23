"use client";

// CLERK DISABLED - useAuth commented out
// import { useAuth } from "@clerk/nextjs";
import { useSyncExternalStore } from "react";

// Empty subscribe function - we don't need to subscribe to anything,
// we just use useSyncExternalStore for its hydration-safe behavior
const emptySubscribe = () => () => { };

/**
 * Hook to check if user has premium using Clerk Billing
 * Returns stable values to prevent hydration mismatches
 * 
 * Uses useSyncExternalStore to safely handle the SSR/client boundary
 * without causing cascading renders from useEffect + setState
 * 
 * CLERK DISABLED - always returns non-premium state
 * 
 * @returns { isPremium: boolean, isLoading: boolean }
 */
export function useIsPremium(): { isPremium: boolean, isLoading: boolean } {
  // CLERK DISABLED - useAuth removed
  // const { isLoaded, has } = useAuth();

  // Returns true on client, false during SSR - prevents hydration mismatch
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,  // Client snapshot
    () => false  // Server snapshot
  );

  // CLERK DISABLED - always return non-premium
  // Only trust premium status after client hydration and auth is loaded
  // const isPremium = isClient && isLoaded && (has?.({ plan: "premium" }) ?? false);
  // const isLoading = !isClient || !isLoaded;
  const isPremium = false;
  const isLoading = !isClient;

  return { isPremium, isLoading };
}

