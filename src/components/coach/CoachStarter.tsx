import { View, Text, StyleSheet, Pressable } from 'react-native';

import { getCategoryMeta } from '@/lib/utils/category';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius, Elevation } from '@/lib/theme/elevation';

import { MiniSquareCard } from './MiniSquareCard';

import type { Category, PlaybookEntry, SquareBlock } from '@/types';

/* ───────────────────────────────────────────────────────────
 * 빈 상태 스타터 — 직접 등록 화면이 초기 AI 안내만 있고 텅 빌 때 노출.
 * 첫 발화를 유도한다: (1) 예시 칩(탭→입력창 프리필) (2) 결과 프리뷰 카드
 * (3) 최근 등록한 노하우 스트립. 첫 발화가 시작되면(square/메시지 생김) 사라진다.
 * 실서비스 빈-대화 패턴(ChatGPT 초기 화면)과 동일: 결과물을 먼저 보여주고 입력을 낮춘다.
 * ─────────────────────────────────────────────────────────── */

// 예시 4종 — 마스터지침 few-shot에서 발췌. 4개 내부 카테고리를 자연스럽게 커버한다.
const EXAMPLES = [
  '여분 시럽은 창고 맨 위 칸에 있어',
  '포스 마감은 카드부터 정산하고 현금 세기',
  '진상 손님 오면 매니저부터 불러',
  '우유 거품은 적당히 곱게 올려야 라떼아트가 잘 나와',
];

// 프리뷰용 샘플 — "이렇게 정리돼요"를 보여주는 정적 카드(비활성).
const PREVIEW_SQUARE: SquareBlock = {
  situation: '오픈 준비 — 커피머신 예열',
  quagmire: '',
  uncover: '',
  action: { steps: ['전원 켜고 15분 예열한다', '포터필터를 뜨거운 물로 헹군다'], scripts: [] },
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
  return (
    <View style={styles.wrap}>
      {/* 1) 예시 칩 — 탭하면 입력창에 꽂힌다 */}
      <View style={styles.block}>
        <Text style={styles.hint}>이런 걸 적으면 돼요 — 탭해서 시작</Text>
        <View style={styles.chips}>
          {EXAMPLES.map((ex) => (
            <Pressable
              key={ex}
              onPress={() => onPickExample(ex)}
              style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={`예시: ${ex}`}
            >
              <Text style={styles.chipMark}>💬</Text>
              <Text style={styles.chipText}>{ex}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 2) 결과 프리뷰 — 흐리게, 손대지 않는 정적 카드 */}
      <View style={styles.block}>
        <Text style={styles.hint}>적으면 이렇게 정리돼요</Text>
        <View style={styles.previewCap} pointerEvents="none">
          <MiniSquareCard
            square={PREVIEW_SQUARE}
            title="오픈 커피머신 예열"
            category={'Routine' as Category}
            editable={false}
            showActions={false}
            onEdit={noop}
            onDoneEditing={noop}
            onRetalk={noop}
            onPublish={noop}
            onPatch={noop}
            onTitle={noop}
            publishLabel="노하우로 저장"
          />
        </View>
      </View>

      {/* 3) 최근 등록 스트립 — 있을 때만(첫 사용이면 숨김) */}
      {recent.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.hint}>최근 이렇게 알려주셨어요</Text>
          <View style={{ gap: 6 }}>
            {recent.map((e) => {
              const m = getCategoryMeta(e.category);
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
  hint: { fontSize: 12, fontWeight: '800', color: InkColors.ink3, letterSpacing: 0.2, paddingHorizontal: 2 },

  chips: { gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bg,
    ...Elevation.e1,
  },
  chipMark: { fontSize: 14 },
  chipText: { flex: 1, fontSize: 14, fontWeight: '600', color: InkColors.ink2, lineHeight: 20 },

  previewCap: { opacity: 0.55 },

  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: InkColors.line,
    backgroundColor: InkColors.bgSoft,
  },
  recentDot: { width: 8, height: 8, borderRadius: Radius.pill },
  recentText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: InkColors.ink2 },
});
