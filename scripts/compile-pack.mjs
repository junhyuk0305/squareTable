// compile-pack.mjs — 업종 표준 노하우 팩(MD) → 앱 번들 JSON 컴파일러
// 사람이 검수 가능한 `노하우팩/*.md`(레포 루트, git-ignore)를 파싱해
// `src/data/knowhow-packs.json`(커밋 대상, 앱 번들)으로 정형화한다.
//
// 실행:  node scripts/compile-pack.mjs   (= npm run compile:packs)
//
// 저작 포맷(README·노하우_추출_마스터지침 기준):
//   ### [카테고리] 제목
//   - 태그: #a #b
//   - 상황: ...
//   - 할 일:
//     1) ...
//     2) ...
//   - 금지: ...
//   - 멘트: ...
//   - 실행: 타이밍 / 채널 / 톤
//   - 검색어: a, b, c
//   - 교정포인트: ...
//   - 추천: true
//
// 매핑: 상황→square.situation, 할 일→square.action.steps, 멘트→square.action.scripts,
//       금지→square.extract.dont, 검색어→search_keywords, 실행→execution{timing,channel,tone}.
// 빈 square 칸(quagmire/uncover/result)은 마스터지침 §원칙대로 공란으로 둔다(날조 금지).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACK_DIR = join(__dirname, '..', '..', '노하우팩'); // 레포 루트/노하우팩
const OUT = join(__dirname, '..', 'src', 'data', 'knowhow-packs.json');

// 파일명 → pack_id
const PACK_FILES = [
  { file: '_공통.md', pack_id: 'common' },
  { file: '카페.md', pack_id: 'cafe' },
];

// 한글 카테고리 라벨 → 내부 Category 코드
const CAT_MAP = { 원칙: 'Context', 루틴: 'Routine', 변수: 'Event', 비법: 'Know-how' };

const FIELD_KEYS = ['태그', '상황', '할 일', '할일', '금지', '멘트', '실행', '검색어', '교정포인트', '추천'];

const clean = (s) =>
  s
    .replace(/\*\*/g, '') // 볼드 마크다운 제거
    .replace(/^⭐\s*/, '') // 별표 마커 제거
    .trim();

// 한 `### ` 블록의 본문 라인들 → 필드 버킷
function parseBlock(catLabel, title, lines, packId, seq) {
  const buckets = {};
  let cur = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^-\s*([^:]+):\s*(.*)$/);
    const key = m && FIELD_KEYS.includes(m[1].trim()) ? m[1].trim() : null;
    if (key) {
      cur = key === '할일' ? '할 일' : key;
      buckets[cur] = buckets[cur] ?? [];
      if (m[2].trim()) buckets[cur].push(m[2].trim());
    } else if (cur) {
      buckets[cur].push(line.trim().replace(/^[-•]\s*/, ''));
    }
  }

  const tags = (buckets['태그']?.[0] ?? '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const situation = clean((buckets['상황'] ?? []).join(' '));
  const steps = (buckets['할 일'] ?? []).map(clean).filter(Boolean);
  const scripts = (buckets['멘트'] ?? []).map(clean).filter(Boolean);
  const dont = clean((buckets['금지'] ?? []).join(' '));
  const keywords = (buckets['검색어']?.[0] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const exec = (buckets['실행']?.[0] ?? '').split('/').map((s) => clean(s));
  const norm = (v) => (!v || v === '—' || v === '-' ? '' : v);
  const correction = (buckets['교정포인트'] ?? []).map(clean).filter(Boolean);
  const recommended = /^(true|네|y|yes|예)$/i.test((buckets['추천']?.[0] ?? '').trim());

  const category = CAT_MAP[catLabel] ?? 'Context';
  const id = `tpl_${packId}_${String(seq).padStart(3, '0')}`;

  return {
    id,
    unit_id: '',
    creator_id: '',
    creator_name: '',
    category,
    subcategory: tags[0]?.replace(/^#/, '') ?? catLabel,
    title: clean(title),
    tags,
    search_keywords: keywords,
    square: {
      situation,
      quagmire: '',
      uncover: '',
      action: { steps, scripts },
      result: { before: '', after: '', metric: '' },
      extract: { do: '', dont, template: '' },
    },
    execution: { timing: norm(exec[0] ?? ''), channel: norm(exec[1] ?? ''), tone: norm(exec[2] ?? '') },
    stats: { query_hits_30d: 0, resolution_rate: 0, thumbs_up: 0, thumbs_down: 0, last_used_at: '' },
    photos: [],
    version: 1,
    status: 'published',
    quality_score: 0,
    created_at: '',
    updated_at: '',
    // 템플릿 메타
    is_template: true,
    pack_id: packId,
    needs_review: true,
    correction_points: correction,
    recommended,
  };
}

function compileFile(filePath, packId) {
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const entries = [];
  let seq = 1;
  let i = 0;
  while (i < lines.length) {
    const h = lines[i].match(/^###\s*\[([^\]]+)\]\s*(.+)$/);
    if (!h) {
      i++;
      continue;
    }
    const catLabel = h[1].trim();
    const title = h[2].trim();
    const body = [];
    i++;
    while (i < lines.length && !/^###\s/.test(lines[i])) {
      if (!/^---\s*$/.test(lines[i]) && !/^##\s/.test(lines[i]) && !/^#\s/.test(lines[i])) body.push(lines[i]);
      i++;
    }
    entries.push(parseBlock(catLabel, title, body, packId, seq++));
  }
  return entries;
}

let all = [];
const report = [];
for (const { file, pack_id } of PACK_FILES) {
  const fp = join(PACK_DIR, file);
  if (!existsSync(fp)) {
    report.push(`  ⚠ ${file} 없음 — 건너뜀`);
    continue;
  }
  const entries = compileFile(fp, pack_id);
  all = all.concat(entries);
  const rec = entries.filter((e) => e.recommended).length;
  report.push(`  ✓ ${file} → ${entries.length}건 (추천 ${rec})`);
}

writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n', 'utf8');
console.log('[compile-pack] 노하우 팩 컴파일 완료');
report.forEach((r) => console.log(r));
console.log(`  Σ 총 ${all.length}건 → ${OUT}`);
