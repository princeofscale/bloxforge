import { isIP } from 'node:net';

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  if (normalized === 'localhost' || normalized === 'localhost.localdomain' || normalized === 'ip6-localhost') {
    return true;
  }
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  if (isIP(normalized) === 6) {
    return normalized === '::1' ||
      normalized === '0:0:0:0:0:0:0:1' ||
      /^::ffff:127\./.test(normalized);
  }
  return false;
}
