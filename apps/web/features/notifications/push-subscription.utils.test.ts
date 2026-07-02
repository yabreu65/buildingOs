import { arrayBufferToBase64Url, urlBase64ToUint8Array } from './push-subscription.utils';

describe('push subscription utilities', () => {
  it('converts base64url VAPID keys to Uint8Array values', () => {
    const bytes = urlBase64ToUint8Array('AQIDBA');

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
  });

  it('converts ArrayBuffer values to unpadded base64url strings', () => {
    const bytes = new Uint8Array([251, 255, 255]);

    expect(arrayBufferToBase64Url(bytes.buffer)).toBe('-___');
  });

  it('returns null when a browser subscription key is missing', () => {
    expect(arrayBufferToBase64Url(null)).toBeNull();
  });
});
