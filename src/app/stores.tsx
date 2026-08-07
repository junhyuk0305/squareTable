import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSessionStore } from '@/lib/store/useSessionStore';
import { useMemberPrefsStore } from '@/lib/store/useMemberPrefsStore';
import { useCrossNotifStore } from '@/lib/store/useCrossNotifStore';
import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useUnknownQueueStore } from '@/lib/store/useUnknownQueueStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { useAttendanceStore } from '@/lib/store/useAttendanceStore';
import { useScheduleStore } from '@/lib/store/useScheduleStore';
import { showToast } from '@/lib/store/useToastStore';
import { needsProfileSetup } from '@/lib/store/profileSetup';
import { HAS_SUPABASE } from '@/lib/supabase';
import { storeColor } from '@/lib/utils/storeColor';
import { useCrossNotifRows } from '@/lib/hooks/useCrossNotifRows';
import { assignedTodayCount } from '@/lib/utils/crossStoreNotifs';
import { canManage } from '@/lib/utils/roles';
import { todayStr } from '@/lib/utils/attendance';
import { fetchOwnerOverview, type MyUnitRow, type OwnerOverviewRow } from '@/lib/db';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { canUseMultistore } from '@/lib/config/tiers';
import { SHOW_BILLING } from '@/lib/config/store-policy';
import { HubTopBar } from '@/components/hub/HubTopBar';
import { HubTabBar } from '@/components/HubTabBar';
import { Appear } from '@/components/Appear';
import { SectionLabel } from '@/components/SectionLabel';
import { TransitionCover } from '@/components/blocks/TransitionCover';

/**
 * 진입 커버가 최대 이만큼만 기다린다.
 *
 * ⚠️ 이 값이 이 화면에서 가장 위험한 부분이다 — 읽기가 끝내 안 오면(오프라인 등) 스토어의 loaded 가
 * 영원히 false 라, 타임아웃이 없으면 사용자가 커버에 갇힌다. **무음 실패를 로딩으로 위장하는 것이
 * 지금보다 나쁘다.** 시간이 지나면 덜 채워진 채로라도 매장 화면(다음 행동이 있는 화면)으로 내보내고,
 * 실패 자체는 전역 SyncBanner(db.ts readFail)가 말한다.
 */
const ENTER_TIMEOUT_MS = 6000;

/**
 * 착지 화면(사장 홈 / 직원 홈)이 그리기 전에 필요한 것만 미리 채운다.
 *
 * 왜 여기서 당기는가: 스토어는 매장이 바뀌어도 비워지지 않는다(loaded 는 true 로 남는다).
 * 그래서 전환 직후 그냥 넘어가면 ① 빈 상태가 스치거나 ② 잠깐 **이전 매장 데이터**가 보인다.
 * 하이드레이트 함수는 owner/junior _layout 이 부르는 것과 **같은 것**이라 새 경로가 아니다.
 */
async function prefetchStoreData(manage: boolean): Promise<void> {
  const jobs = manage
    ? [
        usePlaybookStore.getState().hydrate(),
        useUnknownQueueStore.getState().hydrate(),
        useWorkStore.getState().hydrate(),
        useAttendanceStore.getState().hydrate(),
      ]
    : [
        useWorkStore.getState().hydrate(),
        useAttendanceStore.getState().hydrate(),
        useScheduleStore.getState().hydrate(),
      ];
  // allSettled: 한 스토어가 던져도(오프라인) 나머지를 기다린다. race: 그래도 안 끝나면 놓아준다.
  await Promise.race([
    Promise.allSettled(jobs),
    new Promise<void>((resolve) => setTimeout(resolve, ENTER_TIMEOUT_MS)),
  ]);
}

/**
 * 매장 이름 뒤의 '으로/로' — 매장 이름은 사장이 자유 입력이라 조사를 하드코딩할 수 없다.
 * 받침 없음·ㄹ 받침이면 '로'. 한글이 아니면(영문 상호 등) '으로'로 둔다.
 */
function euroRo(name: string): string {
  const last = name.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return '으로';
  const jong = (code - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

// ── 내 매장 (허브) ──────────────────────────────────────────────────────────
// 로그인 후 사장·직원이 공통으로 착지하는 매장 선택 화면. 매장 카드를 탭하면
// 그 매장 컨텍스트(활성 매장)로 전환 후 5탭 앱으로 진입한다.
// - 루트 레벨 라우트(owner/junior 그룹 게이트 밖) — 활성 매장이 아직 없을 때도 그려져야 하므로.
// - 사장: 매장 추가 + 요금(상태만, 변경은 설정). 직원: 매장 합류(초대코드)만, 요금 숨김.
// - 카드 지표는 기존 통합뷰(owner_overview)를 재사용(직원·노하우·확인필요).
// - 매장 전환은 기존 switchUnit(switch_active_unit RPC) 그대로 — 새 상태를 만들지 않는다.
export default function StoresHub() {
  const router = useRouter();
  const role = useSessionStore((s) => s.role);
  const userId = useSessionStore((s) => s.userId);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const plan = useSessionStore((s) => s.plan);
  const sessionStores = useSessionStore((s) => s.stores);
  const switchUnit = useSessionStore((s) => s.switchUnit);
  const status = useSessionStore((s) => s.status);
  const phone = useSessionStore((s) => s.phone);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);

  const isOwner = role === 'owner';

  // 사장은 fetchMyUnits로 채워진 stores. 직원은 아직 단일매장이라 활성 매장 1개로 구성
  // (Phase 0에서 직원 다매장 로드가 열리면 sessionStores로 통일된다).
  // 오너·직원 모두 my_units로 채워진 sessionStores를 그대로 쓴다(Phase 0: 직원 다매장).
  // 목록이 아직 비었으면(로드 중·데모) 활성 매장 1개로 fallback.
  const stores: MyUnitRow[] =
    sessionStores.length > 0
      ? sessionStores
      : unitId
        ? [{ unit_id: unitId, store_name: storeName || '내 매장', role, industry: null, is_active: true }]
        : [];

  const [overview, setOverview] = useState<Record<string, OwnerOverviewRow>>({});
  // 매장을 고른 순간부터 그 매장 화면이 그릴 준비가 될 때까지 — 이 값이 있으면 화면 전체를 커버가 덮는다.
  const [entering, setEntering] = useState<{ uid: string; name: string } | null>(null);

  // 매장별 개인 설정(닉네임·색) — 카드에 반영. 로그인 후 내 전 매장 한 번에.
  const prefFor = useMemberPrefsStore((s) => s.prefFor);
  const hydratePrefs = useMemberPrefsStore((s) => s.hydrate);
  useEffect(() => {
    void hydratePrefs();
  }, [hydratePrefs]);

  // 통합 알림(0077) — 카드 뱃지·허브 알림 섹션. 판정·매핑·탭 동작은 공용 훅(useCrossNotifRows) SSOT.
  const hydrateCross = useCrossNotifStore((s) => s.hydrate);
  useEffect(() => {
    void hydrateCross();
  }, [hydrateCross]);
  // 도착 전엔 전부 0이라 뱃지·칩이 "없음"으로 보였다가 뒤늦게 튀어나온다 — loaded 전엔 아예 안 그린다.
  const crossLoaded = useCrossNotifStore((s) => s.loaded);
  const { unreadByUnit } = useCrossNotifRows();
  // 직원 '오늘 할일' 칩 — 카운트는 assignedTodayCount SSOT(오늘 탭·허브 탭바 뱃지와 동일 술어).
  const crossData = useCrossNotifStore((s) => s.data);
  const today = todayStr();
  const todoByUnit = useMemo(() => {
    const m: Record<string, number> = {};
    if (!isOwner) for (const d of crossData) m[d.unitId] = assignedTodayCount(d, userId, today);
    return m;
  }, [isOwner, crossData, userId, today]);

  // 사장 매장 카드 지표(직원·노하우·확인필요) — 통합뷰 RPC 1회. 실패해도 카드는 그대로.
  useEffect(() => {
    let alive = true;
    if (!isOwner) return;
    (async () => {
      const { data } = await fetchOwnerOverview();
      if (!alive || !data) return;
      const map: Record<string, OwnerOverviewRow> = {};
      for (const r of data) map[r.unit_id] = r;
      setOverview(map);
    })();
    return () => { alive = false; };
  }, [isOwner]);

  const enterStore = async (u: MyUnitRow) => {
    if (entering) return;
    setEntering({ uid: u.unit_id, name: prefFor(u.unit_id).nickname || u.store_name || '내 매장' });
    // 이미 활성 매장이면 전환 없이 바로 진입. 다른 매장이면 활성 전환 후 진입.
    if (u.unit_id !== unitId) {
      const { error } = await switchUnit(u.unit_id);
      // 전환 실패 시 진입하지 않는다 — 이전 매장을 "선택한 매장인 줄 알고" 보게 되는 무음 오류 방지.
      // 커버를 걷고 매장 목록으로 돌려보낸다(갇히지 않는다).
      if (error) {
        setEntering(null);
        showToast(error, 'warn');
        return;
      }
    }
    // 착지 화면이 그릴 준비가 될 때까지 커버 아래에서 채운다. 실패·지연이면 타임아웃으로 빠져나온다.
    await prefetchStoreData(canManage(useSessionStore.getState().role));
    // 0093: 역할은 매장별(A매장 매니저·B매장 직원 가능) — 전환 '후'의 세션 역할로 착지 화면을 정한다.
    // replace 로 이 화면이 사라지며 커버도 함께 걷힌다(entering 을 되돌릴 필요가 없다).
    router.replace(canManage(useSessionStore.getState().role) ? '/owner/dashboard' : '/junior/home');
  };

  const addStore = () => {
    if (canUseMultistore(plan)) return router.push('/owner/create-store');
    // iOS 네이티브: 결제 화면으로 유도하지 않는다(3.1.3(f)). 사실 고지만 남긴다.
    if (!SHOW_BILLING) return showToast('매장을 더 추가하려면 관리자에게 문의해 주세요.');
    router.push('/billing');
  };
  const joinStore = () => router.push('/junior/hub');

  const storeCount = stores.length;

  // 게이트(index.tsx와 동일 규칙): 미로그인 → 랜딩, 프로필 미완성 → 완성화면.
  // 루트 레벨이라 owner/junior 그룹 게이트를 안 타므로 여기서 직접 지킨다.
  if (HAS_SUPABASE && status === 'signed_out') return <Redirect href="/" />;
  if (HAS_SUPABASE && status === 'loading') return null;
  if (HAS_SUPABASE && needsProfileSetup({ status, phone, unitId, pendingUnitId })) {
    return <Redirect href="/complete-profile" />;
  }

  // 매장 진입 커버 — 고른 순간부터 그 매장 화면이 그릴 준비가 될 때까지 화면 전체를 덮는다.
  // 빈 상태·이전 매장 데이터가 스치는 구간이 여기 통째로 들어간다.
  if (entering) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <TransitionCover
          title={`${entering.name}${euroRo(entering.name)} 가고 있어요`}
          caption="노하우와 오늘 업무를 가져오는 중"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* 상단 바(HubTopBar 공용) — 알림 벨은 여기 고정(탭 금지 — 07-24 사용자 확정) + 프로필(계정 설정) */}
        <HubTopBar />

        {/* 제목 */}
        <Appear delay={0}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>내 매장</Text>
            <Text style={styles.subtitle}>{isOwner ? '들어갈 매장을 선택하세요' : '근무할 매장을 선택하세요'}</Text>
          </View>
        </Appear>

        {stores.length === 0 ? (
          // ── 빈 상태(매장 0곳): 마법사로 튕기지 않고 허브에서 시작 ──
          <Appear delay={60}>
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="storefront-outline" size={30} color="#7a5f10" />
              </View>
              <Text style={styles.emptyTitle}>아직 매장이 없어요</Text>
              <Text style={styles.emptyBody}>
                {isOwner
                  ? '업종만 고르면 그 업종 기본 노하우가 담긴 매장이 만들어져요.'
                  : '사장님께 받은 초대코드로 매장에 합류하세요.'}
              </Text>
              <Pressable onPress={isOwner ? addStore : joinStore} style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.88 }]}>
                <Ionicons name={isOwner ? 'add' : 'enter-outline'} size={18} color={InkColors.ink} />
                <Text style={styles.emptyBtnText}>{isOwner ? '매장 만들기' : '매장 합류'}</Text>
              </Pressable>
            </View>
          </Appear>
        ) : (
          <>
            {/* ── 매장 목록 ── */}
            <Appear delay={60}>
              <View style={styles.section}>
                {/* 역할은 매장별(0093) — 매니저 매장이 하나라도 있으면 '직원' 대신 '매니저'로 표기 */}
                <SectionLabel
                  title={`매장 ${storeCount}곳`}
                  hint={isOwner ? '사장' : stores.some((s) => s.role === 'manager') ? '매니저' : '직원'}
                />
                {stores.map((s) => {
                  const ov = overview[s.unit_id];
                  const isActive = s.unit_id === unitId;
                  const pref = prefFor(s.unit_id);
                  const color = storeColor(s.unit_id, pref.color);
                  return (
                    <Pressable
                      key={s.unit_id}
                      onPress={() => enterStore(s)}
                      style={({ pressed }) => [styles.card, isActive && styles.cardActive, { borderLeftWidth: 4, borderLeftColor: color }, pressed && { opacity: 0.92 }]}
                    >
                      <View style={[styles.cardIcon, { backgroundColor: color + '22' }]}>
                        <Ionicons name={industryIcon(s.industry)} size={22} color={color} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.cardTitleRow}>
                          <Text style={styles.storeName} numberOfLines={1}>{pref.nickname || s.store_name}</Text>
                          {isActive && <Text style={styles.recentBadge}>최근</Text>}
                        </View>
                        <Text style={styles.storeMeta} numberOfLines={1}>
                          {isOwner
                            ? ov
                              ? `직원 ${ov.staff} · 노하우 ${ov.knowhow}`
                              : '탭하면 매장으로 들어가요'
                            : '탭하면 매장으로 들어가요'}
                        </Text>
                      </View>
                      <View style={styles.cardRight}>
                        {/* 사장 = 받은질문 칩(내가 답해야 풀리는 것만, 0이면 숨김 — 대시보드 기획 v2 유지분).
                            직원 = 오늘 할일 칩(오늘 배정·미완료, assignedTodayCount SSOT). */}
                        {isOwner
                          ? (ov?.pending_q ?? 0) > 0 && <Text style={styles.qChip}>받은질문 {ov!.pending_q}</Text>
                          : crossLoaded && (todoByUnit[s.unit_id] ?? 0) > 0 && <Text style={styles.qChip}>오늘 할일 {todoByUnit[s.unit_id]}</Text>}
                        {/* 통합 안읽음 뱃지(0077) — 기존 '확인필요(pending_q만)' 칩을 매장별 전체 안읽음으로 확장(지표 병존 금지). */}
                        {crossLoaded && (unreadByUnit[s.unit_id] ?? 0) > 0 && (
                          <Text style={styles.needChip}>알림 {unreadByUnit[s.unit_id]}</Text>
                        )}
                        <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
                      </View>
                    </Pressable>
                  );
                })}

                {/* 매장 추가(사장) / 매장 합류(직원) */}
                <Pressable onPress={isOwner ? addStore : joinStore} style={({ pressed }) => [styles.addCard, pressed && { opacity: 0.85 }]}>
                  <View style={styles.addIcon}>
                    <Ionicons name={isOwner ? 'add' : 'enter-outline'} size={20} color={InkColors.ink} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.addTitle}>{isOwner ? '매장 추가' : '매장 합류'}</Text>
                    <Text style={styles.addSub}>{isOwner ? '2번째 매장부터는 매장당 요금' : '사장님께 받은 초대코드 입력'}</Text>
                  </View>
                </Pressable>
              </View>
            </Appear>

            {/* 요금제는 허브에 노출하지 않는다 — 확인·변경은 전체 계정 설정(구독 및 결제)에서. */}
          </>
        )}
      </ScrollView>
      {/* 허브 2탭 [현황/오늘 · 매장] — 매장 앱에 들어가면 사라진다(2레이어 경계). */}
      <HubTabBar role={isOwner ? 'owner' : 'junior'} />
    </SafeAreaView>
  );
}

function industryIcon(industry: string | null): keyof typeof Ionicons.glyphMap {
  const s = (industry || '').toLowerCase();
  if (s.includes('카페') || s.includes('cafe') || s.includes('coffee')) return 'cafe-outline';
  return 'storefront-outline';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.xl, paddingBottom: 40 },

  titleBlock: { gap: 4 },
  title: { fontSize: 26, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: InkColors.ink2 },

  section: { gap: Space.md },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    ...Elevation.e2,
  },
  cardActive: { borderColor: BrandColors.yellowDeep },
  cardIcon: { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  storeName: { flexShrink: 1, fontSize: 16, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.3 },
  recentBadge: { fontSize: 10, fontWeight: '900', color: '#7a5f10', backgroundColor: BrandColors.yellow, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.pill, overflow: 'hidden' },
  storeMeta: { fontSize: 13, color: InkColors.ink2, marginTop: 4 },
  cardRight: { alignItems: 'flex-end', gap: Space.sm },
  needChip: {
    fontSize: 11, fontWeight: '900', color: '#8a5a12',
    backgroundColor: BrandColors.warnSoft, borderWidth: 1, borderColor: BrandColors.warnBorder,
    paddingHorizontal: 8, paddingVertical: 1, borderRadius: Radius.pill, overflow: 'hidden',
  },
  // 받은질문(사장)/오늘 할일(직원) 칩 — 알림 칩(앰버)과 색을 벌려 "내 몫의 일"을 구분(노랑 계열).
  qChip: {
    fontSize: 11, fontWeight: '900', color: '#7a5f10',
    backgroundColor: BrandColors.yellowSoft, borderWidth: 1, borderColor: BrandColors.gold,
    paddingHorizontal: 8, paddingVertical: 1, borderRadius: Radius.pill, overflow: 'hidden',
  },

  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: InkColors.ink3,
    borderStyle: 'dashed',
    padding: Space.lg,
  },
  addIcon: { width: 46, height: 46, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  addTitle: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
  addSub: { fontSize: 12, color: InkColors.ink2, marginTop: 2 },

  empty: { alignItems: 'center', paddingVertical: Space.xl, gap: Space.md },
  emptyIcon: { width: 64, height: 64, borderRadius: Radius.lg, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: InkColors.ink },
  emptyBody: { fontSize: 15, color: InkColors.ink2, textAlign: 'center', lineHeight: 22, maxWidth: 260 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: BrandColors.yellow, paddingHorizontal: 22, paddingVertical: 14, borderRadius: Radius.pill, ...Elevation.ey,
  },
  emptyBtnText: { fontSize: 15, fontWeight: '900', color: InkColors.ink },
});
