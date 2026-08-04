/**
 * 외부 공유 링크 시트(0113, 기획 §4.2) — /owner/training 안의 시트다.
 *
 * 단기 직원용. 링크를 열면 이름만 적고 바로 푼다(로그인·가입 없음). 결과는 사장이 이름으로 본다.
 *
 * ⚠️ 링크를 받은 사람은 **매장 노하우를 보게 된다**(문항 안에 절차·수치가 들어간다).
 *    그래서 만드는 자리에서 그 사실을 먼저 말하고, 만료를 고르게 하고(만료 없는 링크는 못 만든다),
 *    회수를 항상 곁에 둔다. 이건 안내 문구가 아니라 이 화면의 존재 이유다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TrainingCourse } from '@/lib/quiz/types';
import { fetchQuizLinks, insertQuizLink, revokeQuizLink, type QuizLinkRow } from '@/lib/db';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import { BottomSheet } from '@/components/BottomSheet';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { SheetHead, Chip, PrimaryButton, qst } from './kit';

/** 유효기간 선택지 — 자유 입력 대신 칩(복잡도 원칙). 만료 없음은 없다. */
const EXPIRY_OPTIONS = [
  { days: 1, label: '하루' },
  { days: 3, label: '3일' },
  { days: 7, label: '1주' },
] as const;

/** 공유 URL 의 앞부분. 웹은 지금 열려 있는 주소, 네이티브는 서비스 도메인(딥링크 아님 — 브라우저로 연다). */
function siteOrigin(): string {
  if (Platform.OS === 'web') {
    const g = globalThis as unknown as { location?: { origin?: string } };
    if (g.location?.origin) return g.location.origin;
  }
  return 'https://dochackchack.com';
}

/** 추측할 수 없는 토큰. crypto 가 있으면 그걸 쓰고, 없으면 genId 를 두 번 이어 붙인다. */
function makeToken(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '');
  return `${genId('q')}${genId('z')}`.replace(/[^a-zA-Z0-9]/g, '');
}

export function QuizLinkSheet({ course, onClose }: { course: TrainingCourse; onClose: () => void }) {
  const [links, setLinks] = useState<QuizLinkRow[]>([]);
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState(false);
  // 렌더 중 Date.now() 금지(React 컴파일러) — 마운트 시 1회면 만료 판정에 충분하다.
  const [now] = useState(() => Date.now());

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

  const urlOf = (token: string) => `${siteOrigin()}/q/${token}`;

  const create = async () => {
    if (busy) return;
    setBusy(true);
    const expiresAt = new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
    const row: QuizLinkRow = {
      id: genId('ql'), courseId: course.id, token: makeToken(),
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
    const url = urlOf(token);
    const g = globalThis as unknown as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } };
    try {
      await g.navigator?.clipboard?.writeText?.(url);
      showToast('링크를 복사했어요', 'good');
    } catch {
      // 복사가 막힌 브라우저에서도 주소는 화면에 그대로 있다 — 실패를 조용히 넘기지 않고 말해 준다.
      showToast('복사가 안 됐어요. 주소를 길게 눌러 복사해 주세요');
    }
  };

  const revoke = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await guardWrite(revokeQuizLink(id), () => {}, '링크 회수에 실패했어요.');
    setBusy(false);
    if (ok) {
      await reload();
      showToast('링크를 회수했어요 · 이제 열리지 않아요', 'good');
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
            필요한 기간만 열어 두고, 끝나면 회수해 주세요.
          </Text>
        </View>

        <Text style={lst.label}>얼마 동안 열어 둘까요?</Text>
        <View style={qst.chipWrap}>
          {EXPIRY_OPTIONS.map((o) => (
            <Chip key={o.days} label={o.label} on={days === o.days} onPress={() => setDays(o.days)} />
          ))}
        </View>

        {live.length > 0 && (
          <>
            <Text style={lst.label}>열려 있는 링크</Text>
            {/* 반복 동종 항목이라 행으로 쌓는다(R3-3) — 링크마다 카드를 만들지 않는다. */}
            <View style={lst.list}>
              {live.map((l, i) => (
                <View key={l.id} style={[lst.row, i > 0 && lst.rowTop]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={lst.url} numberOfLines={1} selectable>{urlOf(l.token)}</Text>
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
                    onPress={() => void revoke(l.id)}
                    disabled={busy}
                    hitSlop={8}
                    style={({ pressed }) => [lst.action, pressed && { opacity: 0.7 }]}
                    accessibilityRole="button"
                    accessibilityLabel="링크 회수"
                  >
                    <Text style={[lst.actionText, { color: BrandColors.bad }]}>회수</Text>
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
