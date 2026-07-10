import { NextRequest, NextResponse } from "next/server";
import { allProviders } from "../../../lib/providers";
import type { Provider, ProviderResult } from "../../../lib/providers/types";
import { TtlCache } from "../../../lib/cache";
import { checkRateLimit } from "../../../lib/rate-limit";

// Vercel's default serverless function duration is 10s (Hobby plan) — below
// the per-provider timeout budget the Playwright-based providers now get
// (see PROVIDER_TIMEOUT_OVERRIDES_MS below). Without this, Vercel would kill
// the function before those providers' timeout race even resolves.
export const maxDuration = 40;

type AggregatedResult = {
  purchase: ProviderResult[];
  // Every provider's raw result, including `not_found` ones — kept so a
  // cache hit can replay the exact same per-provider events a live run
  // would have emitted (see `onProviderResult` below), not just the
  // already-filtered purchase list.
  all: ProviderResult[];
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const searchCache = new TtlCache<AggregatedResult>(ONE_HOUR_MS);

// Orchestrator-level hard cap per provider, on top of each provider's own
// internal timeout (fetch AbortSignal / Playwright goto timeout). Prevents a
// single slow provider (e.g. Amazon Music's ~25s worst case) from making the
// whole /api/search request time out on Vercel, even when every other
// provider already finished. The response returns once this budget elapses
// regardless of what the slow provider's promise eventually does.
const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;

// Providers that go through a real Chromium instance (see lib/browser-fetch.ts)
// need more budget than a plain `fetch` — browser launch + navigation alone
// can take several seconds before any parsing even starts. Beatport/
// Traxsource/Bandcamp can now chain up to 3 sequential browser launches in
// their worst case (own search + Google fallback search + Google-found
// product page — lib/google-search.ts also goes through a real browser as
// of 2026-07-10, Google serves the same kind of bot-challenge to a plain
// `fetch` that Cloudflare does). browser-fetch.ts also caps concurrent
// launches at 2, so when several providers need a fallback simultaneously
// some of their launches queue instead of all firing at once — the larger
// budget here accounts for that queueing delay, not just the raw
// launch+navigate time.
const PROVIDER_TIMEOUT_OVERRIDES_MS: Record<string, number> = {
  // amazon-music.ts's own internal budget is gotoTimeoutMs (20000) +
  // postGotoWaitMs (2500) = 22500ms minimum before it can return anything —
  // this override must clear that plus launch/queueing headroom, or the
  // orchestrator's timer fires first and reports "error" on exactly the
  // slow-but-working case this budget exists to accommodate (found live
  // 2026-07-10 via code review: the two numbers had drifted out of sync).
  "Amazon Music": 28000,
  Beatport: 30000,
  Traxsource: 30000,
  Bandcamp: 30000,
};

async function runProvider(
  provider: Provider,
  query: string,
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS
): Promise<ProviderResult> {
  timeoutMs = PROVIDER_TIMEOUT_OVERRIDES_MS[provider.name] ?? timeoutMs;
  const timeoutResult: ProviderResult = { platform: provider.name, status: "error" };

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<ProviderResult>((resolve) => {
    timer = setTimeout(() => resolve(timeoutResult), timeoutMs);
  });

  // Keep a direct handle on the search promise and attach a no-op catch so
  // that if it rejects AFTER the timeout has already won the race, Node
  // doesn't report an unhandled promise rejection in the background.
  const searchPromise = provider.search(query);
  searchPromise.catch(() => {});

  try {
    const result = await Promise.race([searchPromise, timeout]);
    return result;
  } catch {
    return { platform: provider.name, status: "error" };
  } finally {
    clearTimeout(timer!);
  }
}

export async function aggregateSearch(
  query: string,
  providers: Provider[] = allProviders,
  providerTimeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS,
  // Invoked once per provider result, in resolution order — on a fresh run
  // as each provider settles, or (replayed) once per stored result on a
  // cache hit. Used by GET to stream results incrementally; unused by the
  // existing non-streaming callers/tests.
  onProviderResult?: (result: ProviderResult) => void
): Promise<AggregatedResult> {
  const cacheKey = query.trim().toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) {
    if (onProviderResult) cached.all.forEach(onProviderResult);
    return cached;
  }

  const results = await Promise.all(
    providers.map(async (p) => {
      const result = await runProvider(p, query, providerTimeoutMs);
      onProviderResult?.(result);
      return result;
    })
  );

  const purchase = results.filter((r) => r.status !== "not_found");

  const aggregated: AggregatedResult = { purchase, all: results };
  searchCache.set(cacheKey, aggregated);
  return aggregated;
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { success } = await checkRateLimit(ip);
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const query = request.nextUrl.searchParams.get("q");
  if (!query || query.trim().length === 0) {
    return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
  }

  // Server-Sent Events: each provider's result is pushed to the client the
  // moment it settles (or, on a cache hit, replayed immediately) instead of
  // the client waiting for the slowest of the 5 — Amazon Music's Playwright
  // cold start in particular — before seeing anything.
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // Once the client disconnects (cancel() below), the controller is
      // already closed — enqueue() would throw. Swallow that specific case;
      // any other failure still surfaces via controller.error() below.
      const send = (event: string, data: unknown) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(sseEvent(event, data)));
        } catch {
          // Controller closed between the cancelled check and this call —
          // ignore, nothing left to stream to.
        }
      };

      try {
        await aggregateSearch(
          query,
          allProviders,
          DEFAULT_PROVIDER_TIMEOUT_MS,
          (result) => send("provider", result)
        );

        if (!cancelled) {
          send("done", {});
          controller.close();
        }
      } catch (err) {
        if (!cancelled) controller.error(err);
      }
    },
    cancel() {
      // Fires if the client navigates away / aborts mid-search. Nothing to
      // actively tear down (aggregateSearch's own per-provider timeouts
      // still bound how long the in-flight work runs) — this just stops
      // `send` from touching an already-closed controller.
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
