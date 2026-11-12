// qa-quiz-fuzz.mjs — 퀴즈 발송·응시 서버 상태기계 퍼징 (2026-11-03 · P2 · 로컬 도커 전용 · 자가정리 · AI 호출 0회)
//
// 무엇을 하나: 사장 1 · 직원 A·B · 퀴즈 2개(문항 2·3개) 매장에서 행동을 시드 고정 무작위 순서로 N번 돌리고,
//   행동마다 불변식 I1~I6 을 잰다. 위반이 나오면 그 순서를 행동 하나씩 빼며 새 매장에서 다시 돌려 가장 짧은 재현 순서로 줄인다.
//   결과 = 산출물/오류탐지_2026-11-03/P2_fuzz_<seed>.json
//
// 행동(정본 경로를 그대로 탄다)
//   owner_send   사장 세션 upsert = db.ts insertQuizAssignments(onConflict course_id,user_id,scheduled_on · ignoreDuplicates)
//   owner_remind src/app/owner/quiz/[id].tsx remind() = 대상(지금 직원 · 한 번도 다 풀지 않음 · 최신 발송 미완료)을 골라
//                사장 세션 quiz_resend 를 부른다(0348 뒤 · 2026-11-12 에 맞춤). 판정 함수(latestQuizAssignments·personState·isCurrentStaff·doneBefore)는
//                src 에서 AST 로 뽑아 vm 으로 돌린다(복제 금지). 화면 안의 분기 몇 줄은 원문 표식을 정규식으로 확인한 뒤 옮겨 적었다.
//   tick         service_role due_quiz_sends() → 행마다 claim_quiz_send (supabase/functions/push/index.ts sweepQuizSends 순서 · deliver 는 안 부른다)
//                ★이 매장 행만 선점한다. due_quiz_sends 는 전역이라 다른 로컬 매장 행도 돌려주지만 손대지 않는다(enqueue_knowhow_rechecks 는 전역으로 돈다).
//   advance_day  서버 시계를 못 바꾸므로 이 매장 행의 시각을 하루 당긴다(psql · 로컬 전용). 근사의 한계는 보고서 참고.
//   staff_open / staff_answer / staff_complete — 직원 세션 mark_quiz_opened · quiz_staff_record_v2(db.ts recordStaffQuizAttempt) · mark_quiz_completed
//   owner_archive / owner_restore — training_courses.active
//   remove_staff(B) / rejoin(B) — 사장 remove_staff RPC · 직원 join_by_invite(scripts/lib/qa-staff.mjs)
//
// 불변식
//   I1 완료자 재발송 금지: 선점된 행 r 에 대해 r.created_at 이후 같은 (퀴즈,사람)의 다른 발송에 completed_at 이 있으면 위반(recheck 제외).
//   I2 내보낸 직원에게 발송 0.
//   I3 판정 일치: 서버 quiz_assignment_progress(직원) ↔ 직원 행 + currentSend/assignmentState ↔ 사장 행 + latestQuizAssignments.
//   I4(결정대기) 진행 수 단조: 직원 행동이 없는 행동 전후로 현재 발송 answered_items 가 줄면 위반. 회차가 바뀐 것/같은 회차를 나눠 센다.
//   I5 멱등: tick 두 번째 선점 0 · 같은 id 재선점 false · mark_quiz_completed true 최대 1번 · owner_send 두 번 행 수 같음.
//   I6(의심확인) 마감 지난 발송 금지: 선점한 행의 due_date < 오늘(KST).
//
// 사용: node scripts/qa-quiz-fuzz.mjs --local [--seed=1] [--steps=200] [--no-shrink] [--shrink-budget=60]
// 최종 줄: PASS n · FAIL n · skip n · 실행 못 한 단언 n · AI 호출 0회 · 정리 남은 행 n
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { localEnv, makeLocal, makeWorld, cleanupWorld, kstDay, ok } from './lib/qa-fz-local.mjs';
import { joinAsStaff } from './lib/qa-staff.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const SEED = Number(arg('seed', '1'));
const STEPS = Number(arg('steps', '200'));
const SHRINK = !process.argv.includes('--no-shrink');
const SHRINK_BUDGET = Number(arg('shrink-budget', '80'));
const here = (r) => fileURLToPath(new URL(r, import.meta.url));

// ── 판정 순수 함수: 실제 src 에서 불러온다(qa-quiz-owner-state 방식) ─────────────────────────
function declarations(path, names) {
  const sf = ts.createSourceFile(path, fs.readFileSync(here(`../${path}`), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return names.map((name) => {
    const node = sf.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
    if (!node) throw new Error(`${path}: ${name} 이 없다 — 하니스 갱신 필요`);
    return node.getText(sf).replace(/^export\s+/, '');
  }).join('\n');
}
function loadPure() {
  const src = `const pad2 = (n: number) => String(n).padStart(2, '0');\n`
    + declarations('src/lib/quiz/progress.ts', ['assignmentState', 'currentSend']) + '\n'
    + declarations('src/lib/quiz/courseStats.ts', ['latestQuizAssignments']) + '\n'
    + declarations('src/lib/quiz/schedule.ts', ['todayKst', 'addDaysKst'])
    + '\nglobalThis.api = { assignmentState, currentSend, latestQuizAssignments, todayKst, addDaysKst };';
  const ctx = vm.createContext({ Date, String, Map, Set });
  vm.runInContext(ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, ctx);
  const mOut = ts.transpileModule(fs.readFileSync(here('../src/lib/quiz/metrics.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mCtx = vm.createContext({ exports: {} });
  vm.runInContext(mOut, mCtx);
  // remind() 는 화면 컴포넌트 안의 화살표 함수라 뽑을 수 없다. 옮겨 적은 분기의 원문 표식이 그대로인지 먼저 본다.
  const screen = fs.readFileSync(here('../src/app/owner/quiz/[id].tsx'), 'utf8');
  // 0348(11-04) 뒤 remind() 는 행을 직접 넣지 않고 quiz_resend 하나를 부른다. 옛 표식(오늘 행이면 내일 · 고정 마감)은 서버로 갔다.
  const marks = [
    /const latestSends = useMemo\(\(\) => latestQuizAssignments\(sends\)/,
    /state: personState\(a, quizAnswers\)/,
    /const notDone = people\.filter\(\(p\) => isCurrentStaff\(p\.id, memberIds\) && !doneBefore\(sends, p\.id\) && \(p\.state === 'in_progress' \|\| p\.state === 'not_started'\)\);/,
    /const res = await resendQuiz\(id, notDone\.map\(\(p\) => p\.id\)\);/,
  ];
  const drift = marks.filter((re) => !re.test(screen));
  if (drift.length) throw new Error(`[id].tsx remind 규칙 원문이 바뀌었다(${drift.length}곳) — 하니스를 다시 맞춰야 한다: ${drift.map(String).join(' | ')}`);
  return { ...ctx.api, personState: mCtx.exports.personState, isCurrentStaff: mCtx.exports.isCurrentStaff, doneBefore: mCtx.exports.doneBefore };
}
const P = loadPure();

// ── PRNG (mulberry32) ───────────────────────────────────────────────────────────────────
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const env = localEnv();
const L = makeLocal(env);
const { admin, psql } = L;
const MIG = psql('select max(version) from supabase_migrations.schema_migrations');
const HAS_COUNT_FROM = psql(`select count(*) from information_schema.columns where table_schema='public' and table_name='quiz_assignments' and column_name='count_from'`) === '1';
console.log(`— 대상 로컬 ${env.URL_} · schema_migrations 최고 ${MIG} · count_from 열 ${HAS_COUNT_FROM ? '있음(0348 로컬 적용)' : '없음'} · seed ${SEED} · steps ${STEPS} —`);
if (Number(MIG) >= 348) console.log(`  · 0348(11-04 main 머지) 이후 DB 다. 결함 ②(완료자 재발송)는 0348 이 고쳤으므로 고정 시나리오 통과가 정상이다. 수정 전 RED 를 보려면 0348 이전 DB 가 필요하다.`);

const COLS = 'id, course_id, user_id, scheduled_on, sent_at, due_on, due_date, opened_at, completed_at, origin';
const toA = (r) => ({ id: r.id, courseId: r.course_id, userId: r.user_id, scheduledOn: r.scheduled_on, sentAt: r.sent_at ?? null, dueOn: r.due_on ?? null, dueDate: r.due_date ?? null, openedAt: r.opened_at ?? null, completedAt: r.completed_at ?? null, origin: r.origin ?? 'manual' });
const COURSES = [{ items: 2, answerDays: 3 }, { items: 3, answerDays: null }];
const INVS = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'R1'];
// R1(관찰) = 사장 다시 알리기가 실패한다(화면이 '다시 알리지 못했어요'를 띄우는 자리). 불변식 목록 밖이라 PASS/FAIL 에 안 넣고 따로 센다.
const NON_STAFF = new Set(['tick', 'advance_day', 'owner_send', 'owner_remind', 'owner_archive', 'owner_restore']);
const allCleanups = [];

// ── 실행기 ───────────────────────────────────────────────────────────────────────────────
class Runner {
  constructor(w, opts = {}) {
    this.w = w; this.only = opts.only ?? null; this.stopOnFirst = !!opts.stopOnFirst; this.hit = opts.hit ?? ((v) => v.inv === this.only);
    this.members = { A: true, B: true };
    this.staff = { A: w.staff[0], B: w.staff[1] };
    this.archived = new Set();
    this.completedTrue = new Map();
    this.violations = []; this.obs = []; this.log = [];
    this.snap = null; // I4: { 'A:c' : { id, answered } }
    this.view = null;
    this.step = -1;
  }
  want(inv) { return !this.only || this.only === inv; }
  viol(inv, detail) { this.violations.push({ inv, step: this.step, detail }); }
  done() { return this.stopOnFirst && this.violations.some(this.hit); }
  course(i) { return this.w.courses[i].id; }

  async ownerRows(courseId) {
    return (await ok(this.w.owner.c.from('quiz_assignments').select(COLS).eq('course_id', courseId).order('scheduled_on', { ascending: false }).order('id'), 'owner rows')).map(toA);
  }
  async staffView(key, courseId) {
    const st = this.staff[key];
    const rows = (await ok(st.c.from('quiz_assignments').select(COLS).eq('course_id', courseId).order('scheduled_on', { ascending: false }).order('id'), 'staff rows')).map(toA);
    const prog = await ok(st.c.rpc('quiz_assignment_progress', { p_course_id: courseId }), 'progress');
    const cur = P.currentSend(rows.filter((r) => !!r.sentAt));
    const pr = cur ? prog.find((p) => p.assignment_id === cur.id) : undefined;
    return { rows, prog, cur, pr };
  }
  async unitCount() { const { count, error } = await admin.from('quiz_assignments').select('id', { count: 'exact', head: true }).eq('unit_id', this.w.unit); if (error) throw new Error(error.message); return count; }

  // 사장 세션 = insertQuizAssignments 와 같은 upsert. 반환 = ok(앱이 '보냈어요'로 보는가)
  async insertLikeApp(courseId, userIds, on, due) {
    const { data, error } = await this.w.owner.c.from('quiz_assignments')
      .upsert(userIds.map((uid) => ({ unit_id: this.w.unit, course_id: courseId, user_id: uid, scheduled_on: on, due_date: due })), { onConflict: 'course_id,user_id,scheduled_on', ignoreDuplicates: true })
      .select('id');
    if (error) return { ok: false, error: error.message };
    if ((data?.length ?? 0) > 0) return { ok: true, n: data.length };
    const { count } = await this.w.owner.c.from('quiz_assignments').select('id', { count: 'exact', head: true }).eq('course_id', courseId).eq('scheduled_on', on).in('user_id', userIds);
    return count === new Set(userIds).size ? { ok: true, n: 0 } : { ok: false, error: '0 rows affected' };
  }

  async claimChecks(id) {
    const r = await ok(admin.from('quiz_assignments').select('id, course_id, user_id, origin, created_at, due_date, due_on, sent_at').eq('id', id).single(), 'claimed row');
    const today = kstDay();
    if (this.want('I1') && r.origin !== 'recheck') {
      const prev = await ok(admin.from('quiz_assignments').select('id, completed_at, origin').eq('unit_id', this.w.unit).eq('course_id', r.course_id).eq('user_id', r.user_id).neq('id', r.id).not('completed_at', 'is', null).gte('completed_at', r.created_at), 'I1');
      if (prev.length) this.viol('I1', { claimed: r.id, origin: r.origin, created_at: r.created_at, completed_by: prev.map((p) => ({ id: p.id, completed_at: p.completed_at })) });
    }
    if (this.want('I2')) {
      const m = await ok(admin.from('unit_members').select('user_id').eq('unit_id', this.w.unit).eq('user_id', r.user_id), 'I2');
      if (!m.length) this.viol('I2', { claimed: r.id, user: r.user_id });
    }
    if (this.want('I6') && r.due_date && r.due_date < today) this.viol('I6', { claimed: r.id, due_date: r.due_date, due_on: r.due_on, today });
    return r;
  }

  async exec(a) {
    const w = this.w; const out = {};
    switch (a.t) {
      case 'owner_send': {
        const targets = a.to.filter((k) => this.members[k]).map((k) => this.staff[k].id);
        if (!targets.length) { out.skip = 'no member'; break; }
        const due = a.due == null ? null : kstDay(a.due);
        const r1 = await this.insertLikeApp(this.course(a.c), targets, kstDay(), due);
        const n1 = await this.unitCount();
        const r2 = await this.insertLikeApp(this.course(a.c), targets, kstDay(), due);
        const n2 = await this.unitCount();
        out.r1 = r1; out.r2 = r2;
        if (this.want('I5') && n1 !== n2) this.viol('I5', { what: 'owner_send twice changed row count', n1, n2 });
        if (!r1.ok) this.obs.push({ step: this.step, kind: 'send_fail', error: r1.error });
        break;
      }
      case 'owner_remind': {
        // 화면 remind() = notDone 을 골라 서버 quiz_resend 하나를 부른다(0348). 행·날짜·마감은 서버가 정한다.
        const id = this.course(a.c);
        const sends = await this.ownerRows(id);
        const latestSends = P.latestQuizAssignments(sends);
        const allUserIds = [...new Set(sends.map((s) => s.userId))];
        const memberIds = new Set(Object.entries(this.staff).filter(([k]) => this.members[k]).map(([, s]) => s.id));
        const people = allUserIds.map((uid) => ({ id: uid, state: P.personState(latestSends.find((x) => x.userId === uid), []) }));
        const notDone = people.filter((p) => P.isCurrentStaff(p.id, memberIds) && !P.doneBefore(sends, p.id) && (p.state === 'in_progress' || p.state === 'not_started'));
        if (!notDone.length) { out.skip = 'notDone 0'; break; }
        const { data, error } = await this.w.owner.c.rpc('quiz_resend', { p_course_id: id, p_user_ids: notDone.map((p) => p.id) });
        out.resend = error ? { error: error.message } : data;
        if (error) {
          this.obs.push({ step: this.step, kind: 'remind_fail', error: error.message });
          this.viol('R1', { error: error.message, recipients: notDone.length });
        }
        break;
      }
      case 'tick': {
        const due1 = (await ok(admin.rpc('due_quiz_sends'), 'due_quiz_sends')).filter((r) => r.out_unit_id === w.unit);
        const claimed = [];
        for (const r of due1) {
          const c = await ok(admin.rpc('claim_quiz_send', { p_id: r.out_assignment_id }), 'claim');
          if (c === true) { claimed.push(r.out_assignment_id); await this.claimChecks(r.out_assignment_id); }
        }
        out.claimed = claimed.length;
        if (this.want('I5') || this.want('I1') || this.want('I2') || this.want('I6')) {
          const due2 = (await ok(admin.rpc('due_quiz_sends'), 'due_quiz_sends 2')).filter((r) => r.out_unit_id === w.unit);
          let second = 0;
          for (const r of due2) {
            const c = await ok(admin.rpc('claim_quiz_send', { p_id: r.out_assignment_id }), 'claim 2');
            if (c === true) { second++; await this.claimChecks(r.out_assignment_id); }
          }
          let reclaim = 0;
          for (const id of claimed) if ((await ok(admin.rpc('claim_quiz_send', { p_id: id }), 'reclaim')) === true) reclaim++;
          if (this.want('I5') && (second || reclaim)) this.viol('I5', { what: 'tick twice', second, reclaim });
        }
        break;
      }
      case 'advance_day': {
        const U = w.unit.replace(/'/g, "''");
        const cf = HAS_COUNT_FROM ? ', count_from = count_from - interval \'1000 days\'' : '';
        const cf2 = HAS_COUNT_FROM ? ', count_from = count_from + interval \'999 days\'' : '';
        // unique(course_id,user_id,scheduled_on) 를 한 줄씩 검사하므로 -1000 → +999 두 단계로 옮긴다.
        psql(`update public.quiz_assignments set scheduled_on = scheduled_on - 1000, sent_at = sent_at - interval '1000 days', opened_at = opened_at - interval '1000 days', completed_at = completed_at - interval '1000 days', created_at = created_at - interval '1000 days', due_on = due_on - 1000, due_date = due_date - 1000${cf} where unit_id = '${U}';
              update public.quiz_assignments set scheduled_on = scheduled_on + 999, sent_at = sent_at + interval '999 days', opened_at = opened_at + interval '999 days', completed_at = completed_at + interval '999 days', created_at = created_at + interval '999 days', due_on = due_on + 999, due_date = due_date + 999${cf2} where unit_id = '${U}';
              update public.quiz_attempt_items set created_at = created_at - interval '1 day' where unit_id = '${U}';
              update public.quiz_attempts set taken_at = taken_at - interval '1 day' where unit_id = '${U}';
              update public.unit_members set created_at = created_at - interval '1 day' where unit_id = '${U}';`);
        // ★합류 시각도 같이 민다. 0348(11-04) 이어 풀기 트리거는 지금 멤버십이 생긴 뒤 나간 발송만 앞 회차로 본다.
        //   안 밀면 하루 전 발송이 합류보다 먼저인 것처럼 보여 이어 풀기가 안 걸린다(실제 시간에서는 생기지 않는 착시 · I4 거짓 위반).
        break;
      }
      case 'staff_open': case 'staff_complete': {
        if (!this.members[a.s]) { out.skip = 'not member'; break; }
        const v = await this.staffView(a.s, this.course(a.c));
        if (!v.cur) { out.skip = 'no sent'; break; }
        const st = this.staff[a.s];
        if (a.t === 'staff_open') { out.r = await ok(st.c.rpc('mark_quiz_opened', { p_id: v.cur.id }), 'open'); break; }
        const r1 = await ok(st.c.rpc('mark_quiz_completed', { p_id: v.cur.id }), 'complete 1');
        const r2 = await ok(st.c.rpc('mark_quiz_completed', { p_id: v.cur.id }), 'complete 2');
        const n = (this.completedTrue.get(v.cur.id) ?? 0) + [r1, r2].filter((x) => x === true).length;
        this.completedTrue.set(v.cur.id, n);
        out.r = [r1, r2];
        if (this.want('I5') && n > 1) this.viol('I5', { what: 'mark_quiz_completed true twice', id: v.cur.id, n });
        break;
      }
      case 'staff_answer': {
        if (!this.members[a.s]) { out.skip = 'not member'; break; }
        const item = w.courses[a.c].items[a.i % w.courses[a.c].items.length];
        const { data, error } = await this.staff[a.s].c.rpc('quiz_staff_record_v2', {
          p_rows: [{ item_id: item.id, response: a.ok ? item.answer : item.wrong, ord: 0 }], p_course_id: this.course(a.c), p_request_id: randomUUID(),
        });
        out.r = error ? `error:${error.message}` : (data ? 'saved' : 'null');
        break;
      }
      case 'owner_archive': case 'owner_restore': {
        const active = a.t === 'owner_restore';
        await ok(w.owner.c.from('training_courses').update({ active }).eq('id', this.course(a.c)), a.t);
        if (active) this.archived.delete(a.c); else this.archived.add(a.c);
        break;
      }
      case 'remove_staff': {
        if (!this.members[a.s]) { out.skip = 'not member'; break; }
        await ok(w.owner.c.rpc('remove_staff', { p_staff_id: this.staff[a.s].id }), 'remove_staff');
        this.members[a.s] = false;
        break;
      }
      case 'rejoin': {
        if (this.members[a.s]) { out.skip = 'member'; break; }
        await joinAsStaff(this.staff[a.s].c, w.code);
        await ok(this.staff[a.s].c.rpc('switch_active_unit', { p_unit_id: w.unit }), 'switch');
        this.members[a.s] = true;
        break;
      }
      default: throw new Error('unknown action ' + a.t);
    }
    return out;
  }

  // 행동 뒤 관찰 = I3 + I4 스냅샷. 필요할 때만 읽는다(shrink 중 다른 불변식이면 건너뜀).
  async observe(a) {
    if (!this.want('I3') && !this.want('I4') && this.only) { this.view = null; return; }
    const next = {}; const view = {};
    const ownerByCourse = {};
    for (const [ci] of this.w.courses.entries()) ownerByCourse[ci] = (this.want('I3')) ? await this.ownerRows(this.course(ci)) : null;
    for (const key of ['A', 'B']) {
      if (!this.members[key]) continue;
      for (const [ci] of this.w.courses.entries()) {
        const v = await this.staffView(key, this.course(ci));
        view[`${key}:${ci}`] = v;
        if (!v.cur) continue;
        if (this.want('I3')) {
          const st = this.staff[key];
          if (!v.pr) this.viol('I3', { who: key, course: ci, what: 'sent row missing from quiz_assignment_progress', id: v.cur.id });
          else {
            const clientState = P.assignmentState(v.cur, { assignmentId: v.pr.assignment_id, pendingEntryIds: v.pr.pending_entry_ids, totalItems: v.pr.total_items, answeredItems: v.pr.answered_items, state: v.pr.state });
            const ownerLatest = P.latestQuizAssignments(ownerByCourse[ci]).find((x) => x.userId === st.id);
            const bad = [];
            if (clientState !== v.pr.state) bad.push(`client ${clientState} ≠ server ${v.pr.state}`);
            if (!ownerLatest || ownerLatest.id !== v.cur.id) bad.push(`owner latest ${ownerLatest?.id} ≠ staff current ${v.cur.id}`);
            else if (!!ownerLatest.completedAt !== (v.pr.state === 'done')) bad.push(`owner done ${!!ownerLatest.completedAt} ≠ server ${v.pr.state}`);
            if (bad.length) this.viol('I3', { who: key, course: ci, bad });
          }
        }
        if (v.pr) next[`${key}:${ci}`] = { id: v.cur.id, answered: v.pr.answered_items, state: v.pr.state };
      }
    }
    if (this.want('I4') && this.snap && NON_STAFF.has(a.t)) {
      for (const [k, cur] of Object.entries(next)) {
        const prev = this.snap[k];
        if (prev && cur.answered < prev.answered) {
          this.viol('I4', { who: k, action: a.t, kind: prev.id === cur.id ? 'same_send' : (prev.state === 'done' ? 'new_send_after_done' : 'new_send_mid'), prev, cur });
        }
      }
    }
    this.snap = next; this.view = view;
  }

  async run(actions) {
    for (let i = 0; i < actions.length; i++) {
      this.step = i;
      const out = await this.exec(actions[i]);
      await this.observe(actions[i]);
      this.log.push({ i, ...actions[i], out });
      if (this.done()) break;
    }
  }
}

// ── 행동 생성(상태를 보고 고른다 · 기록은 구체 값으로 남겨 재실행 가능하게) ─────────────────
function gen(rand, R) {
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const members = ['A', 'B'].filter((k) => R.members[k]);
  const wts = [['owner_send', 12], ['owner_remind', 10], ['tick', 14], ['advance_day', 11], ['staff_open', 10], ['staff_answer', 20], ['staff_complete', 10],
    ['owner_archive', 2], ['owner_restore', R.archived.size ? 6 : 0], ['remove_staff', R.members.B ? 2 : 0], ['rejoin', R.members.B ? 0 : 5]];
  const tot = wts.reduce((s, [, x]) => s + x, 0);
  let r = rand() * tot, t = wts[0][0];
  for (const [k, x] of wts) { if (r < x) { t = k; break; } r -= x; }
  const c = Math.floor(rand() * COURSES.length);
  switch (t) {
    case 'owner_send': { const to = rand() < 0.5 ? ['A', 'B'] : [pick(['A', 'B'])]; return { t, c, to, due: pick([null, null, 0, 1, 3]) }; }
    case 'owner_remind': case 'owner_archive': return { t, c };
    case 'owner_restore': return { t, c: [...R.archived][0] ?? c };
    case 'tick': case 'advance_day': return { t };
    case 'remove_staff': case 'rejoin': return { t, s: 'B' };
    default: {
      const s = members.length ? pick(members) : 'A';
      // 열린 현재 발송이 있는 퀴즈를 80% 고른다. 문항은 아직 안 푼 것 중에서.
      const open = Object.entries(R.view ?? {}).filter(([k, v]) => k.startsWith(`${s}:`) && v.pr && (v.pr.state === 'todo' || v.pr.state === 'answered'));
      const cc = open.length && rand() < 0.8 ? Number(pick(open)[0].split(':')[1]) : c;
      if (t !== 'staff_answer') return { t, s, c: cc };
      const pend = R.view?.[`${s}:${cc}`]?.pr?.pending_item_ids ?? [];
      const items = R.w.courses[cc].items;
      const i = pend.length && rand() < 0.85 ? items.findIndex((x) => x.id === pick(pend)) : Math.floor(rand() * items.length);
      return { t, s, c: cc, i: Math.max(0, i), ok: rand() < 0.75 };
    }
  }
}

const fmt = (a) => a.t + (a.c != null ? `(c${a.c}` : '(') + (a.s ? `,${a.s}` : '') + (a.to ? `,${a.to.join('+')}` : '') + (a.due !== undefined ? `,due${a.due ?? '-'}` : '') + (a.i != null ? `,i${a.i},${a.ok ? '정답' : '오답'}` : '') + ')';

async function freshRun(actions, opts) {
  const w = await makeWorld(L, env, { tag: 'f', staffN: 2, plan: 'multi', courses: COURSES });
  const R = new Runner(w, opts);
  try { await R.run(actions); } finally { allCleanups.push(await cleanupWorld(L, env, [w])); }
  return R;
}

async function shrink(actions, inv, kind = null) {
  const hit = (v) => v.inv === inv && (!kind || v.detail.kind === kind);
  const reproduces = async (cand) => (await freshRun(cand, { only: inv, stopOnFirst: true, hit })).violations.some(hit);
  let cur = actions; let budget = SHRINK_BUDGET; let runs = 0;
  runs++; budget--;
  if (!(await reproduces(cur))) return { stable: false, runs, actions: cur.map(fmt) };
  let chunk = Math.max(1, Math.ceil(cur.length / 2));
  while (chunk >= 1 && budget > 0) {
    let removed = false;
    for (let i = 0; i < cur.length && budget > 0; i += chunk) {
      const cand = cur.slice(0, i).concat(cur.slice(i + chunk));
      if (!cand.length) continue;
      budget--; runs++;
      if (await reproduces(cand)) { cur = cand; removed = true; i -= chunk; }
    }
    if (!removed) { if (chunk === 1) break; chunk = Math.floor(chunk / 2); }
  }
  return { stable: true, runs, budgetLeft: budget, len: cur.length, actions: cur.map(fmt), raw: cur };
}

// ── 본 실행 ──────────────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0, skip = 0, executed = 0;
const PLANNED = 7; // 퍼징 I1·I2·I3·I5·I6 (5) + 고정 시나리오 I1 (1) + 검출기 자가검증 (1). I4 는 결정대기라 따로 센다.
const check = (name, okv, extra = '') => { executed++; okv ? (pass++, console.log('  ✓', name, extra)) : (fail++, console.log('  ✗', name, extra)); };
const result = { seed: SEED, steps: STEPS, migration_max: MIG, count_from_column: HAS_COUNT_FROM, started: new Date().toISOString() };

async function main() {
  // ① 고정 시나리오: send → tick → remind → answer all → complete → advance_day → tick
  console.log('— 고정 시나리오(결함 ② · I1) —');
  const fixed = [{ t: 'owner_send', c: 0, to: ['A'], due: null }, { t: 'tick' }, { t: 'owner_remind', c: 0 },
    { t: 'staff_answer', s: 'A', c: 0, i: 0, ok: true }, { t: 'staff_answer', s: 'A', c: 0, i: 1, ok: true },
    { t: 'staff_complete', s: 'A', c: 0 }, { t: 'advance_day' }, { t: 'tick' }];
  const F = await freshRun(fixed, {});
  // quiz_resend 사람별 결과(0348): sent = 바로 나감 · queued = 줄에 섬. 둘 다 다시 알리기가 선 것이다.
  const remindMade = Array.isArray(F.log[2]?.out?.resend) && F.log[2].out.resend.some((r) => r.result === 'sent' || r.result === 'queued');
  const completed = (F.log[5]?.out?.r ?? []).includes(true);
  result.fixed = { actions: fixed.map(fmt), log: F.log, violations: F.violations };
  if (!remindMade || !completed) { skip++; console.log('  - 고정 시나리오 셋업이 안 섰다(skip)', JSON.stringify({ remindMade, completed })); }
  else check('고정 시나리오: 다 푼 직원에게 다시 알리기 대기 행이 나가지 않는다(I1)', !F.violations.some((v) => v.inv === 'I1'),
    `마지막 tick 선점 ${F.log[7].out.claimed}건 · I1 위반 ${F.violations.filter((v) => v.inv === 'I1').length}`);

  // ② 검출기 자가검증: 완료 전에 심은 대기 행을, 완료 뒤 due_quiz_sends 를 거치지 않고 claim_quiz_send 로 직접 선점한다.
  //    완료자에게 나간 행이므로 I1 이 반드시 울려야 한다(울리지 않으면 하니스가 거짓말한다).
  //    0348(11-04) 전에는 due_quiz_sends 가 join 행을 안 걸러 tick 으로 충분했다. 이제 후보에서 빠지므로 직접 선점한다.
  console.log('— 검출기 자가검증(I1 이 RED 를 잡는가) —');
  {
    const w = await makeWorld(L, env, { tag: 'sc', staffN: 2, plan: 'multi', courses: COURSES });
    try {
      const R = new Runner(w, { only: 'I1' });
      await R.run([{ t: 'owner_send', c: 0, to: ['A'], due: null }, { t: 'tick' }]);
      const planted = await ok(admin.from('quiz_assignments').insert({ unit_id: w.unit, course_id: w.courses[0].id, user_id: w.staff[0].id, scheduled_on: kstDay(1), origin: 'join' }).select('id').single(), 'planted row');
      await R.run([{ t: 'staff_answer', s: 'A', c: 0, i: 0, ok: true }, { t: 'staff_answer', s: 'A', c: 0, i: 1, ok: true }, { t: 'staff_complete', s: 'A', c: 0 }, { t: 'advance_day' }]);
      const claimedPlanted = await ok(admin.rpc('claim_quiz_send', { p_id: planted.id }), 'claim planted');
      if (claimedPlanted === true) await R.claimChecks(planted.id);
      const hit = R.violations.filter((v) => v.inv === 'I1');
      result.selfcheck = { violations: R.violations, log: R.log, claimedPlanted };
      check('검출기 자가검증: 완료자에게 직접 선점한 대기 행을 I1 이 잡는다', hit.length > 0, `선점 ${claimedPlanted} · I1 ${hit.length}건`);
    } finally { allCleanups.push(await cleanupWorld(L, env, [w])); }
  }

  // ③ 퍼징
  console.log(`— 퍼징 seed ${SEED} · ${STEPS}걸음 —`);
  const rand = rng(SEED);
  const w = await makeWorld(L, env, { tag: 'z', staffN: 2, plan: 'multi', courses: COURSES });
  const R = new Runner(w, {});
  const actions = [];
  try {
    for (let i = 0; i < STEPS; i++) {
      const a = gen(rand, R);
      actions.push(a);
      R.step = i;
      const out = await R.exec(a);
      await R.observe(a);
      R.log.push({ i, ...a, out });
    }
  } finally { allCleanups.push(await cleanupWorld(L, env, [w])); }
  const by = Object.fromEntries(INVS.map((k) => [k, R.violations.filter((v) => v.inv === k)]));
  const tally = Object.fromEntries(Object.entries(R.log.reduce((m, l) => (m[l.t] = (m[l.t] ?? 0) + 1, m), {})));
  const claims = R.log.filter((l) => l.t === 'tick').reduce((s, l) => s + (l.out.claimed ?? 0), 0);
  console.log(`  행동 분포 ${JSON.stringify(tally)} · 선점 ${claims}건 · 관찰 ${R.obs.length}건(${[...new Set(R.obs.map((o) => o.kind))].join(',') || '-'})`);
  result.fuzz = { actions: actions.map(fmt), tally, claims, violations: R.violations, observations: R.obs, log: R.log };
  for (const k of ['I1', 'I2', 'I3', 'I5']) check(`퍼징 ${k} 위반 0`, by[k].length === 0, `${by[k].length}건${by[k][0] ? ' · 첫 걸음 ' + by[k][0].step : ''}`);
  check('퍼징 I6(의심확인) 마감 지난 발송 0', by.I6.length === 0, `${by.I6.length}건${by.I6[0] ? ' · 첫 걸음 ' + by.I6[0].step : ''}`);
  const i4k = (k) => by.I4.filter((v) => v.detail.kind === k).length;
  console.log(`  · I4(결정대기) ${by.I4.length}건 (푸는 중에 새 회차 ${i4k('new_send_mid')} · 완료 뒤 새 회차 ${i4k('new_send_after_done')} · 같은 회차에서 줄어듦 ${i4k('same_send')})`);
  console.log(`  · R1(관찰) 다시 알리기 실패 ${by.R1.length}건${by.R1[0] ? ' · ' + by.R1[0].detail.error + ' · 나간 직원 포함 ' + by.R1[0].detail.removed_recipients : ''}`);

  // ④ shrink — 불변식별 첫 위반 순서를 줄인다
  result.shrunk = {};
  if (SHRINK) {
    for (const k of INVS) {
      if (!by[k].length) continue;
      // 완료 뒤 새 회차(사장이 다시 보냄)는 정상 흐름이라 줄이지 않는다.
      const kinds = k === 'I4' ? [...new Set(by.I4.map((v) => v.detail.kind))].filter((x) => x !== 'new_send_after_done') : [null];
      for (const kind of kinds) {
        const first = kind ? by.I4.find((v) => v.detail.kind === kind) : by[k][0];
        console.log(`  · shrink ${k}${kind ? '/' + kind : ''} (걸음 0..${first.step})`);
        const sres = await shrink(actions.slice(0, first.step + 1), k, kind);
        result.shrunk[k + (kind ? '/' + kind : '')] = { from: first.step + 1, ...sres, raw: undefined };
        console.log(`    → ${sres.stable ? `${sres.len}걸음 · 재실행 ${sres.runs}회` : '재현 불안정'}: ${sres.actions.join(' → ')}`);
      }
    }
  }
}

let crashed = null;
try { await main(); } catch (e) { crashed = e; console.error('  ✗ 예외:', e?.stack ?? e); }
const left = allCleanups.reduce((s, c) => s + c.left, 0);
const leftDetail = allCleanups.flatMap((c) => c.detail);
const notRun = crashed ? PLANNED - executed : 0;
if (crashed) fail++;
result.cleanup = { worlds: allCleanups.length, units: allCleanups.reduce((s, c) => s + c.units, 0), users: allCleanups.reduce((s, c) => s + c.users, 0), left, leftDetail };
result.final = { pass, fail, skip, notRun, crashed: crashed ? String(crashed.message ?? crashed) : null };
const outPath = here(`../../산출물/오류탐지_2026-11-03/P2_fuzz_${SEED}.json`);
try { fs.writeFileSync(outPath, JSON.stringify(result, null, 1)); console.log(`  · 결과 ${outPath}`); } catch (e) { console.error('  ! 결과 파일 쓰기 실패:', e.message); }
console.log(`  · 정리: 매장 ${result.cleanup.units} · 계정 ${result.cleanup.users} · 남은 행 ${left}${leftDetail.length ? ' (' + leftDetail.join(', ') + ')' : ''}`);
console.log(`\nPASS ${pass} · FAIL ${fail} · skip ${skip} · 실행 못 한 단언 ${notRun} · AI 호출 0회 · 정리 남은 행 ${left}`);
// skip 은 통과가 아니다(AGENTS "게이트가 거짓말하는 3가지").
process.exit(fail === 0 && skip === 0 && !crashed ? 0 : 1);
