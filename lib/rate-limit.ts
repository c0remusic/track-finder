import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
});

export async function checkRateLimit(identifier: string): Promise<{ success: boolean }> {
  // Fail open: rate limiting is a secondary abuse guard, not the core
  // feature. If Redis is unreachable or misconfigured (missing env vars,
  // an Upstash outage), let the search through rather than taking the
  // whole API down for every user.
  try {
    const { success } = await ratelimit.limit(identifier);
    return { success };
  } catch (error) {
    console.warn("[rate-limit] Redis call failed, failing open:", error);
    return { success: true };
  }
}
