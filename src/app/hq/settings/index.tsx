// /hq/settings — 설정 > 브랜드 정보(정본 §5-2). 2026-10-02 하위 메뉴 개편으로 설정 카드 4장을 화면 3개로 나눴다:
//   브랜드 정보(여기 · 연결 해제 안내 포함) · 구성원(members) · 결제(billing).
// 모양 = 섹션 제목은 카드 밖, 카드 안은 칸을 세로선으로 나누고 라벨은 값 위(레퍼런스 개편).
// 변경은 화면에서 하지 않는다 — 계약 정보라 스퀘어테이블에 요청한다. 설정류라 등장 애니메이션은 없다(ui.md 예외).
import { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { HqPage, HqCard, HqField, HqSlab, HqButton, HqLoadError } from '@/components/hq/HqKit';
import { ScreenLoading } from '@/components/ScreenLoading';
import { useBrandStore } from '@/lib/store/useBrandStore';
import { payerLabel } from '@/lib/brand/visibility';
import { useCopyToClipboard, canCopyToClipboard } from '@/lib/utils/useCopyToClipboard';
import { InkColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const fmtBiz = (n: string | null) => (n && n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n || '—');

export default function HqSettingsBrandScreen() {
  const brand = useBrandStore((s) => s.brand);
  const loaded = useBrandStore((s) => s.loaded);
  const error = useBrandStore((s) => s.error);
  const hydrate = useBrandStore((s) => s.hydrate);
  useFocusEffect(useCallback(() => { void hydrate(); }, [hydrate]));
  const { copied, copy } = useCopyToClipboard();

  const head = { title: '브랜드 정보', sub: '바꾸려면 스퀘어테이블에 요청해 주세요. 계약 정보라 화면에서 고치지 않아요.', testID: 'hq-settings' };
  if (!loaded) return <HqPage {...head}><ScreenLoading label="설정을 불러오고 있어요…" /></HqPage>;
  if (error || !brand) {
    return <HqPage {...head}><HqLoadError title="설정을 불러오지 못했어요" onRetry={hydrate} testID="hq-settings-error" /></HqPage>;
  }

  return (
    <HqPage {...head}>
      <View style={styles.slabRow}>
        <HqSlab title="기본 정보" />
        <View style={styles.idBox}>
          <Text style={styles.idLabel}>브랜드 ID</Text>
          <View style={styles.idValue}><Text style={styles.idText} selectable>{brand.brand_id}</Text></View>
          {canCopyToClipboard() ? <HqButton label={copied ? '복사됨' : '복사'} onPress={() => void copy(brand.brand_id)} /> : null}
        </View>
      </View>
      <HqCard>
        <View style={styles.split}>
          <HqField label="브랜드 이름">{brand.brand_name}</HqField>
          <View style={styles.vline} />
          <HqField label="사업자등록번호">{fmtBiz(brand.biz_no)}</HqField>
          <View style={styles.vline} />
          <HqField label="새 매장 요금 부담" hint="매장을 새로 붙일 때의 기본값이에요. 매장마다 바꿀 수 있어요.">{payerLabel(brand.default_payer)}</HqField>
        </View>
      </HqCard>

      <HqSlab title="연결 해제" hint="점주도, 본사도 언제든 끝낼 수 있어요" />
      <HqCard>
        <Text style={styles.body}>해제하면 본사 화면에서 그 매장이 바로 사라져요. 매장이 받았던 노하우는 매장에 그대로 남아요.</Text>
        <Text style={styles.body}>본사 부담 매장이었다면 당월 말까지는 유지돼요.</Text>
        <Text style={styles.body}>해제는 <Text style={{ fontWeight: '700' }}>매장 &gt; 매장 상세 &gt; 연결과 규칙</Text>에서 해요.</Text>
      </HqCard>
    </HqPage>
  );
}

const styles = StyleSheet.create({
  slabRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space.md, flexWrap: 'wrap' },
  idBox: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: 9 },
  idLabel: { fontSize: 13.5, fontWeight: '700', color: InkColors.ink2 },
  idText: { fontSize: 14, fontWeight: '700', color: InkColors.ink },
  idValue: { backgroundColor: InkColors.bg, borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm, paddingHorizontal: Space.md, paddingVertical: 8 },
  split: { flexDirection: 'row', gap: Space.xl, flexWrap: 'wrap' },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: InkColors.line },
  body: { fontSize: 14.5, lineHeight: 22, color: InkColors.ink2, marginBottom: 6 },
});
