// Token bucket, used to bound what an unauthenticated caller can cost us.
//
// The webhook route is the one publicly reachable path in this app, and its
// hostname is not secret — Tailscale's cert is a Let's Encrypt one, which by
// definition appears in Certificate Transparency logs, so the endpoint is
// enumerable. Rejecting a forged request is cheap in isolation but not free:
// without a bound, a stranger can spend our CPU and disk indefinitely.
//
// In-memory on purpose. Persisting the counters would reintroduce the disk
// write per unauthenticated request that this exists to prevent, and losing
// the state on restart is harmless — the bucket refills anyway.

interface Bucket {
  tokens: number
  lastRefillMs: number
}

const buckets = new Map<string, Bucket>()

/**
 * Consume one token for `key`, refilling at `refillPerSec` up to `capacity`.
 * Returns false when the bucket is empty — the caller should answer 429 and
 * do nothing else.
 */
export function allowRequest(
  key: string,
  capacity: number,
  refillPerSec: number,
): boolean {
  const now = Date.now()
  const bucket = buckets.get(key) ?? { tokens: capacity, lastRefillMs: now }

  const elapsedSec = (now - bucket.lastRefillMs) / 1000
  // Capped at `capacity`: an endpoint idle overnight must not bank a burst
  // large enough to make the limit meaningless the moment traffic resumes.
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec)
  bucket.lastRefillMs = now

  if (bucket.tokens < 1) {
    buckets.set(key, bucket)
    return false
  }
  bucket.tokens -= 1
  buckets.set(key, bucket)
  return true
}

/** Test seam. */
export function __resetRateLimitForTests(): void {
  buckets.clear()
}
