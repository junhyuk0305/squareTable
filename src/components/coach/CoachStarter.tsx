import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Collapse } from '@/components/Collapse';
import { getSectionMeta } from '@/lib/utils/category';
import { BrandColors, InkColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';

import { MiniSquareCard } from './MiniSquareCard';

import type { PlaybookEntry, SquareBlock } from '@/types';

/* ───────────────────────────────────────────────────────────
 * 빈 상태 스타터 — 직접 등록 화면이 초기 AI 안내만 있고 텅 빌 때 노출.
 * 첫 발화를 유도한다: (1) 예시 칩(탭→입력창 프리필) (2) 접히는 결과 프리뷰 (3) 최근 등록 스트립.
 *
 * ★2026-08-08 정리. 이 화면은 IA 에 type B(채팅)로 적혀 있어서 A형 규칙에도 B형 규칙에도 안 걸린 채
 *   남아 있었다. 실제로는 **진입 직후만 조합 화면**이라 실측하면 블록 5 · 카드 5장이었다. 고친 것:
 *    · 노란 팁 카드 삭제 — "정리는 제가 할게요"가 위 말풍선과 **글자 그대로 겹쳤다**(지시 3중).
 *      언제·무엇을·어떻게 안내는 말풍선 한 줄로 흡수(OwnerCoachChat 초기 메시지).
 *    · 예시 카드 4장 연속(배치규칙 ① 위반) → **가로 스크롤 칩 1행**. 옆 것을 잘라 더 있음을 알린다(규칙 ④).
 *    · 프리뷰 카드는 접는다. 다만 **처음 쓰는 사장에게는 편다** — 이 카드가 "적으면 뭐가 나오는지"를
 *      가르치는 유일한 장치라, 규칙만 보고 접으면 콜드스타트가 더 나빠진다(첫 사용 = 최근 등록 0건).
 *    · 본문 15sp 하한 적용(칩 14 → 15).
 * ─────────────────────────────────────────────────────────── */

// 예시 4종 — 마스터지침 few-shot에서 발췌. 4개 내부 카테고리를 자연스럽게 커버한다.
// ★칩은 한 줄이라 길면 잘린다 → 잘려도 "이렇게 적으면 된다"가 전달되게 앞부분에 핵심을 둔다.
const EXAMPLES = [
  '여분 시럽은 창고 맨 위 칸에 있어',
  '포스 마감은 카드부터 정산하고 현금 세기',
  '진상 손님 오면 매니저부터 불러',
  '우유 거품은 곱게 올려야 라떼아트가 잘 나와',
];

// 프리뷰용 샘플 — "이렇게 정리돼요"를 보여주는 정적 카드(비활성).
const PREVIEW_SQUARE: SquareBlock = {
  situation: '오픈 준비 — 커피머신 예열',
  quagmire: '',
  uncover: '',
  action: { steps: ['전원 켜고 15분 예열한다', '포터필터를 뜨거운 물로 헹군다'] },
  result: { before: '', after: '', metric: '' },
  extract: { do: '', dont: '예열 끝나기 전엔 추출하지 않기' },
};

const noop = () => {};

export function CoachStarter({
  recent,
  onPickExample,
  onSelectEntry,
}: {
  recent: PlaybookEntry[];
  onPickExample: (text: string) => void;
  onSelectEntry?: (id: string) => void;
}) {
  const router = useRouter();
  // 첫 사용(등록한 노하우 0건)이면 펼친 채로 시작한다 — 그때만 이 카드가 가르칠 게 있다.
  const [previewOpen, setPreviewOpen] = useState(recent.length === 0);

  return (
    <View style={styles.wrap}>
      {/* 1) 예시 칩 — 탭하면 입력창에 꽂힌다. 가로 스크롤이라 옆 것이 잘려 더 있음을 알린다. */}
      <View style={styles.block}>
        <Text style={styles.hint}>이런 걸 적어요 — 눌러서 시작</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {EXAMPLES.map((ex) => (
            <Pressable
              key={ex}
              onPress={() => onPickExample(ex)}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={`예시: ${ex}`}
            >
              {/* 2026-08-06: 💬 → 아이콘(ADR-003 예외 3범주 밖 — 워딩 §2.3 적용) */}
              <Ionicons name="chatbubble-outline" size={13} color={InkColors.ink3} />
              <Text style={styles.chipText} numberOfLines={1}>{ex}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* 이미 문서로 갖고 있는 사장을 위한 두 번째 입구 — 노하우 목록 아래에만 있어서
            '노하우 추가'로 들어온 사람은 못 만났다(2026-08-11 실측 피드백).
            액센트 노랑으로 칩 줄과 확실히 갈라 놓는다. 한 줄에 언제·무엇을·어떻게가 다 있어야 눌린다. */}
        <Pressable
          onPress={() => router.push('/owner/handover' as never)}
          accessibilityRole="button"
          accessibilityLabel="한번에 올리기"
          style={({ pressed }) => [styles.uploadRow, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={InkColors.ink} />
          <View style={styles.uploadBody}>
            <Text style={styles.uploadTitle}>한번에 올리기</Text>
            <Text style={styles.uploadSub}>인수인계서·매뉴얼을 노하우로 쪼개 드려요</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={InkColors.ink} />
        </Pressable>
      </View>

      {/* 2) 결과 프리뷰 — 접힌 한 줄. 처음 쓰는 사장에게만 펴진 채로 시작한다. */}
      <View style={styles.block}>
        <Pressable
          onPress={() => setPreviewOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={previewOpen ? '정리된 모습 접기' : '정리되면 어떤 모습인지 보기'}
          style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.toggleText}>정리되면 이런 모습이에요</Text>
          <Ionicons name={previewOpen ? 'chevron-up' : 'chevron-down'} size={16} color={InkColors.ink3} />
        </Pressable>
        {previewOpen && (
          <Collapse style={styles.previewCap}>
            <View pointerEvents="none">
              <MiniSquareCard
                square={PREVIEW_SQUARE}
                title="오픈 커피머신 예열"
                editable={false}
                showActions={false}
                onRetalk={noop}
                onPublish={noop}
                onPatch={noop}
                onTitle={noop}
                publishLabel="노하우로 저장"
              />
            </View>
          </Collapse>
        )}
      </View>

      {/* 3) 최근 등록 스트립 — 있을 때만(첫 사용이면 숨김) */}
      {recent.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.hint}>최근 이렇게 알려주셨어요</Text>
          <View style={{ gap: 6 }}>
            {recent.map((e) => {
              const m = getSectionMeta(e.section);
              return (
                <Pressable
                  key={e.id}
                  onPress={() => onSelectEntry?.(e.id)}
                  disabled={!onSelectEntry}
                  style={({ pressed }) => [styles.recentRow, pressed && !!onSelectEntry && { opacity: 0.6 }]}
                  accessibilityRole={onSelectEntry ? 'button' : undefined}
                >
                  <View style={[styles.recentDot, { backgroundColor: m.color }]} />
                  <Text style={styles.recentText} numberOfLines={1}>{e.title}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 18, paddingTop: 2 },
  block: { gap: 8 },
  // 섹션 힌트는 '보조'라 15sp 하한 대상이 아니다(simplicity-voice §4).
  hint: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0.2, paddingHorizontal: 2 },

  // 가로 스크롤 칩 — 마지막 칩 뒤 여백을 둬 잘린 것이 더 있다는 인상을 남긴다.
  chips: { gap: Space.sm, paddingRight: Space.xl },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: 300,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e1,
  },
  // 읽어서 판단하는 문장이라 본문 하한 15sp.
  chipText: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink2 },

  // 브랜드 노랑 단색 + 검정 글자. 노랑 위에서 ink2(#6b6b6b)는 대비가 4.4로 아슬해서
  // 제목·설명 모두 ink 로 두고 **굵기**로만 위계를 준다(색 규칙: 노랑 면 위 흰 글자 금지).
  uploadRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    minHeight: 48, paddingHorizontal: 14, paddingVertical: Space.md,
    borderRadius: Radius.md,
    backgroundColor: BrandColors.yellow,
  },
  uploadBody: { flex: 1, gap: 1 },
  uploadTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  uploadSub: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: InkColors.ink },

  toggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, paddingHorizontal: 14,
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  toggleText: { fontSize: 15, fontWeight: '700', color: InkColors.ink },
  previewCap: { opacity: 0.55, paddingTop: Space.sm },

  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  recentDot: { width: 8, height: 8, borderRadius: Radius.pill },
  recentText: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink2 },
});
