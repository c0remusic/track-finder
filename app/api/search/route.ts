import { NextRequest, NextResponse } from "next/server";
import { allProviders } from "../../../lib/providers";
import type { Provider, ProviderResult } from "../../../lib/providers/types";
import { TtlCache } from "../../../lib/cache";
import { checkRateLimit } from "../../../lib/rate-limit";

type MetadataValue<T> = { value: T; source: string };

type AggregatedMetadata = {
  bpm: MetadataValue<number>[];
  key: MetadataValue<string>[];
  genre: MetadataValue<string>[];
  label: MetadataValue<string>[];
};

type AggregatedResult = {
  purchase: ProviderResult[];
  metadata: AggregatedMetadata;
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

async function runProvider(
  provider: Provider,
  query: string,
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS
): Promise<ProviderResult> {
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
  providerTimeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS
): Promise<AggregatedResult> {
  const cacheKey = query.trim().toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const results = await Promise.all(
    providers.map((p) => runProvider(p, query, providerTimeoutMs))
  );

  const purchase = results.filter((r) => r.status !== "not_found");

  const metadata: AggregatedMetadata = { bpm: [], key: [], genre: [], label: [] };
  for (const result of results) {
    if (result.status !== "found" || !result.metadata) continue;
    const { bpm, key, genre, label } = result.metadata;
    if (bpm !== undefined) metadata.bpm.push({ value: bpm, source: result.platform });
    if (key !== undefined) metadata.key.push({ value: key, source: result.platform });
    if (genre !== undefined) metadata.genre.push({ value: genre, source: result.platform });
    if (label !== undefined) metadata.label.push({ value: label, source: result.platform });
  }

  const aggregated: AggregatedResult = { purchase, metadata };
  searchCache.set(cacheKey, aggregated);
  return aggregated;
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

  const result = await aggregateSearch(query);
  return NextResponse.json(result);
}
