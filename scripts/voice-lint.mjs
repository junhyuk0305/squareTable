// 워딩 린트 — 화면에 나가는 문자열이 워딩 규칙을 지키는지 잰다.
//
// 규칙 정본(SSOT) = .claude/rules/voice-rules.json  ← 규칙을 고칠 곳은 여기 하나뿐이다.
// 사람용 근거     = 기획/ux/워딩_기준_2026-07-29.md
//
// ★이 스크립트가 존재하는 이유: 워딩 기준 10장이 있는데도 지켜진 건 "기계로 잴 수 있게
//   써둔 것"(느낌표·금지어)뿐이었다. 문장 규칙은 매번 기본값(AI 문체)으로 돌아갔다.
//
// ★함정 1 — 주석을 걷지 않으면 죽는다.
//   src 에서 "알바"를 grep 하면 49건이 나오지만 전부 주석·식별자다. 출력 텍스트는 0건이다.
//   주석을 안 걷으면 오탐 49건으로 시작해 아무도 안 쓰게 된다. → 아래 extract() 는 문자열/
//   JSX 텍스트만 뽑고 주석은 상태기계로 버린다.
//
// ★함정 2 — 기존 위반을 전부 막으면 아무도 못 지나간다.
//   "등록"은 이미 115건 있고 ADR-001 이 흐름 단위 전환을 지시한다. 그래서 severity:"ratchet"
//   은 baseline 보다 늘 때만 실패한다(npm run ia 의 블록 래칫과 같은 방식).
//
// 사용:
//   npm run voice            위반 검사 (CI 게이트)
//   npm run voice:report     같이 보이는 문구를 화면별로 나란히 출력 (사람 검수용)
//   npm run voice -- --update  현재 수치를 baseline 으로 박는다 (줄었을 때만 쓴다)
//   npm run voice -- --sync    .claude/rules/simplicity-voice.md 의 워딩 절을 규칙에서 재생성

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RULES_PATH = join(ROOT, '.claude/rules/voice-rules.json');
const BASELINE_PATH = join(ROOT, '.claude/rules/voice-baseline.json');
const ENFORCED_PATH = join(ROOT, '.claude/rules/simplicity-voice.md');

const argv = process.argv.slice(2);
const MODE_UPDATE = argv.includes('--update');
const MODE_REPORT = argv.includes('--report');
const MODE_SYNC = argv.includes('--sync');

if (!existsSync(RULES_PATH)) {
  // .claude/rules/ 는 gitignore 대상(저장소가 PUBLIC)이다. 클론한 곳엔 없을 수 있다.
  console.error('규칙 파일이 없다: .claude/rules/voice-rules.json');
  console.error('내부 규칙이라 공개 저장소에 없다. 원본 작업 폴더에서 복사해 온다.');
  process.exit(2);
}
const RULES = JSON.parse(readFileSync(RULES_PATH, 'utf8'));

// ── 1. 파일 수집 ──────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (RULES.scan.skipDirs.includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (RULES.scan.ext.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

// ── 2. 추출기 — 주석을 버리고 화면에 나갈 문자열만 뽑는다 ────────
// 상태: normal / line comment / block comment / '  /  "  /  ` / JSX 텍스트
function extract(src) {
  const out = [];
  let i = 0, line = 1;
  const N = src.length;
  const push = (value, at) => { if (/[가-힣]/.test(value)) out.push({ value, line: at }); };
  // 정규식 리터럴 판별용 — '/' 앞의 마지막 의미 있는 글자
  let prev = '';
  const setPrev = (ch) => { if (!/\s/.test(ch)) prev = ch; };

  while (i < N) {
    const c = src[i], c2 = src[i + 1];

    if (c === '\n') { line++; i++; continue; }

    // 주석 — 통째로 버린다
    if (c === '/' && c2 === '/') { while (i < N && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < N && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }

    // 정규식 리터럴 — ★이걸 안 하면 /^https?:\/\// 의 \/ 가 주석으로 읽혀
    //   그 뒤 토큰이 통째로 어긋난다(첫 구현의 오탐 대부분이 여기서 나왔다).
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%~^'.includes(prev) || /\breturn$/.test(src.slice(Math.max(0, i - 6), i)))) {
      let j = i + 1, inClass = false, ok = false;
      while (j < N) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;                       // 정규식이 아니었다
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { ok = true; j++; break; }
        j++;
      }
      if (ok) { while (j < N && /[gimsuyd]/.test(src[j])) j++; i = j; prev = '/'; continue; }
    }

    // 문자열
    if (c === "'" || c === '"') {
      const quote = c, at = line; let buf = ''; let j = i + 1; let closed = false;
      while (j < N) {
        if (src[j] === '\\') { buf += src[j + 1] === 'n' ? '\n' : src[j + 1]; j += 2; continue; }
        if (src[j] === quote) { closed = true; j++; break; }
        if (src[j] === '\n') break;                  // 줄을 넘는 따옴표 = 토큰 어긋남
        buf += src[j++];
      }
      // 닫히지 않았으면 우리가 어긋난 것이다 — 버퍼를 버리고 한 글자만 전진해 복구한다
      if (!closed) { i++; prev = quote; continue; }
      i = j; prev = quote; push(buf, at); continue;
    }

    // 템플릿 리터럴 — ${...} 는 건너뛰고 literal 조각만 모은다
    if (c === '`') {
      const at = line; let buf = ''; i++;
      while (i < N && src[i] !== '`') {
        // 문자열 브랜치와 같게 \n 을 실제 줄바꿈으로 — 안 그러면 본문에 'n' 이 섞여
        // 글자수와 종결어미 판정이 어긋난다
        if (src[i] === '\\') { buf += src[i + 1] === 'n' ? '\n' : src[i + 1]; i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          push(buf, at); buf = '';
          i += 2; let depth = 1;
          while (i < N && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            else if (src[i] === '\n') line++;
            i++;
          }
          continue;
        }
        if (src[i] === '\n') line++;
        buf += src[i++];
      }
      i++; prev = '`'; push(buf, at); continue;
    }

    // JSX 텍스트 — <Text>여기<
    // ★함정: '>' 는 화살표(=>), 비교(>=), 제네릭(Array<T>)에도 나온다. 그대로 버퍼를 열면
    //   코드와 주석까지 통째로 삼켜 오탐이 폭발한다(첫 구현이 그랬다).
    //   → ① 화살표·비교는 앞 글자로 거르고 ② 버퍼에 코드 문자가 섞이면 통째로 버린다.
    if (c === '>' && src[i - 1] !== '=' && src[i - 1] !== '>' && src[i - 1] !== '<' && src[i - 1] !== '!') {
      // ★버퍼는 따옴표·백틱·세미콜론에서도 멈춰야 한다. 안 그러면 `a > b ? \`…\`` 같은
      //   비교식에서 버퍼가 백틱을 삼켜 템플릿 리터럴의 안팎이 뒤집힌다(실제로 그랬다).
      const STOP = `<{'"\`};`;
      const at = line; let buf = ''; let j = i + 1;
      while (j < N && !STOP.includes(src[j])) { if (src[j] === '\n') line++; buf += src[j++]; }
      i = j; prev = '>';
      // 코드 조각이 섞였으면 JSX 텍스트가 아니다
      if (!/[;=(){}[\]`'"\\]|\/\/|\/\*/.test(buf)) push(buf.trim(), at);
      continue;
    }

    setPrev(c);
    i++;
  }
  return out;
}

// 화면에 안 나가는 문자열 걸러내기
const NOISE = [
  /^[a-z-]+(-outline)?$/i,        // 아이콘 이름
  /^\/[a-z0-9/[\]-]*$/i,          // 라우트 경로
  /^#[0-9a-f]{3,8}$/i,            // 색
];
function isUiString(s, srcLine) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (NOISE.some((re) => re.test(t))) return false;
  if (/console\.(log|warn|error|info|debug)/.test(srcLine)) return false;  // 개발 로그
  if (/^\[[a-z]+\]/i.test(t)) return false;                                 // [push] 같은 로그 태그
  return true;
}

// ── 3. 규칙 적용 ──────────────────────────────────────────────
const EMOJI = /(\p{Extended_Pictographic})/u;   // 그림 이모지만. ✓ ✕ · → 는 안 걸린다

function violations(text, rule) {
  // 한 번에 하나만 뜨는 문구(에러·로딩·입력검증)는 규칙에 따라 제외한다.
  // 정본 §5.2 가 에러를 '2문장 이내'로 허용하므로 길이 상한과 정면으로 부딪힌다.
  if (rule.skipIf && new RegExp(rule.skipIf).test(text)) return [];
  if (rule.kind === 'emoji') return EMOJI.test(text) ? [text.match(EMOJI)[0]] : [];
  // 길이 상한 — '읽는 문장'만 잰다(명사형 라벨·목록 항목은 대상 아님)
  if (rule.maxLen) {
    const t = text.trim();
    if (!/(요|다|죠)[.?!]?$/.test(t)) return [];
    const n = [...t].length;
    return n > rule.maxLen ? [`${n}자`] : [];
  }
  const re = new RegExp(rule.pattern, rule.flags ? rule.flags + 'g' : 'g');
  const hits = [];
  for (const m of text.matchAll(re)) {
    const hit = m[0];
    if (rule.allow?.some((a) => text.includes(a) && text.indexOf(a) <= m.index && m.index < text.indexOf(a) + a.length)) continue;
    hits.push(hit);
  }
  return hits;
}

/**
 * '같이 보이는 것들'로 묶는다 — 줄 간격이 3 이내로 이어지는 문자열 뭉치.
 * 한 카드의 제목+설명은 같은 줄에, 카드끼리는 보통 1~2줄 간격으로 붙어 있다.
 * minLen 으로 본문급만 남긴다(배지·칩 같은 꼬리표를 섞으면 길이 편차가 무의미해진다).
 */
function clusters(strings, minLen) {
  const items = strings.filter((s) => [...s.value.trim()].length >= minLen).sort((a, b) => a.line - b.line);
  const out = [];
  let cur = [];
  for (const s of items) {
    if (cur.length && s.line - cur[cur.length - 1].line > 3) { out.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out;
}

const files = RULES.scan.roots.flatMap((r) => walk(join(ROOT, r)));
const legal = new Set(RULES.scan.legalFiles ?? []);
const exempt = new Set(RULES.scan.exemptFiles ?? []);
const isPrompt = (f) => (RULES.scan.promptPaths ?? []).some((p) => f.startsWith(p));
const isDemo = (f) => (RULES.scan.demoPaths ?? []).some((p) => f.startsWith(p));

const found = new Map();   // ruleId -> [{file, line, text, hit}]
const byFile = new Map();  // file   -> [strings]  (report 용)

for (const abs of files) {
  const f = rel(abs);
  if (exempt.has(f)) continue;
  const src = readFileSync(abs, 'utf8');
  const lines = src.split(/\r?\n/);
  const strings = extract(src).filter((s) => isUiString(s.value, lines[s.line - 1] ?? ''));
  if (strings.length) byFile.set(f, strings);

  for (const rule of RULES.rules) {
    if (rule.skipLegal && legal.has(f)) continue;
    // 프롬프트·데모는 금지어(word)만 잰다. 부호·문체는 화면 문장이 아니다.
    if (rule.kind !== 'word' && (isPrompt(f) || isDemo(f))) continue;

    // ── 묶음 규칙 — 문자열 하나가 아니라 '같이 보이는 것들'을 본다 ──────────
    // ★S5·S6 은 패턴 매칭으로 못 잡는다. 문장 하나만 보면 전부 멀쩡하고,
    //   나란히 놓았을 때만 "찍어낸 티"가 보인다. 그래서 지표(길이 편차·어미 반복)로 잰다.
    if (rule.kind === 'cluster') {
      // 한 번에 하나만 뜨는 문구(에러·로딩·입력검증)는 '같이 보이는 묶음'이 아니다
      const skipRe = rule.skipIf ? new RegExp(rule.skipIf) : null;
      const pool = skipRe ? strings.filter((s) => !skipRe.test(s.value)) : strings;
      for (const cl of clusters(pool, rule.minLen ?? 10)) {
        if (cl.length < (rule.minRun ?? 3)) continue;

        if (rule.endings) {
          // 같은 종결어미가 minRun 만큼 연달아 나오는가
          // ★어미는 마지막 '두 글자'로 본다. 마지막 한 글자만 보면 ~해요체에서 전부 '요'라
          //   우리 표준(§2.1)을 지킨 문장이 죄다 걸린다. 진짜 단조로움은 '해요/해요/해요'처럼
          //   어미 통째로 같을 때다(답해요 vs 쌓여요는 다른 호흡이다).
          const ends = cl.map((s) => (s.value.trim().match(/([가-힣]{2})[.?!]?["']?$/)?.[1] ?? ''));
          let run = 1;
          for (let k = 1; k <= ends.length; k++) {
            if (k < ends.length && ends[k] && ends[k] === ends[k - 1]) { run++; continue; }
            if (run >= (rule.minRun ?? 3) && ends[k - 1]) {
              const seg = cl.slice(k - run, k);
              if (!found.has(rule.id)) found.set(rule.id, []);
              found.get(rule.id).push({
                file: f, line: seg[0].line, hit: `~${ends[k - 1]} ×${run}`,
                text: seg.map((s) => s.value.trim()).join(' / ').slice(0, 90),
              });
            }
            run = 1;
          }
          continue;
        }

        // 길이 변동계수 — 고르면 찍어낸 것이다.
        // ★제목과 설명을 섞어 재면 편차가 커져 신호가 죽는다(카드 4장 = 제목 4 + 설명 4).
        //   ★길이로 가르면 안 된다 — 일부러 짧게 쓴 본문("사장님, 이건 어떻게 해요?")이
        //     제목으로 분류돼, 길이를 잘 흩뜨린 문구가 오히려 걸린다(실제로 그랬다).
        //   → 역할은 **종결어미**로 가른다. 문장형(~요./~다./물음표)=본문, 나머지=명사형 제목.
        //   ★명사형 제목은 대상이 아니다 — 라벨이 고른 길이인 것은 오히려 정돈된 것이다.
        //     문제는 '읽는 문장'이 똑같은 호흡으로 찍혀 나올 때다.
        const isBody = (s) => /[.?!]["']?$/.test(s.value.trim()) || /(요|다|죠|까)["']?$/.test(s.value.trim());
        for (const bucket of [cl.filter(isBody)]) {
          if (bucket.length < (rule.minRun ?? 3)) continue;
          const lens = bucket.map((s) => [...s.value.trim()].length);
          const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
          const cv = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) / mean;
          if (cv >= (rule.cvMax ?? 0.15)) continue;
          if (!found.has(rule.id)) found.set(rule.id, []);
          found.get(rule.id).push({
            file: f, line: bucket[0].line, hit: `${lens.join('·')}자 (편차 ${(cv * 100).toFixed(0)}%)`,
            text: bucket.map((s) => s.value.trim()).join(' / ').slice(0, 90),
          });
        }
      }
      continue;
    }

    for (const s of strings) {
      for (const hit of violations(s.value, rule)) {
        if (!found.has(rule.id)) found.set(rule.id, []);
        found.get(rule.id).push({ file: f, line: s.line, text: s.value.replace(/\n/g, ' ⏎ ').slice(0, 90), hit });
      }
    }
  }
}

// ── 4. --report : 같이 보이는 문구를 나란히 (H1·H2 사람 검수용) ──
if (MODE_REPORT) {
  const ranked = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length);
  const only = argv.find((a) => !a.startsWith('--'));
  for (const [f, strings] of ranked) {
    if (only && !f.includes(only)) continue;
    if (strings.length < 3) continue;
    console.log(`\n\x1b[36m${f}\x1b[0m  (${strings.length}개)`);
    const w = Math.min(70, Math.max(...strings.map((s) => s.value.length)));
    for (const s of strings) {
      const t = s.value.replace(/\n/g, ' ⏎ ');
      console.log(`  ${String(s.line).padStart(4)} │ ${t.slice(0, w)}${t.length > w ? '…' : ''}  \x1b[90m[${[...t].length}자]\x1b[0m`);
    }
  }
  console.log('\n같은 길이·같은 끝맺음이 3줄 이상 이어지면 H1(같은 틀) 위반을 의심한다.');
  process.exit(0);
}

// ── 5. --sync : 집행본(simplicity-voice.md)의 워딩 절을 규칙에서 재생성 ──
if (MODE_SYNC) {
  const BEGIN = '<!-- voice-rules:begin (자동 생성 — 고치지 말 것. .claude/rules/voice-rules.json 을 고친다) -->';
  const END = '<!-- voice-rules:end -->';
  const sev = { block: '차단', ratchet: '래칫', warn: '경고' };
  const body = [
    BEGIN,
    '',
    `### 워딩 규칙 (voice-rules.json v${RULES.version} 에서 생성 · ${RULES.updated})`,
    '',
    '`npm run voice` 가 잰다. 규칙을 고치려면 **json 만** 고치고 `npm run voice -- --sync`.',
    '',
    `#### 승인 어휘 ${RULES.vocabulary.length}개 — 이 밖의 신조어를 UI에 넣지 않는다`,
    '',
    '| 용어 | 뜻 | 비고 |',
    '|---|---|---|',
    ...RULES.vocabulary.map((v) => `| **${v.term}** | ${v.means} | ${v.note} |`),
    '',
    '새 용어가 필요하면 `voice-rules.json` 의 `vocabulary` 에 넣고 **기존 하나를 뺀다.**',
    '출퇴근·급여·공지처럼 사장이 이미 쓰는 일반어는 이 예산에 세지 않는다.',
    '',
    '#### 버튼 (ADR-001)',
    '',
    '| 자리 | 어휘 | |',
    '|---|---|---|',
    ...RULES.buttons.map((b) => `| ${b.slot} | **${b.word}** | ${b.eg} |`),
    '',
    '#### 기계가 재는 규칙',
    '',
    '| 규칙 | 판정 | 무엇을 | 어떻게 |',
    '|---|---|---|---|',
    ...RULES.rules.map((r) => `| \`${r.id}\` | ${sev[r.severity]} | ${r.why} | ${r.fix} |`),
    '',
    '**기계가 못 재는 것 — 사람이 본다** (`npm run voice:report`)',
    '',
    ...RULES.humanOnly.map((h) => `- \`${h.id}\` ${h.why}`),
    '',
    END,
  ].join('\n');

  let md = readFileSync(ENFORCED_PATH, 'utf8');
  md = md.includes(BEGIN)
    ? md.replace(new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}`), body)
    : md.trimEnd() + '\n\n---\n\n' + body + '\n';
  writeFileSync(ENFORCED_PATH, md);
  console.log('simplicity-voice.md 워딩 절 재생성 완료');
  process.exit(0);
}

// ── 6. 검사 결과 ──────────────────────────────────────────────
const counts = Object.fromEntries(RULES.rules.map((r) => [r.id, found.get(r.id)?.length ?? 0]));

if (MODE_UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify({ _: '워딩 잔존 수치. 늘면 실패, 줄이면 --update 로 다시 박는다.', updated: new Date().toISOString().slice(0, 10), counts }, null, 2) + '\n');
  console.log('baseline 갱신:', BASELINE_PATH);
  for (const [k, v] of Object.entries(counts)) if (v) console.log(`  ${k}: ${v}`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).counts : {};
let failed = 0, warned = 0;

// --rule S7 처럼 한 규칙만 보고 싶을 때
const only = argv.find((a) => a.startsWith('--rule='))?.slice(7);

for (const rule of RULES.rules) {
  if (only && !rule.id.includes(only)) continue;
  const hits = found.get(rule.id) ?? [];
  if (!hits.length) continue;
  const base = baseline[rule.id] ?? 0;

  let verdict;
  if (rule.severity === 'warn') { verdict = `\x1b[33m경고\x1b[0m`; warned += hits.length; }
  else if (rule.severity === 'ratchet') {
    if (hits.length > base) { verdict = `\x1b[31m래칫 초과 ${hits.length} > ${base}\x1b[0m`; failed++; }
    else { verdict = `\x1b[90m래칫 ${hits.length}/${base}\x1b[0m`; }
  } else {
    if (hits.length > base) { verdict = `\x1b[31m차단\x1b[0m`; failed++; }
    else { verdict = `\x1b[90m기존 ${hits.length}/${base}\x1b[0m`; }
  }

  console.log(`\n${verdict}  \x1b[1m${rule.id}\x1b[0m  ${hits.length}건 — ${rule.why}`);
  console.log(`      고침: ${rule.fix}`);
  // --rule 로 한 규칙만 볼 땐 전부 보여준다(고치려고 부른 것이다)
  const show = only ? hits : hits.length > base ? hits.slice(0, 12) : hits.slice(0, 3);
  for (const h of show) console.log(`      ${h.file}:${h.line}  "${h.text}"`);
  if (hits.length > show.length) console.log(`      … 외 ${hits.length - show.length}건`);
}

const scanned = [...byFile.values()].reduce((n, a) => n + a.length, 0);
console.log(`\n${files.length}개 파일 · 화면 문자열 ${scanned}개 검사 · 경고 ${warned}건`);

if (failed) {
  console.log(`\x1b[31m실패: ${failed}개 규칙이 baseline 을 넘었다.\x1b[0m`);
  console.log('고치거나, 의도한 것이면 npm run voice -- --update 로 baseline 을 다시 박는다.');
  process.exit(1);
}
console.log('\x1b[32m통과\x1b[0m');
