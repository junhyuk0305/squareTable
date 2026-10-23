const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const cp = require('child_process');
const nativeAssert = require('assert/strict');
const failures = [];
const assert = { equal(...args) { try { nativeAssert.equal(...args); } catch (e) { failures.push({ actual:e.actual, expected:e.expected, stack:e.stack }); } } };
const repo = path.resolve(__dirname, '../../../..');
const ts = require(path.join(repo, 'node_modules/typescript'));
const zustand = require(path.join(repo, 'node_modules/zustand'));
const files = [
  'src/lib/store/useAttendanceStore.ts', 'src/lib/store/useSyncStore.ts',
  'src/lib/store/realtimeSync.ts', 'src/lib/store/tenantEpoch.ts',
  'src/lib/utils/attendance.ts', 'src/lib/utils/schedule.ts', 'src/lib/utils/id.ts',
  'src/components/TimesheetView.tsx', 'src/lib/db.ts',
];
const snapshot = Object.fromEntries(files.map(p => [p, fs.readFileSync(path.join(repo,p),'utf8')]));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const baseline = () => ({time:new Date().toISOString(), head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(), files:files.map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(repo,p))),mtime:fs.statSync(path.join(repo,p)).mtime.toISOString()}))});
if (process.env.AUDIT_BEFORE === '1') snapshot['src/lib/store/useAttendanceStore.ts'] = fs.readFileSync(path.join(__dirname, 'before.ts.txt'), 'utf8');
const before = baseline();
let writes = [], deletes = [], server = [], monthRead = null;
const clone = x => JSON.parse(JSON.stringify(x));
function deferred(payload) { let resolve; const promise = new Promise(r=>resolve=r); return {payload:clone(payload),promise,resolve}; }
const db = {
  upsertAttendance: rec => { const d=deferred(rec); writes.push(d); return d.promise; },
  deleteAttendance: id => {const d=deferred(id);deletes.push(d);return d.promise;},
  fetchAttendance: async()=>({data:clone(server),error:false}),
  fetchAttendanceMonth: async()=>monthRead ? monthRead.promise : ({data:clone(server),error:false}),
  subscribeAttendance:()=>()=>{},
};
const cache = {};
function load(p) {
  if(cache[p])return cache[p].exports;
  const mod={exports:{}};cache[p]=mod;
  const code=ts.transpileModule(snapshot[p],{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const req=n=>{
    if(n==='zustand')return zustand;
    if(n==='@/lib/supabase')return {HAS_SUPABASE:true};
    if(n==='@/lib/db')return db;
    if(n.startsWith('@/'))return load('src/'+n.slice(2)+'.ts');
    throw Error('Unexpected dependency '+n);
  };
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:p})(req,mod,mod.exports);
  return mod.exports;
}
const store=load('src/lib/store/useAttendanceStore.ts').useAttendanceStore;
const sync=load('src/lib/store/useSyncStore.ts').useSyncStore;
const base={id:'synthetic-attendance',staff_id:'synthetic-staff',date:'2026-10-22',check_in:'2026-10-22T00:00:00.000Z',check_out:'2026-10-22T08:00:00.000Z',work_minutes:480};
const flush=()=>new Promise(r=>setImmediate(r));
function reset(){writes=[];deletes=[];monthRead=null;server=[clone(base)];store.setState({records:clone(server),loaded:true,loadError:false,months:{}});sync.setState({error:null});}
function edit(end){store.getState().upsertManual(base.staff_id,base.date,'09:00',end,'owner',base.id);}
async function finish(d,ok){if(ok)server=[clone(d.payload)];d.resolve(ok);await flush();}
const results=[];
(async()=>{
  reset();edit('18:00');await finish(writes[0],true);
  assert.equal(store.getState().records[0].work_minutes,540);
  results.push({case:'control single successful edit',client:540,server:server[0].work_minutes,status:'normal'});
  reset();edit('18:00');await finish(writes[0],false);
  assert.equal(store.getState().records[0].work_minutes,480);
  results.push({case:'control single failed edit',client:480,server:server[0].work_minutes,status:'normal rollback'});
  reset();edit('18:00');edit('20:00');await finish(writes[1],true);await finish(writes[0],false);
  const stale=store.getState().records[0].work_minutes;
  assert.equal(stale,660);assert.equal(server[0].work_minutes,660);
  results.push({case:'A delayed failure after B success',client:stale,server:660,otherClientFreshRead:clone(server)[0].work_minutes,error:sync.getState().error,status:'observed; correctness is determined by failures'});
  reset();edit('18:00');server=[{...base,check_out:'2026-10-22T11:00:00.000Z',work_minutes:660}];await store.getState().hydrate();await finish(writes[0],false);
  assert.equal(store.getState().records[0].work_minutes,660);
  results.push({case:'A delayed failure after latest server hydrate',client:store.getState().records[0].work_minutes,server:server[0].work_minutes,status:'observed; correctness is determined by failures'});
  reset();store.getState().removeRecord(base.id);await store.getState().hydrate();deletes[0].resolve(false);await flush();
  assert.equal(store.getState().records.length,1);assert.equal(server.length,1);
  results.push({case:'delete failure after row already restored by hydrate',clientRows:store.getState().records.length,serverRows:server.length,clientTotalMinutes:store.getState().records.reduce((n,r)=>n+r.work_minutes,0),serverTotalMinutes:480,status:'observed; correctness is determined by failures'});
  await store.getState().hydrate();assert.equal(store.getState().records.length,1);
  results.push({case:'control subsequent hydrate repairs client',clientRows:1,serverRows:1,status:'normal recovery'});
  reset();edit('18:00');edit('20:00');await finish(writes[0],false);await finish(writes[1],false);
  assert.equal(store.getState().records[0].work_minutes,480);
  results.push({case:'A and B both fail in start order',client:store.getState().records[0].work_minutes,server:server[0].work_minutes});
  reset();edit('18:00');edit('20:00');await finish(writes[1],false);await finish(writes[0],false);
  assert.equal(store.getState().records[0].work_minutes,480);
  results.push({case:'A and B both fail in reverse order',client:store.getState().records[0].work_minutes,server:server[0].work_minutes});
  reset();monthRead=deferred(null);edit('18:00');await finish(writes[0],false);
  const oldRead=monthRead;monthRead=null;edit('20:00');await finish(writes[1],true);
  oldRead.resolve({data:[clone(base)],error:false});await flush();
  assert.equal(store.getState().records[0].work_minutes,660);
  results.push({case:'old repair read after newer successful C',client:store.getState().records[0].work_minutes,server:server[0].work_minutes});
  reset();monthRead=deferred(null);edit('18:00');await finish(writes[0],false);
  const repair=monthRead;monthRead=null;const other={...base,id:'synthetic-other',work_minutes:700};
  store.setState({records:[...store.getState().records,other]});
  repair.resolve({data:[clone(base),{...other,work_minutes:300}],error:false});await flush();
  assert.equal(store.getState().records.find(r=>r.id===other.id).work_minutes,700);
  results.push({case:'repair must not replace other row',otherClient:store.getState().records.find(r=>r.id===other.id).work_minutes});
  reset();monthRead=deferred(null);edit('18:00');await finish(writes[0],false);
  const staleRepair=monthRead;server=[{...base,work_minutes:700}];await store.getState().hydrate();
  staleRepair.resolve({data:[clone(base)],error:false});await flush();
  assert.equal(store.getState().records[0].work_minutes,700);
  results.push({case:'repair read must not overwrite newer realtime row',client:store.getState().records[0].work_minutes,server:server[0].work_minutes});
  reset();edit('18:00');load('src/lib/store/tenantEpoch.ts').bumpTenantEpoch();store.setState({records:[]});await finish(writes[0],false);
  assert.equal(store.getState().records.length,0);
  results.push({case:'tenant switch prevents old rollback and repair',clientRows:store.getState().records.length});
  reset();monthRead=deferred(null);edit('18:00');await finish(writes[0],false);
  const priorTenantRead=monthRead;load('src/lib/store/tenantEpoch.ts').bumpTenantEpoch();store.setState({records:[]});
  priorTenantRead.resolve({data:[clone(base)],error:false});await flush();
  assert.equal(store.getState().records.length,0);
  results.push({case:'tenant switch during recovery read',clientRows:store.getState().records.length});
  reset();monthRead=deferred(null);edit('18:00');edit('20:00');await finish(writes[1],true);await finish(writes[0],false);
  monthRead.resolve({data:[],error:true});await flush();
  assert.equal(store.getState().records[0].work_minutes,660);
  results.push({case:'failed recovery read preserves latest success',client:store.getState().records[0].work_minutes,server:server[0].work_minutes});
  const after=baseline();
  const report={scope:'Actual source modules and real Zustand; DB transport mocked. No network, SQL, UI rendering or actual second device.',sourceMode:process.env.AUDIT_BEFORE === '1' ? 'before.ts snapshot' : 'working tree',executedSourceHashes:Object.fromEntries(Object.entries(snapshot).map(([p,s])=>[p,sha(s)])),before,after,sourceChanged:before.files.filter((p,i)=>p.sha256!==after.files[i].sha256).map(p=>p.path),results,failures,productPass:failures.length===0};
  console.log(JSON.stringify(report,null,2));
  if(failures.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
