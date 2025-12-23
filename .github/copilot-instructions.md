# SMRY.ai Copilot Instructions

## Big Picture Architecture
- **Framework**: Next.js 16 (App Router) with TypeScript.
- **Data Fetching**: TanStack Query for parallel multi-source fetching (Direct, Wayback, Jina.ai).
- **Caching**: Dual-layer strategy using Upstash Redis (server-side) and TanStack Query (client-side).
- **AI Integration**: Vercel AI SDK (`useCompletion`) with OpenRouter for summaries.
- **I18n**: `next-intl` for multi-language support.
- **State**: `nuqs` for URL-based state management.

## Developer Workflows
- **Package Manager**: ALWAYS use `pnpm`.
- **Builds**: NEVER run `pnpm run build` in development.
- **Logging**: Use `createLogger` from [lib/logger.ts](../lib/logger.ts). Pipe `pnpm dev | pino-pretty` for readable logs.
- **Testing**: Use Vitest for unit tests (e.g., [lib/rtl.test.ts](../lib/rtl.test.ts)).

## Design Philosophy & UI Patterns
Follow [DESIGN_PHILOSOPHY.md](../DESIGN_PHILOSOPHY.md) strictly:
- **Nested Card Aesthetic**: 
  - Outer: `p-0.5 bg-accent rounded-[14px]`
  - Inner: `bg-card rounded-xl p-4`
- **Base UI**: Use `@base-ui-components/react`. Use the `render` prop instead of `asChild`.
- **Typography**: Small, uppercase labels for titles (`text-xs font-medium uppercase tracking-wider`).
- **Icons**: Use `lucide-react`.

## Error Handling
- **Type-Safe Errors**: Use `neverthrow`'s `Result` types. Avoid `try-catch` for domain logic.
- **Debug Context**: Always include `DebugContext` in errors to track extraction steps. See [lib/errors/types.ts](../lib/errors/types.ts).
- **Validation**: Use `zod` for all API responses and internal data structures.

## Key Integration Points
- **Article Extraction**: [lib/api/diffbot.ts](../lib/api/diffbot.ts) handles the core extraction logic with fallbacks.
- **Proxy Logic**: [proxy.ts](../proxy.ts) and [lib/proxy-redirect.ts](../lib/proxy-redirect.ts) handle URL-based redirection (e.g., `smry.ai/https://...`).
- **API Routes**: [app/api/article/route.ts](../app/api/article/route.ts) is the main entry point for content fetching.

## Code Style
- Use functional components and hooks.
- Prefer `const` over `let`.
- Use absolute imports with `@/` prefix.
- Follow the "investor update" aesthetic: professional, clean, and document-like.
