// /hq/quizzes/status — 퀴즈 매장별 배포 상태(하위 메뉴 · 2026-10-02 목록 화면에서 나왔다).
import { useMemo } from 'react';

import { HqDeployStatusPage } from '@/components/hq/HqDeployStatusPage';
import { useBrandQuizStore } from '@/lib/store/useBrandQuizStore';
import type { BrandCourseCell } from '@/lib/brand/brandDb';

const idOf = (c: BrandCourseCell) => c.course_id;

export default function HqQuizzesStatusScreen() {
  const list = useBrandQuizStore((s) => s.list);
  const matrix = useBrandQuizStore((s) => s.matrix);
  const loaded = useBrandQuizStore((s) => s.loaded);
  const error = useBrandQuizStore((s) => s.error);
  const hydrate = useBrandQuizStore((s) => s.hydrate);
  const refresh = useBrandQuizStore((s) => s.refresh);
  const rows = useMemo(() => list.map((r) => ({ id: r.id, title: r.name })), [list]);
  return (
    <HqDeployStatusPage
      kind="퀴즈"
      rows={rows}
      cells={matrix}
      idOf={idOf}
      loaded={loaded}
      error={error}
      hydrate={hydrate}
      refresh={refresh}
      testID="hq-quizzes-status"
    />
  );
}
