import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
});

export async function checkRateLimit(identifier: string): Promise<{ success: boolean }> {
  const { success } = await ratelimit.limit(identifier);
  return { success };
}
