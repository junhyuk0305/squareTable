// useBrandQuizStore.ts — 본사 퀴즈 화면 상태(작업실 원본 + 배포 현황). realtime 없음(정본 §6-3).
//
// ★핵심 전제는 useBrandKnowhowStore 와 같다 — **작업실이 활성 매장이어야 한다.** 코스·항목·문항 조회는 매장 앱과
//   같은 RLS 경로(`unit_id = auth_unit_id()`)라, 활성 매장이 작업실이 아니면 `fetchTrainingCourses()` 가 조용히 0행이다.
//   그래서 hydrate 첫 줄이 `enterBrandWorkspace()`(0215 · 멱등)다.
//
// 재료가 넷인 이유:
//   courses·courseEntries — 작업실 원본(빌더가 쓴다). RLS 경로라 db.ts 그대로.
//   list                  — 표 재료(문항 수·배포 매장 수·배포 버전). 사본은 다른 매장 행이라 정의자 RPC 로만 센다.
//   matrix                — 퀴즈 교차표 칸(퀴즈 × 매장). 사본이 없는 칸은 행이 없다 = 미배포.
//   entryMatrix           — 노하우 교차표 칸. 배포 모달이 "함께 내려갈 노하우 n건"을 **미리** 말하는 데 쓴다(지시서 §3-2).
import { create } from 'zustand';
import { coalesce } from '@/lib/store/realtimeSync';
import { fetchCourseEntries, fetchTrainingCourses, type CourseEntryRow } from '@/lib/db';
import {
  enterBrandWorkspace,
  fetchBrandQuizzes,
  fetchBrandCourseMatrix,
  fetchBrandDeployMatrix,
  deployBrandCourse,
  type BrandQuizRow,
  type BrandCourseCell,
  type BrandDeployCell,
  type BrandCourseDeployResult,
} from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { reportError } from '@/lib/analytics/track';
import type { TrainingCourse } from '@/lib/quiz/types';

type State = {
  /** 작업실 unit id — 빌더가 새 코스·항목·문항의 `unit_id` 로 쓴다. null 이면 아직 못 들어갔다. */
  wsUnitId: string | null;
  courses: TrainingCourse[];
  courseEntries: CourseEntryRow[];
  list: BrandQuizRow[];
  matrix: BrandCourseCell[];
  entryMatrix: BrandDeployCell[];
  loaded: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 배포 — 성공하면 매장별 결과를 돌려주고 스스로 재조회한다. */
  deploy: (courseId: string, unitIds: string[]) => Promise<{ data: BrandCourseDeployResult[] | null; error: string | null }>;
  reset: () => void;
};

const EMPTY = { wsUnitId: null, courses: [], courseEntries: [], list: [], matrix: [], entryMatrix: [], loaded: false, error: null } satisfies Pick<
  State,
  'wsUnitId' | 'courses' | 'courseEntries' | 'list' | 'matrix' | 'entryMatrix' | 'loaded' | 'error'
>;

export const useBrandQuizStore = create<State>((set, get) => {
  const hydrate = coalesce(async () => {
    const ws = await enterBrandWorkspace();
    if (ws.error || !ws.data) {
      reportError('brandQuiz.enterWorkspace', ws.error ?? { message: 'no_workspace' });
      set({ loaded: true, error: brandErrorMessage(ws.error) });
      return;
    }
    const [c, ce, l, m, em] = await Promise.all([
      fetchTrainingCourses(),
      fetchCourseEntries(),
      fetchBrandQuizzes(),
      fetchBrandCourseMatrix(),
      fetchBrandDeployMatrix(),
    ]);
    const err = l.error ?? m.error ?? em.error;
    if (c.error || err) {
      if (err) reportError('brandQuiz.hydrate', err);
      // 부분 실패도 실패다 — 반만 채운 표가 '정상'으로 보이는 게 더 위험하다(useBrandStore 와 같은 규칙).
      set({ wsUnitId: ws.data, loaded: true, error: brandErrorMessage(err, '퀴즈를 불러오지 못했어요.') });
      return;
    }
    set({
      wsUnitId: ws.data,
      courses: (c.data ?? []).filter((x) => x.active),
      courseEntries: ce,
      list: l.data ?? [],
      matrix: m.data ?? [],
      entryMatrix: em.data ?? [],
      loaded: true,
      error: null,
    });
  });

  return {
    ...EMPTY,
    hydrate,
    refresh: hydrate,
    deploy: async (courseId, unitIds) => {
      const r = await deployBrandCourse(courseId, unitIds);
      if (r.error) {
        reportError('brandQuiz.deploy', r.error);
        return { data: null, error: brandErrorMessage(r.error, '배포하지 못했어요.') };
      }
      await get().refresh();
      return { data: r.data ?? [], error: null };
    },
    reset: () => set({ ...EMPTY }),
  };
});
