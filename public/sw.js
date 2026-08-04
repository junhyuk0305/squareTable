/* 매장의 정석 서비스워커 — 웹푸시 수신 + 알림 클릭 라우팅.
 *
 * 이 파일은 public/ 에 있어 빌드 시 사이트 루트(/sw.js)로 복사된다. 반드시 origin 루트에서
 * 서빙돼야 스코프('/')로 등록돼 앱 전체 경로의 알림을 받을 수 있다.
 * 클라이언트 등록: src/lib/push/webpush.ts 의 registerServiceWorker().
 *
 * 캐싱/오프라인은 하지 않는다(순수 푸시 목적). Expo가 만든 SPA 캐시 정책과 충돌 방지.
 */

// install/activate: 새 SW 를 '기다리지 말고' 즉시 활성화하고 열린 페이지를 곧장 control 한다.
//   - skipWaiting 없으면: 새 SW 가 waiting 상태로 멈춰, 배포해도 사용자가 앱을 완전히 껐다 켜기 전엔
//     옛 SW 가 계속 알림/배지를 처리한다("껐다 켜야 반영되는" 증상의 원인).
//   - clients.claim 없으면: 첫 설치 직후 navigator.serviceWorker.controller === null 이라 클라의 구독
//     로직이 스킵돼 DB에 구독이 안 생기는데 UI는 '알림 켜짐'으로 뜨는 무음 실패가 난다(iOS 다발).
//   근거: WebKit/Apple 웹푸시 가이드 · iOS PWA 구독 조용한 실패(SW not controlling) 사례.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// push: 서버(엣지함수)가 web-push 로 보낸 페이로드를 받아 OS 알림으로 표시.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    // 페이로드가 JSON이 아니면 텍스트로라도 표시
    data = { title: '매장의 정석', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || '매장의 정석';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    // badge = 안드로이드 상태바의 작은 단색 아이콘. 풀컬러(/icon.png)를 주면 안드로이드가
    // 흰 사각형으로 뭉갠다 → 투명배경 흰 실루엣 전용 배지(/badge-96.png)를 쓴다.
    badge: '/badge-96.png',
    // 같은 tag 는 덮어써 알림함이 중복으로 쌓이지 않게 한다(예: 같은 질문 재알림).
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    // 클릭 시 열 앱 내부 경로. notificationclick 에서 사용.
    data: { url: data.url || '/' },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      await bumpBadge(); // 앱 아이콘 숫자 = '실제 안 읽은 수'(IDB 공유) + 1 — 앱이 닫혀 있어도 누적 갱신
    })(),
  );
});

// ── 앱 아이콘 배지 카운터 (앱과 IndexedDB로 공유) ──────────────────────────────
// 배지 숫자를 '알림창에 떠 있는 수'(getNotifications)로 잡던 옛 방식은 ① 같은 tag 알림이 접혀 실제보다
// 적게 세지고 ② 방해금지로 푸시가 억제되면 알림창이 비어, 껐다 켠 뒤 첫 알림에서 1로 튀는 버그가 있었다.
// → '실제 안 읽은 수'를 IDB(chakchak-badge)에 두고: 앱이 열려 있을 땐 앱(useAppBadgeSync)이 실수치를 쓰고,
//   앱이 닫혀 푸시가 오면 여기서 그 값을 +1 한다. 알림 클릭(=하나 확인)하면 -1. IDB가 비었으면 옛 방식 폴백.
const BADGE_DB = 'chakchak-badge';
const BADGE_STORE = 'kv';
const BADGE_KEY = 'count';

function badgeDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BADGE_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BADGE_STORE)) db.createObjectStore(BADGE_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function badgeGet() {
  try {
    const db = await badgeDb();
    return await new Promise((resolve) => {
      const r = db.transaction(BADGE_STORE, 'readonly').objectStore(BADGE_STORE).get(BADGE_KEY);
      r.onsuccess = () => resolve(typeof r.result === 'number' ? r.result : null);
      r.onerror = () => resolve(null);
    });
  } catch (_e) {
    return null;
  }
}
async function badgeSet(n) {
  try {
    const db = await badgeDb();
    await new Promise((resolve) => {
      const tx = db.transaction(BADGE_STORE, 'readwrite');
      tx.objectStore(BADGE_STORE).put(n, BADGE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (_e) {
    /* 무시 */
  }
}

// 푸시 도착 → 실제 안 읽은 수 +1(닫혀 있어도 누적). IDB 미동기화면 옛 방식(알림창 수)으로 폴백.
async function bumpBadge() {
  try {
    if (!self.navigator || typeof self.navigator.setAppBadge !== 'function') return;
    const stored = await badgeGet();
    if (stored == null) return syncAppBadge();
    const next = stored + 1;
    await badgeSet(next);
    await self.navigator.setAppBadge(next);
  } catch (_e) {
    /* 미지원 — 무시 */
  }
}

// 알림 클릭(하나 확인) → 실제 안 읽은 수 -1. 앱이 열리면 useAppBadgeSync가 실수치로 최종 재동기화한다.
async function decBadge() {
  try {
    if (!self.navigator) return;
    const stored = await badgeGet();
    if (stored == null) return syncAppBadge();
    const next = Math.max(0, stored - 1);
    await badgeSet(next);
    if (next > 0 && typeof self.navigator.setAppBadge === 'function') await self.navigator.setAppBadge(next);
    else if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
  } catch (_e) {
    /* 미지원 — 무시 */
  }
}

// 폴백 — IDB가 아직 비어 실수치를 모를 때만 '알림창에 떠 있는 수'로 근사한다.
async function syncAppBadge() {
  try {
    if (!self.navigator || typeof self.navigator.setAppBadge !== 'function') return;
    const list = await self.registration.getNotifications();
    if (list.length > 0) await self.navigator.setAppBadge(list.length);
    else if (typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge();
  } catch (_e) {
    /* 미지원 — 무시 */
  }
}

// 알림 클릭: 이미 열린 앱 탭이 있으면 포커스 + 해당 경로로 이동, 없으면 새로 연다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      await decBadge(); // 이 알림을 하나 확인 → 배지 -1 (앱 열리면 useAppBadgeSync가 실수치로 최종 동기화)
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
