import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { fetchUnitKnowhow, copyKnowhow, type UnitKnowhowRow } from '@/lib/db';
import { SectionLabel } from '@/components/SectionLabel';
import { InfoDot } from '@/components/InfoDot';
import { Appear } from '@/components/Appear';
import { getCategoryMeta } from '@/lib/utils/category';
import { notifyAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { Category } from '@/types';

// RPC 예외 → 사장이 읽을 수 있는 문구. (definer RPC 의 raise 메시지 코드 매핑)
const ERR_MSG: Record<string, string> = {
  not_owner_source: '가져올 매장이 내 매장이 아니에요.',
  not_owner_target: '현재 매장이 내 매장이 아니에요.',
  not_owner: '내 매장이 아니에요.',
  same_unit: '같은 매장끼리는 가져올 수 없어요.',
  too_many: '한 번에 가져올 수 있는 개수를 넘었어요.',
  no_active_unit: '현재 매장을 찾을 수 없어요.',
};
function friendly(msg?: string): string {
  if (msg) for (const k of Object.keys(ERR_MSG)) if (msg.includes(k)) return ERR_MSG[k];
  return '가져오지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
}

/**
 * OwnerKnowhowImport — 다른 내 매장의 노하우를 현재(활성) 매장으로 가져오는 본문(크롬리스).
 * 흐름: 소스 매장 선택 → 발행 노하우 목록(체크 다중선택) → '가져오기'가 copy_knowhow 로 서버 복제.
 * 복제 성공 시에만 성공 안내 + 현재 매장 노하우 재hydrate(무음 유실 방지). 사진 미복제·확인필요는 안내로 고지.
 * (SafeArea/헤더/탭바는 상위 owner/import-knowhow 가 소유.)
 */
export function OwnerKnowhowImport() {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const activeUnit = useSessionStore((s) => s.unitId);
  const activeName = useSessionStore((s) => s.storeName);
  const hydrate = usePlaybookStore((s) => s.hydrate);

  // 소스 후보 = 내가 소유한 다른 매장(현재 활성 제외). 활성은 대상이므로 뺀다.
  const sources = useMemo(
    () => stores.filter((s) => s.role === 'owner' && s.unit_id !== activeUnit),
    [stores, activeUnit],
  );

  const [sourceId, setSourceId] = useState<string | null>(sources.length === 1 ? sources[0].unit_id : null);
  const [nonce, setNonce] = useState(0); // 재시도용 — 같은 소스 재로딩 트리거
  const [rows, setRows] = useState<UnitKnowhowRow[] | null>(null);
  const [loading, setLoading] = useState(sources.length === 1); // 단일 소스 자동선택 시 즉시 로딩
  const [loadErr, setLoadErr] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);

  // 동기 setState를 이펙트에 두지 않는다(cascading render 방지) — 로딩/선택 리셋은 소스칩/재시도 핸들러가 담당.
  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    fetchUnitKnowhow(sourceId).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setLoadErr(true); setRows(null); }
      else setRows(data ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [sourceId, nonce]);

  // 소스 매장 선택(칩) — 이펙트 트리거 전에 로딩/에러/선택을 핸들러에서 리셋.
  const pickSource = (id: string) => {
    if (id === sourceId) return;
    setSourceId(id); setLoading(true); setLoadErr(false); setRows(null); setSelected(new Set());
  };

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const allSelected = !!rows && rows.length > 0 && selected.size === rows.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set((rows ?? []).map((r) => r.id)));

  const doImport = async () => {
    if (!sourceId || selected.size === 0 || copying) return;
    setCopying(true);
    const { data, error } = await copyKnowhow(sourceId, [...selected]);
    setCopying(false);
    if (error || data == null) {
      await notifyAction('가져오지 못했어요', friendly(error?.message), '확인', { icon: 'alert-circle-outline' });
      return;
    }
    await hydrate(); // 복제본이 현재 매장 목록에 즉시 반영되도록(무음 유실 방지)
    await notifyAction(
      '노하우를 가져왔어요',
      `${data}개를 "${activeName || '현재 매장'}"에 추가했어요.`,
      '확인',
      {
        icon: 'checkmark-circle-outline',
        accent: '아직 확인 전이에요. 새 매장 기준(주소·연락처 등)이 맞는지 확인해 주세요. 사진은 함께 옮겨지지 않아요.',
      },
    );
    router.back();
  };

  // 단일 매장(가져올 소스 없음) — 딥링크 방어. 진입 CTA 는 매장 2+개일 때만 노출된다.
  if (sources.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyEmoji}>🏪</Text>
        <Text style={styles.emptyTitle}>가져올 다른 매장이 없어요</Text>
        <Text style={styles.emptyBody}>매장이 2개 이상일 때 다른 매장의 노하우를 현재 매장으로 가져올 수 있어요.</Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.lead}>
          <Text style={styles.leadText}>다른 내 매장의 노하우를 “{activeName || '현재 매장'}”으로 가져와요</Text>
          <InfoDot
            title="어떻게 되나요?"
            body={'선택한 노하우가 현재 매장으로 복사돼요.\n· 사진은 함께 옮겨지지 않아요.\n· 가져온 노하우는 “확인 필요”로 표시돼요 — 새 매장 기준(주소·연락처 등)이 맞는지 확인하세요.'}
          />
        </View>

        {/* 소스 매장 선택 */}
        <View style={styles.block}>
          <SectionLabel icon="storefront-outline" title="어느 매장에서 가져올까요?" />
          <View style={styles.sourceWrap}>
            {sources.map((s) => {
              const on = sourceId === s.unit_id;
              return (
                <Pressable
                  key={s.unit_id}
                  onPress={() => pickSource(s.unit_id)}
                  style={[styles.sourceChip, on && styles.sourceChipOn]}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.store_name}에서 가져오기`}
                >
                  <Ionicons name="storefront" size={14} color={on ? InkColors.bubbleText : InkColors.ink2} />
                  <Text style={[styles.sourceText, on && styles.sourceTextOn]} numberOfLines={1}>{s.store_name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 노하우 목록 */}
        {!sourceId ? (
          <View style={styles.hint}><Text style={styles.hintText}>매장을 먼저 선택하세요</Text></View>
        ) : loading ? (
          <View style={styles.center}><ActivityIndicator color={InkColors.ink3} /></View>
        ) : loadErr ? (
          <View style={styles.center}>
            <Text style={styles.emptyBody}>목록을 불러오지 못했어요.</Text>
            <Pressable onPress={() => { setLoadErr(false); setLoading(true); setNonce((n) => n + 1); }} hitSlop={8}>
              <Text style={styles.retryLink}>다시 시도</Text>
            </Pressable>
          </View>
        ) : rows && rows.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyBody}>이 매장에는 발행된 노하우가 없어요.</Text>
          </View>
        ) : (
          <Appear style={styles.block}>
            <View style={styles.listHead}>
              <Text style={styles.listCount}>{rows?.length}개 중 {selected.size}개 선택</Text>
              <Pressable onPress={toggleAll} hitSlop={8}>
                <Text style={styles.selectAll}>{allSelected ? '전체 해제' : '전체 선택'}</Text>
              </Pressable>
            </View>
            <View style={styles.list}>
              {rows?.map((r) => {
                const on = selected.has(r.id);
                const m = getCategoryMeta(r.category as Category);
                const situation = typeof r.square?.situation === 'string' ? (r.square.situation as string) : '';
                return (
                  <Pressable
                    key={r.id}
                    onPress={() => toggle(r.id)}
                    style={[styles.row, on && styles.rowOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={r.title}
                  >
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on ? <Ionicons name="checkmark" size={13} color={InkColors.bubbleText} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{r.title}</Text>
                      <View style={styles.rowMeta}>
                        <View style={[styles.mdot, { backgroundColor: m.color }]} />
                        <Text style={styles.rowCat}>{m.label}</Text>
                        {r.subcategory ? <Text style={styles.rowSub} numberOfLines={1}>· {r.subcategory}</Text> : null}
                      </View>
                      {situation ? <Text style={styles.rowPreview} numberOfLines={1}>{situation}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </Appear>
        )}

        <View style={{ height: 96 }} />
      </ScrollView>

      {/* 하단 도크 — 선택이 있을 때만. 프레임 안 정상 흐름(모달 아님)이라 폭은 프레임에 귀속. */}
      {selected.size > 0 ? (
        <View style={styles.dock}>
          <Pressable
            onPress={doImport}
            disabled={copying}
            style={({ pressed }) => [styles.importBtn, (pressed || copying) && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel={`${selected.size}개 가져오기`}
          >
            {copying ? (
              <ActivityIndicator color={InkColors.bubbleText} size="small" />
            ) : (
              <Ionicons name="download-outline" size={17} color={InkColors.bubbleText} />
            )}
            <Text style={styles.importBtnText}>{copying ? '가져오는 중…' : `${selected.size}개 가져오기`}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Space.gutter, gap: Space.md },

  lead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leadText: { flex: 1, fontSize: 15, color: InkColors.ink3, fontWeight: '600', lineHeight: 22 },

  block: { gap: Space.sm },

  // 소스 매장 칩
  sourceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  sourceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    backgroundColor: InkColors.bg, borderWidth: 1.5, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingVertical: 9, paddingHorizontal: 14,
  },
  sourceChipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  sourceText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2, flexShrink: 1 },
  sourceTextOn: { color: InkColors.bubbleText },

  hint: { paddingVertical: 24, alignItems: 'center' },
  hintText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  center: { paddingVertical: 40, alignItems: 'center', gap: 8 },

  // 목록
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  listCount: { fontSize: 13, color: InkColors.ink3, fontWeight: '700' },
  selectAll: { fontSize: 13, fontWeight: '800', color: BrandColors.brand },
  list: { gap: Space.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: 13,
  },
  rowOn: { borderColor: InkColors.ink2, ...Elevation.e1 },
  check: {
    width: 22, height: 22, borderRadius: Radius.sm, borderWidth: 1.5, borderColor: InkColors.line,
    alignItems: 'center', justifyContent: 'center', backgroundColor: InkColors.paper,
  },
  checkOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  rowTitle: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  mdot: { width: 7, height: 7, borderRadius: Radius.pill },
  rowCat: { fontSize: 12, color: InkColors.ink2, fontWeight: '700' },
  rowSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', flexShrink: 1 },
  rowPreview: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '500', marginTop: 4, lineHeight: 17 },

  retryLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, textDecorationLine: 'underline' },

  // 하단 도크
  dock: {
    paddingHorizontal: Space.gutter, paddingTop: Space.sm, paddingBottom: Space.md,
    borderTopWidth: 1, borderTopColor: InkColors.line, backgroundColor: InkColors.cream,
  },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 14, borderRadius: Radius.md, backgroundColor: InkColors.ink, ...Elevation.e2,
  },
  importBtnText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },

  // 빈 상태(단일 매장)
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: Space.xl },
  emptyEmoji: { fontSize: 34 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink2 },
  emptyBody: { fontSize: 15, color: InkColors.ink3, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
});
