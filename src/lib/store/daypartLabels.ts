// daypartLabels.ts — 데이파트(시간대) 카테고리 SSOT.
//
// 매장은 시간대 카테고리(오픈/미들/…)를 자유롭게 추가·삭제·수정하고, 카테고리마다
//   "기본 루틴 업무"(그 시간대에 매일 하는 고정 업무)를 등록한다. 저장 위치는 매장 단위 공유 설정
//   schedule_config.dayparts(jsonb, 이미 unit_id RLS 격리)다.
//
// 하위호환: 옛 버전은 이름만 바꾸는 고정 4개라 {open,mid,close,etc} "객체"로 저장했다.
//   resolveDayparts가 그 레거시 객체도 새 배열로 정규화하므로 프로덕션에 이미 저장된 값이 안 깨진다.
//   기본 카테고리 id를 open/mid/close/etc 로 유지 → 기존 work_templates.section(문자열) 이 그대로 매칭.
//
// ⚠️ 이 파일은 RN/zustand/alias(@/) 의존이 "없는" 순수함수만 둔다 — node 로 진리표를 직접 회귀
//   테스트하기 때문(scripts/qa-daypart-labels.mjs · npm run qa:daypart). import 를 추가하지 말 것.

export type DaypartRoutine = { id: string; text: string };
export type Daypart = { id: string; label: string; routines: DaypartRoutine[] };

/** 기본 시간대 id — 기존에 저장된 work_templates.section 값과 맞춘다(마이그레이션 불필요). */
export const DEFAULT_DAYPART_IDS = ['open', 'mid', 'close', 'etc'] as const;

const DEFAULT_LABEL_BY_ID: Record<string, string> = {
  open: '오픈',
  mid: '미들',
  close: '마감',
  etc: '기타',
};

/** 커스텀이 없을 때 쓰는 기본 카테고리 4개(루틴 없음). 항상 새 배열/새 객체로 반환(공유 참조 변형 방지). */
export function defaultDayparts(): Daypart[] {
  return DEFAULT_DAYPART_IDS.map((id) => ({ id, label: DEFAULT_LABEL_BY_ID[id], routines: [] }));
}

/** 읽기 전용 기본 스냅샷 — 라벨 폴백맵(SECTION_LABEL) 파생 등에 쓴다. 직접 변형 금지. */
export const DEFAULT_DAYPARTS: Daypart[] = defaultDayparts();

// alias(@/) 없이 자체 유일 id — 카테고리/루틴 추가·정리 시에만 호출(순수성 유지용 로컬 카운터).
let _idSeq = 0;
function localId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${_idSeq++}`;
}

/** 새 빈 카테고리(사장이 '＋ 카테고리 추가'). label 은 사용자가 채운다. */
export function newDaypart(): Daypart {
  return { id: localId('dp'), label: '', routines: [] };
}
/** 새 빈 루틴 행(사장이 '＋ 루틴 추가'). */
export function newRoutine(): DaypartRoutine {
  return { id: localId('rt'), text: '' };
}

function labelFor(id: string, raw: unknown): string {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return t || DEFAULT_LABEL_BY_ID[id] || '카테고리';
}

// 읽기 시엔 새 id 를 만들지 않는다(렌더마다 id 가 바뀌면 key/완료마크가 흔들림) → 결정적 인덱스 폴백.
function normalizeRoutines(raw: unknown, dpId: string): DaypartRoutine[] {
  if (!Array.isArray(raw)) return [];
  const out: DaypartRoutine[] = [];
  raw.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const rec = r as { id?: unknown; text?: unknown };
    const text = typeof rec.text === 'string' ? rec.text : '';
    const id = typeof rec.id === 'string' && rec.id ? rec.id : `${dpId}_rt_${i}`;
    out.push({ id, text });
  });
  return out;
}

/**
 * 저장된 dayparts(null/undefined/레거시객체/신규배열)를 렌더용 정규 배열로 해석한다.
 * 항상 최소 1개 이상(모두 비면 기본 4개). 각 항목은 id·비어있지 않은 label·routines 배열을 보장.
 * 순수·결정적(같은 입력 → 같은 출력, 새 id 생성 없음).
 */
export function resolveDayparts(dp: unknown): Daypart[] {
  // 신규: 카테고리 배열
  if (Array.isArray(dp)) {
    const out: Daypart[] = [];
    const seen = new Set<string>();
    dp.forEach((it, i) => {
      if (!it || typeof it !== 'object') return;
      const rec = it as { id?: unknown; label?: unknown; routines?: unknown };
      let id = typeof rec.id === 'string' && rec.id ? rec.id : `dp_${i}`;
      if (seen.has(id)) id = `${id}_${i}`;
      seen.add(id);
      out.push({ id, label: labelFor(id, rec.label), routines: normalizeRoutines(rec.routines, id) });
    });
    return out.length ? out : defaultDayparts();
  }
  // 레거시: {open,mid,close,etc} 이름만 담긴 객체
  if (dp && typeof dp === 'object') {
    const o = dp as Record<string, unknown>;
    return DEFAULT_DAYPART_IDS.map((id) => ({ id, label: labelFor(id, o[id]), routines: [] }));
  }
  // 미설정
  return defaultDayparts();
}

/** id→label 조회맵(폴백 포함) — `DL[section]` 형태로 라벨을 쓰던 소비부 하위호환용. */
export function daypartLabelMap(dayparts: Daypart[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const d of dayparts) m[d.id] = d.label;
  return m;
}

/**
 * 저장 직전 정리 — label/루틴텍스트 trim, 이름 없는 카테고리 제거, 빈 루틴 제거, id 중복 해소.
 * 전부 지워지면 기본 4개로 복원(카테고리 0개 방지).
 */
export function sanitizeDayparts(items: Daypart[]): Daypart[] {
  const out: Daypart[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const label = (it.label ?? '').trim();
    if (!label) continue; // 이름 없는 카테고리는 저장하지 않음
    let id = it.id && !seen.has(it.id) ? it.id : localId('dp');
    seen.add(id);
    const routines = (it.routines ?? [])
      .map((r) => ({ id: r.id || localId('rt'), text: (r.text ?? '').trim() }))
      .filter((r) => r.text.length > 0);
    out.push({ id, label, routines });
  }
  return out.length ? out : defaultDayparts();
}
