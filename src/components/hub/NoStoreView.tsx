import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { fetchMyGuestQuizHistory, type MyGuestQuizRow } from '@/lib/db';
import { EmptyState } from '@/components/EmptyState';
import { SectionLabel } from '@/components/SectionLabel';
import { Appear } from '@/components/Appear';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

/**
 * 매장이 0곳일 때 허브 탭(오늘·성장)이 그리는 빈 상태.
 *
 * 왜 있나: 예전엔 두 탭이 매장 0곳이면 `/stores` 로 되돌려버려서, 아직 합류하지 않은 직원은
 * 탭이 보이는데 눌러도 매장 탭으로 튕겨 나왔다("허브의 다른 기능을 볼 수 없다"). 탭은 열어두고
 * 여기서 "합류하면 무엇이 보이는지"를 말한 뒤 다음 행동을 준다(빈 화면에 행동 버튼 필수).
 *
 * 다음 행동은 계정 성격에 따라 갈린다 — 사장 계정은 매장 만들기, 직원 계정은 매장 합류.
 * 판정이 `role` 이 아닌 이유: handle_new_user 가 신규 프로필을 무조건 junior 로 만들어서,
 * 매장을 만들기 전의 사장은 role 만으로는 직원과 구별되지 않는다(가입 때 고른 signupRole 을 본다).
 *
 * ★세 번째 갈래는 '대신'이 아니라 '병기'다(2026-08-24 확정): 합류 대기 카드를 위에 그대로 두고
 *   게스트로 푼 퀴즈 결과를 그 아래 카드로 덧붙인다. 기다리는 사람에게 "지금 할 일이 없다"만
 *   말하는 대신, 이 사람이 우리 앱에서 실제로 한 유일한 행동을 되돌려준다.
 */
export function NoStoreView({ what, withQuizHistory = false }: { what: string; withQuizHistory?: boolean }) {
  const router = useRouter();
  const role = useSessionStore((s) => s.role);
  const signupRole = useSessionStore((s) => s.signupRole);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const canCreateStore = role === 'owner' || signupRole === 'owner';

  // 승인 대기 중이면 할 일이 '기다리기'뿐이다 — 코드 입력을 또 권하지 않는다.
  const primary = pendingUnitId ? (
    <EmptyState
      title="사장님 승인을 기다리고 있어요"
      body={`합류가 승인되면 ${what}이 여기에 보여요.`}
      cta={{ label: '합류 상태 보기', onPress: () => router.push('/junior/hub') }}
    />
  ) : canCreateStore ? (
    <EmptyState
      title="아직 매장이 없어요"
      body={`매장을 만들면 ${what}이 여기에 보여요.`}
      cta={{ label: '매장 만들기', onPress: () => router.push('/owner/create-store') }}
    />
  ) : (
    <EmptyState
      title="아직 매장이 없어요"
      body={`사장님께 받은 초대코드로 합류하면 ${what}이 여기에 보여요.`}
      cta={{ label: '매장 합류', onPress: () => router.push('/junior/hub') }}
    />
  );

  if (!withQuizHistory) return primary;
  return (
    <View style={styles.wrap}>
      {primary}
      <GuestQuizHistory />
    </View>
  );
}

// 응시 시각 표기 — "8월 24일". 연도는 생략(최근 이력 중심, 좁은 행 폭 — JuniorGrowthView 와 같은 규칙).
const fmtMonthDay = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

/**
 * 내가 링크로 푼 퀴즈 결과 — 매장별로 여러 건이 그대로 리스트로 선다(한 곳을 가정하지 않는다).
 *
 * ★점수와 취약영역만 그린다. 문항 내용·정답은 비공개다(기획 Q6) — RPC 가 애초에 주지 않으므로
 *   여기서 더 보여줄 것도 없다. 그 경계를 화면에서 우회하지 말 것.
 * ⛔행동 버튼을 두지 않는다. "이 매장에 합류하기" 류의 전환은 이 화면의 일이 아니다.
 */
function GuestQuizHistory() {
  const [rows, setRows] = useState<MyGuestQuizRow[]>([]);

  useEffect(() => {
    let alive = true;
    void fetchMyGuestQuizHistory().then((r) => {
      if (alive) setRows(r);
    });
    return () => { alive = false; };
  }, []);

  // 없으면 아무것도 그리지 않는다 — 대부분의 계정은 게스트 응시 이력이 없다(빈 카드 금지).
  if (rows.length === 0) return null;

  return (
    <Appear>
      <View style={styles.section}>
        <SectionLabel title="내가 푼 퀴즈" hint={`${rows.length}건`} />
        {rows.map((r) => (
          <View key={r.submissionId} style={styles.card}>
            <View style={styles.headRow}>
              <Text style={styles.store} numberOfLines={1}>{r.storeName}</Text>
              <Text style={styles.date}>{fmtMonthDay(r.takenAt)}</Text>
            </View>
            <Text style={styles.score}>
              {r.total}문제 중 <Text style={styles.scoreNum}>{r.correct}개</Text>
            </Text>
            {r.weakTitles.length > 0 ? (
              <Text style={styles.weak} numberOfLines={2}>
                아직 헷갈리는 것 · {r.weakTitles.join(' · ')}
              </Text>
            ) : null}
          </View>
        ))}
        {/* 왜 점수만 보이는지, 언제까지 보이는지를 말한다(기획 §8 각주).
            ★"사장님이 정리하기 전까지"가 실제 동작과 같은 말이다 — my_guest_quiz_history 는
            cleared_at 이 비어 있는 것만 준다(0165). 만료일(quiz_links.expires_at)은 응시를 닫을 뿐
            이 목록을 닫지 않는다. 그 규칙이 바뀌면 이 문구도 같이 고칠 것. */}
        <Text style={styles.note}>
          문항과 정답은 볼 수 없어요 · 사장님이 정리하기 전까지 보여요
        </Text>
      </View>
    </Appear>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Space.lg },
  section: { gap: Space.sm },
  card: {
    backgroundColor: InkColors.bg,
    borderRadius: Radius.md,
    padding: Space.lg,
    gap: Space.xs,
    ...Elevation.e1,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  store: { flex: 1, fontSize: 15, fontWeight: '800', color: InkColors.ink, letterSpacing: -0.2 },
  date: { fontSize: 12, color: InkColors.ink3, fontWeight: '600' },
  score: { fontSize: 15, color: InkColors.ink2 },
  scoreNum: { color: InkColors.ink, fontWeight: '800' },
  weak: { fontSize: 15, lineHeight: 22, color: BrandColors.warnText },
  // 카드 밖 각주 — 목록 전체에 걸리는 말이라 카드 안에 넣지 않는다.
  note: { fontSize: 13, lineHeight: 20, color: InkColors.ink3, fontWeight: '600' },
});
