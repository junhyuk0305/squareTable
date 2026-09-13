import { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { fetchUnitKnowhow, copyKnowhowBetween, copyKnowhowPhotos, type UnitKnowhowRow } from '@/lib/db';
import { SectionLabel } from '@/components/SectionLabel';
import { StepProgress } from '@/components/blocks/StepProgress';
import { InfoDot } from '@/components/InfoDot';
import { Appear } from '@/components/Appear';
import { notifyAction } from '@/lib/utils/confirm';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

// RPC 예외 → 사장이 읽을 수 있는 문구. (definer RPC 의 raise 메시지 코드 매핑)
const ERR_MSG: Record<string, string> = {
  not_owner_source: '보내는 매장이 내 매장이 아니에요.',
  not_owner_target: '받는 매장이 내 매장이 아니에요.',
  not_owner: '내 매장이 아니에요.',
  same_unit: '같은 매장끼리는 복사할 수 없어요.',
  unit_required: '매장을 두 곳 다 골라 주세요.',
  too_many: '한 번에 복사할 수 있는 개수를 넘었어요.',
  no_active_unit: '현재 매장을 찾을 수 없어요.',
};
function friendly(msg?: string): string {
  if (msg) for (const k of Object.keys(ERR_MSG)) if (msg.includes(k)) return ERR_MSG[k];
  return '복사하지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
}

/**
 * 찾기 바를 띄우는 최소 건수 — `OwnerKnowhowBrowse.FILTER_MIN` 과 같은 판정이다
 * (복잡도 원칙 §4 "리스트 첫 노출 5±2"). 이 수 미만이면 거르는 장치가 목록보다 커진다.
 */
const FILTER_MIN = 8;

const TOTAL_STEPS = 3;
const STEP_TITLES = ['매장 고르기', '노하우 고르기', '복사 완료'] as const;

/** 3단계 결과 한 줄 — 무엇이 갔고 사진이 몇 장 붙었나. */
type CopiedRow = { title: string; photos: number };

/**
 * OwnerKnowhowImport — 노하우 복사하기(3단계 위저드).
 *
 * 1단계 보내는 매장·받는 매장 고르기 → 2단계 노하우 고르기 → 3단계 복사된 것 보여주기.
 *
 * ★2026-09-13 개편 세 가지(사장 실측 QA):
 *  ① 방향을 **둘 다 명시**한다. 예전엔 "가져오기" 한 방향이었고, 받는 매장 = 활성 매장이라
 *    화면에 들어오기 전에 매장 선택 시트로 **활성 매장을 바꿔야** 했다 — 고르기만 했는데
 *    들어가 있는 매장이 바뀌는 부작용이었다. 이제 시트 없이 바로 들어와 여기서 양쪽을 고른다.
 *  ② **사진도 같이 간다**(0198). 서버가 새 항목과 원본 사진 경로를 돌려주고, 여기서 장당
 *    스토리지 복사 → 경로 기록까지 한다. 한 장이 실패해도 그 장만 빠지고 항목은 그대로 간다.
 *  ③ 이름은 '복사'다 — 원본은 보내는 매장에 그대로 남는다(이동이 아니다).
 * '점검 필요'는 그대로 유지한다(받는 매장 기준으로 주소·연락처를 다시 봐야 한다).
 *
 * (SafeArea/헤더/탭바는 상위 owner/import-knowhow 가 소유.)
 */
export function OwnerKnowhowImport() {
  const router = useRouter();
  const stores = useSessionStore((s) => s.stores);
  const activeUnit = useSessionStore((s) => s.unitId);
  const hydrate = usePlaybookStore((s) => s.hydrate);

  // 후보 = 내가 **소유한** 매장 전부(매니저로 들어가 있는 매장은 복사 대상이 아니다 — RPC 도 거부한다).
  const owned = useMemo(() => stores.filter((s) => s.role === 'owner'), [stores]);
  const nameOf = (uid: string | null) => owned.find((s) => s.unit_id === uid)?.store_name ?? '매장';

  const [step, setStep] = useState<1 | 2 | 3>(1);
  // 기본값은 **2곳뿐일 때만** 채운다(그때는 고를 것이 없다). 3곳 이상이면 사장이 직접 고른다 —
  // 방향을 잘못 짚으면 남의 매장에 엉뚱한 노하우가 쌓이고, 되돌리는 화면이 없다.
  const [fromId, setFromId] = useState<string | null>(owned.length === 2 ? activeUnit : null);
  const [toId, setToId] = useState<string | null>(
    owned.length === 2 ? (owned.find((s) => s.unit_id !== activeUnit)?.unit_id ?? null) : null,
  );

  const [nonce, setNonce] = useState(0); // 재시도용 — 같은 소스 재로딩 트리거
  const [rows, setRows] = useState<UnitKnowhowRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<CopiedRow[]>([]);

  // 2단계에 들어온 뒤에만 목록을 당긴다(1단계에서 칩을 바꿀 때마다 부르면 헛질).
  useEffect(() => {
    if (step !== 2 || !fromId) return;
    let alive = true;
    fetchUnitKnowhow(fromId).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setLoadErr(true); setRows(null); }
      else setRows(data ?? []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [step, fromId, nonce]);

  /** 보내는 매장 — 받는 매장과 같아지면 받는 쪽을 비운다(같은 매장끼리는 RPC 가 거부한다). */
  const pickFrom = (id: string) => {
    if (id === fromId) return;
    setFromId(id);
    if (toId === id) setToId(null);
    setRows(null); setSelected(new Set()); setQuery(''); setLoadErr(false);
  };
  const pickTo = (id: string) => setToId(id === toId ? null : id);

  const goPick = () => {
    if (!fromId || !toId || fromId === toId) return;
    setLoading(true); setLoadErr(false);
    setStep(2);
  };

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // ── 찾기(2026-08-07 QA #2) — 제목·소분류·본문 첫 문단까지 본다. 나열 + 스크롤로는 못 찾던 자리다.
  const filtering = query.trim() !== '';
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((r) =>
      [r.title, r.subcategory ?? '', typeof r.square?.situation === 'string' ? (r.square.situation as string) : '']
        .some((t) => t.toLowerCase().includes(q)),
    );
  }, [rows, query]);

  /**
   * ★'전체 선택'의 뜻을 거른 뒤에 맞춘다 — 검색 중에 '전체'가 원래 전체를 뜻하면
   * 화면에 없는 것까지 조용히 딸려 들어간다. 대신 라벨이 무엇을 고르는지 말한다.
   * 거르기 밖에서 이미 고른 것은 **지우지 않는다**(고른 것을 검색 때문에 잃으면 안 된다) —
   * 대신 몇 개가 안 보이는지 아래 줄에 밝힌다(조용한 절단 금지).
   */
  const visibleAllSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const r of visible) { if (visibleAllSelected) next.delete(r.id); else next.add(r.id); }
      return next;
    });
  const hiddenSelected = useMemo(() => {
    if (!filtering) return 0;
    const shown = new Set(visible.map((r) => r.id));
    return [...selected].filter((id) => !shown.has(id)).length;
  }, [filtering, visible, selected]);

  const doCopy = async () => {
    if (!fromId || !toId || selected.size === 0 || copying) return;
    setCopying(true);
    const { data, error } = await copyKnowhowBetween(fromId, toId, [...selected]);
    if (error || data == null) {
      setCopying(false);
      await notifyAction('복사하지 못했어요', friendly(error?.message), '확인', { icon: 'alert-circle-outline' });
      return;
    }
    // 사진은 항목 뒤에 따라간다 — 여기서 실패해도 3단계는 그대로 보여준다(장 수만 0 이 된다).
    const done: CopiedRow[] = [];
    for (const r of data) {
      const n = await copyKnowhowPhotos(r, toId);
      done.push({ title: r.title, photos: n });
    }
    // 받는 매장이 지금 들어가 있는 매장이면 목록에 즉시 반영한다(무음 유실 방지).
    if (toId === activeUnit) await hydrate();
    setResult(done);
    setCopying(false);
    setStep(3);
  };

  // 단일 매장(복사할 상대가 없음) — 딥링크 방어. 진입 CTA 는 매장 2+개일 때만 노출된다.
  if (owned.length < 2) {
    return (
      <View style={styles.emptyState}>
        {/* 그림 이모지 금지(워딩 §1) — Ionicons 로 대체. 2026-08-07 QA #5-2 와 같은 규칙. */}
        <Ionicons name="storefront-outline" size={30} color={InkColors.ink3} />
        <Text style={styles.emptyTitle}>복사할 다른 매장이 없어요</Text>
        <Text style={styles.emptyBody}>매장이 2개 이상일 때 한 매장의 노하우를 다른 매장으로 복사할 수 있어요.</Text>
      </View>
    );
  }

  const photoTotal = result.reduce((a, r) => a + r.photos, 0);

  return (
    <View style={styles.flex}>
      <StepProgress step={step} total={TOTAL_STEPS} title={STEP_TITLES[step - 1]} />
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.flex} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── 1단계 · 매장 고르기 ───────────────────────────────────────────────── */}
        {step === 1 ? (
          <Appear delay={0} style={styles.block}>
            <View style={styles.lead}>
              <Text style={styles.leadText}>한 매장의 노하우를 다른 매장으로 복사해요</Text>
              <InfoDot
                title="어떻게 되나요?"
                body={'고른 노하우가 받는 매장으로 복사돼요 — 보내는 매장의 원본은 그대로 남아요.\n· 사진도 같이 복사돼요.\n· 복사된 노하우는 “점검 필요”로 표시돼요 — 받는 매장 기준(주소·연락처 등)이 맞는지 점검해 주세요.'}
              />
            </View>

            <SectionLabel icon="arrow-up-circle-outline" title="어느 매장에서 보낼까요?" />
            <View style={styles.sourceWrap}>
              {owned.map((s) => {
                const on = fromId === s.unit_id;
                return (
                  <Pressable
                    key={`from-${s.unit_id}`}
                    onPress={() => pickFrom(s.unit_id)}
                    style={[styles.sourceChip, on && styles.sourceChipOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${s.store_name}에서 보내기`}
                  >
                    <Ionicons name="storefront" size={14} color={on ? InkColors.bubbleText : InkColors.ink2} />
                    <Text style={[styles.sourceText, on && styles.sourceTextOn]} numberOfLines={1}>{s.store_name}</Text>
                  </Pressable>
                );
              })}
            </View>

            <SectionLabel icon="arrow-down-circle-outline" title="어느 매장이 받을까요?" />
            <View style={styles.sourceWrap}>
              {owned
                // 보내는 매장은 받는 후보에서 뺀다 — 고를 수 있게 두면 눌러 보고 나서 거절당한다.
                .filter((s) => s.unit_id !== fromId)
                .map((s) => {
                  const on = toId === s.unit_id;
                  return (
                    <Pressable
                      key={`to-${s.unit_id}`}
                      onPress={() => pickTo(s.unit_id)}
                      style={[styles.sourceChip, on && styles.sourceChipOn]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${s.store_name}이 받기`}
                    >
                      <Ionicons name="storefront" size={14} color={on ? InkColors.bubbleText : InkColors.ink2} />
                      <Text style={[styles.sourceText, on && styles.sourceTextOn]} numberOfLines={1}>{s.store_name}</Text>
                    </Pressable>
                  );
                })}
            </View>
            {!fromId ? (
              <Text style={styles.hintText}>보내는 매장을 먼저 골라 주세요.</Text>
            ) : !toId ? (
              <Text style={styles.hintText}>“{nameOf(fromId)}”의 노하우를 받을 매장을 골라 주세요.</Text>
            ) : (
              <Text style={styles.wayText}>{nameOf(fromId)} → {nameOf(toId)}</Text>
            )}
          </Appear>
        ) : null}

        {/* ── 2단계 · 노하우 고르기 ─────────────────────────────────────────────── */}
        {step === 2 ? (
          <>
            <Appear delay={0}>
              <Text style={styles.wayText}>{nameOf(fromId)} → {nameOf(toId)}</Text>
            </Appear>
            {loading ? (
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
                <Ionicons name="file-tray-outline" size={30} color={InkColors.ink3} />
                <Text style={styles.emptyBody}>이 매장에는 발행된 노하우가 없어요.</Text>
                <Pressable onPress={() => setStep(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="매장 다시 고르기">
                  <Text style={styles.retryLink}>매장 다시 고르기</Text>
                </Pressable>
              </View>
            ) : (
              <Appear delay={120} style={styles.block}>
                {/* 찾기 — 8건 미만이면 안 그린다. 단, 검색어가 남아 있으면 강제로 띄운다(끌 수 없는 거르기 금지). */}
                {(rows?.length ?? 0) >= FILTER_MIN || filtering ? (
                  <View style={styles.search}>
                    <Ionicons name="search" size={16} color={InkColors.ink3} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="예) 마감, 발주"
                      placeholderTextColor={InkColors.ink3}
                      style={styles.searchInput}
                      returnKeyType="search"
                    />
                    {query.length > 0 ? (
                      <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                        <Ionicons name="close-circle" size={16} color={InkColors.ink3} />
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.listHead}>
                  <Text style={styles.listCount}>
                    {filtering ? `${rows?.length}개 중 ${visible.length}개 보임 · ` : `${rows?.length}개 중 `}
                    {selected.size}개 선택
                  </Text>
                  <Pressable onPress={toggleAll} hitSlop={8} accessibilityRole="button" accessibilityLabel={filtering ? '보이는 노하우 전부 선택' : '전체 선택'}>
                    <Text style={styles.selectAll}>
                      {visibleAllSelected ? (filtering ? '보이는 것 해제' : '전체 해제') : filtering ? '보이는 것 전부' : '전체 선택'}
                    </Text>
                  </Pressable>
                </View>
                {/* 거르기 밖에서 고른 것을 숨기지 않는다 — 아래 도크의 숫자가 화면과 안 맞는 이유를 여기서 말한다. */}
                {hiddenSelected > 0 ? (
                  <Text style={styles.hiddenNote}>지금 안 보이는 {hiddenSelected}개도 고른 상태예요. 함께 복사해요.</Text>
                ) : null}
                {visible.length === 0 ? (
                  <View style={styles.center}>
                    <Text style={styles.emptyBody}>찾는 노하우가 없어요.</Text>
                    <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="검색어 지우기">
                      <Text style={styles.retryLink}>검색어 지우기</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.list}>
                  {visible.map((r) => {
                    const on = selected.has(r.id);
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
                          {/* 종류(루틴/돌발) 라벨 비노출(07-31 단일화). RPC가 section을 안 주므로 소분류만 남긴다. */}
                          {r.subcategory ? (
                            <View style={styles.rowMeta}>
                              <Text style={styles.rowSub} numberOfLines={1}>{r.subcategory}</Text>
                            </View>
                          ) : null}
                          {/* 본문 미리보기 — 행 탭이 '선택'이라 내용을 열어볼 어포던스가 없다.
                              제목만으로는 비슷한 이름 여럿 중 무엇을 복사하는지 알 수 없어 2줄까지 편다(QA #2). */}
                          {situation ? <Text style={styles.rowPreview} numberOfLines={2}>{situation}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </Appear>
            )}
          </>
        ) : null}

        {/* ── 3단계 · 복사 완료 ─────────────────────────────────────────────────── */}
        {step === 3 ? (
          <Appear delay={0} style={styles.block}>
            <View style={styles.doneHead}>
              <Ionicons name="checkmark-circle" size={22} color={BrandColors.goodText} />
              <Text style={styles.doneTitle}>
                {result.length}개를 “{nameOf(toId)}”으로 복사했어요
              </Text>
            </View>
            <Text style={styles.doneSub}>
              {photoTotal > 0 ? `사진 ${photoTotal}장도 같이 옮겼어요. ` : ''}
              보내는 매장의 원본은 그대로 남아 있어요.
            </Text>
            <View style={styles.list}>
              {result.map((r, i) => (
                <View key={`${r.title}-${i}`} style={styles.row}>
                  <Ionicons name="document-text-outline" size={16} color={InkColors.ink3} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rowTitle} numberOfLines={2}>{r.title}</Text>
                    <View style={styles.rowMeta}>
                      <Text style={styles.rowSub}>점검 필요</Text>
                      {r.photos > 0 ? <Text style={styles.rowSub}>· 사진 {r.photos}장</Text> : null}
                    </View>
                  </View>
                </View>
              ))}
            </View>
            <Text style={styles.hiddenNote}>
              복사된 노하우는 “점검 필요”로 표시돼요. 받는 매장 기준(주소·연락처 등)이 맞는지 점검해 주세요.
            </Text>
          </Appear>
        ) : null}

        <View style={{ height: 96 }} />
      </ScrollView>

      {/* 하단 도크 — 단계마다 주 액션 1개. 프레임 안 정상 흐름(모달 아님)이라 폭은 프레임에 귀속. */}
      <View style={styles.dock}>
        {step === 1 ? (
          <Pressable
            onPress={goPick}
            disabled={!fromId || !toId}
            style={({ pressed }) => [styles.importBtn, (!fromId || !toId) && { opacity: 0.4 }, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="노하우 고르기"
          >
            <Text style={styles.importBtnText}>노하우 고르기</Text>
          </Pressable>
        ) : step === 2 ? (
          <View style={styles.dockRow}>
            <Pressable
              onPress={() => setStep(1)}
              disabled={copying}
              style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel="매장 다시 고르기"
            >
              <Text style={styles.backBtnText}>매장</Text>
            </Pressable>
            <Pressable
              onPress={doCopy}
              disabled={copying || selected.size === 0}
              style={({ pressed }) => [
                styles.importBtn,
                styles.importBtnFill,
                (copying || selected.size === 0) && { opacity: 0.4 },
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${selected.size}개 복사하기`}
            >
              {copying ? (
                <ActivityIndicator color={InkColors.bubbleText} size="small" />
              ) : (
                <Ionicons name="copy-outline" size={17} color={InkColors.bubbleText} />
              )}
              <Text style={styles.importBtnText}>
                {copying ? '복사하는 중…' : selected.size === 0 ? '노하우를 골라 주세요' : `${selected.size}개 복사하기`}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.importBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="끝내기"
          >
            <Text style={styles.importBtnText}>끝내기</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: Space.gutter, gap: Space.md },

  lead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leadText: { flex: 1, fontSize: 15, color: InkColors.ink2, fontWeight: '600', lineHeight: 22 },

  block: { gap: Space.sm },

  // 매장 칩(보내는 쪽·받는 쪽 같은 모양 — 다른 것은 위 라벨이 말한다)
  sourceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  sourceChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    backgroundColor: InkColors.bg, borderWidth: 1.5, borderColor: InkColors.line,
    borderRadius: Radius.pill, paddingVertical: 9, paddingHorizontal: 14,
  },
  sourceChipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  sourceText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2, flexShrink: 1 },
  sourceTextOn: { color: InkColors.bubbleText },

  hintText: { fontSize: 13, color: InkColors.ink3, fontWeight: '600' },
  // 방향 한 줄 — 2단계에서 "지금 어디서 어디로"를 잃지 않게 계속 보여준다.
  wayText: { fontSize: 13.5, fontWeight: '800', color: InkColors.ink2 },
  center: { paddingVertical: 40, alignItems: 'center', gap: 8 },

  // 찾기 바 — OwnerKnowhowBrowse 의 검색행과 같은 형태(새로 발명하지 않는다).
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44,
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.md, backgroundColor: InkColors.bg,
    paddingHorizontal: Space.md,
  },
  searchInput: { flex: 1, fontSize: 15, color: InkColors.ink, paddingVertical: 8 },
  hiddenNote: { fontSize: 12.5, color: InkColors.ink2, fontWeight: '600', lineHeight: 18 },

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
  rowSub: { fontSize: 12, color: InkColors.ink3, fontWeight: '600', flexShrink: 1 },
  rowPreview: { fontSize: 12.5, color: InkColors.ink3, fontWeight: '500', marginTop: 4, lineHeight: 17 },

  retryLink: { fontSize: 13, fontWeight: '800', color: BrandColors.brand, textDecorationLine: 'underline' },

  // 3단계 완료
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  doneTitle: { flex: 1, fontSize: 16, fontWeight: '800', color: InkColors.ink, lineHeight: 23 },
  doneSub: { fontSize: 13.5, color: InkColors.ink2, fontWeight: '600', lineHeight: 20 },

  // 하단 도크
  dock: {
    paddingHorizontal: Space.gutter, paddingTop: Space.sm, paddingBottom: Space.md,
    borderTopWidth: 1, borderTopColor: InkColors.line, backgroundColor: InkColors.cream,
  },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 14, borderRadius: Radius.md, backgroundColor: InkColors.ink, ...Elevation.e2,
  },
  importBtnFill: { flex: 1, minWidth: 0 },
  importBtnText: { fontSize: 15, fontWeight: '800', color: InkColors.bubbleText },
  backBtn: {
    alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: Space.lg,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  backBtnText: { fontSize: 15, fontWeight: '800', color: InkColors.ink },

  // 빈 상태(단일 매장)
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: Space.xl },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: InkColors.ink2 },
  emptyBody: { fontSize: 15, color: InkColors.ink2, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
});
