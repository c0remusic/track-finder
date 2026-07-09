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

async function runProvider(provider: Provider, query: string): Promise<ProviderResult> {
  try {
    return await provider.search(query);
  } catch {
    return { platform: provider.name, status: "error" };
  }
}

export async function aggregateSearch(
  query: string,
  providers: Provider[] = allProviders
): Promise<AggregatedResult> {
  const cacheKey = query.trim().toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const results = await Promise.all(providers.map((p) => runProvider(p, query)));

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
