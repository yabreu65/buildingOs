export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(paddingLength)}`;
  const rawData = atob(padded);
  const output = new Uint8Array(rawData.length) as Uint8Array<ArrayBuffer>;

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output;
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer | null): string | null {
  if (!buffer) {
    return null;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
