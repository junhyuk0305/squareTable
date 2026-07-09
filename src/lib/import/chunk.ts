// 인수인계서 청킹 — 재귀/구조 기반(소제목 → 빈 줄 블록 → 줄 → 글자 캡).
// 설계: 인수인계서_노하우_고도화_설계논의_2026-07-08.md §5d (Chroma 벤치: fixed-size는 노하우를
// 두 동강 내 품질을 깨고, 구조 경계를 지키는 재귀 분할이 실무 최강 — semantic 청킹은 V2 옵션).
//
// 핵심 성질:
//  - 청크는 "섹션 경계를 절대 넘지 않는다" → 소제목이 곧 섹션 시드(§5c: import 소제목=섹션)라
//    한 청크의 세그먼트 전부가 같은 섹션을 물려받는다.
//  - 빈 줄 블록(한 항목 덩어리)은 캡을 넘지 않는 한 쪼개지 않는다(노하우 반토막 방지).
//  - 순수 JS·무의존(Expo56 코드분할 불가 — 번들 비대 회피).

export type DocChunk = {
  /** AI(structureSquare)에 넣을 본문. 소제목 줄은 제외(가짜 entry 방지) — 섹션은 메타로만. */
  text: string;
  /** 이 청크가 속한 소제목(=섹션 시드). 없으면 null(미분류). */
  section: string | null;
  /** 문서 전체에서의 청크 순번(0부터). order_index 산출 기반. */
  order: number;
};

export type ChunkResult = {
  chunks: DocChunk[];
  /** MAX_DOC_CHUNKS 캡으로 잘려나간 청크 수(0=전부 처리). 조용히 자르지 않고 호출부가 고지한다. */
  truncatedChunks: number;
};

// 입력 상한 — A4 10~12장(한국어) 수준. edge는 콜당 8,000자 컷이므로 청크 단위로만 의미 있다.
export const MAX_IMPORT_CHARS = 24_000;
// 청크 크기 캡 — edge MAX_RAWTEXT_LEN(8,000) 여유 안 + 콜당 분리 상한 MAX_ENTRIES(6)에 맞는 밀도
// (반 페이지≈노하우 1개 가정에서 2,800자≈3~6개 → 6개 상한에 걸려 조용히 유실될 확률 최소화).
export const CHUNK_CHAR_CAP = 2_800;
// 문서당 청크 수 캡 — 순차 호출이 레이트리밋(사용자 10콜/분) 아래서 수 분 안에 끝나는 규모.
// 초과분은 truncatedChunks로 반환해 "나머지는 이어서 올려주세요" 고지(조용히 안 자름).
export const MAX_DOC_CHUNKS = 14;

// ── 소제목 판정 ────────────────────────────────────────────
// 인수인계서에서 실제로 쓰이는 헤딩 패턴만 보수적으로 인정한다.
// ⚠️ 번호줄(1. 2. …)·불릿(- ·)은 "항목"이지 소제목이 아니다(마스터지침의 분리 단위) → 제외.
// ⚠️ 과탐 = 본문 무음 유실: 짧은 한국어 항목("그라인더 원두 비우고 청소"·"락커 비번 1234")이
//    헤딩으로 오인되면 빈 섹션으로 증발한다(스모크 테스트로 실증). 그래서 "장식 없는 짧은 줄"은
//    바로 뒤에 목록(번호/불릿)이 따라올 때만 헤딩으로 본다 — 나머지는 전부 본문(유실 제로 원칙).
const HEAD_DECOR = /^(#{1,6}\s*|[■□◆▶★☆]\s*|\[|【)|(\]|】|[:：])\s*$/g;

const isListItem = (line: string) => /^\s*([-·•*]|\d+[.)])\s*\S/.test(line);

function headingName(rawLine: string): { name: string; decorated: boolean } | null {
  const line = rawLine.trim();
  if (!line) return null;
  // 명시적 장식 헤딩: "# 오픈" / "[오픈]" / "【오픈】" / "■ 오픈" / "오픈:"
  const decorated =
    /^#{1,6}\s+\S/.test(line) ||
    /^\[[^\]]{1,20}\]$/.test(line) ||
    /^【[^】]{1,20}】$/.test(line) ||
    /^[■□◆▶★☆]\s*\S/.test(line) ||
    (/[:：]$/.test(line) && line.length <= 20);
  // 암시적 헤딩 "후보": 아주 짧은 단독 줄(≤14자), 종결어미/구두점 없음, 항목 표식 아님.
  // 확정은 호출부에서 "다음 줄이 목록인가"까지 보고 한다(과탐 방어).
  const bare =
    !decorated &&
    line.length <= 14 &&
    !/[.?!…]$/.test(line) &&
    !/(다|요|함|음|것|기)$/.test(line) &&
    !isListItem(line);
  if (!decorated && !bare) return null;
  const name = line.replace(HEAD_DECOR, '').replace(/[:：]\s*$/, '').trim();
  // 정리 후 비었거나 과하게 길면 헤딩 아님(오탐 방어).
  if (!name || name.length > 20) return null;
  return { name, decorated };
}

// ── 블록(빈 줄 경계 덩어리) → 캡에 맞춰 재귀 분할 ─────────────
// 블록이 캡을 넘으면 줄 단위로, 한 줄이 캡을 넘으면(비정상 입력) 글자로 최후 분할.
function splitOversizeBlock(block: string): string[] {
  if (block.length <= CHUNK_CHAR_CAP) return [block];
  const out: string[] = [];
  let buf = '';
  for (const line of block.split('\n')) {
    const piece = line.length > CHUNK_CHAR_CAP
      ? (line.match(new RegExp(`.{1,${CHUNK_CHAR_CAP}}`, 'g')) ?? [])
      : [line];
    for (const p of piece) {
      if (buf && buf.length + p.length + 1 > CHUNK_CHAR_CAP) { out.push(buf); buf = p; }
      else buf = buf ? `${buf}\n${p}` : p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/**
 * 문서 → 섹션 경계를 지키는 청크 배열.
 * 호출 전 입력은 MAX_IMPORT_CHARS로 잘라 두는 것을 권장(입력창 maxLength와 정렬).
 */
export function chunkDocument(rawText: string): ChunkResult {
  const text = rawText.replace(/\r\n?/g, '\n').slice(0, MAX_IMPORT_CHARS);

  // 1) 소제목 기준으로 섹션 나누기 (헤딩 줄 자체는 본문에서 제외).
  //    장식 없는 짧은 줄은 "바로 다음 비어있지 않은 줄이 목록"일 때만 헤딩 확정 — 아니면 본문.
  type Section = { name: string | null; lines: string[] };
  const lines = text.split('\n');
  const sections: Section[] = [{ name: null, lines: [] }];
  const nextNonEmpty = (from: number): string => {
    for (let k = from; k < lines.length; k++) if (lines[k].trim()) return lines[k];
    return '';
  };
  for (let i = 0; i < lines.length; i++) {
    const head = headingName(lines[i]);
    if (head && (head.decorated || isListItem(nextNonEmpty(i + 1)))) {
      sections.push({ name: head.name, lines: [] });
    } else {
      sections[sections.length - 1].lines.push(lines[i]);
    }
  }

  // 2) 섹션 안에서 빈 줄 블록 단위로 캡까지 패킹(섹션 경계는 절대 안 넘음).
  const all: DocChunk[] = [];
  for (const sec of sections) {
    const body = sec.lines.join('\n').trim();
    if (!body) continue;
    const blocks = body.split(/\n{2,}/).flatMap(splitOversizeBlock);
    let buf = '';
    const flush = () => {
      if (buf.trim()) all.push({ text: buf.trim(), section: sec.name, order: all.length });
      buf = '';
    };
    for (const b of blocks) {
      if (buf && buf.length + b.length + 2 > CHUNK_CHAR_CAP) flush();
      buf = buf ? `${buf}\n\n${b}` : b;
    }
    flush();
  }

  // 3) 문서 캡 — 초과분은 잘라내되 개수를 반환(호출부가 고지·이어서 업로드 안내).
  const truncatedChunks = Math.max(0, all.length - MAX_DOC_CHUNKS);
  return { chunks: all.slice(0, MAX_DOC_CHUNKS), truncatedChunks };
}
