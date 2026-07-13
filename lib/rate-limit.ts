import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
});

// Same shape as the Redis limiter (20 requests / 60s), kept in memory. This
// is NOT a replacement for Redis's distributed limit (each serverless
// instance has its own map, so the real ceiling across N warm instances is
// N times higher) — it's only a safety net for when Redis is unreachable,
// so a single instance can't be flooded into launching unlimited Chromium
// page requests (each /api/search hit can spin up to 4 Playwright
// providers, see app/api/search/route.ts) while Redis is down. Without
// this, "fail open" meant zero limit at all during an Upstash outage.
const IN_MEMORY_WINDOW_MS = 60_000;
const IN_MEMORY_LIMIT = 20;
const inMemoryHits = new Map<string, number[]>();

function checkInMemoryFallback(identifier: string): boolean {
  const now = Date.now();
  const windowStart = now - IN_MEMORY_WINDOW_MS;
  const hits = (inMemoryHits.get(identifier) ?? []).filter((t) => t > windowStart);

  if (hits.length >= IN_MEMORY_LIMIT) {
    inMemoryHits.set(identifier, hits);
    return false;
  }

  hits.push(now);
  inMemoryHits.set(identifier, hits);
  return true;
}

export async function checkRateLimit(identifier: string): Promise<{ success: boolean }> {
  // Fail open: rate limiting is a secondary abuse guard, not the core
  // feature. If Redis is unreachable or misconfigured (missing env vars,
  // an Upstash outage), let requests through rather than taking the whole
  // API down for every user — but still bound them via the in-memory
  // fallback above instead of letting every request through unbounded.
  try {
    const { success } = await ratelimit.limit(identifier);
    return { success };
  } catch (error) {
    console.warn("[rate-limit] Redis call failed, falling back to in-memory limit:", error);
    return { success: checkInMemoryFallback(identifier) };
  }
}
