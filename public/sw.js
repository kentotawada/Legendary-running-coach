/*
  通知を受け取るためのサービスワーカー。
  
  iOS では「ホーム画面に追加」した状態でないと通知が使えません（16.4以降）。
  これは仕様なので、アプリ側でもそう案内しています。
  
  ここではキャッシュを一切持ちません。
  古い画面が残って「直したはずの不具合が直らない」方が、ずっと困るためです。
*/

self.addEventListener('install', () => {
  // 新しい版をすぐ有効にする。通知の中身を直した時に、次から効くように。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 取得はネットワークにそのまま任せる（インストール可能にするためだけの空実装）。
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: '伝説のコーチ', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || '伝説のコーチ';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || 'coach',
      // 同じ種類の知らせが2つ並ばないよう、置き換える。
      renotify: false,
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // すでに開いているタブがあれば、そこへ戻す。新しいタブを増やさない。
      for (const client of windows) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
