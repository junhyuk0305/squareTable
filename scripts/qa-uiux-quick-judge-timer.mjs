// Read-only source execution. This is a deterministic hook/clock harness, not a browser or native test.
// Run from SquareTable: node <absolute path to this file> [absolute repository path] [baseline ref]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const repo = path.resolve(process.argv[2] ?? process.cwd());
const require = createRequire(path.join(repo, 'package.json'));
const ts = require('typescript');
const relative = 'src/components/work/quiz/QuickJudge.tsx';
const current = fs.readFileSync(path.join(repo, relative), 'utf8');
const baselineRef = process.argv[3] ?? '493d6719104666adddd12450e8f2bd3546728b88';
const baseline = execFileSync('git', ['show', `${baselineRef}:${relative}`], { cwd: repo, encoding: 'utf8' });

function harness(source) {
  const slots = [];
  let cursor = 0, effects = [], dirty = false, tree, now = 0, nextId = 1;
  const intervals = new Map(), answers = [];
  let props = {
    payload: { seconds: 3, cards: [{ text: 'A' }, { text: 'B' }], labels: ['Y', 'N'] },
    disabled: true, result: null, onAnswer: value => answers.push(value),
  };
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (!old || !deps || deps.length !== old.deps?.length || deps.some((v, j) => !Object.is(v, old.deps?.[j]))) {
        effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: x => x } };
      if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
      if (name.includes('colors')) return { InkColors: {}, BrandColors: {} };
      if (name.includes('elevation')) return { Radius: {} };
      if (name.includes('layout')) return { Space: {} };
      return { qs: {} };
    },
    Date: { now: () => now },
    setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
  });
  function render() {
    let iterations = 0;
    do {
      assert(++iterations < 20, 'render settles');
      dirty = false; cursor = 0; effects = [];
      tree = module.exports.QuickJudge(props);
      const pending = effects; effects = []; pending.forEach(fn => fn());
    } while (dirty);
  }
  function buttons(node, found = []) {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) { node.forEach(child => buttons(child, found)); return found; }
    if (node.type === 'Pressable') found.push(node);
    buttons(node.props?.children, found);
    return found;
  }
  render();
  return {
    setDisabled(value) { props = { ...props, disabled: value }; render(); },
    tick(ms) {
      assert.equal(ms % 100, 0, 'clock advances in 100 ms timer ticks');
      for (let elapsed = 0; elapsed < ms; elapsed += 100) {
        now += 100;
        for (const [id, fn] of [...intervals]) if (intervals.has(id)) { fn(); if (dirty) render(); }
      }
    },
    choose(index) { const button = buttons(tree)[index]; assert(button && !button.props.disabled); button.props.onPress(); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get timers() { return intervals.size; },
    get remaining() { return slots[2]; },
    get answers() { return JSON.parse(JSON.stringify(answers)); },
  };
}

const red = harness(baseline);
assert.equal(red.timers, 1, 'baseline reproduces hidden timer regression');
red.unmount();
console.log(`RED reproduced: ${baselineRef} starts a timer while hidden`);

const run = harness(current);
run.tick(5000);
assert.equal(run.timers, 0);
assert.deepEqual(run.answers, []);
console.log('PASS initially hidden timer does not start');
run.setDisabled(false); run.tick(1000); assert.equal(run.remaining, 2000);
run.setDisabled(true); run.tick(5000); assert.equal(run.remaining, 2000); assert.equal(run.timers, 0);
console.log('PASS pause preserves remaining 2000 ms and stops interval');
run.setDisabled(false); run.tick(500); assert.equal(run.remaining, 1500);
run.choose(0); assert.equal(run.remaining, 3000);
run.tick(1000); assert.equal(run.remaining, 2000);
run.choose(1); assert.deepEqual(run.answers, [[0, 1]]); assert.equal(run.timers, 0);
run.tick(5000); assert.equal(run.answers.length, 1);
console.log('PASS resume, next-card reset, and exactly one completed submission');

const timeout = harness(current);
timeout.setDisabled(false); timeout.tick(6000);
assert.deepEqual(timeout.answers, [[-1, -1]]); assert.equal(timeout.timers, 0);
console.log('PASS visible timeouts submit each card once and stop');

const cleanup = harness(current);
cleanup.setDisabled(false); cleanup.tick(500); assert.equal(cleanup.timers, 1);
cleanup.unmount(); assert.equal(cleanup.timers, 0); cleanup.tick(5000); assert.deepEqual(cleanup.answers, []);
console.log('PASS unmount clears an active timer without submitting');
console.log('Scope: source execution with simulated React hooks and clock; real React scheduling, browser, and native devices are not exercised.');
