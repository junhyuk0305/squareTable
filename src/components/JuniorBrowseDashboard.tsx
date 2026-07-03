import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { SectionLabel } from './SectionLabel';
import { KnowhowCarousel } from './KnowhowCarousel';
import { EmptyState } from './EmptyState';
import { EntryDetailModal } from './EntryDetailModal';
import { Appear } from './Appear';
import { Space } from '@/lib/theme/layout';
import type { PlaybookEntry } from '@/types';

export type JuniorBrowseDashboardProps = {
  /** 둘러보기에 노출할 발행 노하우 목록 */
  entries: PlaybookEntry[];
  /** 빈 상태 안내 문구 */
  emptyHint?: string;
};

const SECTION_LIMIT = 4;

/**
 * 둘러보기 대시보드(주니어) — 일렬 리스트 대신 3개의 관점(렌즈)으로 노하우를 보여준다.
 *  · 🔥 인기 노하우    — 많이 물어본 순(query_hits_30d)
 *  · 🆕 최근 추가됨    — 새로 등록된 순(created_at)
 *  · ✅ 잘 통하는 노하우 — 해결률 높은 순(resolution_rate)
 *
 * 카드는 공용 BrowseCard를 그대로 재사용(검증배지·DO/DON'T·해결률·출처 동일).
 * 주니어 화면이라 카테고리 라벨은 숨기고 색 점만 노출(showCategory=false, 프레임 v2).
 *
 * 카드를 탭하면 원본 노하우(단계·멘트·기준·사진·출처 전체)를 읽기 전용 시트(EntryDetailModal)로 연다.
 * — '물어보기' 답변의 [출처] 탭과 같은 뷰라 일관되고, 둘러보기=읽기/물어보기=질문으로 역할이 갈린다.
 */
export function JuniorBrowseDashboard({ entries, emptyHint }: JuniorBrowseDashboardProps) {
  const [detailEntry, setDetailEntry] = useState<PlaybookEntry | null>(null);

  const popular = useMemo(
    () =>
      entries
        .filter((e) => (e.stats?.query_hits_30d ?? 0) > 0)
        .sort((a, b) => (b.stats?.query_hits_30d ?? 0) - (a.stats?.query_hits_30d ?? 0))
        .slice(0, SECTION_LIMIT),
    [entries],
  );

  const recent = useMemo(
    () =>
      [...entries]
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .slice(0, SECTION_LIMIT),
    [entries],
  );

  const resolved = useMemo(
    () =>
      entries
        .filter((e) => typeof e.stats?.resolution_rate === 'number')
        .sort((a, b) => (b.stats?.resolution_rate ?? 0) - (a.stats?.resolution_rate ?? 0))
        .slice(0, SECTION_LIMIT),
    [entries],
  );

  if (!entries || entries.length === 0) {
    const hint = emptyHint ?? '아직 등록된 노하우가 없어요. 물어보기로 질문하면 사장님이 채워줘요.';
    return <EmptyState title="아직 보여줄 노하우가 없어요" body={hint} />;
  }

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {popular.length > 0 && (
          <Appear delay={0} style={styles.block}>
            <SectionLabel icon="flame-outline" title="인기 노하우" hint="많이 물어본 순" />
            <KnowhowCarousel entries={popular} onSelect={setDetailEntry} showCategory={false} />
          </Appear>
        )}

        {recent.length > 0 && (
          <Appear delay={80} style={styles.block}>
            <SectionLabel icon="sparkles-outline" title="최근 추가됨" hint="새로 올라온 순" />
            <KnowhowCarousel entries={recent} onSelect={setDetailEntry} showCategory={false} />
          </Appear>
        )}

        {resolved.length > 0 && (
          <Appear delay={160} style={styles.block}>
            <SectionLabel icon="checkmark-circle-outline" title="잘 통하는 노하우" hint="해결률 순" />
            <KnowhowCarousel entries={resolved} onSelect={setDetailEntry} showCategory={false} />
          </Appear>
        )}
      </ScrollView>

      {/* 카드 탭 → 원본 노하우 전체(읽기 전용) */}
      <EntryDetailModal
        entry={detailEntry}
        visible={!!detailEntry}
        onClose={() => setDetailEntry(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  // 가로 패딩은 Space.gutter(20)로 — KnowhowCarousel이 -Space.gutter로 가장자리까지 흘리므로
  // 같은 값이어야 상쇄돼 460 프레임을 벗어나지 않는다(Space.lg=16이면 4px 오버플로).
  content: { paddingHorizontal: Space.gutter, paddingVertical: Space.lg, gap: Space.xl },
  // 한 블록 = [밖 라벨] + [카드들]. block 내부 gap이 라벨↔카드·카드 사이를 붙이고,
  // content의 gap(xl)이 블록 사이를 벌린다.
  block: { gap: Space.md },
});
