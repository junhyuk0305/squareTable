import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { usePlaybookStore } from '@/lib/store/usePlaybookStore';
import { useStaffStore } from '@/lib/store/useStaffStore';
import { useSessionStore } from '@/lib/store/useSessionStore';
import { useWorkStore } from '@/lib/store/useWorkStore';
import { guardWrite } from '@/lib/store/useSyncStore';
import { showToast } from '@/lib/store/useToastStore';
import { genId } from '@/lib/utils/id';
import {
  upsertTrainingCourse,
  insertQuizItem,
  deleteQuizItem,
  insertQuizAssignments,
} from '@/lib/db';
import { generateQuizItems, QuizQuotaError } from '@/lib/quiz/generate';
import { FORMATS } from '@/lib/quiz/formats';
import { detectKinds } from '@/lib/quiz/detect';
import { QuizEditorSheet } from '@/components/owner/quiz/QuizEditorSheet';
import { QuizPreviewSheet } from '@/components/owner/quiz/QuizPreviewSheet';
import { StepProgress } from '@/components/blocks/StepProgress';
import { EmptyState } from '@/components/EmptyState';
import { InkColors, BrandColors } from '@/lib/theme/colors';
import { Radius } from '@/lib/theme/elevation';
import { Space } from '@/lib/theme/layout';
import type { QuizItem } from '@/lib/quiz/types';
import type { PlaybookEntry } from '@/types';

const TOTAL = 5;
const STEP_TITLES = ['무엇을 확인할까요', '문제를 만들고 있어요', '문항 검토', '이름과 받는 사람', '일정'] as const;

/** 마감 후보 — 자유 입력을 주지 않는다(복잡도 §4 "칩 선택으로 못 바꾸나"를 먼저 묻는다). */
const DEADLINES: { label: string; days: number | null }[] = [
  { label: '마감 없음', days: null },
  { label: '3일 안에', days: 3 },
  { label: '7일 안에', days: 7 },
  { label: '14일 안에', days: 14 },
];

/** "직접 정할래요"를 골랐을 때의 고정 주기. 간격 확대(맡김)를 안 쓰겠다는 뜻이다. */
const CYCLES: { label: string; days: number }[] = [
  { label: '한 달마다', days: 30 },
  { label: '3개월마다', days: 90 },
  { label: '6개월마다', days: 180 },
];

/** 노하우 한 줄의 부제 — `detectKinds` 결과를 사장 말로. 새로 판정하지 않는다. */
const KIND_HINT: Record<string, string> = {
  t1: '할 일 여러 단계',
  t2: '기준 값 있음',
  t3: '금지 있음',
  t5: '상황이 갈림',
  t6: '이름·용어 있음',
  t0: '내용 있음',
};

type Made = { entryId: string; title: string; item: QuizItem | null; formatLabel: string; state: 'wait' | 'ok' | 'thin' };

/**
 * 퀴즈 만들기 — 5단계(C 몰입형: 한 화면 한 항목, 상단 n/m).
 *
 * 이 화면이 이번 재설계의 본체다. 예전에는 `코스 만들기 → 담기 → 업무에 붙이기`를 먼저 통과해야
 * 문제 하나를 낼 수 있었다. 여기서는 **노하우를 고르는 것이 곧 시작**이고, 나머지는 코드가 한다.
 *
 * ★ 사장에게 문항 형태를 고르게 하지 않는다. `generateQuizItems` 가 `detectKinds` 로 판정해
 *   자동으로 정하고, 사장은 3단계에서 **검토만** 한다. 11종을 늘어놓는 순간 "노하우만 고르면 끝"이라는
 *   강점이 사라진다(직접 쓰기에서만 쉬운 형태를 노출한다 — QuizEditorSheet startMode='manual').
 * ★ 5단계에서 **요일·시각을 묻지 않는다.** 물으면 사장이 빈도 상한(근무일에만·하루 1회·주 2회)을
 *   깨게 된다 — 도착 시각은 근무표가 정한다(0139 due_quiz_sends).
 * ★ 재확인 간격(3일→2주→8주→6개월)도 설명하지 않는다. 설명하면 설정처럼 보인다.
 *
 * 퀴즈(코스) 행은 **1단계를 넘길 때 만들어진다** — 중간에 나가도 초안으로 남는다(A2 '초안' 알약).
 */
export default function QuizNewScreen() {
  const router = useRouter();
  const unitId = useSessionStore((s) => s.unitId);
  const userId = useSessionStore((s) => s.userId);
  const entries = usePlaybookStore((s) => s.entries);
  const staff = useStaffStore((s) => s.staff);
  const hydrateStaff = useStaffStore((s) => s.hydrate);
  const addCourseEntry = useWorkStore((s) => s.addCourseEntry);

  useEffect(() => {
    void hydrateStaff();
  }, [hydrateStaff]);

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [quota, setQuota] = useState(false);

  // 1단계
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  // 2·3단계
  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseKey, setCourseKey] = useState<string | null>(null);
  const [made, setMade] = useState<Made[]>([]);
  const [editing, setEditing] = useState<{ item: QuizItem; entry: PlaybookEntry } | null>(null);
  const [manualFor, setManualFor] = useState<PlaybookEntry | null>(null);
  const [preview, setPreview] = useState<QuizItem | null>(null);

  // 4단계
  const [name, setName] = useState('');
  const [to, setTo] = useState<string[]>([]);

  // 5단계
  const [sendNow, setSendNow] = useState(true);
  const [startAt, setStartAt] = useState<string>(() => addDays(todayKst(), 1));
  const [deadline, setDeadline] = useState<number | null>(3);
  const [autoCycle, setAutoCycle] = useState(true);
  const [cycleDays, setCycleDays] = useState(90);

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  /** 낼 수 있는 재료 = 발행된 노하우. 초안(draft)은 문항 근거가 못 된다. */
  const pool = useMemo(
    () => entries.filter((e) => e.status !== 'draft'),
    [entries],
  );
  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return pool;
    return pool.filter((e) => e.title.toLowerCase().includes(k));
  }, [pool, q]);

  const toggle = (id: string) => setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  // ── 1 → 2 : 퀴즈 만들고 문항 생성 ────────────────────────────────────────
  const start = async () => {
    if (busy || picked.length === 0) return;
    setBusy(true);
    setErr(null);
    setQuota(false);

    const id = genId('tc');
    const key = `q_${id}`;
    const first = entryById.get(picked[0]);
    const draftName = first ? `${first.title} 확인` : '새 퀴즈';
    const ok = await guardWrite(
      upsertTrainingCourse({
        id,
        unit_id: unitId,
        key,
        name: draftName,
        description: null,
        preset: null,
        min_items: 1,
        max_items: 10,
        due_days: null,
        start_at: null,
        answer_days: null,
        position: 0,
        active: true,
      }),
      () => {},
      '퀴즈를 만들지 못했어요.',
    );
    if (!ok) {
      setBusy(false);
      return;
    }
    setCourseId(id);
    setCourseKey(key);
    setName(draftName);
    // 받는 사람 기본값 = 합류한 직원 전원. 고르는 수고를 기본으로 없앤다.
    setTo(staff.map((s) => s.id));

    const rows: Made[] = picked.map((eid) => ({
      entryId: eid,
      title: entryById.get(eid)?.title ?? '노하우',
      item: null,
      formatLabel: '',
      state: 'wait',
    }));
    setMade(rows);
    setStep(2);
    setBusy(false);
    void runGenerate(id, rows);
  };

  /**
   * 노하우 하나당 문항 하나. 형태는 코드가 정한다(`generateQuizItems` 의 자동 선택).
   * 만든 즉시 저장한다 — 중간에 앱이 죽어도 만든 것이 남고, 3단계는 저장된 것을 검토하는 자리다.
   */
  const runGenerate = useCallback(
    async (cid: string, rows: Made[]) => {
      const out: Made[] = [...rows];
      for (let i = 0; i < out.length; i++) {
        const entry = entryById.get(out[i].entryId);
        if (!entry) {
          out[i] = { ...out[i], state: 'thin' };
          setMade([...out]);
          continue;
        }
        await addCourseEntry(cid, entry.id);
        let items: QuizItem[] = [];
        try {
          items = await generateQuizItems([entry], undefined, { unitId, createdBy: userId, max: 1 });
        } catch (e) {
          // "낼 게 부족해서 안 낸 것"(빈 배열)과 한도·장애를 섞지 않는다.
          if (e instanceof QuizQuotaError) setQuota(true);
          else setErr('문제를 만들지 못했어요. 연결이 끊겼어요.');
          out[i] = { ...out[i], state: 'thin' };
          setMade([...out]);
          // 한도·장애는 다음 노하우에서도 같은 결과다 — 남은 것을 계속 두드리지 않는다.
          for (let j = i + 1; j < out.length; j++) out[j] = { ...out[j], state: 'thin' };
          setMade([...out]);
          setStep(3);
          return;
        }
        const d = items[0];
        if (!d) {
          out[i] = { ...out[i], state: 'thin' };
          setMade([...out]);
          continue;
        }
        const item: QuizItem = {
          ...d,
          id: d.id || genId('qz'),
          unit_id: d.unit_id || unitId,
          entry_ids: d.entry_ids?.length ? d.entry_ids : [entry.id],
          source: 'ai',
          status: 'active',
          created_by: d.created_by ?? userId,
        };
        const saved = await guardWrite(insertQuizItem(item), () => {}, '문제 저장에 실패했어요.');
        out[i] = saved
          ? { ...out[i], item, formatLabel: FORMATS[item.format]?.label ?? '', state: 'ok' }
          : { ...out[i], state: 'thin' };
        setMade([...out]);
      }
      setStep(3);
    },
    [entryById, unitId, userId, addCourseEntry],
  );

  const okItems = made.filter((m) => m.state === 'ok' && m.item);
  const thin = made.filter((m) => m.state === 'thin');

  const dropItem = async (m: Made) => {
    if (!m.item) return;
    await guardWrite(deleteQuizItem(m.item.id), () => {}, '문항을 빼지 못했어요.');
    setMade((v) => v.map((x) => (x.entryId === m.entryId ? { ...x, item: null, state: 'thin' } : x)));
  };

  // ── 5 → 발행 ─────────────────────────────────────────────────────────────
  const publish = async () => {
    if (!courseId || !courseKey || busy) return;
    setBusy(true);
    const scheduledOn = sendNow ? todayKst() : startAt;
    const ok = await guardWrite(
      upsertTrainingCourse({
        id: courseId,
        unit_id: unitId,
        key: courseKey,
        name: name.trim() || '새 퀴즈',
        description: null,
        preset: null,
        min_items: 1,
        max_items: 10,
        // "맡길래요" = 간격 확대(3일→2주→8주→6개월)를 시스템이 쓴다 → 고정 주기를 두지 않는다.
        due_days: autoCycle ? null : cycleDays,
        start_at: scheduledOn,
        answer_days: deadline,
        position: 0,
        active: true,
      }),
      () => {},
      '일정을 저장하지 못했어요.',
    );
    if (!ok) {
      setBusy(false);
      return;
    }
    const sent = await guardWrite(
      insertQuizAssignments(courseId, to, scheduledOn),
      () => {},
      '보내기에 실패했어요.',
    );
    setBusy(false);
    if (!sent) return;
    showToast(sendNow ? `${to.length}명에게 보내요` : `${dayLabel(scheduledOn)}에 보내요`, 'good');
    router.replace(`/owner/quiz/${courseId}` as never);
  };

  const saveDraftAndLeave = () => {
    showToast('초안으로 저장했어요', 'good');
    router.replace('/owner/training' as never);
  };

  return (
    <SafeAreaView style={st.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '퀴즈 만들기', headerRight: () => <Text style={st.stepBadge}>{step}/{TOTAL}</Text> }} />
      <ScrollView
        contentContainerStyle={st.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <StepProgress step={step} total={TOTAL} title={STEP_TITLES[step - 1]} />

        {/* ── 1/5 노하우 고르기 — 이 화면이 "내용 입력"을 대체한다. 타이핑이 0이다 ── */}
        {step === 1 && (
          pool.length === 0 ? (
            <EmptyState
              title="먼저 노하우가 필요해요"
              body="퀴즈 문제는 사장님이 적어 둔 노하우에서 나와요."
              cta={{ label: '노하우 추가하기', onPress: () => router.replace('/owner/coach' as never) }}
            />
          ) : (
            <>
              <Text style={st.lead}>고른 노하우에서 문제를 만들어요</Text>
              <View style={st.search}>
                <Ionicons name="search" size={16} color={InkColors.ink3} />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder="노하우 찾기"
                  placeholderTextColor={InkColors.ink3}
                  style={st.searchInput}
                />
              </View>
              <View style={st.listCard}>
                {filtered.map((e, i) => (
                  <Pressable
                    key={e.id}
                    onPress={() => toggle(e.id)}
                    style={({ pressed }) => [st.chk, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: picked.includes(e.id) }}
                    accessibilityLabel={e.title}
                  >
                    <View style={[st.box, picked.includes(e.id) && st.boxOn]}>
                      {picked.includes(e.id) ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
                    </View>
                    <View style={st.rowText}>
                      <Text style={st.rowTitle} numberOfLines={1}>{e.title}</Text>
                      <Text style={st.rowSub} numberOfLines={1}>{hintOf(e)}</Text>
                    </View>
                  </Pressable>
                ))}
                {filtered.length === 0 ? <Text style={st.emptyLine}>찾는 노하우가 없어요</Text> : null}
              </View>
            </>
          )
        )}

        {/* ── 2/5 만드는 중 — 형태 이름을 여기서 처음 보여줘 다음 화면의 낯선 단어를 미리 익히게 한다 ── */}
        {step === 2 && (
          <>
            <Text style={st.lead}>20~30초 걸려요. 이 화면을 켜 두세요</Text>
            <View style={st.listCard}>
              {made.map((m, i) => (
                <View key={m.entryId} style={[st.row, i > 0 && st.rowDivider]}>
                  <View style={st.rowText}>
                    <Text style={st.rowTitle} numberOfLines={1}>{m.title}</Text>
                    <Text style={st.rowSub} numberOfLines={1}>
                      {m.state === 'ok' ? m.formatLabel : m.state === 'thin' ? '못 만들었어요' : '만드는 중'}
                    </Text>
                  </View>
                  <Text style={[st.tick, m.state === 'ok' && st.tickOk]}>
                    {m.state === 'ok' ? '됨' : m.state === 'thin' ? '—' : '…'}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── 3/5 문항 검토 — AI가 만든 것을 사장이 승인하는 지점. 생략할 수 없다 ── */}
        {step === 3 && (
          <>
            {quota ? (
              /* D2 — 한도. "실패"가 아니라 한도라고 정확히 말하고 우회로를 남긴다. */
              <View style={st.warnBox}>
                <Text style={st.warnTitle}>이번 달 AI 사용량을 다 썼어요</Text>
                <Text style={st.warnBody}>고르신 노하우는 저장해 뒀어요. 지금 필요하면 문항을 직접 쓸 수도 있어요.</Text>
              </View>
            ) : err ? (
              /* D3 — 장애. D1(재료 부족)과 다음 행동이 달라야 사장이 노하우를 괜히 고치지 않는다. */
              <View style={st.warnBox}>
                <Text style={st.warnTitle}>문제를 만들지 못했어요</Text>
                <Text style={st.warnBody}>{err} 고르신 노하우는 그대로 있어요.</Text>
              </View>
            ) : null}

            <Text style={st.lead}>
              {okItems.length > 0 ? `문항 ${okItems.length}개가 만들어졌어요` : '아직 만들어진 문항이 없어요'}
            </Text>
            <Text style={st.leadSub}>그대로 보내도 되고, 고쳐도 돼요</Text>

            {okItems.map((m) => (
              <View key={m.entryId} style={st.qcard}>
                <Text style={st.qFormat}>{m.formatLabel}</Text>
                <Text style={st.qAsk}>{String(m.item?.payload?.ask ?? '')}</Text>
                <Text style={st.qSource} numberOfLines={1}>근거 · {m.title}</Text>
                <View style={st.qActs}>
                  <SmallAction label="미리보기" onPress={() => setPreview(m.item)} />
                  <SmallAction
                    label="고치기"
                    onPress={() => {
                      const e = entryById.get(m.entryId);
                      if (e && m.item) setEditing({ item: m.item, entry: e });
                    }}
                  />
                  <SmallAction label="빼기" onPress={() => void dropItem(m)} />
                </View>
              </View>
            ))}

            {/* D1 — 낼 게 부족함. "실패"가 아니라 재료 부족이라 말하고 **어느 노하우**인지 지목한다. */}
            {thin.length > 0 && (
              <View style={st.thinBox}>
                <Text style={st.thinTitle}>이 노하우로는 문제를 못 만들었어요</Text>
                <Text style={st.thinBody}>할 일이나 금지가 적혀 있어야 문제가 나와요. 상황만 한 줄 있으면 낼 게 없어요.</Text>
                {thin.map((m) => (
                  <View key={m.entryId} style={st.thinRow}>
                    <Text style={st.thinName} numberOfLines={1}>{m.title}</Text>
                    <SmallAction
                      label="직접 쓰기"
                      onPress={() => {
                        const e = entryById.get(m.entryId);
                        if (e) setManualFor(e);
                      }}
                    />
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── 4/5 이름과 받는 사람 ── */}
        {step === 4 && (
          <>
            <Text style={st.label}>퀴즈 이름</Text>
            <TextInput value={name} onChangeText={setName} style={st.input} placeholder="마감 청소 확인" placeholderTextColor={InkColors.ink3} />
            <Text style={st.hint}>고른 노하우로 지어 봤어요. 직원에게 이 이름이 보여요</Text>

            <Text style={st.label}>누구에게</Text>
            {staff.length === 0 ? (
              /* D5 — 보낼 직원이 없다. 0/0 을 통과로 읽히게 두지 않고 초대 경로를 준다. */
              <EmptyState
                title="아직 합류한 직원이 없어요"
                body="퀴즈는 저장해 둘게요. 직원이 들어오면 그때 보낼 수 있어요."
                cta={{ label: '직원 초대하기', onPress: () => router.push('/owner/staff' as never) }}
              />
            ) : (
              <View style={st.listCard}>
                {staff.map((s, i) => (
                  <Pressable
                    key={s.id}
                    onPress={() => setTo((v) => (v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id]))}
                    style={({ pressed }) => [st.chk, i > 0 && st.rowDivider, pressed && { opacity: 0.6 }]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: to.includes(s.id) }}
                    accessibilityLabel={s.name}
                  >
                    <View style={[st.box, to.includes(s.id) && st.boxOn]}>
                      {to.includes(s.id) ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
                    </View>
                    <View style={st.rowText}>
                      <Text style={st.rowTitle} numberOfLines={1}>{s.name}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        {/* ── 5/5 일정 ── */}
        {step === 5 && (
          <>
            <Text style={st.label}>언제 보낼까요</Text>
            <Radio label="지금 바로" on={sendNow} onPress={() => setSendNow(true)} />
            <Radio label="예약해서 보내기" on={!sendNow} onPress={() => setSendNow(false)} />
            {!sendNow && (
              <View style={st.chips}>
                {[1, 2, 3, 7].map((d) => {
                  const day = addDays(todayKst(), d);
                  return <Chip key={d} label={dayLabel(day)} on={startAt === day} onPress={() => setStartAt(day)} />;
                })}
              </View>
            )}

            <Text style={st.label}>언제까지 풀까요</Text>
            <View style={st.chips}>
              {DEADLINES.map((d) => (
                <Chip key={d.label} label={d.label} on={deadline === d.days} onPress={() => setDeadline(d.days)} />
              ))}
            </View>

            <Text style={st.label}>다시 확인</Text>
            <Radio label="맡길래요" badge="권함" on={autoCycle} onPress={() => setAutoCycle(true)} />
            <Radio label="직접 정할래요" on={!autoCycle} onPress={() => setAutoCycle(false)} />
            {!autoCycle && (
              <View style={st.chips}>
                {CYCLES.map((c) => (
                  <Chip key={c.days} label={c.label} on={cycleDays === c.days} onPress={() => setCycleDays(c.days)} />
                ))}
              </View>
            )}

            <View style={st.summary}>
              <Text style={st.summaryLabel}>이렇게 돌아가요</Text>
              <Text style={st.summaryBody}>
                {sendNow ? '오늘' : dayLabel(startAt)}부터 {to.length}명에게 보내요.{'\n'}
                {deadline ? `받은 날부터 ${deadline}일 안에 풀어야 해요.` : '마감은 없어요.'}{'\n'}
                {autoCycle ? '다시 확인은 저희가 알아서 챙길게요.' : `${CYCLES.find((c) => c.days === cycleDays)?.label ?? ''} 다시 확인해요.`}
              </Text>
            </View>

            {/* 사장이 못 정하는 것을 미리 말해 준다 — 안 적으면 "왜 오늘 안 왔지"가 문의가 된다. */}
            <Text style={st.capNote}>근무일에만 · 하루 1번 · 주 2번까지만 보내요</Text>
          </>
        )}
      </ScrollView>

      {/* ── 바닥 액션 — 화면당 Primary 1개 ── */}
      <View style={st.foot}>
        {step === 1 && (
          <Primary
            label={picked.length > 0 ? `${picked.length}개로 문제 만들기` : '노하우를 골라 주세요'}
            disabled={busy || picked.length === 0}
            onPress={() => void start()}
          />
        )}
        {step === 3 && (
          <>
            {okItems.length === 0 ? (
              <Ghost label="나중에 하기 · 초안으로 저장" onPress={saveDraftAndLeave} />
            ) : null}
            <Primary label="다음" disabled={okItems.length === 0} onPress={() => setStep(4)} />
          </>
        )}
        {step === 4 && (
          <Primary
            label="다음"
            disabled={!name.trim() || to.length === 0}
            onPress={() => setStep(5)}
          />
        )}
        {step === 5 && (
          <Primary
            label={busy ? '보내는 중…' : sendNow ? `${to.length}명에게 보내기` : `${to.length}명에게 예약하기`}
            disabled={busy}
            onPress={() => void publish()}
          />
        )}
      </View>

      {/* D6 · D9 — 문항 고치기 / 직접 쓰기. 형태 11종마다 입력이 달라 **재구현 금지** 대상이다. */}
      {editing && courseId && (
        <QuizEditorSheet
          subject={{ entryId: editing.entry.id, title: editing.entry.title }}
          courseId={courseId}
          entries={entries}
          defaultSection={editing.entry.section ?? null}
          editing={editing.item}
          startMode="manual"
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      {manualFor && courseId && (
        <QuizEditorSheet
          subject={{ entryId: manualFor.id, title: manualFor.title }}
          courseId={courseId}
          entries={entries}
          defaultSection={manualFor.section ?? null}
          startMode="manual"
          onClose={() => setManualFor(null)}
          onSaved={() => {
            setManualFor(null);
            showToast('문항을 넣었어요', 'good');
          }}
        />
      )}
      {preview && <QuizPreviewSheet quiz={preview} onClose={() => setPreview(null)} />}
    </SafeAreaView>
  );
}

/** 노하우 한 줄의 부제 — 판정은 `detectKinds` 가 한다(사장이 고르는 것이 아니다). */
function hintOf(e: PlaybookEntry): string {
  const kinds = detectKinds(e);
  return KIND_HINT[kinds[0] ?? 't0'] ?? '내용 있음';
}

/** KST 오늘 "YYYY-MM-DD". 서버(due_quiz_sends)도 KST 고정이라 같은 축으로 만든다. */
function todayKst(): string {
  const k = new Date(Date.now() + 9 * 3600_000);
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function pad(n: number) {
  return String(n).padStart(2, '0');
}
function dayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : ymd;
}

function SmallAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.smallAct, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={st.smallActText}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.chip, on && st.chipOn, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[st.chipText, on && st.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Radio({ label, on, badge, onPress }: { label: string; on: boolean; badge?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.radio, pressed && { opacity: 0.6 }]}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <View style={[st.dot, on && st.dotOn]} />
      <Text style={[st.radioText, on && st.radioTextOn]}>{label}</Text>
      {badge ? <Text style={st.radioBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function Primary({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.primary, disabled && st.primaryOff, pressed && !disabled && { opacity: 0.85 }]}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label}
    >
      <Text style={[st.primaryText, disabled && st.primaryTextOff]}>{label}</Text>
    </Pressable>
  );
}

function Ghost({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [st.ghost, pressed && { opacity: 0.7 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={st.ghostText}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: InkColors.paper },
  scroll: { padding: Space.gutter, paddingBottom: Space.xl, gap: Space.md },
  stepBadge: { fontSize: 13, fontWeight: '800', color: InkColors.ink3, marginRight: Space.gutter },

  lead: { fontSize: 17, fontWeight: '900', color: InkColors.ink, lineHeight: 24 },
  leadSub: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 21, marginTop: -Space.sm },
  label: { fontSize: 13, fontWeight: '800', color: InkColors.ink2, marginTop: Space.xs },
  hint: { fontSize: 13, fontWeight: '600', color: InkColors.ink3, lineHeight: 18, marginTop: -Space.xs },
  emptyLine: { fontSize: 15, color: InkColors.ink3, fontWeight: '600', paddingVertical: Space.lg, textAlign: 'center' },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    backgroundColor: InkColors.bgSoft, borderRadius: Radius.sm, paddingHorizontal: Space.md, minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '600', color: InkColors.ink },
  input: {
    borderWidth: 1, borderColor: InkColors.line, borderRadius: Radius.sm,
    paddingHorizontal: Space.md, minHeight: 48, fontSize: 15, fontWeight: '700', color: InkColors.ink,
    backgroundColor: '#FFFFFF',
  },

  listCard: {
    backgroundColor: InkColors.bg, borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    paddingHorizontal: Space.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  chk: { flexDirection: 'row', alignItems: 'center', gap: Space.md, minHeight: 56, paddingVertical: Space.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: InkColors.line },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800', color: InkColors.ink },
  rowSub: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: InkColors.ink3 },
  tick: { fontSize: 13, fontWeight: '800', color: InkColors.ink3 },
  tickOk: { color: BrandColors.goodText },

  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: InkColors.line,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },

  qcard: {
    backgroundColor: '#FFFFFF', borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line,
    padding: Space.lg, gap: Space.xs,
  },
  qFormat: { fontSize: 12, fontWeight: '800', color: BrandColors.mentionText },
  qAsk: { fontSize: 15, fontWeight: '700', color: InkColors.ink, lineHeight: 22 },
  qSource: { fontSize: 13, fontWeight: '600', color: InkColors.ink3 },
  qActs: { flexDirection: 'row', gap: Space.xs, marginTop: Space.xs },
  smallAct: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  smallActText: { fontSize: 13, fontWeight: '800', color: InkColors.ink2 },

  warnBox: {
    backgroundColor: BrandColors.warnSoft, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.warnBorder,
    padding: Space.lg, gap: Space.xs,
  },
  warnTitle: { fontSize: 15, fontWeight: '800', color: BrandColors.warnText, lineHeight: 22 },
  warnBody: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 22 },

  thinBox: {
    backgroundColor: InkColors.bgSoft, borderRadius: Radius.md, padding: Space.lg, gap: Space.sm,
  },
  thinTitle: { fontSize: 15, fontWeight: '800', color: InkColors.ink, lineHeight: 22 },
  thinBody: { fontSize: 15, fontWeight: '600', color: InkColors.ink2, lineHeight: 22 },
  thinRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  thinName: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '700', color: InkColors.ink },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  chip: {
    minHeight: 48, justifyContent: 'center', paddingHorizontal: Space.md,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  chipOn: { backgroundColor: InkColors.ink, borderColor: InkColors.ink },
  chipText: { fontSize: 13, fontWeight: '700', color: InkColors.ink2 },
  chipTextOn: { color: '#FFFFFF', fontWeight: '800' },

  radio: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 48 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: InkColors.line },
  dotOn: { borderWidth: 5.5, borderColor: InkColors.ink },
  radioText: { fontSize: 15, fontWeight: '700', color: InkColors.ink2 },
  radioTextOn: { color: InkColors.ink, fontWeight: '800' },
  radioBadge: {
    fontSize: 12, fontWeight: '800', color: InkColors.ink,
    backgroundColor: BrandColors.yellowSoft, borderRadius: Radius.pill, paddingHorizontal: Space.sm, paddingVertical: 3,
  },

  summary: {
    backgroundColor: BrandColors.yellowSoft, borderRadius: Radius.md, borderWidth: 1, borderColor: BrandColors.gold,
    padding: Space.lg, gap: Space.xs,
  },
  summaryLabel: { fontSize: 13, fontWeight: '800', color: BrandColors.warnText },
  summaryBody: { fontSize: 15, fontWeight: '600', color: InkColors.ink, lineHeight: 23 },
  capNote: { fontSize: 13, fontWeight: '600', color: BrandColors.mentionText, textAlign: 'center' },

  foot: {
    flexDirection: 'row', gap: Space.sm,
    paddingHorizontal: Space.gutter, paddingVertical: Space.md,
    borderTopWidth: 1, borderTopColor: InkColors.line, backgroundColor: InkColors.bg,
  },
  primary: {
    flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, backgroundColor: InkColors.ink,
  },
  primaryOff: { backgroundColor: InkColors.bgSoft },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  primaryTextOff: { color: InkColors.ink3 },
  ghost: {
    flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: InkColors.line, backgroundColor: '#FFFFFF',
  },
  ghostText: { fontSize: 15, fontWeight: '800', color: InkColors.ink2 },
});
