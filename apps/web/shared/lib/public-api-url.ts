const NEXT_PUBLIC_API_URL_ERROR =
  'NEXT_PUBLIC_API_URL is required. Set it to the public BuildingOS API base URL before building or running the web app.';

export function getPublicApiUrl(): string {
  const value = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!value) {
    throw new Error(NEXT_PUBLIC_API_URL_ERROR);
  }

  return value.replace(/\/$/, '');
}

export function buildPublicApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getPublicApiUrl()}${normalizedPath}`;
}
