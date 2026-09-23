// /owner/brand-consent?invite= — 본사 연결 요청 동의 화면(정본 §3-5 B · §5-3: 관측 경계표를 **첫 화면**에).
//
//   본사명·사업자번호 → 본사가 보게 되는 것(공개 수준 3단 표 + 어느 수준에도 없는 것) → 연결할 내 매장 선택
//   → 요금 부담 표시 → 소인원 고지 한 줄 → [수락] / [거절] → respond_brand_invite.
// 수락 전엔 본사가 내 매장명을 모른다(초대 행엔 번호만). 여기서 고른 매장만 본사에 보인다.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { SectionLabel } from '@/components/SectionLabel';
import { useOwnerBrandStore } from '@/lib/store/useOwnerBrandStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { respondBrandInvite, ackBrandConsent, type BrandVisibility, type MyBrandViewRow } from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { VISIBILITY_LEVELS, NEVER_SHARED, payerLabel, relationLabel, RELATION_RULES, visibilityLabel } from '@/lib/brand/visibility';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, SCREEN_GUTTER } from '@/lib/theme/layout';

const fmtBiz = (n: string | null) => (n && n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n || '미등록');

export default function BrandConsentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ invite?: string }>();
  const invites = useOwnerBrandStore((s) => s.invites);
  const links = useOwnerBrandStore((s) => s.links);
  const loaded = useOwnerBrandStore((s) => s.loaded);
  const hydrate = useOwnerBrandStore((s) => s.hydrate);
  const stores = useSessionStore((s) => s.stores);
  useEffect(() => { void hydrate(); }, [hydrate]);

  // `?invite=` 가 없으면(알림 탭) 가장 최근 요청.
  const invite = useMemo(
    () => (typeof params.invite === 'string' && invites.find((i) => i.invite_id === params.invite)) || invites[0] || null,
    [invites, params.invite],
  );
  // ★관계가 바뀌어 **다시 받는** 동의·고지(0224 · 정본 §8). 새 초대와 같은 화면을 쓰되 갈래가 다르다:
  //   가맹 = [수락]/[거절](거절하면 연결이 끝난다) · 직영 = [확인]/[문의하기](고지라 거절이 없다).
  //   이미 연결된 매장이라 매장 고르기·수준 고르기가 없다 — 무엇이 달라졌는지만 말한다.
  const pending = useMemo(() => links.find((l) => l.consent_pending) ?? null, [links]);
  // 내가 사장인 매장 중 아직 어느 본사에도 연결 안 된 것만 고를 수 있다(매장은 동시에 한 브랜드).
  const linkedIds = useMemo(() => new Set(links.map((l) => l.unit_id)), [links]);
  const candidates = useMemo(() => stores.filter((s) => s.role === 'owner' && !linkedIds.has(s.unit_id)), [stores, linkedIds]);

  // 사용자가 손대기 전(null)엔 매장이 하나뿐이면 그것이 골라져 있다 — 고를 것이 없는데 고르라고 하지 않는다.
  const [touched, setTouched] = useState<Set<string> | null>(null);
  const picked = touched ?? (candidates.length === 1 ? new Set([candidates[0].unit_id]) : new Set<string>());
  const [level, setLevel] = useState<BrandVisibility>('summary');
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => {
    const n = new Set(picked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setTouched(n);
  };

  const respond = async (accept: boolean) => {
    if (!invite) return;
    if (accept && picked.size === 0) {
      showToast('연결할 매장을 하나 이상 골라 주세요.', 'warn');
      return;
    }
    const ok = accept
      ? await confirmAction('연결 수락', `${invite.brand_name}에 ${picked.size}곳을 ${VISIBILITY_LEVELS.find((l) => l.key === level)?.label} 수준으로 연결할까요? 수준은 언제든 설정에서 바꿀 수 있어요.`, '수락', { icon: 'link-outline' })
      : await confirmAction('요청 거절', `${invite.brand_name}의 연결 요청을 거절할까요? 본사가 다시 초대할 수 있어요.`, '거절', { destructive: true, icon: 'close-circle-outline' });
    if (!ok) return;
    setBusy(true);
    const err = await respondBrandInvite(invite.invite_id, accept ? [...picked] : [], accept ? level : 'summary', accept);
    setBusy(false);
    if (err) {
      showToast(brandErrorMessage(err), 'warn');
      return;
    }
    showToast(accept ? `${invite.brand_name}와 연결됐어요.` : '요청을 거절했어요.', 'good');
    await hydrate();
    if (accept) router.replace('/owner/brand-link');
    else router.back();
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ title: '본사 연결 요청' }} />
      <ScreenTitleHeader title="본사 연결 요청" backFallback="/hub" />
      {!loaded ? (
        <ScreenLoading label="연결 요청을 확인하는 중" />
      ) : pending ? (
        // 다시 받는 동의·고지가 있으면 그것이 먼저다 — 이미 연결된 매장의 규칙이 바뀐 것이라 더 급하다.
        <ReConsent link={pending} onDone={() => { void hydrate(); router.replace('/owner/brand-link'); }} />
      ) : !invite ? (
        <View style={styles.empty} testID="brand-consent-empty">
          <Ionicons name="checkmark-circle-outline" size={28} color={InkColors.ink3} />
          <Text style={styles.emptyTitle}>기다리는 연결 요청이 없어요</Text>
          <Text style={styles.emptyBody}>본사가 내 번호로 초대를 보내면 여기에 떠요. 이미 답했거나 14일이 지나 만료된 요청은 보이지 않아요.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} testID="brand-consent">
          {/* 1) 누가 */}
          <View style={styles.hero}>
            <View style={styles.heroIcon}><Ionicons name="business" size={20} color={InkColors.ink} /></View>
            <Text style={styles.heroTitle}>{invite.brand_name}</Text>
            <Text style={styles.heroSub}>사업자등록번호 {fmtBiz(invite.brand_biz_no)}</Text>
            <Text style={styles.heroSub}>이 매장 요금 부담 · <Text style={{ fontWeight: '800', color: InkColors.ink }}>{payerLabel(invite.payer)}</Text></Text>
          </View>

          {/* 2) 본사가 보게 되는 것 — 첫 화면(§5-3). 고른 수준이 곧 동의 범위다. */}
          <SectionLabel icon="eye-outline" title="본사가 보게 되는 것" hint="수준은 내가 고르고, 언제든 바꿀 수 있어요" />
          <View style={styles.levels}>
            {VISIBILITY_LEVELS.map((l) => {
              const on = level === l.key;
              return (
                <Pressable
                  key={l.key}
                  testID={`brand-level-${l.key}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={l.label}
                  onPress={() => setLevel(l.key)}
                  style={[styles.level, on && styles.levelOn]}
                >
                  <View style={styles.levelHead}>
                    <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={18} color={on ? InkColors.ink : InkColors.ink3} />
                    <Text style={[styles.levelName, on && { color: InkColors.ink }]}>{l.label}</Text>
                    <Text style={styles.levelShort}>{l.short}</Text>
                  </View>
                  {l.sees.map((s) => (
                    <Text key={s} style={styles.levelItem}>· {s}</Text>
                  ))}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.never}>
            <Text style={styles.neverTitle}>어느 수준에서도 본사에 가지 않는 것</Text>
            <Text style={styles.neverBody}>{NEVER_SHARED.join(' · ')}</Text>
          </View>
          {/* 소인원 고지(정본 §4-A Q9: 전 매장 같은 표시). */}
          <Text style={styles.note}>직원이 1~2명인 매장은 매장 단위 숫자만으로도 누구인지 짐작될 수 있어요.</Text>

          {/* 3) 어느 매장을 */}
          <SectionLabel icon="storefront-outline" title="연결할 내 매장" hint="고른 매장만 본사에 보여요" />
          {candidates.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardText}>연결할 수 있는 매장이 없어요. 내가 사장인 매장 중 아직 다른 본사와 연결되지 않은 매장만 고를 수 있어요.</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {candidates.map((s, i) => {
                const on = picked.has(s.unit_id);
                return (
                  <Pressable
                    key={s.unit_id}
                    testID={`brand-pick-${s.unit_id}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={s.store_name}
                    onPress={() => toggle(s.unit_id)}
                    style={[styles.pickRow, i > 0 && styles.pickBorder]}
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? InkColors.ink : InkColors.ink3} />
                    <Text style={styles.pickName} numberOfLines={1}>{s.store_name}</Text>
                    {s.industry ? <Text style={styles.pickSub}>{s.industry}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* 4) 답 */}
          <Text style={styles.note}>수락한 뒤에도 설정 &gt; 본사 연결에서 공개 수준을 바꾸거나 연결을 끝낼 수 있어요. 본사가 해제해도 받은 노하우는 매장에 남아요.</Text>
          <Pressable
            testID="brand-accept"
            accessibilityRole="button"
            disabled={busy || candidates.length === 0}
            onPress={() => void respond(true)}
            style={({ pressed }) => [styles.primary, (busy || candidates.length === 0) && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.primaryText}>{picked.size > 0 ? `${picked.size}곳 연결 수락` : '연결 수락'}</Text>
          </Pressable>
          <Pressable testID="brand-decline" accessibilityRole="button" disabled={busy} onPress={() => void respond(false)} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}>
            <Text style={styles.secondaryText}>거절</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * 관계가 바뀐 뒤 다시 받는 동의·고지(정본 §7·§8).
 *
 * 경계표는 새 초대 화면과 **같은 표**(`RELATION_RULES` · `NEVER_SHARED`)를 쓴다 — 두 화면이 다른 표를
 * 그리면 점주가 동의한 것과 본사가 보는 것이 달라진다(brand-boundary 가 가장 경계하는 사고).
 * 다른 것은 두 칸뿐이다: 버튼(수락/거절 vs 확인/문의하기)과 성격(동의 vs 고지).
 */
function ReConsent({ link, onDone }: { link: MyBrandViewRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const notice = link.consent_kind === 'notice';

  const answer = async (accept: boolean) => {
    if (!accept) {
      const ok = await confirmAction(
        '연결 해제',
        `동의하지 않으면 ${link.brand_name}와의 연결이 끝나요. 받았던 노하우는 매장에 남아요.`,
        '동의 안 함',
        { destructive: true, icon: 'unlink-outline' },
      );
      if (!ok) return;
    }
    setBusy(true);
    const err = await ackBrandConsent(link.unit_id, accept);
    setBusy(false);
    if (err) {
      showToast(brandErrorMessage(err), 'warn');
      return;
    }
    showToast(accept ? '확인했어요.' : '연결을 끝냈어요.', 'good');
    onDone();
  };

  return (
    <ScrollView contentContainerStyle={styles.body} testID="brand-reconsent">
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="swap-horizontal" size={20} color={InkColors.ink} /></View>
        <Text style={styles.heroTitle}>{link.brand_name}</Text>
        <Text style={styles.heroSub}>사업자등록번호 {fmtBiz(link.brand_biz_no)}</Text>
        <Text style={styles.heroSub}>
          이 매장은 이제 <Text style={{ fontWeight: '800', color: InkColors.ink }}>{relationLabel(link.relation)}점</Text>이에요
        </Text>
      </View>

      <SectionLabel
        icon={notice ? 'megaphone-outline' : 'shield-checkmark-outline'}
        title={notice ? '본사가 보는 범위를 알려드려요' : '공개 범위에 다시 동의해 주세요'}
        hint={notice ? '직영점이라 본사가 정해요' : '관계가 바뀌어 근거가 달라졌어요'}
      />
      <View style={styles.card}>
        <Text style={styles.cardText}>
          {notice
            ? '본사가 이 매장을 직영으로 전환했어요. 직영점은 공개 범위의 최소선을 본사가 정하고, 점장님은 그 위로만 조정할 수 있어요.'
            : '이 매장이 가맹으로 바뀌었어요. 이제 공개 범위를 사장님이 직접 정하고, 연결도 언제든 끊을 수 있어요.'}
        </Text>
      </View>

      {/* 지금 실제로 무엇이 보이나 — 추상적인 표보다 이 한 줄이 먼저다. */}
      <View style={styles.card}>
        <View style={styles.pickRow}>
          <Ionicons name="eye-outline" size={18} color={InkColors.ink3} />
          <Text style={styles.pickName}>지금 공개 수준</Text>
          <Text style={styles.pickSub}>{visibilityLabel(link.visibility)}</Text>
        </View>
        {notice ? (
          <View style={[styles.pickRow, styles.pickBorder]}>
            <Ionicons name="lock-closed" size={18} color={InkColors.ink3} />
            <Text style={styles.pickName}>본사가 정한 최소선</Text>
            <Text style={styles.pickSub}>{visibilityLabel(link.visibility_floor)}</Text>
          </View>
        ) : null}
      </View>

      <SectionLabel icon="list-outline" title={`${relationLabel(link.relation)}점에서는 이렇게 달라져요`} />
      <View style={styles.card}>
        {RELATION_RULES.map((r, i) => (
          <View key={r.label} style={[styles.pickRow, i > 0 && styles.pickBorder]}>
            <Text style={styles.pickName}>{r.label}</Text>
            <Text style={styles.pickSub}>{link.relation === 'direct' ? r.direct : r.franchise}</Text>
          </View>
        ))}
      </View>

      <View style={styles.never}>
        <Text style={styles.neverTitle}>관계와 상관없이 본사에 가지 않는 것</Text>
        <Text style={styles.neverBody}>{NEVER_SHARED.join(' · ')}</Text>
      </View>

      <Pressable
        testID="brand-reconsent-accept"
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void answer(true)}
        style={({ pressed }) => [styles.primary, busy && { opacity: 0.45 }, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.primaryText}>{notice ? '확인했어요' : '동의하고 계속하기'}</Text>
      </Pressable>
      {notice ? (
        <Pressable
          testID="brand-reconsent-ask"
          accessibilityRole="button"
          onPress={() => showToast('본사 담당자에게 문의해 주세요.', 'info')}
          style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.secondaryText}>문의하기</Text>
        </Pressable>
      ) : (
        <Pressable
          testID="brand-reconsent-decline"
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void answer(false)}
          style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.secondaryText}>동의하지 않기(연결 끝내기)</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  body: { paddingHorizontal: SCREEN_GUTTER, paddingBottom: 48, gap: Space.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.sm },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  emptyBody: { fontSize: 13.5, lineHeight: 20, color: InkColors.ink2, textAlign: 'center' },
  hero: { alignItems: 'center', gap: 4, paddingVertical: Space.lg },
  heroIcon: { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  heroTitle: { fontSize: 20, fontWeight: '900', color: InkColors.ink, letterSpacing: -0.4 },
  heroSub: { fontSize: 13, color: InkColors.ink2 },
  levels: { gap: Space.sm },
  level: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, padding: Space.md, backgroundColor: InkColors.bg, gap: 3, ...Elevation.e1 },
  levelOn: { borderColor: InkColors.ink, backgroundColor: BrandColors.yellowSoft },
  levelHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 4 },
  levelName: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
  levelShort: { fontSize: 12, color: InkColors.ink3, marginLeft: 'auto' },
  levelItem: { fontSize: 13, lineHeight: 19, color: InkColors.ink, paddingLeft: 26 },
  never: { borderWidth: 1, borderColor: BrandColors.badSoft, backgroundColor: BrandColors.badSoft, borderRadius: Radius.md, padding: Space.md },
  neverTitle: { fontSize: 13, fontWeight: '800', color: BrandColors.badText, marginBottom: 3 },
  neverBody: { fontSize: 12.5, lineHeight: 18, color: BrandColors.badText },
  note: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3 },
  card: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, overflow: 'hidden', ...Elevation.e1 },
  cardText: { fontSize: 13.5, lineHeight: 20, color: InkColors.ink2, padding: Space.md },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingHorizontal: Space.md, minHeight: 52 },
  pickBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  pickName: { flex: 1, fontSize: 15, fontWeight: '700', color: InkColors.ink },
  pickSub: { fontSize: 12, color: InkColors.ink3 },
  primary: { marginTop: Space.sm, minHeight: 52, borderRadius: Radius.pill, backgroundColor: BrandColors.brand, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
});
