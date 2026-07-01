import { BadRequestException } from '@nestjs/common';
import { isIP } from 'node:net';

interface PushEndpointValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

const allowedExactPushHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);

const allowedPushHostSuffixes = ['.notify.windows.com'];

const deniedHostnames = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
]);

export function assertValidPushSubscriptionEndpoint(
  endpoint: unknown,
): asserts endpoint is string {
  const validation = validatePushSubscriptionEndpoint(endpoint);

  if (!validation.valid) {
    throw new BadRequestException(validation.reason);
  }
}

export function validatePushSubscriptionEndpoint(
  endpoint: unknown,
): PushEndpointValidationResult {
  if (typeof endpoint !== 'string' || endpoint.trim().length === 0) {
    return invalid('Push subscription endpoint is required');
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return invalid('Push subscription endpoint must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    return invalid('Push subscription endpoint must use HTTPS');
  }

  if (url.username || url.password) {
    return invalid('Push subscription endpoint must not include credentials');
  }

  const host = normalizeHostname(url.hostname);

  if (host.length === 0) {
    return invalid('Push subscription endpoint must include a host');
  }

  if (isDeniedHostname(host)) {
    return invalid('Push subscription endpoint host is not allowed');
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && isDeniedIPv4(host)) {
    return invalid('Push subscription endpoint IP range is not allowed');
  }

  if (ipVersion === 6 && isDeniedIPv6(host)) {
    return invalid('Push subscription endpoint IP range is not allowed');
  }

  if (!isAllowedPushServiceHost(host)) {
    return invalid('Push subscription endpoint host is not an allowed push service');
  }

  return { valid: true };
}

function invalid(reason: string): PushEndpointValidationResult {
  return { valid: false, reason };
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function isDeniedHostname(host: string): boolean {
  return deniedHostnames.has(host) || host.endsWith('.localhost');
}

function isAllowedPushServiceHost(host: string): boolean {
  return (
    allowedExactPushHosts.has(host) ||
    allowedPushHostSuffixes.some((suffix) => host.endsWith(suffix))
  );
}

function isDeniedIPv4(host: string): boolean {
  const octets = parseIPv4(host);
  if (!octets) {
    return true;
  }

  const [first, second] = octets;

  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

function parseIPv4(host: string): readonly [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !/^\d+$/.test(parts[index]!) ||
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255,
    )
  ) {
    return null;
  }

  return octets as [number, number, number, number];
}

function isDeniedIPv6(host: string): boolean {
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }

  const firstBlockText = host.split(':')[0];
  if (!firstBlockText) {
    return false;
  }

  const firstBlock = Number.parseInt(firstBlockText, 16);
  if (!Number.isInteger(firstBlock)) {
    return true;
  }

  return (firstBlock & 0xfe00) === 0xfc00 || (firstBlock & 0xffc0) === 0xfe80;
}
