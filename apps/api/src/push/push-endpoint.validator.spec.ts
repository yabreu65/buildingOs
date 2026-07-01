import { validatePushSubscriptionEndpoint } from './push-endpoint.validator';

describe('validatePushSubscriptionEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/subscription-1',
    'https://updates.push.services.mozilla.com/wpush/v2/subscription-1',
    'https://web.push.apple.com/subscription-1',
    'https://example.notify.windows.com/?token=subscription-1',
  ])('accepts a known push service endpoint: %s', (endpoint) => {
    expect(validatePushSubscriptionEndpoint(endpoint)).toEqual({ valid: true });
  });

  it('rejects non-HTTPS endpoints', () => {
    expect(
      validatePushSubscriptionEndpoint(
        'http://fcm.googleapis.com/fcm/send/subscription-1',
      ).valid,
    ).toBe(false);
  });

  it.each([
    'https://localhost/push',
    'https://app.localhost/push',
    'https://127.0.0.1/push',
    'https://10.0.0.1/push',
    'https://172.16.0.1/push',
    'https://192.168.0.1/push',
    'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/push',
    'https://[::1]/push',
    'https://[fe80::1]/push',
  ])('rejects unsafe endpoint hosts: %s', (endpoint) => {
    expect(validatePushSubscriptionEndpoint(endpoint).valid).toBe(false);
  });

  it('rejects public HTTPS endpoints that are not known push services', () => {
    expect(validatePushSubscriptionEndpoint('https://example.com/push').valid).toBe(false);
  });
});
