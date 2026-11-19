// 백엔드 없음 · AI 호출 0회. "보냈나" 판정(metrics.sendPhase · B1 2026-11-19)을 실제 파일 그대로 실행한다.
// 보내기 직후 토스트 · 상세 결과 칸 · 목록 줄 셋이 이 판정 하나로 말한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const src = fs.readFileSync(new URL('../src/lib/quiz/metrics.ts', import.meta.url), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const ctx = vm.createContext({ exports: {} });
vm.runInContext(out, ctx);
const m = ctx.exports;

let pass = 0;
const check = (name, fn) => { fn(); pass += 1; console.log(`  PASS ${name}`); };

// 2026-11-19 09:00 KST
const NOW = Date.parse('2026-11-19T00:00:00Z');
const row = (o) => ({ userId: 'a', sentAt: null, completedAt: null, scheduledOn: '2026-11-19', ...o });

check('행 없음 = none · 문구 없음', () => {
  assert.equal(m.sendPhase([], NOW), 'none');
  assert.equal(m.sendPhaseLabel('none'), '');
});
check('지금 바로 · 아직 안 나감 = soon "1분 안에 가요"', () => {
  assert.equal(m.sendPhase([row({ sendNow: true })], NOW), 'soon');
  assert.equal(m.sendPhaseLabel('soon'), '1분 안에 가요');
});
check('한 명이라도 나가면 sent "보냈어요"', () => {
  assert.equal(m.sendPhase([row({ sendNow: true }), row({ userId: 'b', sendNow: true, sentAt: '2026-11-19T00:01:00Z' })], NOW), 'sent');
  assert.equal(m.sendPhaseLabel('sent'), '보냈어요');
});
check('예약(표시 없음) = waiting · 보낼 시각 문구(0931)', () => {
  assert.equal(m.sendPhase([row({ scheduledOn: '2026-11-21' })], NOW), 'waiting');
  // 시간 없는 행 = 예약일 09:00 KST(00:00 UTC).
  assert.equal(m.nextSendAt([row({ scheduledOn: '2026-11-21' })], NOW), '2026-11-21T00:00:00.000Z');
  assert.equal(m.sendPhaseLabel('waiting', '2026-11-21T00:00:00.000Z'), '11월 21일 오전 9시에 보내요');
  assert.equal(m.sendPhaseLabel('waiting', '2026-11-21T06:30:00.000Z'), '11월 21일 오후 3시 30분에 보내요');
  assert.equal(m.sendPhaseLabel('waiting', null), '아직 안 나갔어요');
});
check('send_at(0931): 오늘 안의 나중 시각 = waiting · 지난 시각 = soon', () => {
  assert.equal(m.sendPhase([row({ sendAt: '2026-11-19T06:00:00Z' })], NOW), 'waiting');
  assert.equal(m.sendPhase([row({ sendAt: '2026-11-18T23:59:00Z' })], NOW), 'soon');
  assert.equal(m.nextSendAt([row({ sendAt: '2026-11-19T06:00:00Z' }), row({ userId: 'b', sentAt: 'x', sendAt: '2026-11-19T01:00:00Z' })], NOW), '2026-11-19T06:00:00.000Z', '나간 행은 안 본다');
});
check('시간 없는 오늘 행: 09:00 전 = waiting · 09:00 = soon', () => {
  assert.equal(m.sendPhase([row({})], NOW - 60_000), 'waiting');
  assert.equal(m.sendPhase([row({})], NOW), 'soon');
});
check('옛 앱·옛 서버 행(sendNow 없음) = waiting', () => {
  assert.equal(m.sendPhase([{ userId: 'a', sentAt: null, completedAt: null }], NOW), 'waiting');
});
check('어제 지금 바로 행이 아직 안 나감 = 막힌 것 · soon 이라 말하지 않는다', () => {
  assert.equal(m.sendPhase([row({ sendNow: true, scheduledOn: '2026-11-18' })], NOW), 'waiting');
});
check('KST 경계: UTC 18일 15:30 = KST 19일 00:30 → 19일 행은 오늘', () => {
  assert.equal(m.sendPhase([row({ sendNow: true })], Date.parse('2026-11-18T15:30:00Z')), 'soon');
});
check('목록 상태: soon = queued "곧 발송" · sent = sending', () => {
  assert.equal(m.quizState({ active: true, start_at: '2026-11-19' }, [row({ sendNow: true })], [], NOW), 'queued');
  assert.equal(m.QUIZ_STATE_LABEL.queued, '곧 발송');
  assert.equal(m.quizState({ active: true, start_at: '2026-11-19' }, [row({ sentAt: 'x' })], [], NOW), 'sending');
  assert.equal(m.quizState({ active: true, start_at: '2026-11-19' }, [row({})], [], NOW - 60_000), 'scheduled', '09:00 전 = 예약 문구');
});
check('토스트 머리 = 같은 판정', () => {
  assert.equal(m.sendToastLabel('soon', 3, '2026-11-19'), '3명에게 1분 안에 가요');
  assert.equal(m.sendToastLabel('waiting', 3, '2026-11-21T06:00:00Z'), '11월 21일 오후 3시에 보내요');
});
check('결과 칸: 보낸 행이 있으면 비어도 none 이 아니다', () => {
  const sends = [row({ sendNow: true })];
  assert.equal(m.resultsEmpty(sends, []), true);
  assert.notEqual(m.sendPhase(sends, NOW), 'none');
});

console.log(`qa-quiz-send-phase: GREEN — pass ${pass} · fail 0 · AI 호출 0회`);
