self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event);
  const notificationData = getNotificationData(payload);

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title
    : 'BuildingOS';

  const options = {
    body: typeof payload.body === 'string' ? payload.body : undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: notificationData,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetPath = sanitizeSameOriginPath(event.notification.data?.url);

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    const targetUrl = new URL(targetPath, self.location.origin).href;

    for (const client of clientsList) {
      if (client.url === targetUrl && 'focus' in client) {
        try {
          return await client.focus();
        } catch {
          break;
        }
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetPath);
    }

    return undefined;
  })());
});

function parsePushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    const json = event.data.json();
    return isRecord(json) ? json : {};
  } catch {
    try {
      return { body: event.data.text() };
    } catch {
      return {};
    }
  }
}

function getNotificationData(payload) {
  const data = isRecord(payload.data) ? { ...payload.data } : {};
  data.url = sanitizeSameOriginPath(payload.url ?? data.url);
  return data;
}

function sanitizeSameOriginPath(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return '/';
  }

  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) {
      return '/';
    }
    return `${url.pathname}${url.search}${url.hash}` || '/';
  } catch {
    return '/';
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
