/* promo.js — 8월 전면 무료 고지. 마케팅 정적 페이지 전용(앱 SPA·법무 페이지 제외).
 *
 * 왜 JS 주입인가: 정적 HTML 8장에 nav 가 각각 복사돼 있어, 마크업을 넣으면 8곳에 같은 문구가
 *   흩어진다. 문구·기한을 한 곳에서만 고치려고 이 파일이 마크업까지 만든다.
 *   각 페이지는 <script defer src="/promo.js"></script> 한 줄만 갖는다.
 *
 * ★스스로 만료된다 — 9월 1일이 지나면 아무것도 그리지 않는다.
 *   프로모션이 끝났는데 "8월 무료"가 남아 방문자에게 거짓말하는 사고를 막는다.
 *   기간을 늘리려면 ENDS_AT 과 앱의 FREE_PROMO(src/lib/config/tiers.ts), 그리고
 *   관리 콘솔의 전면 무료 스위치를 **함께** 옮긴다(셋이 어긋나면 말과 실제가 다르다).
 */
(function () {
  var ENDS_AT = new Date('2026-09-01T00:00:00+09:00'); // KST 9/1 00:00 이후 노출 중단
  var SEEN_KEY = 'sqt.promo.aug2026.seen';
  var HEADLINE = '8월 한 달 전면 무료';
  var UNTIL = '8월 31일';

  if (Date.now() >= ENDS_AT.getTime()) return;

  function seen() {
    try { return !!localStorage.getItem(SEEN_KEY); } catch (e) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 시크릿 모드 등 — 무시 */ }
  }

  /* ── 1) 상단 띠 — 늘 보인다(스크롤하면 nav 위로 지나간다) ── */
  var strip = document.createElement('div');
  strip.className = 'promoStrip';
  strip.innerHTML =
    '<div class="in"><b>' + HEADLINE + '</b>' +
    '<span>매장 수·직원 수 제한 없이 모든 기능을 ' + UNTIL + '까지 무료로 쓰실 수 있어요.</span>' +
    '<a href="/signup">무료로 시작하기</a></div>';
  document.body.insertBefore(strip, document.body.firstChild);

  /* ── 2) 팝업 — 브라우저당 1회 ── */
  if (seen()) return;

  var back = document.createElement('div');
  back.className = 'promoBack';
  back.setAttribute('role', 'dialog');
  back.setAttribute('aria-modal', 'true');
  back.setAttribute('aria-labelledby', 'promoTitle');
  back.innerHTML =
    '<div class="promoCard">' +
      '<button type="button" class="x" aria-label="닫기">&times;</button>' +
      '<p class="eyebrow"><span class="pin"></span>지금 가입하면</p>' +
      '<h2 id="promoTitle">' + HEADLINE + '</h2>' +
      '<p class="sub">서비스가 실제로 매장에 맞는지 먼저 써 보시라고, ' + UNTIL + '까지 요금제를 열어 둡니다.</p>' +
      '<ul>' +
        '<li>모든 기능 — 노하우·질문 응답·퀴즈·업무 채팅</li>' +
        '<li>매장 수 제한 없음 — 다점포 기능까지</li>' +
        '<li>직원 수 제한 없음</li>' +
      '</ul>' +
      '<a class="p" href="/signup">무료로 시작하기</a>' +
      '<button type="button" class="s">다음에 볼게요</button>' +
      // ★클래스명 주의: 사이트에 이미 .foot(검정 배경 CTA 섹션)이 있다 — 겹치면 흰 카드 안에
      //   검정 덩어리가 생긴다(브라우저 확인에서 실제로 재현됨). 프로모션 전용 이름을 쓴다.
      '<p class="promoNote">9월부터는 무료 요금제(매장 1개·직원 3명)로 계속 쓰거나 요금제를 고르시면 돼요.</p>' +
    '</div>';

  function close() {
    markSeen();
    back.classList.remove('on');
    setTimeout(function () { back.remove(); }, 200);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  back.addEventListener('click', function (e) {
    // 배경 클릭·닫기·"다음에" 는 닫기. 가입 링크는 그대로 이동시킨다(닫기 표시만 남긴다).
    var t = e.target;
    if (t === back || t.classList.contains('x') || t.classList.contains('s')) { e.preventDefault(); close(); }
    else if (t.classList.contains('p')) markSeen();
  });

  // 페이지를 읽기 시작한 뒤에 띄운다 — 착지하자마자 덮으면 무슨 서비스인지 보기도 전에 닫는다.
  setTimeout(function () {
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(function () { back.classList.add('on'); });
  }, 1400);
})();
