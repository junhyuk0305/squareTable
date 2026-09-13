/**
 * 배포 패널 — 퀴즈 상세의 '배포' 세그먼트 본문(2026-09-11).
 *
 * **한 퀴즈 = 배포 여러 번**이 이 화면의 전제다. 단기 직원은 계속 바뀌므로 사장은 같은 퀴즈를
 * 사람이 바뀔 때마다 다시 내보낸다. 그전까지 링크는 더보기 메뉴 속 시트에만 있어서, 사장은
 * "또 배포한다"를 **퀴즈를 복제하는 것**으로 이해했다(= 목록이 같은 퀴즈로 계속 불어났다).
 *
 * ★`QuizLinkSheet`(2026-08-07~09-11)를 여기로 접었다 — 링크를 만드는 자리가 둘이면
 *   같은 기능이 두 모양을 갖는다(AGENTS.md ② SSOT). 만드는 자리는 이제 여기 하나다.
 *
 * ⚠️ 링크를 받은 사람은 **매장 노하우를 보게 된다**(문항 안에 절차·수치가 들어간다).
 *    그래서 경고를 먼저 두고, 만료 없는 링크는 못 만들고, 지우기를 항상 곁에 둔다.
 *
 * ★'지우기'는 링크를 못 열게 하는 것이다(revoke). **응시 기록은 지우지 않는다.**
 * ★'기간'은 토큰을 그대로 두고 만료만 민다 — 지우고 새로 만들면 **이미 보낸 주소가 죽는다.**
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { TrainingCourse } from '@/lib/quiz/types';
import {
  fetchQuizLinks,
  fetchGuestQuizSubmissions,
  insertQuizLink,
  revokeQuizLink,
  updateQuizLinkExpiry,
  type QuizLinkRow,
  type GuestSubmissionRow,
} from '@/lib/db';
import { maskTail4, scoreText, takenDayLabel } from '@/lib/quiz/guestResult';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import { BottomSheet } from '@/components/BottomSheet';
import { ScreenLoading } from '@/components/ScreenLoading';
import { MiniCalendar } from '@/components/blocks/MiniCalendar';
import { SectionLabel } from '@/components/SectionLabel';
import {
  COPY_LINK_LABEL,
  COPY_LINK_ICON,
  copyLinkToast,
  copyQuizLink,
  makeQuizToken,
  quizLinkUrl,
} from '@/lib/quiz/link';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
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

/** 고른 날의 **끝**이 만료다 — 그 날 낮에 열었더니 이미 닫혀 있으면 안 된다. */
function endOfDayIso(day: string): string {
  return new Date(`${addDays(day, 1)}T00:00:00+09:00`).toISOString();
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 달력 시트가 무엇을 하는 중인가 — 새로 만드는 중이거나, 열려 있는 링크의 기간을 미는 중이거나. */
type DayPick = { mode: 'create' } | { mode: 'extend'; link: QuizLinkRow };

export function QuizDeployPanel({ course, onOpenResult }: { course: TrainingCourse; onOpenResult: (submissionId: string) => void }) {
  const [links, setLinks] = useState<QuizLinkRow[]>([]);
  /** 이 퀴즈를 링크로 푼 사람들(0189 부터 귀속이 적힌다). 0189 이전 응시는 코스를 모르므로 안 나온다. */
  const [subs, setSubs] = useState<GuestSubmissionRow[]>([]);
  // ★목록이 오기 전에 그리면 이미 열려 있는 링크가 있어도 없는 것처럼 보인다 — 사장은 같은
  //   퀴즈의 링크를 한 번 더 발급한다. 실패해도 true 로 확정한다(영영 로딩 금지).
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // 렌더 중 Date.now() 금지(React 컴파일러) — 마운트 시 1회면 만료 판정에 충분하다.
  const [now] = useState(() => Date.now());
  const [today] = useState(() => kstDay(Date.now()));
  const [pick, setPick] = useState<DayPick | null>(null);
  const [day, setDay] = useState(() => addDays(kstDay(Date.now()), DEFAULT_OPEN_DAYS));

  const reload = useCallback(async () => {
    const rows = await fetchQuizLinks();
    setLinks(rows.filter((l) => l.courseId === course.id));
    setLoaded(true);
  }, [course.id]);

  useEffect(() => {
    let alive = true;
    // 링크와 응시 결과는 **같이** 와야 한다 — 링크만 먼저 그리면 결과 자리가 비었다가 채워진다.
    void Promise.all([fetchQuizLinks(), fetchGuestQuizSubmissions()]).then(([rows, got]) => {
      if (!alive) return;
      setLinks(rows.filter((l) => l.courseId === course.id));
      setSubs(got.filter((s) => s.courseId === course.id));
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [course.id]);

  const live = useMemo(
    () => links.filter((l) => !l.revokedAt && Date.parse(l.expiresAt) > now),
    [links, now],
  );
  /** 닫힌 링크 수 — "이 퀴즈를 몇 번 내보냈나"가 재배포 맥락에서 사장이 보는 값이다. */
  const closed = links.length - live.length;

  const openCreate = () => {
    setDay(addDays(today, DEFAULT_OPEN_DAYS));
    setPick({ mode: 'create' });
  };

  const openExtend = (link: QuizLinkRow) => {
    const cur = kstDay(Date.parse(link.expiresAt) - 1);
    setDay(cur < today ? today : cur);
    setPick({ mode: 'extend', link });
  };

  const confirmDay = async () => {
    if (!pick || busy) return;
    setBusy(true);
    const expiresAt = endOfDayIso(day);
    const ok =
      pick.mode === 'create'
        ? await guardWrite(
            insertQuizLink({
              id: genId('ql'), courseId: course.id, token: makeQuizToken(),
              expiresAt, revokedAt: null, createdAt: new Date().toISOString(),
            }),
            () => {},
            '링크를 만들지 못했어요.',
          )
        : await guardWrite(updateQuizLinkExpiry(pick.link.id, expiresAt), () => {}, '기간을 바꾸지 못했어요.');
    setBusy(false);
    if (!ok) return;
    setPick(null);
    await reload();
    showToast(pick.mode === 'create' ? '링크를 만들었어요' : `${shortDate(expiresAt)}까지로 바꿨어요`, 'good');
  };

  const copy = async (token: string) => {
    // 복사가 막힌 브라우저에서도 주소는 화면에 그대로 있다 — 실패를 조용히 넘기지 않는다.
    const t = copyLinkToast(await copyQuizLink(token));
    if (t) showToast(t.text, t.tone);
  };

  /** 링크만 못 열게 한다 — 이미 푼 사람의 결과는 그대로 남는다. */
  const remove = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const ok = await guardWrite(revokeQuizLink(id), () => {}, '링크를 지우지 못했어요.');
    setBusy(false);
    if (!ok) return;
    await reload();
    showToast('링크를 지웠어요 · 이제 열리지 않아요', 'good');
  };

  if (!loaded) return <ScreenLoading label="링크를 불러오고 있어요…" />;

  return (
    <View style={st.wrap}>
      {/* 경고는 안내 카드 하나로 묶는다 — 배경색 블록은 이 화면에서 이것 하나. */}
      <View style={st.warnBox}>
        <Ionicons name="alert-circle-outline" size={17} color={BrandColors.warn} />
        <Text style={st.warnText}>
          링크를 받은 사람은 문제 안에서 매장 노하우를 보게 돼요.
          필요한 기간만 열어 두고, 끝나면 지워 주세요.
        </Text>
      </View>

      {live.length === 0 ? (
        /* 빈 화면에 다음 행동 버튼이 없으면 버그로 본다(워딩 §4). */
        <View style={st.empty}>
          <Text style={st.emptyText}>
            {closed > 0
              ? `지금 열린 링크가 없어요. 전에 ${closed}번 내보냈어요.`
              : '아직 내보낸 적이 없어요. 링크를 만들면 계정 없는 사람도 바로 풀 수 있어요.'}
          </Text>
        </View>
      ) : (
        <>
          {/* 이름은 '링크' 하나로 둔다(2026-09-13) — '열려 있는'은 힌트(지난 링크 N개)가 이미 말한다. */}
          <SectionLabel
            title="링크"
            hint={closed > 0 ? `${live.length}개 · 지난 링크 ${closed}개` : `${live.length}개`}
          />
          {/* 반복 동종 항목이라 행으로 쌓는다 — 링크마다 카드를 만들지 않는다. */}
          <View style={st.list}>
            {live.map((l, i) => (
              <View key={l.id} style={[st.row, i > 0 && st.rowTop]}>
                <View style={st.rowHead}>
                  <Text style={st.url} numberOfLines={1} selectable>{quizLinkUrl(l.token)}</Text>
                  <Text style={st.meta}>{shortDate(l.expiresAt)}까지 열려 있어요</Text>
                </View>
                {/* role=button Pressable 중첩 금지 — 행은 View 이고 액션만 형제 버튼이다. */}
                <View style={st.acts}>
                  {/* 복사는 아이콘 하나로(2026-09-13) — 행에서 가장 많이 누르는 일이라 글자보다 빨리 찾는다.
                      네이티브는 클립보드 모듈이 없어 공유 시트를 연다 → 아이콘도 그에 맞춰 바뀐다(link.ts 정본). */}
                  <IconAction icon={COPY_LINK_ICON} a11y={COPY_LINK_LABEL} onPress={() => void copy(l.token)} />
                  <RowAction label="기간" a11y="열어 둘 기간 바꾸기" onPress={() => openExtend(l)} />
                  <RowAction label="지우기" a11y="링크 지우기" tone="danger" disabled={busy} onPress={() => void remove(l.id)} />
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      {/* 이 링크로 푼 사람 — 배포와 결과가 한 자리에 있어야 "또 내보낼까"를 여기서 정할 수 있다.
          ⛔ 채용 전환 액션(뽑기·합류 초대)은 두지 않는다 — 명시적으로 스코프 밖이다. */}
      {subs.length > 0 && (
        <View style={st.results}>
          <SectionLabel title="이 링크로 푼 사람" hint={`${subs.length}명`} />
          <View style={st.list}>
            {subs.map((s, i) => (
              <Pressable
                key={s.submissionId}
                onPress={() => onOpenResult(s.submissionId)}
                style={({ pressed }) => [st.subRow, i > 0 && st.rowTop, pressed && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={`${s.guestName} 결과 보기`}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.subName} numberOfLines={1}>{s.guestName}</Text>
                  <Text style={st.meta} numberOfLines={1}>
                    {maskTail4(s.guestPhone)} · {takenDayLabel(s.takenAt)}
                  </Text>
                </View>
                <Text style={st.subScore}>{scoreText(s.correct, s.total)}</Text>
                <Ionicons name="chevron-forward" size={15} color={InkColors.ink3} />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={st.cta}>
        <PrimaryButton
          label={live.length > 0 ? '링크 또 만들기' : '링크 만들기'}
          onPress={openCreate}
          accessibilityLabel={live.length > 0 ? '링크 또 만들기' : '링크 만들기'}
        />
        <Text style={st.ctaHint}>사람이 바뀌면 새 링크를 만들어 보내세요. 퀴즈는 이것 하나 그대로예요.</Text>
      </View>

      {/* 날짜 고르기 — 만들기와 기간 바꾸기가 같은 일(며칠까지 열어 둘까)이라 시트 하나다. */}
      {pick && (
        <BottomSheet visible onClose={() => setPick(null)}>
          <SheetHead
            title={pick.mode === 'create' ? '언제까지 열어 둘까요?' : '언제까지로 바꿀까요?'}
            onClose={() => setPick(null)}
          />
          <View style={qst.body}>
            <MiniCalendar value={day} today={today} min={today} max={addDays(today, MAX_OPEN_DAYS)} onChange={setDay} />
          </View>
          <View style={qst.foot}>
            <PrimaryButton
              label={busy ? '저장하는 중…' : pick.mode === 'create' ? '링크 만들기' : '기간 바꾸기'}
              disabled={busy}
              onPress={() => void confirmDay()}
            />
          </View>
        </BottomSheet>
      )}
    </View>
  );
}

/** 행 안의 아이콘 액션 — 글자 액션과 같은 48dp 상자를 쓴다(터치 타깃 규칙 공유). */
function IconAction({
  icon, a11y, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  a11y: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.act, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Ionicons name={icon} size={19} color={InkColors.ink2} />
    </Pressable>
  );
}

/** 행 안의 작은 액션 — 48dp 는 **상자 크기**로 지킨다(hitSlop 은 RN-web 에서 안 먹는다). */
function RowAction({
  label, a11y, onPress, tone, disabled,
}: {
  label: string;
  a11y: string;
  onPress: () => void;
  tone?: 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.act, disabled && { opacity: 0.35 }, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <Text style={[st.actText, tone === 'danger' && { color: BrandColors.badText }]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  wrap: { gap: Space.sm },
  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Space.sm,
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.md, padding: Space.md,
  },
  warnText: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },

  empty: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.lg, backgroundColor: '#FFFFFF',
    padding: Space.lg, marginTop: Space.sm, ...Elevation.e1,
  },
  emptyText: { fontSize: 15, color: InkColors.ink2, lineHeight: 22, fontWeight: '600', textAlign: 'center' },

  list: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.lg,
    backgroundColor: '#FFFFFF', paddingHorizontal: Space.lg, ...Elevation.e1,
  },
  // 주소 줄과 버튼은 서로 다른 일이라 사이를 벌리고(gap), 버튼 아래는 행 경계라 좁힌다(2026-09-13).
  // 버튼 자체의 48dp 는 st.act 의 minHeight 가 지킨다 — 행 패딩으로 키우지 않는다.
  row: { paddingTop: Space.sm, paddingBottom: Space.xs, gap: Space.md },
  rowTop: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowHead: { gap: 1 },
  url: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  meta: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  acts: { flexDirection: 'row', gap: Space.xs },
  act: {
    minHeight: 48, minWidth: 56, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.sm,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  actText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  results: { marginTop: Space.lg },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 56, paddingVertical: Space.sm },
  subName: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  subScore: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  cta: { marginTop: Space.md, gap: Space.xs },
  ctaHint: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', textAlign: 'center' },
});
