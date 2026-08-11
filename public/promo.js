/* promo.js — 가입 프로모션 고지. 마케팅 정적 페이지 전용(앱 SPA·법무 페이지 제외).
 *
 * ★2026-08-11 약속이 바뀌었다: "8월 한 달 전면 무료"(달력 기준) → **"가입일부터 N일"**(계정 기준).
 *   기간은 그날 오후에 30일 → **14일**로 한 번 더 내렸다(사용자 결정). 기간을 옮길 땐
 *   **여기 · app_config.signup_trial_days · 인스타 원고 3곳**을 반드시 함께 옮긴다.
 *   달력 기준이면 8/29 가입자가 3일만 쓰고 끝난다 — 가장 늦게, 가장 힘들게 확보한 리드가
 *   가장 짧게 쓰는 구조였다. 여기서 파는 것은 기간이 아니라 **가입 창구 마감(8/31)** 이다.
 *   실제 부여는 서버(create_store)가 한다 — 이 파일은 말만 한다. 둘이 어긋나면 거짓말이 된다.
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
  // ★서버 카운터파트: app_config.signup_trial_until / signup_trial_days (관리 콘솔에서 조절).
  //   기간을 바꾸면 **여기와 서버 설정을 함께** 옮긴다. 안 그러면 광고와 실제가 달라진다.
  var ENDS_AT = new Date('2026-09-01T00:00:00+09:00'); // 가입 창구 마감(8/31 KST) 다음 순간
  var SEEN_KEY = 'sqt.promo.aug2026.seen';
  var HEADLINE = '지금 가입하면 14일 무료';
  var UNTIL = '8월 31일';
  var DAYS = '14일';

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
    // 띠의 배지는 짧게 — 팝업 제목을 그대로 넣으면 뒤 문장과 "가입"·"14일"이 두 번 겹친다.
    '<div class="in"><b>' + DAYS + ' 무료</b>' +
    '<span>' + UNTIL + '까지 가입하시면 직원 수 제한 없이 ' + DAYS + ' 동안 쓰실 수 있어요.</span>' +
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
      '<p class="eyebrow"><span class="pin"></span>' + UNTIL + '까지 가입하시면</p>' +
      '<h2 id="promoTitle">' + HEADLINE + '</h2>' +
      '<p class="sub">서비스가 실제로 매장에 맞는지 먼저 써 보시라고, 가입하신 날부터 ' + DAYS + ' 동안 요금제를 열어 둡니다.</p>' +
      '<ul>' +
        '<li>직원 수 제한 없음 — 무료 요금제는 3명까지예요</li>' +
        '<li>AI 답변 월 1,500건</li>' +
        // 다점포는 가입만으로 자동으로 열리지 않는다(관리 콘솔에서 열어준다) — 그래서
        // "말씀만 주시면"을 뺀 채로 쓰지 않는다. 말과 실제가 갈라지는 자리다.
        '<li>매장이 여러 곳이면 다점포까지 — 가입 후 말씀만 주세요</li>' +
      '</ul>' +
      '<a class="p" href="/signup">무료로 시작하기</a>' +
      '<button type="button" class="s">다음에 볼게요</button>' +
      // ★클래스명 주의: 사이트에 이미 .foot(검정 배경 CTA 섹션)이 있다 — 겹치면 흰 카드 안에
      //   검정 덩어리가 생긴다(브라우저 확인에서 실제로 재현됨). 프로모션 전용 이름을 쓴다.
      '<p class="promoNote">' + DAYS + '이 지나면 무료 요금제(매장 1개·직원 3명)로 계속 쓰시면 돼요. 자동으로 결제되는 것은 없어요.</p>' +
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
