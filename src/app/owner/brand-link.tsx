// /owner/brand-link — 설정 > 본사 연결(정본 §4-E ②): 상태 · 요금 부담 · 공개 수준(즉시 변경) · 상향 요청 응답 · 요금 부담 제안 응답 · 해제.
//
// 재료 = useOwnerBrandStore(my_brand_view: 내가 사장인 매장의 active 연결). 0행이면 이 화면에 올 진입점이 없다.
// "본사가 보는 화면 그대로"(미러 뷰)는 P4 에서 본사 표 컴포넌트를 재사용해 붙인다.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { ScreenTitleHeader } from '@/components/ScreenTitleHeader';
import { ScreenLoading } from '@/components/ScreenLoading';
import { SectionLabel } from '@/components/SectionLabel';
import { BottomSheet } from '@/components/BottomSheet';
import { BrandMirrorView } from '@/components/owner/BrandMirrorView';
import { useOwnerBrandStore } from '@/lib/store/useOwnerBrandStore';
import { setBrandVisibility, acceptPayer, endBrandUnit, type MyBrandViewRow, type BrandVisibility } from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { VISIBILITY_LEVELS, NEVER_SHARED, END_REASONS, visibilityLabel, payerLabel } from '@/lib/brand/visibility';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space, SCREEN_GUTTER } from '@/lib/theme/layout';

const fmtBiz = (n: string | null) => (n && n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n || '미등록');
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');

export default function BrandLinkScreen() {
  const router = useRouter();
  const links = useOwnerBrandStore((s) => s.links);
  const loaded = useOwnerBrandStore((s) => s.loaded);
  const hydrate = useOwnerBrandStore((s) => s.hydrate);
  useEffect(() => { void hydrate(); }, [hydrate]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Stack.Screen options={{ title: '본사 연결' }} />
      <ScreenTitleHeader title="본사 연결" backFallback="/owner/settings" />
      {!loaded ? (
        <ScreenLoading label="본사 연결을 확인하는 중" />
      ) : links.length === 0 ? (
        <View style={styles.empty} testID="brand-link-empty">
          <Ionicons name="unlink-outline" size={28} color={InkColors.ink3} />
          <Text style={styles.emptyTitle}>연결된 본사가 없어요</Text>
          <Text style={styles.emptyBody}>본사가 내 번호로 초대를 보내면 홈에 요청 카드가 떠요. 연결은 초대로만 시작돼요.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}>
            <Text style={styles.secondaryText}>돌아가기</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} testID="brand-link">
          {links.map((l) => (
            <LinkCard key={l.unit_id} link={l} onChanged={() => void hydrate()} />
          ))}
          <SectionLabel icon="eye-outline" title="공개 수준이 뜻하는 것" />
          <View style={styles.card}>
            {VISIBILITY_LEVELS.map((lv, i) => (
              <View key={lv.key} style={[styles.lvRow, i > 0 && styles.rowBorder]}>
                <Text style={styles.lvName}>{lv.label}</Text>
                <Text style={styles.lvItems}>{lv.sees.join(' · ')}</Text>
              </View>
            ))}
            <View style={[styles.lvRow, styles.rowBorder]}>
              <Text style={[styles.lvName, { color: BrandColors.badText }]}>어느 수준에도 없음</Text>
              <Text style={styles.lvItems}>{NEVER_SHARED.join(' · ')}</Text>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function LinkCard({ link, onChanged }: { link: MyBrandViewRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const run = async (fn: () => Promise<{ message: string } | null>, okMsg: string) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) {
      showToast(brandErrorMessage(err), 'warn');
      return false;
    }
    showToast(okMsg, 'good');
    onChanged();
    return true;
  };

  const setLevel = (v: BrandVisibility) => {
    if (v === link.visibility && !link.visibility_requested) return;
    void run(() => setBrandVisibility(link.unit_id, v), v === link.visibility ? '지금 수준을 유지해요.' : `${visibilityLabel(v)}로 바꿨어요. 본사 화면에 바로 반영돼요.`);
  };

  const end = async (reason: string) => {
    setEndOpen(false);
    const ok = await confirmAction('연결 해제', `${link.brand_name}와의 연결을 끝낼까요? 본사는 더 이상 이 매장을 보지 못하고, 받았던 노하우는 매장에 남아요.`, '해제', { destructive: true, icon: 'unlink-outline' });
    if (!ok) return;
    await run(() => endBrandUnit(link.unit_id, reason), '연결을 끝냈어요.');
  };

  return (
    <View style={styles.card} testID={`brand-link-${link.unit_id}`}>
      <View style={styles.head}>
        <View style={styles.headIcon}><Ionicons name="business" size={18} color={InkColors.ink} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.brand} numberOfLines={1}>{link.brand_name}</Text>
          <Text style={styles.meta}>사업자등록번호 {fmtBiz(link.brand_biz_no)} · {fmtDay(link.accepted_at)} 연결</Text>
        </View>
        <View style={styles.pill}><Text style={styles.pillText}>연결됨</Text></View>
      </View>

      <View style={[styles.kv, styles.rowBorder]}>
        <Text style={styles.k}>요금 부담</Text>
        <Text style={styles.v}>{payerLabel(link.payer)}</Text>
      </View>

      {/* 요금 부담 제안(§3-5 D) — 본사가 보낸 제안에만 답한다. 내 제안은 본사 대기 표시. */}
      {link.payer_proposed ? (
        <View style={[styles.banner, styles.rowBorder]}>
          <Ionicons name="card-outline" size={16} color={BrandColors.warnText} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>
              {link.payer_proposed_by_me ? `${payerLabel(link.payer_proposed)}으로 바꾸자는 내 제안을 본사가 보고 있어요` : `본사가 ${payerLabel(link.payer_proposed)}으로 바꾸자고 제안했어요`}
            </Text>
            {!link.payer_proposed_by_me ? (
              <View style={styles.bannerActions}>
                <Pressable testID="brand-payer-accept" accessibilityRole="button" disabled={busy} onPress={() => void run(() => acceptPayer(link.unit_id, true), '요금 부담이 바뀌었어요.')} style={styles.smallPri}>
                  <Text style={styles.smallPriText}>수락</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(() => acceptPayer(link.unit_id, false), '제안을 거절했어요.')} style={styles.small}>
                  <Text style={styles.smallText}>거절</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* 공개 수준 — 언제든, 즉시(§3-4). 상향 요청이 있으면 그 수준을 누르면 수락, 지금 수준을 누르면 유지. */}
      <View style={[styles.section, styles.rowBorder]}>
        <Text style={styles.k}>공개 수준</Text>
        {link.visibility_requested ? (
          <View style={styles.reqBanner}>
            <Ionicons name="arrow-up-circle-outline" size={16} color={BrandColors.warnText} />
            <Text style={styles.reqText}>본사가 <Text style={{ fontWeight: '800' }}>{visibilityLabel(link.visibility_requested)}</Text>로 올려 달라고 요청했어요. 아래에서 그 수준을 고르면 수락, 지금 수준을 고르면 유지예요.</Text>
          </View>
        ) : null}
        <View style={styles.levels}>
          {VISIBILITY_LEVELS.map((lv) => {
            const on = lv.key === link.visibility;
            const requested = lv.key === link.visibility_requested;
            return (
              <Pressable
                key={lv.key}
                testID={`brand-vis-${lv.key}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={lv.label}
                disabled={busy}
                onPress={() => setLevel(lv.key)}
                style={[styles.level, on && styles.levelOn, requested && styles.levelReq]}
              >
                <Text style={[styles.levelName, on && { color: InkColors.ink }]}>{lv.label}</Text>
                <Text style={styles.levelShort}>{lv.short}</Text>
                {on && link.visibility_requested ? <Text style={styles.levelTag}>지금 · 유지하려면 다시 누르기</Text> : null}
                {requested ? <Text style={styles.levelTag}>본사 요청</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* 미러 뷰 — 대칭 가시성(§4-A). 해제 바로 위에 둔다: "무엇이 보이는지"를 본 다음 끊을지 고른다. */}
      <View style={[styles.section, styles.rowBorder]}>
        <BrandMirrorView unitId={link.unit_id} />
      </View>

      <View style={[styles.section, styles.rowBorder]}>
        <Pressable testID="brand-end" accessibilityRole="button" disabled={busy} onPress={() => setEndOpen(true)} style={({ pressed }) => [styles.danger, pressed && { opacity: 0.8 }]}>
          <Ionicons name="unlink-outline" size={16} color={BrandColors.badText} />
          <Text style={styles.dangerText}>연결 해제</Text>
        </Pressable>
        <Text style={styles.note}>해제해도 받았던 노하우는 매장에 남아요. 본사 부담이었다면 이번 달 말까지는 그대로예요.</Text>
      </View>

      <BottomSheet visible={endOpen} onClose={() => setEndOpen(false)}>
        <Text style={styles.sheetTitle}>왜 끝내나요?</Text>
        <Text style={styles.note}>사유는 본사에 그대로 전해져요.</Text>
        <View style={{ marginTop: Space.md }}>
          {END_REASONS.map((r, i) => (
            <Pressable key={r.key} testID={`brand-end-${r.key}`} accessibilityRole="button" onPress={() => void end(r.key)} style={[styles.reasonRow, i > 0 && styles.rowBorder]}>
              <Text style={styles.reasonText}>{r.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={InkColors.ink3} />
            </Pressable>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.cream },
  body: { paddingHorizontal: SCREEN_GUTTER, paddingBottom: 48, gap: Space.md },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.sm },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  emptyBody: { fontSize: 13.5, lineHeight: 20, color: InkColors.ink2, textAlign: 'center' },
  card: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg, overflow: 'hidden', ...Elevation.e1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.md },
  headIcon: { width: 36, height: 36, borderRadius: Radius.sm, backgroundColor: BrandColors.yellowSoft, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 16, fontWeight: '800', color: InkColors.ink },
  meta: { fontSize: 12, color: InkColors.ink3, marginTop: 2 },
  pill: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: Radius.pill, backgroundColor: BrandColors.goodSoft },
  pillText: { fontSize: 11.5, fontWeight: '700', color: BrandColors.goodText },
  rowBorder: { borderTopWidth: 1, borderTopColor: InkColors.line },
  kv: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.md, minHeight: 48 },
  k: { fontSize: 13, fontWeight: '700', color: InkColors.ink2, flex: 1 },
  v: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  banner: { flexDirection: 'row', gap: Space.sm, padding: Space.md, backgroundColor: BrandColors.warnSoft },
  bannerTitle: { fontSize: 13, lineHeight: 19, color: BrandColors.warnText, fontWeight: '600' },
  bannerActions: { flexDirection: 'row', gap: Space.sm, marginTop: Space.sm },
  smallPri: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: InkColors.ink },
  smallPriText: { fontSize: 13, fontWeight: '800', color: InkColors.bubbleText },
  small: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg },
  smallText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  section: { padding: Space.md, gap: Space.sm },
  reqBanner: { flexDirection: 'row', gap: Space.sm, alignItems: 'flex-start', padding: Space.sm, borderRadius: Radius.sm, backgroundColor: BrandColors.warnSoft },
  reqText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: BrandColors.warnText },
  levels: { gap: Space.sm },
  level: { borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingVertical: 10, paddingHorizontal: Space.md, minHeight: 48, justifyContent: 'center' },
  levelOn: { borderColor: InkColors.ink, backgroundColor: BrandColors.yellowSoft },
  levelReq: { borderColor: BrandColors.warnBorder, borderStyle: 'dashed' },
  levelName: { fontSize: 14, fontWeight: '800', color: InkColors.ink2 },
  levelShort: { fontSize: 12, color: InkColors.ink3, marginTop: 1 },
  levelTag: { fontSize: 11.5, fontWeight: '700', color: BrandColors.warnText, marginTop: 3 },
  danger: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: Radius.pill, backgroundColor: BrandColors.badSoft },
  dangerText: { fontSize: 13, fontWeight: '800', color: BrandColors.badText },
  note: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3 },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space.lg },
  secondaryText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  lvRow: { paddingVertical: 10, paddingHorizontal: Space.md, gap: 2 },
  lvName: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink },
  lvItems: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink2 },
  sheetTitle: { fontSize: 17, fontWeight: '900', color: InkColors.ink, marginBottom: 4 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: Space.md },
  reasonText: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
});
