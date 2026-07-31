import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Wordmark } from '@/components/Wordmark';
import { Appear } from '@/components/Appear';

const CODE_LEN = 6;

type IconName = keyof typeof Ionicons.glyphMap;

// 직원 개인 허브 홈 — 회원가입 직후(매장 미연결) 착지점.
// 마이페이지 + 후킹 배너 + 가게 코드 입력 + 내 가게 목록을 한 화면에 모은다.
// 단일매장 모델이라 지금 '내 가게'는 0~1개지만, 목록(stores)으로 그려 향후 멀티매장 확장에 대비한다.
// 가게 합류/승인 대기 로직은 기존 joinByInvite(승인제)를 그대로 재사용한다.
export default function JuniorHub() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const joinByInvite = useSessionStore((s) => s.joinByInvite);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const pendingStoreName = useSessionStore((s) => s.pendingStoreName);
  const cancelJoinRequest = useSessionStore((s) => s.cancelJoinRequest);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);
  const rejectedJoinStoreName = useSessionStore((s) => s.rejectedJoinStoreName);
  const dismissRejectedJoin = useSessionStore((s) => s.dismissRejectedJoin);

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 내 가게 목록 — 단일매장이라 연결 시 1개. 멀티매장 전환 시 여기만 배열로 바뀐다.
  const stores = unitId ? [{ id: unitId, name: storeName || '내 매장' }] : [];
  const hasStore = stores.length > 0;

  const cells = Array.from({ length: CODE_LEN }, (_, i) => code[i] ?? '');

  const onChange = (v: string) => {
    setErr(null);
    setCode(v.replace(/[^0-9]/g, '').slice(0, CODE_LEN));
  };

  const focusCode = () => inputRef.current?.focus();

  const join = async () => {
    if (code.length < CODE_LEN) {
      setErr('6자리 초대코드를 모두 입력해주세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    const { error, pending } = await joinByInvite(code.trim());
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setCode('');
    // 승인제: 성공은 '승인 대기' 신청(pendingUnitId 세팅 → 아래 대기 카드로 전환).
    // 혹시 즉시 합류(레거시)면 바로 가게로 진입.
    if (!pending) router.replace('/junior/home');
  };

  const onCancelPending = async () => {
    setBusy(true);
    setErr(null);
    // 예전엔 반환값을 버려 RPC 실패 시 아무 반응 없이 대기카드가 그대로 남았다(#12 무음 no-op).
    // 이제 실패 사유를 대기카드 아래에 노출하고, 성공했을 때만 입력값을 정리한다.
    const { error } = await cancelJoinRequest();
    setBusy(false);
    if (error) {
      setErr(error);
      return;
    }
    setCode('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 상단 바: 매장 선택으로(뒤로) + 워드마크.
            ★마이페이지 아이콘 버튼은 제거함(2026-07-29) — 같은 화면 아래 '마이페이지' 카드가 이미
              프로필 편집·로그아웃을 제공해 목적지가 완전히 겹쳤고(중복 진입점), 라벨 없는 아이콘 단독
              버튼이라 복잡도 원칙 P9(아이콘 단독 버튼 금지)에도 걸렸다. 이 화면의 목적은 '매장 합류'다. */}
        <View style={styles.topbar}>
          <View style={styles.topbarLeft}>
            {/* hub는 headerShown:false라 화면 안에 탈출 경로를 둔다 — 매장 선택(/stores)으로. */}
            <Pressable
              onPress={() => router.replace('/stores')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="매장 선택으로"
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="arrow-back" size={24} color={InkColors.ink} />
            </Pressable>
            <Wordmark size="sm" />
          </View>
        </View>

        {/* 인사 */}
        <Appear delay={0}>
        <View style={styles.greet}>
          <Text style={styles.hello}>
            안녕하세요{userName ? `, ${userName}님` : ''}
          </Text>
          <Text style={styles.helloSub}>
            {hasStore ? '오늘도 착착 시작해볼까요?' : '매장에 연결하면 착착을 시작할 수 있어요.'}
          </Text>
        </View>
        </Appear>

        {/* 후킹 배너 ① — 가게 연결 유도 (매장 없을 때만) */}
        {!hasStore && !pendingUnitId && (
          <Appear delay={60}>
          <Pressable onPress={focusCode} style={({ pressed }) => [styles.heroBanner, pressed && { opacity: 0.92 }]}>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>사장님께 코드를 받으셨나요?</Text>
              <Text style={styles.heroSub}>6자리 초대코드를 넣으면 합류 신청이 되고, 사장님이 승인하면 연결돼요.</Text>
            </View>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaText}>코드 입력</Text>
              <Ionicons name="arrow-forward" size={15} color={InkColors.ink} />
            </View>
          </Pressable>
          </Appear>
        )}

        {/* 합류 미승인 안내(#미아 방지) — 승인 대기가 조용히 사라지던 것을 기기 마커로 감지해 알린다. */}
        {!pendingUnitId && !!rejectedJoinStoreName && (
          <Appear delay={90}>
          <View style={styles.pendingCard}>
            <View style={styles.pendingHead}>
              <View style={styles.pendingIcon}>
                <Ionicons name="alert-circle-outline" size={20} color={BrandColors.warn} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName}>{rejectedJoinStoreName || '신청한 매장'}</Text>
                <Text style={styles.pendingMeta}>합류 신청이 승인되지 않았어요</Text>
              </View>
            </View>
            <Text style={styles.pendingBody}>코드를 다시 확인해 신청하거나, 사장님께 문의해 주세요.</Text>
            <View style={styles.pendingActions}>
              <Pressable onPress={dismissRejectedJoin} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.ghostBtnText}>닫기</Text>
              </Pressable>
            </View>
          </View>
          </Appear>
        )}

        {/* 내 가게 */}
        <Appear delay={120}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>내 매장</Text>

          {pendingUnitId ? (
            <View style={styles.pendingCard}>
              <View style={styles.pendingHead}>
                <View style={styles.pendingIcon}>
                  <Ionicons name="hourglass-outline" size={20} color={BrandColors.warn} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{pendingStoreName || '신청한 매장'}</Text>
                  <Text style={styles.pendingMeta}>사장님 승인 대기 중</Text>
                </View>
              </View>
              <Text style={styles.pendingBody}>승인되면 바로 이 매장으로 들어갈 수 있어요.</Text>
              <View style={styles.pendingActions}>
                <Pressable disabled={busy} onPress={() => void refreshMembership()} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.ghostBtnText}>승인 확인</Text>
                </Pressable>
                <Pressable disabled={busy} onPress={onCancelPending} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.ghostBtnText}>신청 취소</Text>
                </Pressable>
              </View>
              {/* 신청취소 실패 사유를 대기카드 안에서 노출(코드입력 섹션은 대기 중 숨겨져 err이 안 보였음 #12). */}
              {err && <Text style={styles.err}>{err}</Text>}
            </View>
          ) : hasStore ? (
            stores.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => router.replace('/junior/home')}
                style={({ pressed }) => [styles.storeCard, pressed && { opacity: 0.9 }]}
              >
                <View style={styles.storeIcon}>
                  <Ionicons name="storefront-outline" size={20} color={InkColors.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{s.name}</Text>
                  <Text style={styles.storeMeta}>탭하면 매장으로 들어가요</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="add-circle-outline" size={22} color={InkColors.ink3} />
              <Text style={styles.emptyText}>아직 연결된 매장이 없어요.{'\n'}아래에 초대코드를 입력해 매장을 추가하세요.</Text>
            </View>
          )}
        </View>
        </Appear>

        {/* 가게 코드 입력 (대기 중이 아닐 때만) */}
        {!pendingUnitId && (
          <Appear delay={160}>
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>매장 코드 입력</Text>
            <View style={styles.codeCard}>
              <Pressable onPress={focusCode} style={styles.cells}>
                {cells.map((ch, i) => (
                  <View key={i} style={[styles.cell, i === Math.min(code.length, CODE_LEN - 1) && styles.cellActive]}>
                    <Text style={styles.cellText}>{ch}</Text>
                  </View>
                ))}
                <TextInput
                  ref={inputRef}
                  value={code}
                  onChangeText={onChange}
                  keyboardType="number-pad"
                  maxLength={CODE_LEN}
                  style={styles.hiddenInput}
                  caretHidden
                  onSubmitEditing={join}
                />
              </Pressable>
              {err && <Text style={styles.err}>{err}</Text>}
              <Pressable disabled={busy} onPress={join} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.88 }, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>매장 추가하기</Text>}
              </Pressable>
              <Text style={styles.codeHint}>코드가 없으신가요? 사장님께 요청하세요 (사장님: 설정 › 매장 관리).</Text>
            </View>
          </View>
          </Appear>
        )}

        {/* 후킹 배너 ② — 기능 소개/온보딩 */}
        <Appear delay={200}>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>착착으로 이런 걸 할 수 있어요</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featureRow}
          >
            {FEATURES.map((f) => (
              <View key={f.title} style={styles.featureCard}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon} size={20} color={InkColors.ink} />
                </View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
        </Appear>

        {/* 내 계정 — 이 화면의 목적은 '매장 합류'이므로 계정 관리는 한 줄로 강등한다(IA 결정 1 = 안 A, 2026-07-29).
            ★통째로 옮기지 않은 이유: hub는 자체 상단바를 써서 HubTopBar의 계정 진입점이 없다. 카드를 없애면
              미합류 직원에게 로그아웃 경로가 사라진다. 대신 프로필편집·로그아웃·탈퇴를 모두 가진
              상위 화면(/account-settings) 한 줄로 합쳤다 — 요소 2개 → 1개, 기능은 오히려 늘어난다. */}
        <Appear delay={240}>
        <View style={styles.section}>
          <Pressable
            onPress={() => router.push('/account-settings')}
            style={({ pressed }) => [styles.myRow, styles.myRowSolo, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="내 계정 — 프로필 편집·로그아웃"
          >
            <View style={styles.avatarSm}>
              <Text style={styles.avatarText}>{(userName || '?').slice(0, 1)}</Text>
            </View>
            <Text style={styles.myRowText}>{userName ? `${userName}님 · 내 계정` : '내 계정'}</Text>
            <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
          </Pressable>
        </View>
        </Appear>
      </ScrollView>
    </SafeAreaView>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'sparkles-outline', title: '노하우 물어보기', body: '모르는 건 AI에게 바로 물어봐요.' },
  { icon: 'time-outline', title: '출퇴근 체크', body: '출근·퇴근을 한 번에 기록해요.' },
  { icon: 'calendar-outline', title: '근무표 확인', body: '내 근무 일정을 바로 확인해요.' },
];

const CELL_GAP = 8;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  scroll: { padding: Space.gutter, gap: Space.xl, paddingBottom: 40 },

  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topbarLeft: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  backBtn: { padding: 2 },

  greet: { gap: 4 },
  hello: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  helloSub: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },

  heroBanner: {
    backgroundColor: BrandColors.brandSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  heroText: { gap: 4 },
  heroTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  heroSub: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  heroCta: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start' },
  heroCtaText: { fontSize: 14, fontWeight: '800', color: InkColors.ink },

  section: { gap: Space.md },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginLeft: 2 },

  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    ...Elevation.e1,
  },
  storeIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  storeName: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  storeMeta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },

  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    borderStyle: 'dashed',
    padding: Space.lg,
  },
  emptyText: { flex: 1, fontSize: 15, color: InkColors.ink2, lineHeight: 22 },

  pendingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  pendingHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  pendingIcon: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: '#FBF3E2', alignItems: 'center', justifyContent: 'center' },
  pendingMeta: { fontSize: 12, color: BrandColors.warn, fontWeight: '700', marginTop: 2 },
  pendingBody: { fontSize: 15, color: InkColors.ink2, lineHeight: 22 },
  pendingActions: { flexDirection: 'row', gap: Space.sm },
  ghostBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, borderWidth: 1, borderColor: InkColors.line },
  ghostBtnText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },

  codeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.md,
    ...Elevation.e1,
  },
  cells: { flexDirection: 'row', gap: CELL_GAP, position: 'relative' },
  cell: {
    flex: 1,
    aspectRatio: 0.82,
    maxHeight: 56,
    borderWidth: 1.5,
    borderColor: InkColors.line,
    borderRadius: Radius.md,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: { borderColor: BrandColors.brand },
  cellText: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  hiddenInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, color: 'transparent' },
  err: { fontSize: 15, color: BrandColors.accent, fontWeight: '600' },
  primary: { backgroundColor: BrandColors.brand, paddingVertical: 15, borderRadius: Radius.md, alignItems: 'center' },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  codeHint: { fontSize: 12, color: InkColors.ink3, lineHeight: 18 },

  featureRow: { gap: Space.md, paddingRight: Space.gutter },
  featureCard: {
    width: 150,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.sm,
    ...Elevation.e1,
  },
  featureIcon: { width: 36, height: 36, borderRadius: Radius.md, backgroundColor: InkColors.bgSoft, alignItems: 'center', justifyContent: 'center' },
  featureTitle: { fontSize: 14, fontWeight: '800', color: InkColors.ink },
  featureBody: { fontSize: 12, color: InkColors.ink2, lineHeight: 17 },

  avatarSm: { width: 30, height: 30, borderRadius: Radius.pill, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  myRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 12 },
  // 카드 안 행이 아니라 단독 행 — 테두리·배경을 스스로 갖고 터치 타깃 48dp를 지킨다.
  myRowSolo: {
    minHeight: 48,
    paddingHorizontal: Space.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    ...Elevation.e1,
  },
  myRowText: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink },
});
