// deployStatus.ts — 본사가 보는 배포 상태 5종의 이름·색 정본(기획정본 §4-B 마지막 줄).
//
// 미배포 / 최신 / 수정됨 / 새 버전 대기 / 숨김. **이 다섯 개 말고 다른 상태를 만들지 않는다** —
// 교차표 칸·노하우 표 요약·매장 드로어가 같은 어휘를 써야 본사가 화면을 오가며 같은 뜻으로 읽는다.
//
// ★상태는 저장값이 아니라 **사본에서 파생**한다(0217 brand_deploy_matrix). 그래서 여기엔 판정이 없고
//   이름·색만 있다 — 판정이 클라에 한 벌 더 생기면 서버와 어긋나는 날이 온다.
import type { BrandDeployCell } from '@/lib/brand/brandDb';

/** HqPill 의 tone 과 같은 값 — lib 가 components 를 import 하지 않으려고 여기 둔다(계층 경계). */
type PillTone = 'g' | 'w' | 'b' | 'i' | 'n' | 'y';

export type DeployStatus = 'none' | BrandDeployCell['status'];

export const DEPLOY_STATUS: Record<DeployStatus, { label: string; tone: PillTone; hint: string }> = {
  none:     { label: '미배포',      tone: 'n', hint: '이 매장에는 아직 안 보냈어요.' },
  current:  { label: '최신',        tone: 'g', hint: '보낸 내용 그대로예요.' },
  modified: { label: '수정됨',      tone: 'i', hint: '점주가 이 매장에 맞게 고쳤어요. 다시 보내도 덮지 않아요.' },
  pending:  { label: '새 버전 대기', tone: 'w', hint: '고친 사본에 새 버전이 기다려요. 점주가 교체할지 고르고 있어요.' },
  hidden:   { label: '숨김',        tone: 'b', hint: '점주가 이 매장에서 숨겼어요. 내용은 계속 갱신돼요.' },
};

/** 교차표 격자 — 사본이 없는 칸은 서버가 행을 안 주므로 여기서 '미배포'로 채운다. */
export function deployStatusMap(cells: BrandDeployCell[]): Map<string, BrandDeployCell> {
  return new Map(cells.map((c) => [`${c.entry_id}|${c.unit_id}`, c]));
}
export const cellKey = (entryId: string, unitId: string) => `${entryId}|${unitId}`;
