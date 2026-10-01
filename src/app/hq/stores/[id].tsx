// /hq/stores/<unit_id> — 매장 상세(정본 §5-2): 연결 정보 · 직영 전용 규칙 · 공개 수준 요청 · 요금 부담 제안 · 연결 해제.
//
// 예전 드로어 내용을 섹션 그대로 옮겼다(문구·권한 판정 동일). 주소가 SSOT 라 공유·새로고침·뒤로가기가 된다.
// ★탭을 만들지 않는다 — 섹션이 더 늘면 그때 `[id]/_layout.tsx` 로 승격한다.
// 재료 = useBrandUnitsStore(이 매장의 overview 행) · useBrandUnitDetailStore(부담 날짜 · 직영 규칙 — 상세가 열릴 때만 받는다).
import { useEffect, useState, type ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HqButton, HqPill, HqRow, HqSlab, HqSegment, HqEmpty } from '@/components/hq/HqKit';
import { useStoresTwoPane } from '@/components/hq/storesPane';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { useBrandUnitDetailStore } from '@/lib/store/useBrandUnitDetailStore';
import {
  requestVisibility,
  proposePayer,
  acceptPayer,
  endBrandUnit,
  setVisibilityFloor,
  setContentRequired,
  setOwnerCanEnd,
  type BrandOverviewRow,
  type BrandPayer,
  type BrandPayerDateRow,
  type BrandRelation,
  type BrandUnitRulesRow,
  type BrandVisibility,
} from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { visibilityLabel, payerLabel, relationLabel, VISIBILITY_LEVELS } from '@/lib/brand/visibility';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
// 목록(`_layout`)과 같은 배지 색 — 같은 매장이 두 칸에서 다른 색이면 안 된다.
const VIS_TONE: Record<BrandVisibility, 'n' | 'i' | 'g'> = { summary: 'n', knowhow: 'i', ops: 'g' };
const REL_TONE: Record<BrandRelation, 'i' | 'n'> = { direct: 'i', franchise: 'n' };

/**
 * 요금 부담 줄 옆의 날짜 한 마디(정본 §4-D). 본사 부담이면 "언제부터", 매장 부담인데 이번 달까지
 * 본사가 내는 중이면 "언제까지". 둘 다 없으면 아무 말도 안 붙인다 — 빈 칸이 낫다.
 */
function payerDateNote(payer: BrandPayer, dates: BrandPayerDateRow | null): string | undefined {
  if (!dates) return undefined;
  if (payer === 'brand' && dates.payer_effective_from) return `${dates.payer_effective_from}부터 본사 부담`;
  if (payer === 'store' && dates.brand_paid_through) return `본사 부담은 ${dates.brand_paid_through}까지`;
  return undefined;
}

export default function HqStoreDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const twoPane = useStoresTwoPane();

  const overview = useBrandUnitsStore((s) => s.overview);
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const refreshUnits = useBrandUnitsStore((s) => s.refresh);
  const payerDates = useBrandUnitDetailStore((s) => s.payerDates);
  const unitRules = useBrandUnitDetailStore((s) => s.unitRules);
  const detailLoaded = useBrandUnitDetailStore((s) => s.loaded);
  // 상세 칸의 ready 게이트(ui.md) — 목록과 따로 갖는다. 직영 규칙이 늦게 오면 '권장'·'끊을 수 있어요' 같은
  // 기본값이 먼저 스쳤다가 바뀐다 — 본사가 그 순간 버튼을 누르면 반대로 바꾼다.
  const ready = unitsLoaded && detailLoaded;
  const hydrateDetail = useBrandUnitDetailStore((s) => s.hydrate);
  const refreshDetail = useBrandUnitDetailStore((s) => s.refresh);

  // 부담 날짜·직영 규칙은 상세가 열릴 때만 받는다(쓰는 곳이 여기뿐이다). 매장을 갈아 끼울 때마다 다시 받는다.
  useEffect(() => { void hydrateDetail(); }, [id, hydrateDetail]);

  /**
   * 닫기 = 이 매장 칸의 스택에서 한 칸 뒤로(= 목록). 주소로 바로 들어와 뒤가 없으면 목록 주소로.
   * ★전역 `router.canGoBack()` 이 아니라 가장 가까운 네비게이터로 판정한다 — 전역은 부모 스택까지 봐서
   *   대시보드에서 들어온 경우 '닫기'가 대시보드로 새어 나간다(HeaderBackButton 과 같은 이유).
   */
  const close = () => (navigation.canGoBack() ? navigation.goBack() : router.replace('/hq/stores'));

  const row = overview.find((r) => r.unit_id === id) ?? null;

  if (!ready) return <ScreenLoading label="매장 정보를 불러오고 있어요…" />;
  if (!row) {
    return (
      <DetailFrame title="매장" twoPane={twoPane} onClose={close}>
        <HqEmpty text="이 매장은 지금 연결된 매장 목록에 없어요." />
      </DetailFrame>
    );
  }

  return (
    <DetailFrame title={row.store_name} sub={row.industry ?? undefined} twoPane={twoPane} onClose={close}>
      {/* key = 매장 — 2단에서 다른 매장으로 갈아 끼울 때 로컬 상태(요청 수준 기본값)가 그 매장으로 선다.
          라우트 replace 도 새로 마운트하지만, 같은 라우트의 파라미터만 바뀌는 경로가 생겨도 안전하게. */}
      <StoreDetail
        key={row.unit_id}
        row={row}
        dates={payerDates.find((d) => d.unit_id === row.unit_id) ?? null}
        rules={unitRules.find((r) => r.unit_id === row.unit_id) ?? null}
        onClose={close}
        onChanged={() => { void refreshUnits(); void refreshDetail(); }}
      />
    </DetailFrame>
  );
}

/**
 * 상세 칸의 머리 — 넓은 창(목록 옆)은 예전 드로어처럼 오른쪽 ✕, 좁은 창(상세만)은 '목록으로' ←.
 * testID 는 예전 드로어 것을 그대로 쓴다(`qa-hq-browser` C9 가 이 이름으로 찾는다).
 */
function DetailFrame({ title, sub, twoPane, onClose, children }: {
  title: string;
  sub?: string;
  twoPane: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ScrollView style={styles.frame} contentContainerStyle={styles.body} testID="hq-drawer">
      {twoPane ? null : (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="목록으로"
          testID="hq-drawer-close"
          style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="arrow-back" size={18} color={InkColors.ink2} />
          <Text style={styles.backText}>목록으로</Text>
        </Pressable>
      )}
      <View style={styles.dh}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.h3} numberOfLines={2}>{title}</Text>
          {sub ? <Text style={styles.p}>{sub}</Text> : null}
        </View>
        {twoPane ? (
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="닫기" testID="hq-drawer-close" style={({ pressed }) => [styles.x, pressed && { backgroundColor: InkColors.paper }]}>
            <Ionicons name="close" size={18} color={InkColors.ink2} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </ScrollView>
  );
}

// ── 상세: 연결 정보 · 상향 요청 · payer 제안/응답 · 해제 ─────────────────────
function StoreDetail({ row, dates, rules, onClose, onChanged }: {
  row: BrandOverviewRow;
  /** 0221 본사 부담 시작·종료일. `brand_overview` 를 넓히지 않고 작은 RPC 로 따로 받는다. */
  dates: BrandPayerDateRow | null;
  /** 0224 직영 전용 값 3개. 가맹이면 전부 기본값이고 아래 구역이 통째로 회색이다. */
  rules: BrandUnitRulesRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // 지금 수준보다 높은 첫 수준을 기본으로(부모가 key 로 매장마다 새로 마운트한다).
  const [reqLevel, setReqLevel] = useState<'knowhow' | 'ops'>(() => (row.visibility === 'summary' ? 'knowhow' : 'ops'));

  const direct = row.relation === 'direct';
  const canRequest = row.visibility !== 'ops' && !row.visibility_requested;
  const otherPayer: BrandPayer = row.payer === 'brand' ? 'store' : 'brand';
  const payerNote = payerDateNote(row.payer, dates);

  const run = async (fn: () => Promise<{ message: string } | null>, okMsg: string) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) {
      showToast(brandErrorMessage(err), 'warn');
      return;
    }
    showToast(okMsg, 'good');
    onChanged();
  };

  return (
    <>
      <View style={styles.kv}>
        {/* 관계(0223) — 맨 위. 아래 줄들이 "누가 정하나"로 갈리는 기준이라 먼저 읽혀야 한다.
            ⛔여기서 바꾸는 길은 없다(정본 §12 R3: 우리만 바꾼다). 바꾸려면 내부 콘솔이다. */}
        <HqRow first k="관계" v={<HqPill tone={REL_TONE[row.relation]} label={relationLabel(row.relation)} />} />
        <HqRow k="연결일" v={fmtDay(row.accepted_at)} />
        <HqRow
          k="요금 부담"
          v={<HqPill tone={row.payer === 'brand' ? 'y' : 'n'} label={payerLabel(row.payer)} />}
          tail={payerNote ? <Text style={styles.payerNote}>{payerNote}</Text> : undefined}
        />
        <HqRow k="공개 수준" v={<HqPill tone={VIS_TONE[row.visibility]} label={visibilityLabel(row.visibility)} />} />
        <HqRow k="직원" v={`${row.staff}명`} />
        <HqRow k="자체 노하우" v={`${row.knowhow_own}건`} />
        <HqRow k="미해결 질문" v={`${row.pending_q}건`} />
        <HqRow k="AI 사용(월)" v={`${row.ai_used}건`} />
        {row.tasks_done_30d !== null ? <HqRow k="업무 완료(30일)" v={`${row.tasks_done_30d}건`} /> : null}
        {row.quiz_courses !== null ? <HqRow k="매장 퀴즈" v={`${row.quiz_courses}개`} /> : null}
        {/* 0226 집계 세분화(정본 02 §3 이유 2) — **누가**는 없다. 본사는 점장에게 말하면 되고 점장은 안다.
            ⛔직영이라고 더 주지 않는다. 관계와 무관하게 '운영 공개'에서만 값이 온다. */}
        {row.staff_behind !== null ? <HqRow k="미이수 인원" v={`${row.staff_behind}명`} tail={<Text style={styles.payerNote}>받은 노하우를 하나라도 안 본 직원 수</Text>} /> : null}
        {row.weak_entries !== null ? <HqRow k="오답 몰린 노하우" v={`${row.weak_entries}건`} tail={<Text style={styles.payerNote}>직원이 못 외운 게 아니라 글이 헷갈릴 수 있어요</Text>} /> : null}
      </View>

      {/* 직영(0224) — 본사가 **하한**을 정한다. 점장은 그 위로만 움직인다(정본 §5 C안).
          ⛔가맹에는 이 구역이 없다. "점주가 동의하면 본사가 정한다"를 만들지 않는 것이 방어선이다(정본 §4). */}
      {direct ? (
        <View style={styles.section}>
          <HqSlab title="공개 범위 하한" hint="직영점만 · 점장은 이 위로만 고를 수 있어요" />
          <View style={{ gap: Space.sm }}>
            <HqSegment
              items={VISIBILITY_LEVELS.map((l) => ({ key: l.key, label: l.label }))}
              value={rules?.visibility_floor ?? 'summary'}
              onChange={(v) => void run(() => setVisibilityFloor(row.unit_id, v), '하한을 바꿨어요. 점장에게 알려드렸어요.')}
            />
            <Text style={styles.hint}>
              하한을 올리면 지금 공개 수준이 그 아래일 때 같이 올라가요. 바꾸면 점장에게 고지 알림이 한 건 가요.
            </Text>
          </View>
        </View>
      ) : null}

      {/* 직영(0224) — 필수 배포. ★배포 모달의 [필수로 내리기]는 이 값을 **켜기만** 한다.
          끄는 것은 상태가 보이는 여기뿐이다 — 배포가 체크 값을 그대로 반영하면 체크를 깜빡한
          재배포 한 번이 본사가 일부러 세운 제약을 조용히 푼다(사용자 결정 2026-09-23). */}
      {direct ? (
        <View style={styles.section}>
          <HqSlab title="받은 내용 숨기기 금지" hint="직영점만" />
          <View style={{ gap: Space.sm }}>
            <Text style={styles.hint}>
              {rules?.content_required
                ? '지금은 필수예요 — 점장이 받은 노하우·퀴즈를 숨길 수 없어요.'
                : '지금은 권장이에요 — 점장이 받은 내용을 숨길 수 있어요.'}
            </Text>
            <HqButton
              label={rules?.content_required ? '숨길 수 있게 되돌리기' : '필수로 바꾸기'}
              variant={rules?.content_required ? undefined : 'dark'}
              disabled={busy}
              testID="hq-content-required"
              onPress={() => void run(
                () => setContentRequired(row.unit_id, !rules?.content_required),
                rules?.content_required ? '이제 점장이 숨길 수 있어요.' : '필수로 바꿨어요.',
              )}
            />
          </View>
        </View>
      ) : null}

      {/* 직영(0227) — 점주 해제권. 0224 가 컬럼·서버 거부·점주 앱 자물쇠까지 만들고 **켜는 자리를
          빠뜨려서** 자물쇠가 도달 불가였다(2026-09-26 실측). 하한·필수 배포와 같은 층에 둔다. */}
      {direct ? (
        <View style={styles.section}>
          <HqSlab title="점주 해제권" hint="직영점만" />
          <View style={{ gap: Space.sm }}>
            <Text style={styles.hint}>
              {rules?.owner_can_end === false
                ? '지금은 본사 문의예요 — 점장이 매장에서 연결을 끊을 수 없어요.'
                : '지금은 끊을 수 있어요 — 점장이 매장에서 연결을 끝낼 수 있어요.'}
            </Text>
            <HqButton
              label={rules?.owner_can_end === false ? '끊을 수 있게 되돌리기' : '본사 문의로 바꾸기'}
              variant={rules?.owner_can_end === false ? undefined : 'dark'}
              disabled={busy}
              testID="hq-owner-can-end"
              onPress={() => void run(
                () => setOwnerCanEnd(row.unit_id, rules?.owner_can_end === false),
                rules?.owner_can_end === false ? '이제 점장이 끊을 수 있어요.' : '본사 문의로 바꿨어요.',
              )}
            />
          </View>
        </View>
      ) : null}

      {/* 공개 수준 상향 요청 — 가맹에서 본사는 **요청만**(§3-4). 점주가 앱에서 수락하거나 유지한다. */}
      {direct ? null : (
      <View style={styles.section}>
      <HqSlab title="공개 수준 올려 달라고 요청" />
      {row.visibility === 'ops' ? (
        <Text style={styles.hint}>가장 넓은 수준(운영 공개)이에요.</Text>
      ) : row.visibility_requested ? (
        <Text style={styles.hint}>{visibilityLabel(row.visibility_requested)} 요청을 점주가 보고 있어요. 점주가 답하면 표에 반영돼요.</Text>
      ) : (
        <View style={{ gap: Space.sm }}>
          <HqSegment
            items={VISIBILITY_LEVELS.filter((l) => l.key !== 'summary' && l.key !== row.visibility).map((l) => ({ key: l.key as 'knowhow' | 'ops', label: l.label }))}
            value={reqLevel}
            onChange={setReqLevel}
          />
          <HqButton
            label="요청 보내기"
            variant="dark"
            disabled={busy || !canRequest}
            testID="hq-request-visibility"
            onPress={() => void run(() => requestVisibility(row.unit_id, reqLevel), '점주에게 요청을 보냈어요.')}
          />
        </View>
      )}

      </View>
      )}

      {/* payer — 제안 → 상대 수락(§3-5 D). 반영 시점·정산은 P6.
          직영은 본사 부담 고정이라 제안 경로 자체가 없다(정본 §4-3 · 서버도 `direct_payer_fixed`). */}
      <View style={styles.section}>
      <HqSlab title="요금 부담 변경" />
      {direct ? (
        <Text style={styles.hint}>직영점은 본사 부담으로 고정돼요. 바꾸려면 먼저 관계를 가맹으로 바꿔야 해요(스퀘어테이블에 문의).</Text>
      ) : row.payer_proposed ? (
        row.payer_proposed_by_brand ? (
          <Text style={styles.hint}>{payerLabel(row.payer_proposed)}으로 바꾸자는 제안을 점주가 보고 있어요.</Text>
        ) : (
          <View style={{ gap: Space.sm }}>
            <Text style={styles.hint}>점주가 {payerLabel(row.payer_proposed)}으로 바꾸자고 제안했어요.</Text>
            <View style={{ flexDirection: 'row', gap: Space.sm }}>
              <HqButton label="수락" variant="pri" disabled={busy} onPress={() => void run(() => acceptPayer(row.unit_id, true), '요금 부담이 바뀌었어요.')} />
              <HqButton label="거절" disabled={busy} onPress={() => void run(() => acceptPayer(row.unit_id, false), '제안을 거절했어요.')} />
            </View>
          </View>
        )
      ) : (
        <View style={{ gap: Space.sm }}>
          <Text style={styles.hint}>지금은 {payerLabel(row.payer)}이에요. 바꾸려면 점주가 수락해야 해요.</Text>
          <HqButton
            label={`${payerLabel(otherPayer)}으로 제안`}
            disabled={busy}
            onPress={() => void run(() => proposePayer(row.unit_id, otherPayer), '점주에게 제안을 보냈어요.')}
          />
        </View>
      )}

      </View>

      <View style={styles.section}>
      <HqSlab title="연결 해제" />
      <Text style={styles.hint}>해제하면 이 매장을 더 보지 못해요. 매장이 받은 노하우는 매장에 남아요.</Text>
      <HqButton
        label="연결 해제"
        variant="danger"
        disabled={busy}
        onPress={() => {
          void (async () => {
            const ok = await confirmAction('연결 해제', `${row.store_name}과의 연결을 끝낼까요? 되돌리려면 다시 초대해야 해요.`, '해제', { destructive: true, icon: 'unlink-outline' });
            if (!ok) return;
            await run(() => endBrandUnit(row.unit_id, 'brand'), '연결을 끝냈어요.');
            onClose();
          })();
        }}
      />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // 예전 드로어(HqDrawer)의 본문·머리 치수 그대로.
  frame: { flex: 1, backgroundColor: InkColors.bg },
  body: { paddingVertical: 22, paddingHorizontal: 24 },
  dh: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  h3: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3, color: InkColors.ink },
  p: { fontSize: 14, color: InkColors.ink2, marginTop: 3 },
  x: { width: 32, height: 32, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 40, marginBottom: Space.sm },
  backText: { fontSize: 14, fontWeight: '700', color: InkColors.ink2 },
  kv: { borderTopWidth: 1, borderTopColor: InkColors.line, marginBottom: Space.lg },
  section: { marginBottom: Space.xl },
  hint: { fontSize: 14, lineHeight: 20, color: InkColors.ink2, marginBottom: Space.md },
  payerNote: { fontSize: 13.5, color: InkColors.ink3 },
});
