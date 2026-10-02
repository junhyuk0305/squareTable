// BrandMirrorView.tsx — "본사가 보는 화면 그대로 보기"(정본 §4-E ② · §4-A 대칭 가시성).
//
// ★같은 본문을 지난다: `my_brand_mirror()` 는 `brand_overview()` 와 **같은 SQL**(brand_overview_rows, 0217)을
//   내 매장으로만 부른다. 그래서 여기 숫자와 본사 화면의 숫자가 어긋날 수 없다 — 그게 이 화면의 존재 이유다.
//   "본사만 보는 매장 화면은 없다"(§4-A)를 점주가 **확인할 수 있게** 만드는 것.
//
// ★왜 표(HqTable)를 안 쓰나: 그건 넓은 웹 전용 부품이고, 여기는 460 폰 프레임이다(ui 규칙 · 정본 §5-1).
//   같은 행을 폰에서는 키·값 목록으로 그린다 — 열을 줄인 표는 폰에서 읽기 더 어렵다.
//
// ★수준 밖 컬럼은 서버가 null 로 준다 → '—'. 0 이 아니다. 점주가 요약으로 내려 두면 여기서도 비어 보이고,
//   그것이 정확한 표현이다("본사도 지금 이만큼만 본다").
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { myBrandMirror, type BrandOverviewRow } from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { visibilityLabel, payerLabel } from '@/lib/brand/visibility';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const num = (v: number | null) => (v === null ? '—' : v.toLocaleString());

export function BrandMirrorView({ unitId }: { unitId: string }) {
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<BrandOverviewRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 펼칠 때 조회한다(정본 §6-3: realtime 없음 · 포커스·수동 새로고침). 펼침은 아래로 열린다
  // (메모리 feedback_ui_reveal_scroll_down) — 위로 밀면 방금 누른 줄이 화면에서 사라진다.
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setBusy(true);
    setErr(null);
    const r = await myBrandMirror();
    setBusy(false);
    if (r.error) { setErr(brandErrorMessage(r.error, '지금은 불러오지 못했어요.')); return; }
    setRow((r.data ?? []).find((x) => x.unit_id === unitId) ?? null);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="본사가 보는 화면 그대로 보기"
        testID="brand-mirror-toggle"
        style={({ pressed }) => [styles.head, pressed && { opacity: 0.75 }]}
      >
        <Ionicons name="eye-outline" size={16} color={InkColors.ink} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headText}>본사가 보는 화면 그대로 보기</Text>
          <Text style={styles.headSub}>본사 화면과 같은 값이에요. 본사만 보는 화면은 없어요.</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={InkColors.ink3} />
      </Pressable>

      {open ? (
        <View style={styles.body} testID="brand-mirror-body">
          {busy ? (
            <Text style={styles.note}>불러오는 중…</Text>
          ) : err ? (
            <Text style={styles.err}>{err}</Text>
          ) : !row ? (
            <Text style={styles.note}>아직 본사가 볼 수 있는 값이 없어요.</Text>
          ) : (
            <>
              <Kv k="공개 수준" v={visibilityLabel(row.visibility)} first />
              <Kv k="요금 부담" v={payerLabel(row.payer)} />
              <Kv k="직원 수" v={num(row.staff)} />
              <Kv k="매장 노하우 수" v={num(row.knowhow_own)} />
              <Kv k="본사 노하우 숙지율" v={pct(row.mastery)} />
              <Kv k="미해결 질문" v={`${num(row.pending_q)}건`} />
              <Kv k="이번 달 AI 사용" v={`${num(row.ai_used)}건`} />
              <Kv k="업무 완료(30일)" v={num(row.tasks_done_30d)} />
              <Kv k="매장 퀴즈 수" v={num(row.quiz_courses)} />
              {/* 0226 — **숫자만** 간다. 누가 미이수인지는 어느 수준에서도 가지 않는다(정본 02 §3).
                  미러 뷰에 같이 세우는 이유: 본사가 보는 것을 점주도 정확히 같은 줄로 봐야 한다. */}
              <Kv k="미이수 인원" v={row.staff_behind === null ? '—' : `${row.staff_behind}명`} />
              <Kv k="오답 몰린 노하우" v={row.weak_entries === null ? '—' : `${row.weak_entries}건`} />
              <Text style={styles.foot}>
                줄표(—)는 지금 공개 수준에서 본사에 가지 않는 값이에요. 급여·근태·직원 이름·개인별 점수·업무 채팅은
                어느 수준에서도 본사에 가지 않아요.
              </Text>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Kv({ k, v, first }: { k: string; v: string; first?: boolean }) {
  return (
    <View style={[styles.kv, !first && styles.border]}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, v === '—' && styles.vNull]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: Space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 6 },
  headText: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink },
  // 고정 높이를 안 준다 — 두 줄이 되면 늘어난다(메모리 feedback_fixed_height_text_overflow).
  headSub: { fontSize: 12.5, lineHeight: 18, color: InkColors.ink3, marginTop: 2 },
  body: { marginTop: Space.sm, borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, paddingHorizontal: 13 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 44 },
  border: { borderTopWidth: 1, borderTopColor: InkColors.line },
  k: { flex: 1, minWidth: 0, fontSize: 13.5, color: InkColors.ink2 },
  v: { fontSize: 14, fontWeight: '700', color: InkColors.ink, fontVariant: ['tabular-nums'] },
  vNull: { color: InkColors.ink3, fontWeight: '600' },
  note: { fontSize: 13.5, color: InkColors.ink3, paddingVertical: 14 },
  err: { fontSize: 13.5, lineHeight: 20, color: BrandColors.badText, fontWeight: '600', paddingVertical: 14 },
  foot: { fontSize: 12, lineHeight: 18, color: InkColors.ink3, paddingVertical: 12, borderTopWidth: 1, borderTopColor: InkColors.line },
});
