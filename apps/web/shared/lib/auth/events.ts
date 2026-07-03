export const AUTH_UNAUTHORIZED_EVENT = 'bo:auth-unauthorized';

export function emitAuthUnauthorized(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT));
}

export function subscribeAuthUnauthorized(onUnauthorized: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = () => {
    onUnauthorized();
  };

  window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handler);

  return () => {
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handler);
  };
}
