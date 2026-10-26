// qa-oracles.mjs — 범용 오라클 R1~R11(2026-10-17 메가프롬프트_오류탐지_범용오라클 §2-2).
//
// "어떤 화면이든 참이어야 하는 것" 만 둔다. 케이스별 기대값("이 화면엔 이 버튼이 있어야")은 여기 넣지 않는다 — 그건 여정 하니스 몫.
// 쓰는 곳: scripts/qa-crawl.mjs. 여정 하니스가 같은 판정을 쓰고 싶으면 import 한다(이번엔 안 고친다).
//
// 구조: PROBE(브라우저에서 한 번 실행해 화면 스냅샷을 뽑는 JS 문자열) + 스냅샷을 받아 판정하는 순수 함수들.
// 판정 결과 모양은 전부 { status: 'pass' | 'fail' | 'warn' | 'skip', detail: string[] } 이다.
//
// ★R2 '뷰포트 밖' 은 "스크롤해도 닿을 수 없음" 으로 잰다 — 목록 아래쪽 행은 뷰포트 밖이지만 정상이다.
// ★R2 '가려짐' 은 완전히 뷰포트 안에 든 요소만 잰다 — 반쯤 잘린 요소의 중심은 다른 요소를 찍는다(거짓 실패).
// ★R3 는 getBoundingClientRect 만 본다 — RN-web 은 hitSlop 을 무시한다(메모리 project_squaretable_rnweb_hitslop).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RULES = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12'];
export const RULE_TITLES = {
  R1: '콘솔 에러 0 · ≥400 응답 0',
  R2: '누를 수 있는 요소가 전부 보인다(0크기·닿을 수 없음·가려짐 없음)',
  R3: '누를 수 있는 요소 44×44 이상(44~47 경고)',
  R4: '16자 이하 글자가 접히지 않는다',
  R5: '"0개·0건·0명"·"알바"·느낌표·그림 이모지 0건',
  R6: '빈 상태 문구 옆에 다음 행동 버튼이 있다',
  R7: '뒤로가기가 막히지 않는다',
  R8: '같은 라벨의 숫자는 한 화면에서 같다',
  R9: '로딩 중 빈 상태 문구가 스치지 않는다',
  R10: '역할 경계(다른 역할 화면이 한 프레임도 안 보인다)',
  R11: '460px 프레임 가로 넘침 0',
  R12: '내부 값(영문 코드·밑줄 식별자·오류 원문·undefined·UUID)이 화면 글자에 없다',
};

export const CLICKABLE_SEL = 'button,[role="button"],a[href],[role="link"],[role="tab"],[role="menuitem"],input[type="button"],input[type="submit"]';

/** 브라우저에서 실행하는 스냅샷 수집기. 한 화면을 한 번 읽고 끝낸다(판정은 Node 쪽 순수 함수).
 *  sel = "누를 수 있는 요소" 선택자. role 없는 Pressable(칩 등)은 div[tabindex="0"] 로만 보인다 — 넣을지는 쓰는 쪽이 정한다. */
export const probeFor = (sel) => `(() => {
  const W = innerWidth, H = innerHeight, SEL = ${JSON.stringify(sel)};
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const hiddenByAncestor = (el) => { for (let a = el; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none' || cs.visibility === 'hidden' || a.getAttribute('aria-hidden') === 'true') return true; } return false; };
  const scrollerY = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) return a; } return null; };
  const scrollerX = (el) => { for (let a = el.parentElement; a; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1) return a; } return null; };
  const label = (el) => norm(el.getAttribute('aria-label') || el.innerText).slice(0, 40) || ('<' + el.tagName.toLowerCase() + (el.dataset && el.dataset.testid ? '#' + el.dataset.testid : '') + '>');
  const leaves = (root) => [...root.querySelectorAll('*')].filter((e) => e.children.length === 0 && norm(e.textContent));

  // ── 누를 수 있는 요소 ──
  const transformed = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const tf = getComputedStyle(a).transform; if (tf && tf !== 'none' && tf !== 'matrix(1, 0, 0, 1, 0, 0)') return true; } return false; };
  const clickables = [];
  const els = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (hiddenByAncestor(el)) continue;
    const r = el.getBoundingClientRect();
    const item = { t: label(el), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      nested: !!(el.parentElement && el.parentElement.closest(SEL)), back: el.getAttribute('aria-label') === '뒤로' };
    clickables.push(item); els.push(el);
    if (!r.width || !r.height) { item.zero = true; continue; }
    const inView = r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
    if (!inView) {
      let reach = true;
      if (r.right <= 0 || r.left >= W) {
        const hs = scrollerX(el);
        if (!hs) reach = false;
        else { const sr = hs.getBoundingClientRect(); const off = r.left - sr.left + hs.scrollLeft; if (off + r.width <= 0 || off >= hs.scrollWidth) reach = false; }
      }
      if (reach && (r.bottom <= 0 || r.top >= H)) {
        const s = scrollerY(el);
        if (s) { const sr = s.getBoundingClientRect(); const off = r.top - sr.top + s.scrollTop; if (off + r.height <= 0 || off >= s.scrollHeight) reach = false; }
        else { const se = document.scrollingElement; const off = r.top + se.scrollTop; if (se.scrollHeight <= se.clientHeight + 1 || off + r.height <= 0 || off >= se.scrollHeight) reach = false; }
      }
      item.off = true; item.unreachable = !reach;
      // transform 으로 움직이는 것(흐르는 배너 등)은 시간이 지나면 들어온다 — '닿을 수 없음' 판정에서 뺀다(판정 정확도 · 10-17 1차).
      if (!reach && transformed(el)) item.moving = true;
    }
  }
  // 하단 탭바 추정 = 화면 맨 아래에 붙은 높이 90 이하 버튼이 3개 이상. 그 위 영역은 스크롤 콘텐츠가 지나가는 자리다.
  //   (탭 항목 아래에 안전 영역 여백이 붙는다 — 바닥에서 24px 안이면 바닥에 붙은 것으로 본다.)
  const bottom = clickables.filter((c) => !c.zero && !c.off && c.y + c.h >= H - 24 && c.h <= 110 && c.y >= H - 110);
  let tabTop = H;
  if (bottom.length >= 3) for (const c of bottom) { c.tab = true; tabTop = Math.min(tabTop, c.y); }
  // 가려짐 — 뷰포트(탭바 위)에 **완전히** 든 요소만 잰다. 반쯤 잘린 요소의 중심은 다른 요소를 찍는다.
  // 덮은 것이 바닥에 붙은 전체 폭 띠(탭바·하단 고정 바)면 그 아래를 지나가는 스크롤 콘텐츠다 → 부분 노출로 본다.
  clickables.forEach((item, i) => {
    if (item.zero || item.off || item.tab) return;
    const el = els[i]; const r = el.getBoundingClientRect();
    const full = r.top >= 0 && r.bottom <= tabTop && r.left >= 0 && r.right <= W;
    if (!full) { item.partial = true; return; }
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    if (!top) { item.covered = '(없음)'; return; }
    if (el === top || el.contains(top)) return;
    const tr = top.getBoundingClientRect();
    if (tr.width >= W * 0.9 && tr.bottom >= H - 24 && tr.top > r.top && tr.top >= H - 140) { item.partial = true; return; }
    // 덮은 것이 떠 있는 작은 버튼(FAB)이고 대상이 스크롤 목록 안이면, 내리면 비켜난다 → 부분 노출(10-20 /owner/training 실측 · 사용자 결정).
    const cover = top.closest(SEL); const sc = scrollerY(el);
    if (cover && sc && !sc.contains(cover)) {
      const cr = cover.getBoundingClientRect(); const cp = getComputedStyle(cover).position;
      if ((cp === 'absolute' || cp === 'fixed') && cr.width <= 80 && cr.height <= 80) { item.partial = true; return; }
    }
    // 덮은 것이 버튼 안의 아이콘이면 그 버튼 이름으로 적는다(FAB '퀴즈 만들기' 가 목록 행 톱니를 덮은 10-17 실측).
    item.covered = label(top.closest(SEL) || top) + (top.contains(el) ? '(clipped)' : '');
  });

  // ── 접힌 짧은 글자(qa-hq-structure J 묶음 그대로) ──
  const folded = [];
  for (const e of document.querySelectorAll('div[dir="auto"],span[dir="auto"]')) {
    if (e.querySelector('div[dir="auto"],span[dir="auto"]')) continue;
    const t = (e.innerText || '').trim(); if (!t || t.length > 16 || t.includes('\\n')) continue;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(e); const fs = parseFloat(cs.fontSize); const lh = cs.lineHeight === 'normal' ? fs * 1.35 : parseFloat(cs.lineHeight);
    if (r.height > lh * 1.6) folded.push(t + '(' + Math.round(r.width) + '×' + Math.round(r.height) + ')');
  }

  // ── 글자 잎(보이는 것만) — R6·R8 용 ──
  const vleaves = leaves(document.body).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const leafTexts = vleaves.map((e) => norm(e.textContent));
  // ── R8 용 "라벨 + 숫자" 수집 ──
  // 반복 행(매장 목록 카드마다 '받은질문 n')은 같은 라벨에 값이 달라도 모순이 아니다. 반복 = 잎에서 위로 올라가다가,
  // 어떤 조상의 **형제**(같은 태그 · 클래스가 60% 이상 겹침 — 강조 카드는 테두리 클래스 하나만 다르다)가 같은 라벨을 품고 있으면 그 부모가 반복 묶음이다.
  // 탭 배지('할 일'+4)와 세그먼트('할 일 33')는 형제가 닮지 않아 각자 단독 묶음 → 값이 다르면 모순.
  const classes = (e) => new Set(String(e.className || '').split(/\\s+/).filter(Boolean));
  const similar = (a, b) => { if (a.tagName !== b.tagName) return false; const A = classes(a), B = classes(b); if (!A.size && !B.size) return true; let i = 0; for (const c of A) if (B.has(c)) i++; return i / Math.max(A.size, B.size) >= 0.6; };
  let solo = 0;
  const pids = new Map();
  const repeatKey = (leaf, lab) => {
    for (let a = leaf; a && a !== document.body; a = a.parentElement) {
      const p = a.parentElement; if (!p) break;
      for (const sib of p.children) {
        if (sib === a || !similar(sib, a)) continue;
        if ((sib.textContent || '').includes(lab)) { if (!pids.has(p)) pids.set(p, pids.size + 1); return 'rep' + pids.get(p); }
      }
    }
    return 'solo' + (++solo);
  };
  const numbered = [];
  for (const e of vleaves) {
    const t = norm(e.textContent);
    const m = t.match(/^(.{1,12}?)\\s+(\\d{1,4})$/) || t.match(/^(.{1,12}?)\\s*(\\d{1,4})\\s*(?:건|개|명)$/);
    if (m) numbered.push({ label: m[1], n: Number(m[2]), g: repeatKey(e, m[1]) });
  }
  // 탭·버튼처럼 "라벨 잎 + 숫자 잎" 둘로 된 요소(배지)
  for (const el of document.querySelectorAll(SEL)) {
    if (hiddenByAncestor(el)) continue;
    const le = leaves(el); const ls = le.map((e) => norm(e.textContent));
    if (ls.length === 2) { const n = ls.findIndex((x) => /^\\d{1,4}$/.test(x)); if (n >= 0 && !/^\\d+$/.test(ls[1 - n])) numbered.push({ label: ls[1 - n], n: Number(ls[n]), g: repeatKey(le[1 - n], ls[1 - n]) }); }
  }

  const se = document.scrollingElement || document.documentElement;
  return {
    path: location.pathname, W, H,
    text: document.body.innerText || '',
    clickables, folded, leafTexts, numbered,
    scrollWidth: Math.max(se.scrollWidth, document.body.scrollWidth, document.documentElement.scrollWidth),
  };
})()`;
export const PROBE = probeFor(CLICKABLE_SEL);

/** 첫 사용 팝업을 미리 끄는 localStorage 문장(try 안에 넣어 쓴다). seedSession 이 문서마다 저장소를 비워 매 화면 다시 뜨고,
 *  덮개가 버튼을 가리면 R2 가 전부 '가려짐' 이 된다(10-17 1차 실측). 키는 소스에서 읽는다(손으로 베끼지 않음).
 *  · 직원 환영 코치 `sqt.juniorCoachSeen` · 화면 가이드 `sqt.tour.v1`(id = guideContent.ts) · 무료 기간 안내(키 = FreeUntilNotice.tsx — 로컬 DB 는 무료 모드라 뜬다) */
export function firstRunSeedJs(root) {
  const guideIds = [...new Set([...readFileSync(join(root, 'src/lib/guides/guideContent.ts'), 'utf8').matchAll(/'([a-z]+_[a-z_]+_v\d+)'/g)].map((m) => m[1]))];
  const tourSeen = JSON.stringify(Object.fromEntries(guideIds.map((id) => [id, true])));
  const noticeKey = readFileSync(join(root, 'src/components/FreeUntilNotice.tsx'), 'utf8').match(/NOTICE_KEY = '([^']+)'/)?.[1];
  if (!noticeKey) throw new Error('FreeUntilNotice.tsx 에서 NOTICE_KEY 를 못 찾았다 — firstRunSeedJs 를 고친다');
  return `localStorage.setItem('sqt.juniorCoachSeen','1');localStorage.setItem('sqt.tour.v1',${JSON.stringify(tourSeen)});localStorage.setItem(${JSON.stringify(noticeKey)},'1');`;
}

/** 안정 = 글자가 있고 · ScreenLoading(progressbar) 없음 · 진입 스플래시(SplashAnimation: '매장의 정석'+'우리 매장 운영의 기준' 덮개) 걷힘.
 *  쓰는 곳: qa-crawl · qa-layout-stress. page.waitFor(SETTLED) 로 쓴다. */
export const SETTLED = `(()=>{const b=document.body;if(!b)return false;const t=(b.innerText||'').trim();if(!t.length)return false;if(document.querySelector('[role="progressbar"]'))return false;if(/우리 매장 운영의 기준/.test(t)||t.replace(/\\s+/g,'')==='매장의정석')return false;return true;})()`;

/** 가벼운 프레임 샘플 — R9(스친 빈 문구)·R10(역할 경계) 용. 자주 부르므로 싸게. */
export const FRAME_PROBE = `(() => {
  const SEL = ${JSON.stringify(CLICKABLE_SEL)};
  let buttons = 0;
  for (const el of document.querySelectorAll(SEL)) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) buttons++; }
  const text = document.body ? document.body.innerText || '' : '';
  return { path: location.pathname, buttons, textLen: text.trim().length, empties: (text.match(/[^\\n]*없어요[^\\n]*/g) || []).map((s) => s.trim()).slice(0, 5) };
})()`;

const res = (status, detail = []) => ({ status, detail });
const fmt = (c) => `"${c.t}" @${c.x},${c.y} ${c.w}×${c.h}`;

/** R1 — 진입 + 3초 동안 콘솔 에러·≥400 응답 0. errors: string[] · bad: string[] */
export function r1(errors, bad) {
  const d = [...errors.map((e) => `콘솔: ${e.slice(0, 160)}`), ...bad.map((b) => `HTTP ${b}`)];
  return res(d.length ? 'fail' : 'pass', d);
}

/** R2 — 누를 수 있는 요소가 전부 보인다. */
export function r2(snap) {
  const d = [];
  for (const c of snap.clickables) {
    if (c.zero) d.push(`0크기 ${fmt(c)}`);
    else if (c.unreachable && !c.moving) d.push(`닿을 수 없음 ${fmt(c)}`);
    else if (c.covered) d.push(`가려짐(${c.covered}) ${fmt(c)}`);
  }
  return res(d.length ? 'fail' : 'pass', d);
}

/** R3 — 보이는 요소 44×44 이상. 44~47 은 경고. 겹친(부모도 버튼) 안쪽 요소는 바깥이 터치 면적이므로 뺀다. */
export function r3(snap) {
  const fail = [];
  const warn = [];
  for (const c of snap.clickables) {
    if (c.zero || c.off || c.nested) continue;
    const m = Math.min(c.w, c.h);
    if (m < 44) fail.push(fmt(c));
    else if (m < 48) warn.push(fmt(c));
  }
  if (fail.length) return res('fail', fail.map((s) => `<44 ${s}`));
  if (warn.length) return res('warn', warn.map((s) => `44~47 ${s}`));
  return res('pass');
}

/** R4 — 16자 이하 글자가 줄높이×1.6 을 넘지 않는다. */
export function r4(snap) {
  const d = [...new Set(snap.folded)];
  return res(d.length ? 'fail' : 'pass', d);
}

// 기호(✓ ✕ · → 화살표·도형)는 워딩 규칙이 허용한다 — 그림 이모지만 금지(simplicity-voice C-이모지). ↗ 같은 대각 화살표도 기호다.
const EMOJI_ALLOW = new Set(['✓', '✔', '✕', '✗', '·', '→', '←', '↑', '↓', '↗', '↘', '↖', '↙', '↔', '↕', '©', '®', '™', '•', '※', '℃', '⏱', '▲', '▼', '△', '▽', '◀', '▶', '★', '☆']);
/** R5 — 워딩 금지어. text = body.innerText */
export function r5(text) {
  const d = [];
  const zero = text.match(/(?<![\d,.])0\s?(개|건|명)(?![\d])/g);
  if (zero) d.push(`"0개류" ${zero.length}건: ${ctx(text, /(?<![\d,.])0\s?(개|건|명)(?![\d])/).join(' | ')}`);
  const alba = text.match(/알바/g);
  if (alba) d.push(`"알바" ${alba.length}건: ${ctx(text, /알바/).join(' | ')}`);
  const bang = text.match(/[!！]/g);
  if (bang) d.push(`느낌표 ${bang.length}건: ${ctx(text, /[!！]/).join(' | ')}`);
  const emo = [...text.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]).filter((ch) => !EMOJI_ALLOW.has(ch));
  if (emo.length) d.push(`그림 이모지 ${emo.length}건: ${[...new Set(emo)].join(' ')}`);
  return res(d.length ? 'fail' : 'pass', d);
}
function ctx(text, re) {
  const out = [];
  for (const line of text.split('\n')) if (re.test(line)) { out.push(line.trim().slice(0, 50)); if (out.length >= 3) break; }
  return out;
}

/** R6 — 빈 상태 문구("…없어요")가 보이면 탭바·뒤로 말고 누를 것이 하나는 있다. */
export function r6(snap) {
  // "문제가 없어요·이상이 없어요" 는 상태 보고지 빈 목록이 아니다(10-17 1차 /billing 오탐).
  // "이 달 출퇴근 기록이 없어요" 는 누를 것이 없는 게 맞다(10-20 사용자 확인).
  const empties = snap.leafTexts.filter((t) => /없어요/.test(t) && !/(문제|이상)[가이] 없어요/.test(t) && !/출퇴근 기록이 없어요/.test(t));
  if (!empties.length) return res('skip', ['빈 상태 문구 없음']);
  const actions = snap.clickables.filter((c) => !c.zero && !c.unreachable && !c.covered && !c.tab && !c.back);
  if (actions.length) return res('pass', [`빈 문구 ${empties.length} · 행동 ${actions.length}`]);
  return res('fail', empties.map((e) => `"${e.slice(0, 40)}" 옆에 행동 버튼 0`));
}

/** R7 — 뒤로가기. before/after = pathname · stuck = 3초 뒤에도 같은 경로 · dead = 도착 화면에 글자·버튼이 없음 */
export function r7({ before, after, stuck, dead, how }) {
  if (stuck) return res('fail', [`${how}: ${before} 에서 안 움직임`]);
  if (dead) return res('fail', [`${how}: ${before} → ${after} (빈 화면)`]);
  return res('pass', [`${how}: → ${after}`]);
}

/** R8 — 같은 라벨의 숫자가 둘 이상 보이면 값이 같다. */
export function r8(snap) {
  const by = new Map();
  for (const { label, n, g } of snap.numbered ?? []) {
    const k = label.replace(/\s+/g, '').replace(/[:：()]/g, '');
    if (!/[가-힣]/.test(k) || /(월|일|시|분|초|년|호|층|번|회차|기)$/.test(k) || k.length > 12) continue;
    (by.get(k) ?? by.set(k, []).get(k)).push({ n, g });
  }
  // 반복 묶음(rep*) 안에서만 다른 값은 행마다 다른 값이다 — 묶음이 둘 이상일 때만 모순.
  const d = [...by].filter(([, xs]) => new Set(xs.map((x) => x.n)).size > 1 && new Set(xs.map((x) => x.g)).size > 1)
    .map(([k, xs]) => `"${k}" = ${[...new Set(xs.map((x) => x.n))].join(' vs ')}`);
  return res(d.length ? 'fail' : 'pass', d);
}

/** R9 — 진입 직후 샘플에 보였던 빈 문구가 안정된 뒤엔 없다 = 스쳤다. frames: FRAME_PROBE 결과[] · finalText */
export function r9(frames, finalText) {
  const seen = new Set(frames.flatMap((f) => f.empties));
  const d = [...seen].filter((s) => !finalText.includes(s)).map((s) => `스침: "${s.slice(0, 50)}"`);
  return res(d.length ? 'fail' : 'pass', d);
}

/** R10 — 역할 경계. forbidden = '/owner' | '/junior' (이 세션이 보면 안 되는 접두사) · frames · finalPath */
export function r10({ forbidden, frames, finalPath }) {
  const d = [];
  const leaked = frames.filter((f) => f.path.startsWith(forbidden) && f.buttons > 0);
  if (leaked.length) d.push(`${forbidden} 화면이 ${leaked.length}프레임 보임(버튼 ${Math.max(...leaked.map((f) => f.buttons))}개 · ${leaked[0].path})`);
  if (finalPath.startsWith(forbidden)) d.push(`최종 경로가 ${finalPath}`);
  return res(d.length ? 'fail' : 'pass', d.length ? d : [`→ ${finalPath}`]);
}

/** R12 — 내부 값 노출(2026-10-26 · 업종 영문 코드 'cafe' 가 칩·안내 문장에 그대로 나간 사고).
 *  DB 코드값·식별자·오류 원문은 사용자 화면에 나가면 안 된다(AGENTS.md ⑨). 글자 잎(leafTexts) 단위로 본다.
 *  이메일·주소는 지우고 본다(owner@pilot… 의 영문은 사용자 값이다). 사용자가 쓴 영문 이름("Local pilot")은 대문자·공백이 섞여 걸리지 않는다.
 *  하니스가 QA 매장에 심은 행의 꼬리표("[UIQA link_match] …")는 그 부분만 지우고 나머지 글자는 그대로 본다(10-26 첫 전수 실측).
 *  ★ 새 오탐이 나오면 규칙을 넓히지 말고 그 낱말을 R12_ALLOW 에 근거와 함께 더한다. */
const R12_ALLOW = new Set([]);
const R12_PATTERNS = [
  ['영문 코드', /^[a-z][a-z0-9]*$/], // 글자 칸 전체가 소문자 낱말 하나 — 칩·배지·라벨에 코드값을 그대로 그린 모양('cafe' · 'owner')
  ['영문 코드+한글', /(?:^|\s)[a-z][a-z0-9]{1,}\s+[가-힣]/], // 'cafe 매장에서' 처럼 코드값이 한글 문장 앞에 끼어든 모양
  ['밑줄 식별자', /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/i], // store_001 · rename_limit · owner_cannot_join
  ['오류 원문', /PGRST\d+|SQLSTATE|violates|duplicate key|permission denied|null value in column|relation "|function public\.|JWT|TypeError|Failed to fetch|Internal Server Error/i],
  ['빈 값 출력', /(?:^|[^A-Za-z])(undefined|null|NaN)(?:[^A-Za-z]|$)|\[object Object\]/],
  ['UUID', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
];
export function r12(snap) {
  const d = [];
  for (const raw of new Set(snap.leafTexts ?? [])) {
    const t = raw.replace(/\[(?:UI)?QA\b[^\]]*\]/g, ' ').replace(/\S+@\S+\.\S+/g, ' ').replace(/https?:\/\/\S+|\b[\w-]+\.(?:com|app|kr|net|io)\b\S*/g, ' ').trim();
    if (!t || R12_ALLOW.has(t)) continue;
    for (const [name, re] of R12_PATTERNS) {
      const m = t.match(re);
      if (m && !R12_ALLOW.has(m[0].trim())) { d.push(`${name}: "${t.slice(0, 40)}"`); break; }
    }
  }
  return res(d.length ? 'fail' : 'pass', d.slice(0, 8));
}

/** R11 — 가로 넘침. */
export function r11(snap, slack = 4) {
  return snap.scrollWidth <= snap.W + slack ? res('pass') : res('fail', [`scrollWidth ${snap.scrollWidth} > ${snap.W}`]);
}
