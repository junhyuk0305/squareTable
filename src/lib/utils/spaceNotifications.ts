// spaceNotifications.ts — 계정 층 벨의 공간 줄(야간 g4a · 계약 6-3 "벨" · 역 ⑩).
// 원천 = my_space_notif_data(0551) 한 RPC. 술어(무엇이 알림인가)는 서버가 정한다. 여기서는 행 모양만 만든다.
//   space_question = 내가 주인인 공간의 대기 질문(답하면 사라진다) · space_answered = 내 공간 질문에 온 답(14일)
//   · link_answered = 옮겨 받은 링크 질문의 답(14일 · 링크가 닫히면 빠진다) · space_deleted = 공간 삭제(14일).
// 행 id = spq_<질문> · spa_<질문> · lka_<질문> · spd_<알림 번호>(계약 6-3). 제목·주소는 레지스트리(NOTIF · 주소 함수)가 정한다.
// 읽음 기준 = 계정 단위 축과 같은 accountAckAt(합류 결과와 같다 · 처리형 줄은 read_by 가 없다).
// ★notifications.ts 는 고치지 않는다(계약 3절). 매장 벨(매장 안)에는 넣지 않는다. 공간은 매장 층 밖이다.
import type { SpaceNotifRow } from '@/lib/db';
import { NOTIF, linkAnsweredRoute, spaceAnsweredRoute, spaceQuestionRoute } from '@/lib/notif/registry';
import { SPACE_WORDS } from '@/lib/place/words';
import { isAfterAck } from '@/lib/utils/notifications';

export type SpaceBellKind = 'space_question' | 'space_q_answered' | 'link_q_answered' | 'space_deleted';

/** NotificationList 한 줄 + 어느 자리 것인지. storeLabel = 공간 이름(칩). */
export type SpaceBellRow = {
  id: string;
  kind: SpaceBellKind;
  title: string;
  body?: string;
  at: string;
  unread: boolean;
  route: string;
  unitId: string;
  storeLabel?: string;
};

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** 답한 사람 이름이 비면 공간 주인으로 부른다(서버 0551 제목과 같은 규칙 · 가결정 6). */
const answerer = (name: string) => name.trim() || `공간 ${SPACE_WORDS.ownerRole}`;

export function buildSpaceNotifRows(rows: SpaceNotifRow[], ackAt: string | null): SpaceBellRow[] {
  const out: SpaceBellRow[] = [];
  for (const r of rows) {
    const p = r.payload ?? {};
    const id = str(p.id);
    if (!id) continue;
    const label = str(p.space_name) || undefined;
    if (r.source === 'space_question') {
      const at = str(p.asked_at);
      const who = str(p.junior_name).trim() || SPACE_WORDS.guest;
      out.push({
        id: `spq_${id}`, kind: 'space_question', title: NOTIF.space_question.title(who), body: str(p.query_text),
        at, unread: isAfterAck(at, ackAt), route: spaceQuestionRoute(r.unitId, id), unitId: r.unitId, storeLabel: label,
      });
    } else if (r.source === 'space_answered') {
      const at = str(p.answered_at);
      out.push({
        id: `spa_${id}`, kind: 'space_q_answered', title: NOTIF.space_q_answered.title(answerer(str(p.answerer_name))), body: str(p.query_text),
        at, unread: isAfterAck(at, ackAt), route: spaceAnsweredRoute(r.unitId, id), unitId: r.unitId, storeLabel: label,
      });
    } else if (r.source === 'link_answered') {
      const link = str(p.link_id);
      if (!link) continue;
      const at = str(p.answered_at);
      out.push({
        id: `lka_${id}`, kind: 'link_q_answered', title: NOTIF.link_q_answered.title(answerer(str(p.answerer_name))), body: str(p.query_text),
        at, unread: isAfterAck(at, ackAt), route: linkAnsweredRoute(link, id), unitId: r.unitId,
      });
    } else if (r.source === 'space_deleted') {
      const at = str(p.created_at);
      // 문구는 서버가 넣은 그대로(레지스트리 space_deleted 주석). 공간 이름은 칩으로 보인다.
      out.push({
        id: `spd_${id}`, kind: 'space_deleted', title: str(p.title), body: str(p.body) || undefined,
        at, unread: isAfterAck(at, ackAt), route: NOTIF.space_deleted.route('junior'), unitId: r.unitId, storeLabel: label,
      });
    }
  }
  return out;
}
