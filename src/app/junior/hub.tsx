import { useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { logout } from '@/lib/auth';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import { Wordmark } from '@/components/Wordmark';

const CODE_LEN = 6;

type IconName = keyof typeof Ionicons.glyphMap;

// 직원 개인 허브 홈 — 회원가입 직후(매장 미연결) 착지점.
// 마이페이지 + 후킹 배너 + 가게 코드 입력 + 내 가게 목록을 한 화면에 모은다.
// 단일매장 모델이라 지금 '내 가게'는 0~1개지만, 목록(stores)으로 그려 향후 멀티매장 확장에 대비한다.
// 가게 합류/승인 대기 로직은 기존 joinByInvite(승인제)를 그대로 재사용한다.
export default function JuniorHub() {
  const router = useRouter();
  const userName = useSessionStore((s) => s.userName);
  const email = useSessionStore((s) => s.email);
  const unitId = useSessionStore((s) => s.unitId);
  const storeName = useSessionStore((s) => s.storeName);
  const joinByInvite = useSessionStore((s) => s.joinByInvite);
  const pendingUnitId = useSessionStore((s) => s.pendingUnitId);
  const pendingStoreName = useSessionStore((s) => s.pendingStoreName);
  const cancelJoinRequest = useSessionStore((s) => s.cancelJoinRequest);
  const refreshMembership = useSessionStore((s) => s.refreshMembership);

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 내 가게 목록 — 단일매장이라 연결 시 1개. 멀티매장 전환 시 여기만 배열로 바뀐다.
  const stores = unitId ? [{ id: unitId, name: storeName || '내 가게' }] : [];
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
    await cancelJoinRequest();
    setBusy(false);
    setCode('');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 상단 바: 워드마크 + 마이페이지 진입 */}
        <View style={styles.topbar}>
          <Wordmark size="sm" />
          <Pressable
            onPress={() => router.push('/account-edit')}
            hitSlop={8}
            style={({ pressed }) => [styles.myBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="person-circle-outline" size={26} color={InkColors.ink} />
          </Pressable>
        </View>

        {/* 인사 */}
        <View style={styles.greet}>
          <Text style={styles.hello}>
            안녕하세요{userName ? `, ${userName}님` : ''} 👋
          </Text>
          <Text style={styles.helloSub}>
            {hasStore ? '오늘도 착착 시작해볼까요?' : '가게에 연결하면 착착을 시작할 수 있어요.'}
          </Text>
        </View>

        {/* 후킹 배너 ① — 가게 연결 유도 (매장 없을 때만) */}
        {!hasStore && !pendingUnitId && (
          <Pressable onPress={focusCode} style={({ pressed }) => [styles.heroBanner, pressed && { opacity: 0.92 }]}>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>사장님께 코드를 받으셨나요?</Text>
              <Text style={styles.heroSub}>6자리 초대코드를 입력하면 가게에 연결돼요.</Text>
            </View>
            <View style={styles.heroCta}>
              <Text style={styles.heroCtaText}>코드 입력</Text>
              <Ionicons name="arrow-forward" size={15} color={InkColors.ink} />
            </View>
          </Pressable>
        )}

        {/* 내 가게 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>내 가게</Text>

          {pendingUnitId ? (
            <View style={styles.pendingCard}>
              <View style={styles.pendingHead}>
                <View style={styles.pendingIcon}>
                  <Ionicons name="hourglass-outline" size={20} color={BrandColors.warn} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storeName}>{pendingStoreName || '신청한 가게'}</Text>
                  <Text style={styles.pendingMeta}>사장님 승인 대기 중</Text>
                </View>
              </View>
              <Text style={styles.pendingBody}>승인되면 바로 이 가게로 들어갈 수 있어요.</Text>
              <View style={styles.pendingActions}>
                <Pressable disabled={busy} onPress={() => void refreshMembership()} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.ghostBtnText}>승인 확인</Text>
                </Pressable>
                <Pressable disabled={busy} onPress={onCancelPending} style={({ pressed }) => [styles.ghostBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.ghostBtnText}>신청 취소</Text>
                </Pressable>
              </View>
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
                  <Text style={styles.storeMeta}>탭하면 가게로 들어가요</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={InkColors.ink3} />
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="add-circle-outline" size={22} color={InkColors.ink3} />
              <Text style={styles.emptyText}>아직 연결된 가게가 없어요.{'\n'}아래에 초대코드를 입력해 가게를 추가하세요.</Text>
            </View>
          )}
        </View>

        {/* 가게 코드 입력 (대기 중이 아닐 때만) */}
        {!pendingUnitId && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>가게 코드 입력</Text>
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
                {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryText}>가게 추가하기</Text>}
              </Pressable>
              <Text style={styles.codeHint}>코드가 없으신가요? 사장님께 요청하세요 (사장님: 설정 › 가게 관리).</Text>
            </View>
          </View>
        )}

        {/* 후킹 배너 ② — 기능 소개/온보딩 */}
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

        {/* 마이페이지 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>마이페이지</Text>
          <View style={styles.myCard}>
            <View style={styles.myHead}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(userName || '?').slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.myName}>{userName || '이름 미설정'}</Text>
                {!!email && <Text style={styles.myEmail}>{email}</Text>}
              </View>
            </View>
            <Pressable onPress={() => router.push('/account-edit')} style={({ pressed }) => [styles.myRow, pressed && { opacity: 0.7 }]}>
              <Ionicons name="create-outline" size={18} color={InkColors.ink2} />
              <Text style={styles.myRowText}>프로필 편집</Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
            <Pressable onPress={() => void logout()} style={({ pressed }) => [styles.myRow, pressed && { opacity: 0.7 }]}>
              <Ionicons name="log-out-outline" size={18} color={InkColors.ink2} />
              <Text style={styles.myRowText}>로그아웃</Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
          </View>
        </View>
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
  myBtn: { padding: 2 },

  greet: { gap: 4 },
  hello: { fontSize: 22, fontWeight: '900', color: InkColors.ink },
  helloSub: { fontSize: 14, color: InkColors.ink2, lineHeight: 20 },

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
  heroSub: { fontSize: 13, color: InkColors.ink2, lineHeight: 19 },
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
  emptyText: { flex: 1, fontSize: 13, color: InkColors.ink2, lineHeight: 19 },

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
  pendingBody: { fontSize: 13, color: InkColors.ink2, lineHeight: 19 },
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
  err: { fontSize: 13, color: BrandColors.accent, fontWeight: '600' },
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

  myCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: InkColors.line,
    padding: Space.lg,
    gap: Space.sm,
    ...Elevation.e1,
  },
  myHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingBottom: Space.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: InkColors.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  myName: { fontSize: 15, fontWeight: '800', color: InkColors.ink },
  myEmail: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  myRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: 12, borderTopWidth: 1, borderTopColor: InkColors.line },
  myRowText: { flex: 1, fontSize: 14, fontWeight: '700', color: InkColors.ink },
});
