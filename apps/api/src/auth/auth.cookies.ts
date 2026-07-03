import type { Request, Response, CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'bo_access_token';
export const REFRESH_TOKEN_COOKIE = 'bo_refresh_token';

const ACCESS_TOKEN_MAX_AGE_MS = 1000 * 60 * 15;
const REFRESH_TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

function isSecureCookie(): boolean {
  const nodeEnv = process.env.NODE_ENV?.trim();
  return nodeEnv === 'production' || nodeEnv === 'staging';
}

function createCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return header.split(';').reduce<Record<string, string>>((cookies, pair) => {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex < 0) {
      return cookies;
    }

    const key = decodeURIComponent(pair.slice(0, separatorIndex).trim());
    const value = decodeURIComponent(pair.slice(separatorIndex + 1).trim());
    cookies[key] = value;
    return cookies;
  }, {});
}

export function getCookie(req: Request, cookieName: string): string | null {
  const cookies = parseCookies(req);
  return cookies[cookieName] ?? null;
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, accessToken, createCookieOptions(ACCESS_TOKEN_MAX_AGE_MS));
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, createCookieOptions(REFRESH_TOKEN_MAX_AGE_MS));
}

export function clearAuthCookies(res: Response): void {
  const clearOptions = {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax' as const,
    path: '/',
  };

  res.clearCookie(ACCESS_TOKEN_COOKIE, clearOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE, clearOptions);
}
