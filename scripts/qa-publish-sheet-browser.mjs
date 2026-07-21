// 저장 전 확인 시트(PublishConfirmSheet) + 매뉴얼 복사 — 실브라우저 QA.
// 목(mock) 모드 로컬 서버 대상. RNW 함정: fill✗ → pressSequentially, Pressable은 click 이벤트.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://localhost:8099';
const SHOTS = process.env.QA_SHOTS ?? './qa-shots';
mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const results = [];
const chk = (id, cond, name, detail = '') => {
  if (cond) { pass++; results.push([id, name, 'PASS', '']); console.log(`  ✓ [${id}] ${name}`); }
  else { fail++; results.push([id, name, 'FAIL', detail]); console.log(`  ✗ [${id}] ${name}${detail ? ' → ' + detail : ''}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },   // 넓은 뷰포트 = 프레임 이탈이 드러나는 조건
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });
const tapText = async (t, opts = {}) => {
  const el = page.getByText(t, { exact: false }).first();
  await el.waitFor({ state: 'visible', timeout: opts.timeout ?? 15000 });
  await el.click();
};
const seeText = (t) => page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
const waitText = (t, timeout = 15000) =>
  page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);

try {
  // ── 로그인(목: 역할 토글 → 로그인) ──────────────────────────
  console.log('\n[0] 사장 계정 진입(mock)');
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500); // Metro 번들 + 첫 렌더
  await tapText('사장님');
  await tapText('로그인');
  const onDash = await waitText('노하우', 20000);
  chk('T0', onDash, '사장 대시보드 진입', '로그인 후 사장 화면이 안 뜸');
  await shot('00-dashboard');

  // ── 노하우 등록 → 시트 ─────────────────────────────────────
  console.log('\n[1] 노하우 등록 → 저장 전 확인 시트');
  await page.goto(`${BASE}/owner/coach`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const input = page.locator('input, textarea').last();
  await input.waitFor({ state: 'visible', timeout: 15000 });
  await input.click();
  await input.pressSequentially('마감할 때 원두 그라인더 호퍼를 비우고 솔로 청소해요', { delay: 8 });
  // multiline TextInput이라 Enter는 줄바꿈 — 전송은 ↑ 버튼으로만 된다.
  await page.getByText('↑', { exact: true }).first().click();
  await page.waitForTimeout(4000);
  await shot('01-coach-after-input');

  // 꼬리질문이 붙으면 '이대로 충분해요'로 조기 종료
  if (await seeText('이대로 충분해요')) { await tapText('이대로 충분해요'); await page.waitForTimeout(2000); }
  await shot('02-coach-ready');

  const publishBtn = page.getByText('노하우로 저장', { exact: false }).first();
  const hasPublish = await publishBtn.isVisible().catch(() => false);
  chk('T1a', hasPublish, '발행 CTA(노하우로 저장) 노출', '카드가 안 만들어짐 — mock 구조화 실패 가능');
  if (!hasPublish) throw new Error('발행 CTA 없음 — 이후 시트 검증 불가');
  // 프레임 바깥(좌측 여백) 픽셀을 시트 열기 "전"에 떠둔다 — 열고 난 뒤와 비교해 이탈을 판정한다.
  // 프레임은 (1280-460)/2 = x410 에서 시작한다. 경계 바로 옆 70px 은 프레임 자체의 그림자가
  // 시트 elevation 때문에 짙어지는 정상 구간이라 제외한다 — 여기까지 넣으면 오진이 난다.
  const outsideStrip = { x: 0, y: 300, width: 340, height: 560 };
  const beforeOutside = await page.screenshot({ clip: outsideStrip });
  await publishBtn.click();

  const sheetUp = await waitText('저장 전 확인', 10000);
  await page.waitForTimeout(1200); // slide 애니메이션이 끝난 뒤 측정·촬영(이르면 화면 밖에 있다)
  chk('T1', sheetUp, '저장 전 확인 시트가 뜬다', '시트가 안 뜸(발행이 그대로 진행됐을 수 있음)');
  await shot('03-sheet');

  // ── T2 프레임 가둠 ─────────────────────────────────────────
  console.log('\n[2] 460px 모바일 프레임 가둠(RN Modal 이탈 함정)');
  // RN Modal의 루트 컨테이너는 뷰포트 전폭이지만 **투명**하다(보이지도, 칠해지지도 않음).
  // 실제 이탈은 "칠해진 것"이 프레임을 넘을 때만 생긴다 → 배경색/그림자가 있는 요소만 본다.
  const frame = await page.evaluate(() => {
    const vw = window.innerWidth;
    const painted = (cs) => {
      const bg = cs.backgroundColor || '';
      const m = bg.match(/rgba?\(([^)]+)\)/);
      const alpha = m ? Number(m[1].split(',')[3] ?? 1) : 0;
      return (bg && bg !== 'transparent' && alpha > 0.01) || (cs.boxShadow && cs.boxShadow !== 'none');
    };
    // 검사 범위는 "시트의 조상 사슬"뿐 — 프레임 바깥 페이지 배경(전폭·칠해짐)은 설계상 정상이라
    // 문서 전체를 훑으면 그게 잡혀 오진이 난다. 모달은 포털이라 조상 사슬 = 모달 컨테이너들이다.
    const label = [...document.querySelectorAll('div')].find((el) => el.textContent?.trim() === '저장 전 확인');
    const wide = [];
    let sheetW = null;
    for (let el = label; el; el = el.parentElement) {
      const w = el.getBoundingClientRect().width;
      const cs = getComputedStyle(el);
      if (w > 520 && painted(cs)) wide.push({ w: Math.round(w), bg: cs.backgroundColor });
      if (w <= 520) sheetW = Math.round(w);
    }
    return { vw, wide: wide.slice(0, 6), sheetW };
  });
  // RNW의 <Modal>은 진짜 포털이 아니라 앱 트리 안에 렌더된다 → 조상 사슬에 앱 셸 배경(전폭·칠해짐)이
  // 섞여 DOM 폭만으로는 이탈을 판정할 수 없다(그 착각으로 오진이 났었다). 픽셀로 확정한다:
  // 프레임 바깥 영역이 시트 열기 전후로 1픽셀도 안 변하면, 딤·시트는 프레임 안에 갇힌 것이다.
  const afterOutside = await page.screenshot({ clip: outsideStrip });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${SHOTS}/strip-before.png`, beforeOutside);
  writeFileSync(`${SHOTS}/strip-after.png`, afterOutside);
  chk('T2a', Buffer.compare(beforeOutside, afterOutside) === 0, '프레임 바깥 픽셀이 시트 전후로 불변(딤·시트 갇힘)',
    `프레임 밖 ${outsideStrip.width}x${outsideStrip.height} 영역이 변했다 — 딤이나 시트가 새고 있음`);
  chk('T2b', frame.sheetW !== null && frame.sheetW <= 460, `시트 본체 폭이 460px 이하 (${frame.sheetW}px)`,
    `시트 폭 ${frame.sheetW}px — 프레임(460) 초과`);

  // ── T3 챕터 칩 선택/해제 ───────────────────────────────────
  // 칩은 aria-label(accessibilityLabel)로 집는다 — 본문에 '마감'이 들어간 채팅 말풍선과 헷갈리지 않게.
  console.log('\n[3] 챕터 칩 선택/해제');
  const chip = (n) => page.getByLabel(`챕터 ${n}`, { exact: true }).first();
  const stdChips = await page.getByLabel(/^챕터 /).count();
  chk('T3z', stdChips >= 9, `표준 챕터 칩이 노출된다 (${stdChips}개)`, '칩이 안 그려짐');
  const beforePick = await seeText('챕터 없이 저장');
  await chip('마감').click();
  await page.waitForTimeout(500);
  const afterPick = await waitText('«마감»에 저장', 5000);
  chk('T3a', beforePick && afterPick, '칩 선택 시 저장 버튼 문구가 «마감»에 저장으로 바뀜',
    `before(챕터 없이 저장)=${beforePick} after(«마감»에 저장)=${afterPick}`);
  await chip('마감').click();
  await page.waitForTimeout(500);
  const afterUnpick = await seeText('챕터 없이 저장');
  chk('T3b', afterUnpick, '같은 칩 재탭 시 선택 해제', '해제되지 않음');
  await shot('04-chip');

  // ── T4 직접 추가 유사 챕터 되묻기 ──────────────────────────
  console.log('\n[4] 직접 추가 — 유사 챕터 1회 되묻기');
  await page.getByLabel('챕터 직접 추가', { exact: true }).first().click();
  await page.waitForTimeout(500);
  const nameInput = page.getByPlaceholder('새 챕터 이름', { exact: false }).first();
  await nameInput.waitFor({ state: 'visible', timeout: 8000 });
  await nameInput.click();
  await nameInput.pressSequentially('진상 응대', { delay: 10 });
  await page.getByLabel('챕터 만들기', { exact: true }).first().click();
  await page.waitForTimeout(700);
  const asked = await waitText('이미 «고객 응대» 챕터가 있어요', 5000);
  chk('T4a', asked, '유사 챕터(고객 응대) 감지 후 되묻는다', '경고가 안 뜸 — labelSimilarity 임계값 확인 필요');
  await shot('05-similar-warn');
  const hasUseBtn = await seeText('«고객 응대»에 넣기');
  chk('T4b', hasUseBtn, '"«고객 응대»에 넣기" 대안 제시', '대안 버튼 없음');
  await page.getByLabel('챕터 만들기', { exact: true }).first().click(); // 재확인 = "그래도 만들기"
  await page.waitForTimeout(700);
  const forced = await waitText('«진상 응대»에 저장', 5000);
  chk('T4c', forced, '재확인하면 새 챕터로 통과', '"그래도 만들기"가 안 먹힘');
  await shot('06-forced-new');

  // ── T5 취소 → 재시도 ───────────────────────────────────────
  console.log('\n[5] 취소 후 재시도(발행 잠금 해제)');
  const cancelBtn = page.getByLabel('저장 취소', { exact: true }).first();
  chk('T5z', await cancelBtn.isVisible().catch(() => false), '명시적 "취소" 버튼이 있다',
    '딤 탭 말고는 저장을 접을 방법이 없음');
  // 푸터가 시트 폭을 꽉 채우는가 — PressableScale은 style을 안쪽 View에 넘겨 flex가 죽는다(실제로 겪음).
  const foot = await page.evaluate(() => {
    const byLabel = (l) => document.querySelector(`[aria-label="${l}"]`)?.getBoundingClientRect();
    const c = byLabel('저장 취소'), s = byLabel('노하우 저장');
    return c && s ? { gap: Math.round(s.left - c.right), cancelR: Math.round(c.right), saveR: Math.round(s.right), saveW: Math.round(s.width) } : null;
  });
  const sheetRight = 1280 / 2 + 460 / 2; // 프레임 오른쪽 경계
  chk('T5y', foot !== null && Math.abs(foot.saveR - (sheetRight - 20)) <= 4,
    `저장 버튼이 남은 폭을 채운다 (오른쪽 끝 ${foot?.saveR}px, 기대 ${sheetRight - 20}px)`,
    `저장 버튼이 내용 크기로 쪼그라듦 — flex 미적용: ${JSON.stringify(foot)}`);
  await cancelBtn.click();
  await page.waitForTimeout(1500);
  const closed = !(await seeText('저장 전 확인'));
  chk('T5a', closed, '취소하면 시트가 닫힌다', '시트가 안 닫힘');
  const retryBtn = page.getByText('노하우로 저장', { exact: false }).first();
  const canRetry = await retryBtn.isVisible().catch(() => false);
  chk('T5b', canRetry, '취소 후 발행 CTA가 살아있다(잠금 해제)', 'CTA가 사라짐 — publishedRef가 잠긴 채 남음');
  if (canRetry) {
    await retryBtn.click();
    const reopened = await waitText('저장 전 확인', 8000);
    chk('T5c', reopened, '다시 저장 시도 시 시트가 재노출', '재시도 불가 — 사장이 저장을 못 하게 됨');
  }
  await shot('07-retry');

  // ── T6 저장 → 매뉴얼 탭에 챕터로 반영 ──────────────────────
  console.log('\n[6] 저장 → 매뉴얼 탭 section 반영');
  await chip('마감').click();
  await page.waitForTimeout(500);
  await page.getByLabel('노하우 저장', { exact: true }).first().click();
  await page.waitForTimeout(3500);
  await shot('08-saved');

  // ★ page.goto 금지: 목 모드 스토어는 인메모리라 전체 새로고침이면 방금 저장한 게 날아간다
  //   (실제로 그 착각으로 "section 미반영" 오진이 났었다). 발행 후 앱이 이미 노하우 화면으로 보낸다.
  await waitText('내 노하우', 15000);
  await tapText('매뉴얼');
  await page.waitForTimeout(1500);
  await shot('09-manual');
  // '마감'이라는 낱말은 기존 노하우 제목에도 있어 화면 텍스트로는 판정이 약하다 →
  // 챕터 헤딩(■ 마감)이 실제로 생겼는지는 아래 T8b 클립보드에서 확정한다.
  const headings = await page.getByText('마감', { exact: true }).count();
  chk('T6a', headings > 0, '매뉴얼에 «마감» 챕터 헤딩이 생김', '챕터 헤딩 없음 — section 미반영 의심');

  // ── T8 매뉴얼 복사 ─────────────────────────────────────────
  console.log('\n[7] 매뉴얼 전체 복사');
  const copyVisible = await seeText('매뉴얼 전체 복사');
  chk('T8a', copyVisible, '웹에서 "매뉴얼 전체 복사" 버튼 노출', '버튼이 안 보임(canCopyToClipboard=false?)');
  if (copyVisible) {
    await tapText('매뉴얼 전체 복사');
    await page.waitForTimeout(1200);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    chk('T8b', clip.includes('운영 매뉴얼') && clip.includes('■'), '클립보드에 매뉴얼 평문이 들어감',
      `클립보드 앞부분: ${JSON.stringify(clip.slice(0, 80))}`);
    // section 반영의 확정 증거 — 방금 «마감»으로 저장한 노하우가 그 챕터 아래 실려야 한다.
    const secIdx = clip.indexOf('■ 마감');
    const underMagam = secIdx >= 0 && clip.slice(secIdx, clip.indexOf('■', secIdx + 1) < 0 ? undefined : clip.indexOf('■', secIdx + 1)).includes('그라인더');
    chk('T6b', secIdx >= 0, '내보낸 매뉴얼에 «■ 마감» 챕터가 존재', '챕터가 안 만들어짐 — section 미저장');
    chk('T6c', underMagam, '방금 저장한 노하우가 «마감» 챕터 아래에 실림', '다른 챕터(기타)로 떨어짐');
    console.log('\n--- 클립보드(챕터 헤딩만) ---\n' + clip.split('\n').filter((l) => l.startsWith('■')).join('\n') + '\n---');
    const copiedFeedback = await seeText('복사됐어요');
    chk('T8c', copiedFeedback, '복사 후 "복사됐어요" 피드백', '피드백 없음');
  }
  await shot('10-copied');

} catch (e) {
  fail++;
  results.push(['EXC', '스크립트 예외', 'FAIL', e.message]);
  console.log('\n✗ 예외: ' + e.message);
  await shot('99-exception').catch(() => {});
}

// ── T9 console error ─────────────────────────────────────────
const realErrors = errors.filter((e) => !/favicon|Download the React DevTools|ResizeObserver/i.test(e));
chk('T9', realErrors.length === 0, 'console error 0건', `${realErrors.length}건: ${realErrors.slice(0, 3).join(' | ').slice(0, 300)}`);

console.log('\n' + '='.repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed   (스크린샷: ${SHOTS})`);
console.log('='.repeat(60));
for (const [id, name, r, d] of results) console.log(`${r === 'PASS' ? '✅' : '❌'} ${id.padEnd(5)} ${name}${d ? '  — ' + d : ''}`);

await browser.close();
process.exit(fail === 0 ? 0 : 1);
