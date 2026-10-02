// /hq/stores/<unit_id> — 매장 상세 페이지(정본 §5-2): 머리 줄(← · 매장 이름 · 관계 · 공개 수준) + 탭 4개.
//
//   개요         — 이 매장이 지금 어떤가: 숫자 칸 · 본사 노하우/퀴즈 배포 상태 · 매장 활동
//   노하우 · 퀴즈 — 본사가 보낸 것을 이 매장 기준으로(상태 5종 · 같은 어휘 deployStatus.ts)
//   연결과 규칙   — 예전 상세(드로어)의 내용 전부: 연결 정보 · 직영 전용 규칙 · 요청과 제안 · 연결 해제
//
// 2026-10-02 개편: 목록 옆 392 칸 → 별도 페이지(사용자 결정). 예전 상세는 설정 목록을 세로로 쌓은 것이라
//   "이 매장이 지금 어떤가"에 답이 없었다. 개요를 맨 앞에, 설정은 마지막 탭으로 보낸다.
// 탭은 주소(`?tab=`)가 SSOT 다 — 새로고침·공유·뒤로가기가 같은 탭을 연다.
// 재료 = useBrandUnitDetailStore(이 매장 행 · 부담 날짜 · 직영 규칙) + 본사 노하우·퀴즈 스토어(원본 목록 · 배포 교차표).
//   ⛔새 RPC 없음 — 전부 이미 받는 값이다. 개인 축 0(숫자는 전부 매장 단위 · 직원 이름 없음).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';

import { HqPage, HqButton, HqPill, HqRow, HqSlab, HqSegment, HqEmpty, HqLoadError, HqCard, HqTabs, HqField, HqNotice } from '@/components/hq/HqKit';
import { HqStrip } from '@/components/hq/HqStrip';
import { HqTable, Cell } from '@/components/hq/HqTable';
import { ScreenLoading } from '@/components/ScreenLoading';
import { Appear } from '@/components/Appear';
import { useBrandUnitDetailStore } from '@/lib/store/useBrandUnitDetailStore';
import { useBrandKnowhowStore } from '@/lib/store/useBrandKnowhowStore';
import { useBrandQuizStore } from '@/lib/store/useBrandQuizStore';
import {
  requestVisibility,
  proposePayer,
  acceptPayer,
  endBrandUnit,
  setVisibilityFloor,
  setContentRequired,
  setOwnerCanEnd,
  type BrandOverviewRow,
  type BrandPayer,
  type BrandPayerDateRow,
  type BrandUnitRulesRow,
} from '@/lib/brand/brandDb';
import { brandErrorMessage } from '@/lib/brand/errors';
import { DEPLOY_STATUS, type DeployStatus } from '@/lib/brand/deployStatus';
import { visibilityLabel, payerLabel, relationLabel, VISIBILITY_LEVELS, VIS_TONE, REL_TONE } from '@/lib/brand/visibility';
import { showToast } from '@/lib/store/useToastStore';
import { confirmAction } from '@/lib/utils/confirm';
import { InkColors } from '@/lib/theme/colors';
import { Space } from '@/lib/theme/layout';

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('ko-KR');

type Tab = 'overview' | 'knowhow' | 'quizzes' | 'rules';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '개요' },
  { key: 'knowhow', label: '노하우' },
  { key: 'quizzes', label: '퀴즈' },
  { key: 'rules', label: '연결과 규칙' },
];
/** 상태 칸 순서 — 매장별 배포 상태 표·범례와 같다. 미배포는 맨 끝. */
const ORDER: DeployStatus[] = ['current', 'modified', 'pending', 'hidden', 'none'];

/**
 * 요금 부담 줄 아래 날짜 한 마디(정본 §4-D). 본사 부담이면 "언제부터", 매장 부담인데 이번 달까지
 * 본사가 내는 중이면 "언제까지". 둘 다 없으면 아무 말도 안 붙인다 — 빈 칸이 낫다.
 */
function payerDateNote(payer: BrandPayer, dates: BrandPayerDateRow | null): string | undefined {
  if (!dates) return undefined;
  if (payer === 'brand' && dates.payer_effective_from) return `${dates.payer_effective_from}부터 본사 부담`;
  if (payer === 'store' && dates.brand_paid_through) return `본사 부담은 ${dates.brand_paid_through}까지`;
  return undefined;
}

export default function HqStoreDetailScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const current: Tab = TABS.some((t) => t.key === tab) ? (tab as Tab) : 'overview';

  const row = useBrandUnitDetailStore((s) => s.row);
  const payerDates = useBrandUnitDetailStore((s) => s.payerDates);
  const unitRules = useBrandUnitDetailStore((s) => s.unitRules);
  const detailUnit = useBrandUnitDetailStore((s) => s.unitId);
  const detailLoaded = useBrandUnitDetailStore((s) => s.loaded);
  const detailError = useBrandUnitDetailStore((s) => s.error);
  const loadDetail = useBrandUnitDetailStore((s) => s.load);
  const refreshDetail = useBrandUnitDetailStore((s) => s.refresh);
  const knowhowLoaded = useBrandKnowhowStore((s) => s.loaded);
  const hydrateKnowhow = useBrandKnowhowStore((s) => s.hydrate);
  const quizLoaded = useBrandQuizStore((s) => s.loaded);
  const hydrateQuiz = useBrandQuizStore((s) => s.hydrate);
  // ready 게이트(ui.md) — 이 매장 행 + 본사 노하우·퀴즈 교차표가 다 와야 그린다.
  // ★매장 행은 **이 매장 것**일 때만 선다 — 다른 매장으로 넘길 때 옛 매장 값이 새 주소 아래 스치지 않게.
  const ready = detailLoaded && detailUnit === id && knowhowLoaded && quizLoaded;

  useEffect(() => { if (id) void loadDetail(id); }, [id, loadDetail]);
  useFocusEffect(useCallback(() => { void hydrateKnowhow(); void hydrateQuiz(); }, [hydrateKnowhow, hydrateQuiz]));

  /**
   * ← = 들어온 곳으로(전체 매장 · 대시보드). 스택에 아래 칸이 없으면(주소 직접 입력·새로고침) 전체 매장으로.
   * 이 화면은 본사 스택(hq/_layout)에 바로 있다 — 그 스택의 index 만 본다.
   */
  const back = () => ((navigation.getState()?.index ?? 0) > 0 ? navigation.goBack() : router.replace('/hq/stores'));
  const setTab = (t: Tab) => router.setParams({ tab: t === 'overview' ? undefined : t });

  const backBtn = { label: '뒤로', onPress: back, testID: 'hq-store-back' };
  if (!ready) {
    return (
      <HqPage title="매장" back={backBtn} testID="hq-store-detail">
        <ScreenLoading label="매장 정보를 불러오고 있어요…" />
      </HqPage>
    );
  }
  if (!row) {
    return (
      <HqPage title="매장" back={backBtn} testID="hq-store-detail">
        {/* 읽기 실패를 '없는 매장'으로 위장하지 않는다. */}
        {detailError ? (
          <HqLoadError title="매장 정보를 불러오지 못했어요" onRetry={refreshDetail} testID="hq-store-detail-error" />
        ) : (
          <HqCard>
            <HqEmpty
              text="이 매장은 지금 연결된 매장 목록에 없어요."
              action={<HqButton label="전체 매장" onPress={() => router.replace('/hq/stores')} />}
            />
          </HqCard>
        )}
      </HqPage>
    );
  }

  return (
    <HqPage
      title={row.store_name}
      badges={
        <>
          <HqPill tone={REL_TONE[row.relation]} label={relationLabel(row.relation)} />
          <HqPill tone={VIS_TONE[row.visibility]} label={visibilityLabel(row.visibility)} />
        </>
      }
      sub={[row.industry, `${fmtDay(row.accepted_at)} 연결`, payerLabel(row.payer)].filter(Boolean).join(' · ')}
      back={backBtn}
      tabs={<HqTabs items={TABS} value={current} onChange={setTab} testID="hq-store-tabs" />}
      testID="hq-store-detail"
    >
      {/* key = 매장 + 탭 — 매장이나 탭이 바뀌면 같은 방식으로 다시 나타나고, 탭 안 로컬 상태도 새로 선다. */}
      <Appear key={`${row.unit_id}:${current}`}>
        {current === 'overview' ? (
          <Overview row={row} onTab={setTab} />
        ) : current === 'knowhow' ? (
          <KnowhowTab unitId={row.unit_id} />
        ) : current === 'quizzes' ? (
          <QuizzesTab unitId={row.unit_id} />
        ) : (
          <Rules
            row={row}
            dates={payerDates.find((d) => d.unit_id === row.unit_id) ?? null}
            rules={unitRules.find((r) => r.unit_id === row.unit_id) ?? null}
            onEnded={() => router.replace('/hq/stores')}
            onChanged={() => void refreshDetail()}
          />
        )}
      </Appear>
    </HqPage>
  );
}

// ── 개요 ─────────────────────────────────────────────────────────────────
function Overview({ row, onTab }: { row: BrandOverviewRow; onTab: (t: Tab) => void }) {
  const ops = row.visibility === 'ops';
  // 운영 공개 전용 값(0226)이 null 이면 '공개 수준 밖'이다. 운영 공개인데 null 이면 재료(받은 노하우)가 없는 것.
  const opsOnly = (v: number | null, empty: string) => (v !== null ? undefined : ops ? empty : '운영 공개일 때만 보여요');
  const knowhowStatus = useUnitStatusCounts('knowhow', row.unit_id);
  const quizStatus = useUnitStatusCounts('quiz', row.unit_id);

  // 본사가 손쓸 것만 — 0건은 그리지 않는다.
  const todo = [
    row.visibility_requested ? `${visibilityLabel(row.visibility_requested)} 요청을 점주가 보고 있어요.` : null,
    row.payer_proposed && !row.payer_proposed_by_brand ? `점주가 ${payerLabel(row.payer_proposed)}으로 바꾸자고 제안했어요. 연결과 규칙 탭에서 답할 수 있어요.` : null,
    knowhowStatus.counts.pending ? `노하우 ${knowhowStatus.counts.pending}건이 새 버전 대기예요. 점주가 교체할지 고르고 있어요.` : null,
    quizStatus.counts.pending ? `퀴즈 ${quizStatus.counts.pending}건이 새 버전 대기예요.` : null,
  ].filter((x): x is string => !!x);

  return (
    <>
      <HqStrip
        testID="hq-store-kpi"
        items={[
          { label: '직원', value: row.staff, unit: '명' },
          { label: '숙지율', value: row.mastery === null ? null : `${Math.round(row.mastery * 100)}%`, sub: row.mastery === null ? '받은 노하우가 생기면 계산돼요' : '받은 노하우 기준' },
          { label: '미이수 인원', value: row.staff_behind, unit: '명', sub: opsOnly(row.staff_behind, '받은 노하우가 생기면 계산돼요') ?? '받은 노하우를 하나라도 안 본 직원' },
          { label: '오답 몰린 노하우', value: row.weak_entries, unit: '건', sub: opsOnly(row.weak_entries, '받은 노하우가 생기면 계산돼요') ?? '글이 헷갈릴 수 있어요' },
        ]}
      />

      {todo.length ? (
        <HqNotice tone="warn">{todo.join(' ')}</HqNotice>
      ) : null}

      <View style={styles.cols}>
        <StatusCard title="본사 노하우" status={knowhowStatus} onMore={() => onTab('knowhow')} testID="hq-store-knowhow-status" />
        <StatusCard title="본사 퀴즈" status={quizStatus} onMore={() => onTab('quizzes')} testID="hq-store-quiz-status" />
      </View>

      <HqSlab title="매장 활동" hint="이 매장이 스스로 하는 일 · 사람 단위는 보이지 않아요" />
      <HqCard>
        <View style={styles.fields}>
          <HqField label="자체 노하우">{`${row.knowhow_own}건`}</HqField>
          <HqField label="미해결 질문">{`${row.pending_q}건`}</HqField>
          <HqField label="AI 사용(이번 달)">{`${row.ai_used}회`}</HqField>
          <HqField label="업무 완료(30일)" hint={opsOnly(row.tasks_done_30d, '')}>{row.tasks_done_30d === null ? '—' : `${row.tasks_done_30d}건`}</HqField>
          <HqField label="매장 퀴즈" hint={opsOnly(row.quiz_courses, '')}>{row.quiz_courses === null ? '—' : `${row.quiz_courses}개`}</HqField>
        </View>
      </HqCard>
    </>
  );
}

type StatusCounts = { counts: Record<DeployStatus, number>; total: number; error: string | null };

/** 이 매장에서 본사 원본들이 어느 상태인가 — 교차표(사본이 있는 칸)에서 세고, 칸이 없으면 미배포. */
function useUnitStatusCounts(kind: 'knowhow' | 'quiz', unitId: string): StatusCounts {
  const kList = useBrandKnowhowStore((s) => s.list);
  const kMatrix = useBrandKnowhowStore((s) => s.matrix);
  const kErr = useBrandKnowhowStore((s) => s.error);
  const qList = useBrandQuizStore((s) => s.list);
  const qMatrix = useBrandQuizStore((s) => s.matrix);
  const qErr = useBrandQuizStore((s) => s.error);
  return useMemo(() => {
    const counts: Record<DeployStatus, number> = { current: 0, modified: 0, pending: 0, hidden: 0, none: 0 };
    const cells = kind === 'knowhow'
      ? kMatrix.filter((c) => c.unit_id === unitId).map((c) => c.status)
      : qMatrix.filter((c) => c.unit_id === unitId).map((c) => c.status);
    for (const st of cells) counts[st]++;
    const total = kind === 'knowhow' ? kList.length : qList.length;
    counts.none = Math.max(0, total - cells.length);
    return { counts, total, error: kind === 'knowhow' ? kErr : qErr };
  }, [kind, unitId, kList, kMatrix, kErr, qList, qMatrix, qErr]);
}

function StatusCard({ title, status, onMore, testID }: { title: string; status: StatusCounts; onMore: () => void; testID?: string }) {
  return (
    <HqCard style={styles.col} testID={testID}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardMeta}>{status.error ? '' : `원본 ${status.total}건`}</Text>
        <HqButton label="전체 보기" onPress={onMore} style={{ marginLeft: 'auto' }} />
      </View>
      {status.error ? (
        <Text style={styles.muted}>불러오지 못했어요. 전체 보기에서 다시 시도할 수 있어요.</Text>
      ) : status.total === 0 ? (
        <Text style={styles.muted}>본사가 아직 만든 것이 없어요.</Text>
      ) : (
        <View style={styles.statusRow}>
          {ORDER.map((st) => (
            <View key={st} style={styles.statusCell}>
              <HqPill tone={DEPLOY_STATUS[st].tone} label={DEPLOY_STATUS[st].label} />
              <Text style={[styles.statusNum, status.counts[st] === 0 && { color: InkColors.ink3 }]}>{status.counts[st]}</Text>
            </View>
          ))}
        </View>
      )}
    </HqCard>
  );
}

// ── 노하우 · 퀴즈 탭 — 본사 원본을 이 매장 기준 상태로 ────────────────────────
function KnowhowTab({ unitId }: { unitId: string }) {
  const router = useRouter();
  const list = useBrandKnowhowStore((s) => s.list);
  const matrix = useBrandKnowhowStore((s) => s.matrix);
  const error = useBrandKnowhowStore((s) => s.error);
  const refresh = useBrandKnowhowStore((s) => s.refresh);
  const status = useMemo(() => new Map(matrix.filter((c) => c.unit_id === unitId).map((c) => [c.entry_id, c.status] as const)), [matrix, unitId]);
  if (error) return <HqLoadError title="노하우를 불러오지 못했어요" onRetry={refresh} testID="hq-store-knowhow-error" />;
  return (
    <>
      <HqTable
        columns={[
          { key: 'title', label: '노하우', width: 320, render: (r) => <Cell kind="name">{r.title}</Cell>, sortValue: (r) => r.title },
          { key: 'section', label: '카테고리', width: 150, render: (r) => <Cell kind="muted">{r.section || '미분류'}</Cell>, sortValue: (r) => r.section ?? '' },
          {
            key: 'st',
            label: '이 매장 상태',
            width: 150,
            render: (r) => {
              const st: DeployStatus = status.get(r.id) ?? 'none';
              return <HqPill tone={DEPLOY_STATUS[st].tone} label={DEPLOY_STATUS[st].label} />;
            },
            sortValue: (r) => ORDER.indexOf(status.get(r.id) ?? 'none'),
          },
          { key: 'ver', label: '배포 버전', align: 'right', render: (r) => (r.version ? <Cell kind="num">{`v${r.version}`}</Cell> : <Cell kind="muted">—</Cell>) },
        ]}
        rows={list}
        rowKey={(r) => r.id}
        onRowPress={(r) => router.push({ pathname: '/hq/knowhow/[id]', params: { id: r.id } })}
        footer={`${list.length}건 · 이 매장에 간 것 ${status.size}건`}
        empty={<HqEmpty text="본사가 쓴 노하우가 아직 없어요." action={<HqButton label="노하우 쓰기" variant="pri" onPress={() => router.push({ pathname: '/hq/knowhow/[id]', params: { id: 'new' } })} />} />}
        testID="hq-store-knowhow-table"
      />
      <Legend />
    </>
  );
}

function QuizzesTab({ unitId }: { unitId: string }) {
  const router = useRouter();
  const list = useBrandQuizStore((s) => s.list);
  const matrix = useBrandQuizStore((s) => s.matrix);
  const error = useBrandQuizStore((s) => s.error);
  const refresh = useBrandQuizStore((s) => s.refresh);
  const status = useMemo(() => new Map(matrix.filter((c) => c.unit_id === unitId).map((c) => [c.course_id, c.status] as const)), [matrix, unitId]);
  if (error) return <HqLoadError title="퀴즈를 불러오지 못했어요" onRetry={refresh} testID="hq-store-quiz-error" />;
  return (
    <>
      <HqTable
        columns={[
          { key: 'name', label: '퀴즈', width: 320, render: (r) => <Cell kind="name">{r.name}</Cell>, sortValue: (r) => r.name },
          { key: 'items', label: '문항', align: 'right', render: (r) => <Cell kind="num">{`${r.items}개`}</Cell>, sortValue: (r) => r.items },
          {
            key: 'st',
            label: '이 매장 상태',
            width: 150,
            render: (r) => {
              const st: DeployStatus = status.get(r.id) ?? 'none';
              return <HqPill tone={DEPLOY_STATUS[st].tone} label={DEPLOY_STATUS[st].label} />;
            },
            sortValue: (r) => ORDER.indexOf(status.get(r.id) ?? 'none'),
          },
          { key: 'ver', label: '배포 버전', align: 'right', render: (r) => (r.version ? <Cell kind="num">{`v${r.version}`}</Cell> : <Cell kind="muted">—</Cell>) },
        ]}
        rows={list}
        rowKey={(r) => r.id}
        onRowPress={(r) => router.push({ pathname: '/hq/quizzes/[id]', params: { id: r.id } })}
        footer={`${list.length}건 · 이 매장에 간 것 ${status.size}건 · 언제 누구에게 보낼지는 점주가 정해요`}
        empty={<HqEmpty text="본사가 만든 퀴즈가 아직 없어요." action={<HqButton label="퀴즈 만들기" variant="pri" onPress={() => router.push({ pathname: '/hq/quizzes/[id]', params: { id: 'new' } })} />} />}
        testID="hq-store-quiz-table"
      />
      <Legend />
    </>
  );
}

function Legend() {
  return (
    <View style={styles.legend}>
      {ORDER.map((k) => (
        <View key={k} style={styles.legendItem}>
          <HqPill tone={DEPLOY_STATUS[k].tone} label={DEPLOY_STATUS[k].label} />
          <Text style={styles.legendText}>{DEPLOY_STATUS[k].hint}</Text>
        </View>
      ))}
    </View>
  );
}

// ── 연결과 규칙 — 예전 상세의 내용 그대로(문구·권한 판정 동일), 카드로 묶었다 ─────────
function Rules({ row, dates, rules, onEnded, onChanged }: {
  row: BrandOverviewRow;
  /** 0221 본사 부담 시작·종료일. `brand_overview` 를 넓히지 않고 작은 RPC 로 따로 받는다. */
  dates: BrandPayerDateRow | null;
  /** 0224 직영 전용 값 3개. 가맹이면 이 카드가 없다. */
  rules: BrandUnitRulesRow | null;
  onEnded: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // 지금 수준보다 높은 첫 수준을 기본으로(부모가 key 로 매장·탭마다 새로 마운트한다).
  const [reqLevel, setReqLevel] = useState<'knowhow' | 'ops'>(() => (row.visibility === 'summary' ? 'knowhow' : 'ops'));

  const direct = row.relation === 'direct';
  const canRequest = row.visibility !== 'ops' && !row.visibility_requested;
  const otherPayer: BrandPayer = row.payer === 'brand' ? 'store' : 'brand';
  const payerNote = payerDateNote(row.payer, dates);

  const run = async (fn: () => Promise<{ message: string } | null>, okMsg: string) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) {
      showToast(brandErrorMessage(err), 'warn');
      return false;
    }
    showToast(okMsg, 'good');
    onChanged();
    return true;
  };

  return (
    <>
      <View style={styles.cols}>
        <HqCard title="연결 정보" style={styles.col}>
          {/* 관계(0223) — 맨 위. 아래 줄들이 "누가 정하나"로 갈리는 기준이라 먼저 읽혀야 한다.
              ⛔여기서 바꾸는 길은 없다(정본 §12 R3: 우리만 바꾼다). 바꾸려면 내부 콘솔이다. */}
          <HqRow first k="관계" v={<HqPill tone={REL_TONE[row.relation]} label={relationLabel(row.relation)} />} />
          <HqRow k="연결일" v={fmtDay(row.accepted_at)} />
          <HqRow
            k="요금 부담"
            v={<HqPill tone={row.payer === 'brand' ? 'y' : 'n'} label={payerLabel(row.payer)} />}
            tail={payerNote ? <Text style={styles.muted}>{payerNote}</Text> : undefined}
          />
          <HqRow k="공개 수준" v={<HqPill tone={VIS_TONE[row.visibility]} label={visibilityLabel(row.visibility)} />} />
        </HqCard>

        <HqCard title="요청과 제안" style={styles.col}>
          {/* 공개 수준 상향 요청 — 가맹에서 본사는 **요청만**(§3-4). 점주가 앱에서 수락하거나 유지한다.
              직영은 하한(아래 카드)으로 정하므로 요청 경로가 없다. */}
          {direct ? null : (
            <Section title="공개 수준 올려 달라고 요청">
              {row.visibility === 'ops' ? (
                <Text style={styles.hint}>가장 넓은 수준(운영 공개)이에요.</Text>
              ) : row.visibility_requested ? (
                <Text style={styles.hint}>{visibilityLabel(row.visibility_requested)} 요청을 점주가 보고 있어요. 점주가 답하면 바로 반영돼요.</Text>
              ) : (
                <View style={styles.inline}>
                  <HqSegment
                    items={VISIBILITY_LEVELS.filter((l) => l.key !== 'summary' && l.key !== row.visibility).map((l) => ({ key: l.key as 'knowhow' | 'ops', label: l.label }))}
                    value={reqLevel}
                    onChange={setReqLevel}
                  />
                  <HqButton
                    label="요청 보내기"
                    variant="dark"
                    disabled={busy || !canRequest}
                    testID="hq-request-visibility"
                    onPress={() => void run(() => requestVisibility(row.unit_id, reqLevel), '점주에게 요청을 보냈어요.')}
                  />
                </View>
              )}
            </Section>
          )}

          {/* payer — 제안 → 상대 수락(§3-5 D). 직영은 본사 부담 고정이라 제안 경로 자체가 없다(정본 §4-3 · 서버도 `direct_payer_fixed`). */}
          <Section title="요금 부담 변경" last>
            {direct ? (
              <Text style={styles.hint}>직영점은 본사 부담으로 고정돼요. 바꾸려면 먼저 관계를 가맹으로 바꿔야 해요(스퀘어테이블에 문의).</Text>
            ) : row.payer_proposed ? (
              row.payer_proposed_by_brand ? (
                <Text style={styles.hint}>{payerLabel(row.payer_proposed)}으로 바꾸자는 제안을 점주가 보고 있어요.</Text>
              ) : (
                <View style={{ gap: Space.sm }}>
                  <Text style={styles.hint}>점주가 {payerLabel(row.payer_proposed)}으로 바꾸자고 제안했어요.</Text>
                  <View style={styles.inline}>
                    <HqButton label="수락" variant="pri" disabled={busy} onPress={() => void run(() => acceptPayer(row.unit_id, true), '요금 부담이 바뀌었어요.')} />
                    <HqButton label="거절" disabled={busy} onPress={() => void run(() => acceptPayer(row.unit_id, false), '제안을 거절했어요.')} />
                  </View>
                </View>
              )
            ) : (
              <View style={{ gap: Space.sm }}>
                <Text style={styles.hint}>지금은 {payerLabel(row.payer)}이에요. 바꾸려면 점주가 수락해야 해요.</Text>
                <HqButton
                  label={`${payerLabel(otherPayer)}으로 제안`}
                  disabled={busy}
                  onPress={() => void run(() => proposePayer(row.unit_id, otherPayer), '점주에게 제안을 보냈어요.')}
                />
              </View>
            )}
          </Section>
        </HqCard>
      </View>

      {/* 직영(0224·0225·0227) — 본사가 정하는 값 3개. ⛔가맹에는 이 카드가 없다.
          "점주가 동의하면 본사가 정한다"를 만들지 않는 것이 방어선이다(정본 §4). 서버 CHECK 가 같은 선을 지킨다. */}
      {direct ? (
        <HqCard title="직영 전용 규칙" sub="직영점에서만 본사가 정해요. 바꾸면 점장에게 알림이 한 건 가요.">
          <View style={styles.ruleCols}>
            {/* 하한 — 점장은 그 위로만 움직인다(정본 §5 C안). */}
            <HqField label="공개 범위 하한" hint="하한을 올리면 지금 수준이 그 아래일 때 같이 올라가요." style={styles.ruleCol}>
              <HqSegment
                items={VISIBILITY_LEVELS.map((l) => ({ key: l.key, label: l.label }))}
                value={rules?.visibility_floor ?? 'summary'}
                onChange={(v) => void run(() => setVisibilityFloor(row.unit_id, v), '하한을 바꿨어요. 점장에게 알려드렸어요.')}
              />
            </HqField>
            <View style={styles.vline} />
            {/* 필수 배포 — ★배포 모달의 [필수로 내리기]는 이 값을 **켜기만** 한다. 끄는 것은 여기뿐이다
                (체크를 깜빡한 재배포 한 번이 본사가 일부러 세운 제약을 조용히 풀지 않게 · 사용자 결정 2026-09-23). */}
            <HqField
              label="받은 내용 숨기기 금지"
              hint={rules?.content_required ? '지금은 필수예요. 점장이 받은 노하우·퀴즈를 숨길 수 없어요.' : '지금은 권장이에요. 점장이 받은 내용을 숨길 수 있어요.'}
              style={styles.ruleCol}
            >
              <HqButton
                label={rules?.content_required ? '숨길 수 있게 되돌리기' : '필수로 바꾸기'}
                variant={rules?.content_required ? undefined : 'dark'}
                disabled={busy}
                testID="hq-content-required"
                onPress={() => void run(
                  () => setContentRequired(row.unit_id, !rules?.content_required),
                  rules?.content_required ? '이제 점장이 숨길 수 있어요.' : '필수로 바꿨어요.',
                )}
              />
            </HqField>
            <View style={styles.vline} />
            {/* 점주 해제권(0227) — 0224 가 자물쇠까지 만들고 켜는 자리를 빠뜨려 도달 불가였다(2026-09-26 실측). */}
            <HqField
              label="점주 해제권"
              hint={rules?.owner_can_end === false ? '지금은 본사 문의예요. 점장이 매장에서 연결을 끊을 수 없어요.' : '지금은 끊을 수 있어요. 점장이 매장에서 연결을 끝낼 수 있어요.'}
              style={styles.ruleCol}
            >
              <HqButton
                label={rules?.owner_can_end === false ? '끊을 수 있게 되돌리기' : '본사 문의로 바꾸기'}
                variant={rules?.owner_can_end === false ? undefined : 'dark'}
                disabled={busy}
                testID="hq-owner-can-end"
                onPress={() => void run(
                  () => setOwnerCanEnd(row.unit_id, rules?.owner_can_end === false),
                  rules?.owner_can_end === false ? '이제 점장이 끊을 수 있어요.' : '본사 문의로 바꿨어요.',
                )}
              />
            </HqField>
          </View>
        </HqCard>
      ) : null}

      <HqCard title="연결 해제" sub="해제하면 이 매장을 더 보지 못해요. 매장이 받은 노하우는 매장에 남아요.">
        <HqButton
          label="연결 해제"
          variant="danger"
          disabled={busy}
          testID="hq-end-unit"
          onPress={() => {
            void (async () => {
              const ok = await confirmAction('연결 해제', `${row.store_name}과의 연결을 끝낼까요? 되돌리려면 다시 초대해야 해요.`, '해제', { destructive: true, icon: 'unlink-outline' });
              if (!ok) return;
              if (await run(() => endBrandUnit(row.unit_id, 'brand'), '연결을 끝냈어요.')) onEnded();
            })();
          }}
        />
      </HqCard>
    </>
  );
}

/** 카드 안 한 묶음 — 작은 제목 + 내용. 묶음 사이는 선 하나. */
function Section({ title, children, last }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.section, !last && styles.sectionBorder]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', gap: Space.lg, flexWrap: 'wrap', marginBottom: Space.xs },
  col: { flex: 1, minWidth: 360 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.lg },
  cardTitle: { fontSize: 16, fontWeight: '700', color: InkColors.ink, flexShrink: 0 },
  cardMeta: { fontSize: 13.5, color: InkColors.ink3, flexShrink: 0 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  statusCell: { flex: 1, minWidth: 92, gap: 6, alignItems: 'flex-start' },
  statusNum: { fontSize: 24, fontWeight: '800', color: InkColors.ink, fontVariant: ['tabular-nums'], letterSpacing: -0.5 },
  fields: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space.lg, columnGap: Space.xl },
  ruleCols: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xl },
  ruleCol: { minWidth: 240 },
  vline: { width: 1, alignSelf: 'stretch', backgroundColor: InkColors.line },
  section: { paddingVertical: Space.md, gap: Space.sm },
  sectionBorder: { borderBottomWidth: 1, borderBottomColor: InkColors.line },
  sectionTitle: { fontSize: 14.5, fontWeight: '700', color: InkColors.ink },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, flexWrap: 'wrap' },
  hint: { fontSize: 14, lineHeight: 20, color: InkColors.ink2 },
  muted: { fontSize: 13.5, color: InkColors.ink3 },
  legend: { gap: 7, marginBottom: 26 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendText: { fontSize: 13.5, color: InkColors.ink3, flex: 1, minWidth: 0 },
});
