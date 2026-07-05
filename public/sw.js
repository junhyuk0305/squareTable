/* 착착 서비스워커 — 웹푸시 수신 + 알림 클릭 라우팅.
 *
 * 이 파일은 public/ 에 있어 빌드 시 사이트 루트(/sw.js)로 복사된다. 반드시 origin 루트에서
 * 서빙돼야 스코프('/')로 등록돼 앱 전체 경로의 알림을 받을 수 있다.
 * 클라이언트 등록: src/lib/push/webpush.ts 의 registerServiceWorker().
 *
 * 캐싱/오프라인은 하지 않는다(순수 푸시 목적). Expo가 만든 SPA 캐시 정책과 충돌 방지.
 */

// push: 서버(엣지함수)가 web-push 로 보낸 페이로드를 받아 OS 알림으로 표시.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    // 페이로드가 JSON이 아니면 텍스트로라도 표시
    data = { title: '착착', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || '착착';
  const options = {
    body: data.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    // 같은 tag 는 덮어써 알림함이 중복으로 쌓이지 않게 한다(예: 같은 질문 재알림).
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    // 클릭 시 열 앱 내부 경로. notificationclick 에서 사용.
    data: { url: data.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭: 이미 열린 앱 탭이 있으면 포커스 + 해당 경로로 이동, 없으면 새로 연다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          await client.focus();
          // 열린 탭에 목적지 경로를 알려 앱이 그 화면으로 네비게이트하게 한다.
          client.postMessage({ type: 'push-navigate', url: target });
          return;
        }
      }
      // 열린 탭이 없으면 목적지 경로로 새 창을 연다.
      if (self.clients.openWindow) await self.clients.openWindow(target);
    })(),
  );
});

// 구독이 브라우저에 의해 회전/만료되면 발생. 여기선 앱이 다음 실행 때 재구독하도록 두고,
// 조용한 유실을 막기 위해 기존 알림 하나로 재구독을 유도할 수도 있으나 과함 → no-op.
self.addEventListener('pushsubscriptionchange', () => {
  /* 앱 재실행 시 ensurePushSubscribed()가 새 구독을 저장한다. */
});
