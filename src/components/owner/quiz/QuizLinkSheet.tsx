/**
 * 외부 공유 링크 시트(0113, 기획 §4.2) — /owner/quiz-list 안의 시트다(2026-08-07 1층에서 이관).
 *
 * 단기 직원용. 링크를 열면 이름만 적고 바로 푼다(로그인·가입 없음). 결과는 사장이 이름으로 본다.
 *
 * ⚠️ 링크를 받은 사람은 **매장 노하우를 보게 된다**(문항 안에 절차·수치가 들어간다).
 *    그래서 만드는 자리에서 그 사실을 먼저 말하고, 만료일을 고르게 하고(만료 없는 링크는 못 만든다),
 *    삭제를 항상 곁에 둔다. 이건 안내 문구가 아니라 이 화면의 존재 이유다.
 *
 * ★'삭제'는 링크를 못 열게 하는 것이다(revoke). **응시 기록은 지우지 않는다** — 이미 푼 사람의
 *   결과가 사라지면 사장이 본 것이 없어진다. 2026-08-26 에 어휘만 '회수'→'삭제'로 바꿨다:
 *   회수는 사장이 쓰는 말이 아니었다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TrainingCourse } from '@/lib/quiz/types';
import { fetchQuizLinks, insertQuizLink, revokeQuizLink, type QuizLinkRow } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import { BottomSheet } from '@/components/BottomSheet';
import { MiniCalendar } from '@/components/blocks/MiniCalendar';
import { copyQuizLink, makeQuizToken, quizLinkUrl } from '@/lib/quiz/link';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { SheetHead, PrimaryButton, qst } from './kit';

/** 링크를 열어 둘 수 있는 최대 앞날(일). 만료 없는 링크는 못 만든다 — 상한도 둔다. */
const MAX_OPEN_DAYS = 30;
/** 새 링크의 기본 만료일 — 오늘로부터 며칠. */
const DEFAULT_OPEN_DAYS = 7;

/** Date(ms) → KST "YYYY-MM-DD". 달력이 고르는 축과 만료 판정 축을 같게 맞춘다. */
function kstDay(ms: number): string {
  const k = new Date(ms + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}

function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00+09:00`);
  return kstDay(t + n * 86_400_000 - 9 * 3600_000);
}

export function QuizLinkSheet({ course, onClose }: { course: TrainingCourse; onClose: () => void }) {
  const [links, setLinks] = useState<QuizLinkRow[]>([]);
  const [busy, setBusy] = useState(false);
  // 렌더 중 Date.now() 금지(React 컴파일러) — 마운트 시 1회면 만료 판정에 충분하다.
  const [now] = useState(() => Date.now());
  const [today] = useState(() => kstDay(Date.now()));
  /** 새로 만들 링크를 이 날까지 연다. 칩("하루·3일·1주") 대신 달력에서 직접 고른다(2026-08-26). */
  const [openUntil, setOpenUntil] = useState(() => addDays(kstDay(Date.now()), DEFAULT_OPEN_DAYS));

  const reload = useCallback(async () => {
    const rows = await fetchQuizLinks();
    setLinks(rows.filter((l) => l.courseId === course.id));
  }, [course.id]);

  useEffect(() => {
    let alive = true;
    void fetchQuizLinks().then((rows) => {
      if (alive) setLinks(rows.filter((l) => l.courseId === course.id));
    });
    return () => { alive = false; };
  }, [course.id]);

  const live = useMemo(
    () => links.filter((l) => !l.revokedAt && Date.parse(l.expiresAt) > now),
    [links, now],
  );

  const create = async () => {
    if (busy) return;
    setBusy(true);
    // 만료는 고른 날의 **끝**이다 — 그 날 낮에 열었더니 이미 닫혀 있으면 안 된다.
    const expiresAt = new Date(`${addDays(openUntil, 1)}T00:00:00+09:00`).toISOString();
    const row: QuizLinkRow = {
      id: genId('ql'), courseId: course.id, token: makeQuizToken(),
      expiresAt, revokedAt: null, createdAt: new Date().toISOString(),
    };
    const ok = await guardWrite(insertQuizLink(row), () => {}, '링크를 만들지 못했어요.');
    setBusy(false);
    if (ok) {
      await reload();
      showToast('링크를 만들었어요', 'good');
    }
  };

  const copy = async (token: string) => {
    // 복사가 막힌 브라우저에서도 주소는 화면에 그대로 있다 — 실패를 조용히 넘기지 않고 말해 준다.
    const done = await copyQuizLink(token);
    showToast(done ? '링크를 복사했어요' : '복사가 안 됐어요. 주소를 길게 눌러 복사해 주세요', done ? 'good' : undefined);
  };

  /** 링크만 못 열게 한다 — 이미 푼 사람의 결과는 그대로 남는다(어휘만 '삭제', 기록은 보존). */
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await guardWrite(revokeQuizLink(id), () => {}, '링크를 지우지 못했어요.');
    setBusy(false);
    if (ok) {
      await reload();
      showToast('링크를 지웠어요 · 이제 열리지 않아요', 'good');
    }
  };

  return (
    <BottomSheet visible={true} onClose={onClose} sheetStyle={{ height: '82%' }}>
      <SheetHead title={`링크로 내보내기 · ${course.name}`} onClose={onClose} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={qst.body} showsVerticalScrollIndicator={false}>
        {/* 경고를 안내 카드 하나로 묶는다 — 배경색 블록은 이 시트에서 이것 하나(R4-4). */}
        <View style={lst.warnBox}>
          <Ionicons name="alert-circle-outline" size={17} color={BrandColors.warn} />
          <Text style={lst.warnText}>
            링크를 받은 사람은 문제 안에서 매장 노하우를 보게 돼요.
            필요한 기간만 열어 두고, 끝나면 지워 주세요.
          </Text>
        </View>

        <Text style={lst.label}>언제까지 열어 둘까요?</Text>
        <MiniCalendar
          value={openUntil}
          today={today}
          min={today}
          max={addDays(today, MAX_OPEN_DAYS)}
          onChange={setOpenUntil}
        />

        {live.length > 0 && (
          <>
            <Text style={lst.label}>열려 있는 링크</Text>
            {/* 반복 동종 항목이라 행으로 쌓는다(R3-3) — 링크마다 카드를 만들지 않는다. */}
            <View style={lst.list}>
              {live.map((l, i) => (
                <View key={l.id} style={[lst.row, i > 0 && lst.rowTop]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={lst.url} numberOfLines={1} selectable>{quizLinkUrl(l.token)}</Text>
                    <Text style={lst.meta}>{shortDate(l.expiresAt)}까지</Text>
                  </View>
                  {/* role=button Pressable 중첩 금지 — 행은 View 이고 액션만 형제 버튼이다. */}
                  <Pressable
                    onPress={() => void copy(l.token)}
                    hitSlop={8}
                    style={({ pressed }) => [lst.action, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="링크 복사"
                  >
                    <Text style={lst.actionText}>복사</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void remove(l.id)}
                    disabled={busy}
                    hitSlop={8}
                    style={({ pressed }) => [lst.action, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="링크 삭제"
                  >
                    <Text style={[lst.actionText, { color: BrandColors.badText }]}>삭제</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <View style={qst.foot}>
        <PrimaryButton label={busy ? '만드는 중…' : '링크 만들기'} disabled={busy} onPress={() => void create()} />
      </View>
    </BottomSheet>
  );
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const lst = StyleSheet.create({
  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm,
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.md, padding: Space.md, marginBottom: Space.lg,
  },
  warnText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: '800', color: InkColors.ink3, marginTop: Space.lg, marginBottom: Space.xs },
  list: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.lg,
    backgroundColor: '#FFFFFF', paddingHorizontal: Space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  url: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  meta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', marginTop: 1 },
  action: { minHeight: 44, justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, textDecorationLine: 'underline' },
});
