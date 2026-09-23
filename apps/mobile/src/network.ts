/**
 * Connectivity state and retry helpers. Pure TypeScript (no React Native imports) so the
 * logic is testable under Node.
 */

/** Thrown for transport failures (no response at all), as opposed to HTTP error statuses. */
export class NetworkError extends Error {
  readonly network = true;
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Chrome/Edge, Safari, Firefox and React Native wordings for a failed fetch.
  return /failed to fetch|load failed|networkerror|network request failed|network error/i.test(
    message,
  );
}

/** Exponential backoff with an optional random factor: 500, 1000, 2000… capped at `maxMs`. */
export function backoffDelay(
  attempt: number,
  { baseMs = 500, maxMs = 8000, random = Math.random }: BackoffOptions = {},
): number {
  const exact = Math.min(maxMs, baseMs * 2 ** attempt);
  // Up to 25% jitter so reconnecting clients do not all retry at the same instant.
  return Math.round(exact * (0.75 + 0.25 * random()));
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}

export interface RetryOptions extends BackoffOptions {
  /** Extra attempts after the first one. */
  retries?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `task`, retrying with exponential backoff while `shouldRetry` accepts the error. Use only
 * for idempotent requests (GET); a retried POST could repeat a side effect.
 */
export async function retryWithBackoff<T>(
  task: (attempt: number) => Promise<T>,
  { retries = 3, shouldRetry = isNetworkError, sleep = wait, ...backoff }: RetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      await sleep(backoffDelay(attempt, backoff));
    }
  }
}

/** HTTP statuses worth retrying for idempotent requests (gateway and overload errors). */
export function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

type Listener = () => void;

/**
 * App-wide online/offline flag. The browser's online/offline events feed it on web; on every
 * platform a request that fails at the transport level marks it offline and the next successful
 * response marks it online again.
 */
export class Connectivity {
  private online = true;
  private readonly listeners = new Set<Listener>();
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.online;
  set(online: boolean) {
    if (online === this.online) return;
    this.online = online;
    for (const listener of this.listeners) listener();
  }
}

export const connectivity = new Connectivity();
