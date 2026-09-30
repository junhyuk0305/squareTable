// /hq/settings — 설정(정본 §5-2): 브랜드 정보 · 구성원(초대 링크) · 결제(표시만) · 연결 해제 안내.
//
// 재료 = useBrandStore(my_brand 확장 · brand_members_list · brand_invites_list) + useBrandBillingStore(P6).
// ★결제는 **표시만**이다 — 발행·입금 확인·크레딧·환불은 내부 콘솔(service_role)이 한다(정본 §4-D·§5-2).
//   대상·금액도 여기서 세지 않는다. 내부 콘솔의 발행과 같은 함수(`brand_billing_preview`)가 준 줄을 더한다.
import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HqPage, HqButton, HqPill, HqCard, HqRow, HqNotice, HqEmpty } from '@/components/hq/HqKit';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { HqModal } from '@/components/hq/HqModal';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { useBrandBillingStore } from '@/lib/store/useBrandBillingStore';
import { inviteBrandMember } from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { BILLING_RULES, INVOICE_STATUS, krw, periodLabel } from '@/lib/brand/billing';
import { payerLabel, relationLabel } from '@/lib/brand/visibility';
import { useCopyToClipboard, canCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { showToast } from '@/lib/store/useToastStore';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');
const fmtBiz = (n: string | null) => (n && n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n || '—');
const joinUrl = (token: string) => {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}/hq/join?token=${token}`;
};

export default function HqSettingsScreen() {
  const brand = useBrandStore((s) => s.brand);
  const overview = useBrandStore((s) => s.overview);
  const members = useBrandStore((s) => s.members);
  const invites = useBrandStore((s) => s.invites);
  const loaded = useBrandStore((s) => s.loaded);
  const error = useBrandStore((s) => s.error);
  const hydrate = useBrandStore((s) => s.hydrate);
  const refresh = useBrandStore((s) => s.refresh);
  // 결제는 이 화면에서만 본다 — 대시보드·매장·노하우·퀴즈의 조회에 청구 RPC 를 얹지 않는다.
  const current = useBrandBillingStore((s) => s.current);
  const next = useBrandBillingStore((s) => s.next);
  const invoices = useBrandBillingStore((s) => s.invoices);
  const hydrateBilling = useBrandBillingStore((s) => s.hydrate);
  useFocusEffect(useCallback(() => { void hydrate(); void hydrateBilling(); }, [hydrate, hydrateBilling]));

  const [link, setLink] = useState<{ url: string; expires: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const memberInvites = useMemo(() => invites.filter((i) => i.kind === 'member' && i.status === 'pending' && i.token), [invites]);
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

  const makeLink = async () => {
    setBusy(true);
    const r = await inviteBrandMember();
    setBusy(false);
    if (r.error || !r.data?.[0]) {
      showToast(brandErrorMessage(r.error), 'warn');
      return;
    }
    setLink({ url: joinUrl(r.data[0].token), expires: r.data[0].expires_at });
    void refresh();
  };

  return (
    <HqPage title="설정" sub="브랜드 정보 · 구성원 · 결제" testID="hq-settings">
      {error ? <HqNotice tone="warn">설정을 불러오지 못했어요. ({error})</HqNotice> : null}

      <HqCard title="브랜드 정보" sub="변경은 스퀘어테이블에 요청해 주세요(계약 정보라 화면에서 고치지 않아요).">
        <HqRow first k="브랜드 이름" v={brand?.brand_name ?? (loaded ? '—' : '불러오는 중…')} />
        <HqRow k="사업자등록번호" v={fmtBiz(brand?.biz_no ?? null)} />
        <HqRow k="매장 추가 시 기본 요금 부담" v={brand ? payerLabel(brand.default_payer) : '—'} />
      </HqCard>

      <HqCard
        title="구성원"
        sub="담당자는 전원 같은 권한이에요. 초대 링크(7일)를 만들어 전달하면 그 사람이 가입한 뒤 이 브랜드에 합류해요."
      >
        <View style={{ gap: 0 }}>
          {members.length === 0 ? (
            <HqEmpty text={loaded ? '구성원이 없어요.' : '불러오는 중…'} />
          ) : (
            members.map((m, i) => (
              <HqRow
                key={m.user_id}
                first={i === 0}
                k={m.is_me ? '나' : '담당자'}
                v={m.name || '이름 없음'}
                tail={<Text style={styles.muted}>{fmtDay(m.joined_at)} 합류</Text>}
              />
            ))
          )}
        </View>
        <View style={{ flexDirection: 'row', gap: Space.sm, marginTop: Space.lg }}>
          <HqButton label="초대 링크 만들기" variant="pri" icon="link-outline" disabled={busy} testID="hq-member-invite" onPress={() => void makeLink()} />
        </View>
        {memberInvites.length > 0 ? (
          <View style={{ marginTop: Space.lg }}>
            <Text style={styles.subhead}>아직 안 쓴 초대 링크</Text>
            <HqTable
              columns={[
                { key: 'made', label: '만든 날', width: 120, render: (i) => <Cell kind="muted">{fmtDay(i.created_at)}</Cell> },
                { key: 'exp', label: '만료', width: 120, render: (i) => <Cell kind="muted">{fmtDay(i.expires_at)}</Cell> },
                { key: 'st', label: '상태', width: 100, render: () => <HqPill tone="w" label="대기" /> },
                {
                  key: 'act',
                  label: '',
                  render: (i) =>
                    canCopyToClipboard() ? (
                      <HqButton label="링크 복사" onPress={() => void copy(joinUrl(i.token!)).then(() => showToast('링크를 복사했어요.', 'good'))} />
                    ) : (
                      <Cell kind="muted">{joinUrl(i.token!)}</Cell>
                    ),
                },
              ]}
              rows={memberInvites}
              rowKey={(i) => i.id}
            />
          </View>
        ) : null}
      </HqCard>

      <HqCard title="결제" sub="월 선불 · 계좌이체 + 세금계산서 · 자동결제 없음(계약 제6조). 청구서 발행과 입금 확인은 스퀘어테이블이 해요 — 이 화면은 표시만이에요.">
        <HqRow first k="매장당 월 계약가" v={krw(price)} tail={<Text style={styles.muted}>부가세 별도 · 계약서 기준</Text>} />
        <HqRow k="이번 달 청구 대상" v={`${current.length}곳`} tail={<Text style={styles.muted}>가맹 {franchisePaid}곳 · 매장 부담 {overview.length - brandPaid}곳은 청구에 없어요</Text>} />
        <HqRow k="이번 달 금액" v={krw(currentAmount)} />
        <HqRow k="다음 청구 예정" v={`${next.length}곳 · ${krw(nextAmount)}`} tail={<Text style={styles.muted}>{nextNote}</Text>} />
        <HqRow k="이용 기간" v={brand?.paid_until ? `${brand.paid_until}까지` : '아직 결제 전'} />

        <Text style={[styles.subhead, { marginTop: Space.lg }]}>이번 달 청구 대상 ({current.length}곳)</Text>
        {current.length === 0 ? (
          <HqEmpty text="본사 부담 매장이 아직 없어요. 매장 화면에서 요금 부담을 바꾸자고 제안할 수 있어요." />
        ) : (
          <HqTable
            columns={[
              { key: 'name', label: '매장', render: (r) => <Cell kind="name">{r.store_name}</Cell> },
              {
                key: 'rel',
                label: '관계',
                width: 80,
                render: (r) => {
                  const rel = relationOf.get(r.unit_id);
                  return rel ? <HqPill tone={rel === 'direct' ? 'i' : 'n'} label={relationLabel(rel)} /> : <Cell kind="muted">—</Cell>;
                },
              },
              { key: 'since', label: '본사 부담 시작', width: 140, render: (r) => <Cell kind="muted">{r.since}</Cell> },
              { key: 'price', label: '금액', width: 120, align: 'right', render: (r) => <Cell kind="num">{krw(r.price_krw)}</Cell> },
            ]}
            rows={current}
            rowKey={(r) => r.unit_id}
          />
        )}

        <Text style={[styles.subhead, { marginTop: Space.lg }]}>청구서</Text>
        {invoices.length === 0 ? (
          <HqEmpty text="아직 발행된 청구서가 없어요." />
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

        <View style={styles.rules}>
          {BILLING_RULES.map((r) => (
            <Text key={r} style={styles.ruleItem}>· {r}</Text>
          ))}
        </View>
        <Text style={styles.src}>가맹점주에게 이 요금을 월 회수하지 않아요(가맹사업법 제12조). 매장 부담 매장은 점주가 고른 요금제 그대로예요.</Text>
      </HqCard>

      <HqCard title="연결 해제" sub="점주도, 본사도 언제든 끝낼 수 있어요.">
        <Text style={styles.body}>해제하면 본사 화면에서 그 매장이 바로 사라지고, 매장이 받았던 노하우는 매장에 그대로 남아요. 본사 부담 매장이었다면 당월 말까지는 유지돼요.</Text>
        <Text style={styles.body}>매장에서 해제하려면 <Text style={{ fontWeight: '700' }}>매장 &gt; 행 선택 &gt; 연결 해제</Text>.</Text>
      </HqCard>

      <HqModal open={!!link} title="초대 링크를 만들었어요" sub={link ? `${fmtDay(link.expires)}까지 쓸 수 있어요. 링크를 받은 사람이 가입(또는 로그인)하면 이 브랜드 담당자가 돼요.` : undefined} onClose={() => setLink(null)}>
        {link ? (
          <>
            <View style={styles.linkBox}>
              <Text selectable style={styles.linkText} testID="hq-member-invite-link">{link.url}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: Space.sm, marginTop: Space.lg }}>
              {canCopyToClipboard() ? <HqButton label={copied ? '복사됨' : '링크 복사'} variant="pri" onPress={() => void copy(link.url)} /> : null}
              <HqButton label="닫기" onPress={() => setLink(null)} />
            </View>
          </>
        ) : null}
      </HqModal>
    </HqPage>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: 13.5, color: InkColors.ink3 },
  subhead: { fontSize: 14, fontWeight: '700', color: InkColors.ink2, marginBottom: 8 },
  src: { fontSize: 13, color: InkColors.ink3, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: InkColors.line, borderStyle: 'dashed', lineHeight: 19 },
  body: { fontSize: 14.5, lineHeight: 22, color: InkColors.ink2, marginBottom: 6 },
  rules: { marginTop: Space.md, gap: 3 },
  ruleItem: { fontSize: 14, lineHeight: 20, color: InkColors.ink2 },
  linkBox: { borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.paper, borderRadius: Radius.sm, padding: 12 },
  linkText: { fontSize: 14, color: InkColors.ink, fontFamily: 'monospace' },
});
