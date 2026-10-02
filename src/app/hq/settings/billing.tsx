// /hq/settings/billing — 설정 > 결제(정본 §5-2). 2026-10-02 하위 메뉴 개편으로 설정 한 장에서 나왔다.
//
// 재료 = useBrandStore(계약가 · 이용 기간) + useBrandUnitsStore(청구 줄의 관계·부담 수) + useBrandBillingStore(P6).
// ★결제는 **표시만**이다 — 발행·입금 확인·크레딧·환불은 내부 콘솔(service_role)이 한다(정본 §4-D·§5-2).
//   대상·금액도 여기서 세지 않는다. 내부 콘솔의 발행과 같은 함수(`brand_billing_preview`)가 준 줄을 더한다.
import { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HqPage, HqPill, HqCard, HqField, HqSlab, HqEmpty, HqLoadError } from '@/components/hq/HqKit';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandUnitsStore } from '@/lib/store/useBrandUnitsStore';
import { useBrandBillingStore } from '@/lib/store/useBrandBillingStore';
import { BILLING_RULES, INVOICE_STATUS, krw, periodLabel } from '@/lib/brand/billing';
import { relationLabel } from '@/lib/brand/visibility';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

export default function HqSettingsBillingScreen() {
  const brand = useBrandStore((s) => s.brand);
  const brandLoaded = useBrandStore((s) => s.loaded);
  const brandError = useBrandStore((s) => s.error);
  const hydrateBrand = useBrandStore((s) => s.hydrate);
  // 매장 축은 이 화면이 직접 받는다 — 청구 줄의 관계 배지와 "매장 부담 N곳"이 overview 에서 나온다(셸이 대신 받지 않는다).
  const overview = useBrandUnitsStore((s) => s.overview);
  const unitsLoaded = useBrandUnitsStore((s) => s.loaded);
  const unitsError = useBrandUnitsStore((s) => s.error);
  const hydrateUnits = useBrandUnitsStore((s) => s.hydrate);
  const error = brandError ?? unitsError;
  const hydrate = useCallback(() => Promise.all([hydrateBrand(), hydrateUnits()]), [hydrateBrand, hydrateUnits]);
  // 결제는 이 화면에서만 본다 — 대시보드·매장·노하우·퀴즈의 조회에 청구 RPC 를 얹지 않는다.
  const current = useBrandBillingStore((s) => s.current);
  const next = useBrandBillingStore((s) => s.next);
  const invoices = useBrandBillingStore((s) => s.invoices);
  const billingLoaded = useBrandBillingStore((s) => s.loaded);
  const billingError = useBrandBillingStore((s) => s.error);
  const hydrateBilling = useBrandBillingStore((s) => s.hydrate);
  // ready 게이트(ui.md) — 브랜드·매장 축·결제 셋이 다 와야 그린다. '이번 달 청구 대상 0곳'이 먼저 스치지 않는다.
  const ready = brandLoaded && unitsLoaded && billingLoaded;
  useFocusEffect(useCallback(() => { void hydrate(); void hydrateBilling(); }, [hydrate, hydrateBilling]));

  const brandPaid = overview.filter((r) => r.payer === 'brand').length;
  // 청구 목록의 관계 표시(0223 · 정본 02 §9) — `brand_billing_preview_mine` 을 넓히지 않고 매장 표에서 집어 온다.
  //   두 RPC 가 같은 브랜드의 active 연결을 보므로 붙지 않는 줄은 없다. 그래도 없으면 '—' 다(거짓말보다 빈 칸).
  // ★직영은 사실상 항상 본사 부담이라, 실제 협상 숫자는 **가맹 중 본사 부담이 몇 곳인가**다.
  const relationOf = useMemo(
    () => new Map(overview.map((r) => [r.unit_id, r.relation] as const)),
    [overview],
  );
  const franchisePaid = current.filter((r) => relationOf.get(r.unit_id) === 'franchise').length;
  const price = brand?.price_per_store_krw ?? null;
  // ★금액을 화면에서 세지 않는다 — 내부 콘솔의 발행과 **같은 함수**가 준 줄을 더하기만 한다(0222).
  const currentAmount = current.reduce((s, r) => s + r.price_krw, 0);
  const nextAmount = next.reduce((s, r) => s + r.price_krw, 0);
  const diff = next.length - current.length;
  const nextNote = diff === 0 ? '이번 달과 같아요' : diff > 0 ? `${diff}곳 늘어요` : `${-diff}곳 줄어요`;

  // 머리(제목)는 게이트 밖 — 골격은 즉시 선다. 설정류라 등장 애니메이션은 없다(ui.md 예외).
  if (!ready) {
    return (
      <HqPage title="결제" sub={SUB} testID="hq-settings-billing">
        <ScreenLoading label="설정을 불러오고 있어요…" />
      </HqPage>
    );
  }
  // 3분기의 둘째 — 결제를 못 읽었는데 '청구 대상 0곳 · 0원'을 그리면 그게 가장 위험한 위장이다.
  if (error || billingError) {
    return (
      <HqPage title="결제" sub={SUB} testID="hq-settings-billing">
        <HqLoadError
          title={error ? '설정을 불러오지 못했어요' : '결제 정보를 불러오지 못했어요'}
          onRetry={() => Promise.all([hydrate(), hydrateBilling()])}
          testID="hq-settings-error"
        />
      </HqPage>
    );
  }

  return (
    <HqPage title="결제" sub={SUB} testID="hq-settings-billing">

      {/* 요약 — 섹션 제목은 카드 밖, 칸은 라벨 위·값 아래(레퍼런스 개편). */}
      <HqSlab title="이번 달" hint="월 선불 · 계좌이체와 세금계산서 · 자동결제 없음(계약 제6조)" />
      <HqCard testID="hq-billing-summary">
        <View style={styles.split}>
          <HqField label="매장당 월 계약가" hint="부가세 별도">{krw(price)}</HqField>
          <View style={styles.vline} />
          <HqField label="청구 대상" hint={`가맹 ${franchisePaid}곳 · 매장 부담 ${overview.length - brandPaid}곳은 청구에 없어요`}>{`${current.length}곳`}</HqField>
          <View style={styles.vline} />
          <HqField label="이번 달 금액">{krw(currentAmount)}</HqField>
          <View style={styles.vline} />
          <HqField label="다음 청구 예정" hint={nextNote}>{`${next.length}곳 · ${krw(nextAmount)}`}</HqField>
          <View style={styles.vline} />
          <HqField label="이용 기간">{brand?.paid_until ? `${brand.paid_until}까지` : '아직 결제 전'}</HqField>
        </View>
      </HqCard>

      <HqSlab title="이번 달 청구 대상" hint={`${current.length}곳`} />
      {current.length === 0 ? (
        <HqCard>
          <HqEmpty text="본사 부담 매장이 아직 없어요. 매장 상세에서 요금 부담을 바꾸자고 제안할 수 있어요." />
        </HqCard>
      ) : (
        <HqTable
          columns={[
            { key: 'name', label: '매장', render: (r) => <Cell kind="name">{r.store_name}</Cell> },
            {
              key: 'rel',
              label: '관계',
              width: 96,
              render: (r) => {
                const rel = relationOf.get(r.unit_id);
                return rel ? <HqPill tone={rel === 'direct' ? 'i' : 'n'} label={relationLabel(rel)} /> : <Cell kind="muted">—</Cell>;
              },
            },
            { key: 'since', label: '본사 부담 시작', width: 150, render: (r) => <Cell kind="muted">{r.since}</Cell> },
            { key: 'price', label: '금액', width: 130, align: 'right', render: (r) => <Cell kind="num">{krw(r.price_krw)}</Cell> },
          ]}
          rows={current}
          rowKey={(r) => r.unit_id}
          testID="hq-billing-current"
        />
      )}

      <HqSlab title="청구서" hint="발행과 입금 확인은 스퀘어테이블이 해요" />
      {invoices.length === 0 ? (
        <HqCard>
          <HqEmpty text="아직 발행된 청구서가 없어요." />
        </HqCard>
      ) : (
        <HqTable
          columns={[
            { key: 'period', label: '기간', width: 130, render: (r) => <Cell kind="name">{periodLabel(r.period)}</Cell> },
            { key: 'units', label: '매장', width: 90, align: 'right', render: (r) => <Cell kind="num">{r.unit_count}곳</Cell> },
            { key: 'amount', label: '금액', width: 130, align: 'right', render: (r) => <Cell kind="num">{krw(r.amount_krw)}</Cell> },
            { key: 'credit', label: '크레딧 차감', width: 130, align: 'right', render: (r) => <Cell kind="muted">{r.credit_krw ? `− ${krw(r.credit_krw)}` : '—'}</Cell> },
            { key: 'status', label: '상태', width: 110, render: (r) => <HqPill tone={r.status === 'paid' ? 'g' : r.status === 'issued' ? 'y' : 'n'} label={INVOICE_STATUS[r.status]} /> },
          ]}
          rows={invoices}
          rowKey={(r) => r.id}
        />
      )}

      <HqSlab title="정산 규칙" />
      <HqCard>
        <View style={styles.rules}>
          {BILLING_RULES.map((r) => (
            <Text key={r} style={styles.ruleItem}>· {r}</Text>
          ))}
        </View>
        <Text style={styles.src}>가맹점주에게 이 요금을 월 회수하지 않아요(가맹사업법 제12조). 매장 부담 매장은 점주가 고른 요금제 그대로예요.</Text>
      </HqCard>
    </HqPage>
  );
}

const SUB = '청구서 발행과 입금 확인은 스퀘어테이블이 해요. 이 화면은 보여 주기만 해요.';

const styles = StyleSheet.create({
  split: { flexDirection: 'row', gap: Space.xl, flexWrap: 'wrap' },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: InkColors.line },
  src: { fontSize: 13, color: InkColors.ink3, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: InkColors.line, borderStyle: 'dashed', lineHeight: 19 },
  rules: { gap: 3 },
  ruleItem: { fontSize: 14, lineHeight: 20, color: InkColors.ink2 },
});
