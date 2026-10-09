import { isIP } from 'node:net';
import { env } from '../config/env.js';
import { cipher } from '../lib/encryption.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';

export interface IpVerdict {
  proxy: boolean;
  type?: string;
  /** True when the provider could not be reached and IP_INTEL_FAIL_OPEN decided the outcome. */
  degraded?: boolean;
}

const CACHE_TTL_S = 6 * 60 * 60;
const PRIVATE_RANGES = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^f[cd]/i, /^fe80:/i];

const isPrivate = (ip: string) => PRIVATE_RANGES.some((range) => range.test(ip));

async function queryProxycheck(ip: string): Promise<IpVerdict> {
  const url = new URL(`https://proxycheck.io/v2/${encodeURIComponent(ip)}`);
  url.searchParams.set('vpn', '1');
  if (env.PROXYCHECK_API_KEY) url.searchParams.set('key', env.PROXYCHECK_API_KEY);

  const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!res.ok) throw new Error(`proxycheck.io returned ${res.status}`);
  const body = (await res.json()) as Record<string, { proxy?: string; type?: string } | string>;
  const entry = body[ip];
  if (typeof entry !== 'object') throw new Error(`proxycheck.io error: ${String(body.message ?? body.status)}`);
  return { proxy: entry.proxy === 'yes', type: entry.type };
}

/** VPN / proxy detection. Results are cached under a keyed hash so raw IPs never reach Redis. */
export async function checkIp(ip: string): Promise<IpVerdict> {
  if (env.IP_INTEL_PROVIDER === 'none' || !isIP(ip) || isPrivate(ip)) return { proxy: false };

  const cacheKey = `dv:ipintel:${cipher.hashIdentifier(ip, 'ip-intel')}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as IpVerdict;

  try {
    const verdict = await queryProxycheck(ip);
    await redis.set(cacheKey, JSON.stringify(verdict), 'EX', CACHE_TTL_S);
    return verdict;
  } catch (err) {
    logger.warn({ err }, 'IP intelligence lookup failed');
    return { proxy: !env.IP_INTEL_FAIL_OPEN, degraded: true };
  }
}
