const fs=require('node:fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('src/components/work/UnderstandingCheckSheet.tsx','utf8');
assert.ok(src.includes('loadPendingDraft<QuizDraft>'),'failed submission is loaded on reopen');
assert.ok(src.indexOf('await savePendingDraft(draftKey') < src.indexOf('await recordStaffQuizAttempt(given.current'),'persist before network');
assert.ok(src.indexOf('await recordStaffQuizAttempt(given.current') < src.indexOf('await onPass(perEntry'),'confirm only after server');
require('./qa-c1-draft.cjs');
const vm=require('node:vm'),ts=require('typescript');
const sf=ts.createSourceFile('sheet.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let finish;
function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(sf)==='finish')finish=n.initializer.getText(sf);ts.forEachChild(n,visit)}visit(sf);
const disk=new Map(),server=new Map();let loseAck=true,passed=0;
function boot(draft){
  const state={failed:false,done:false};
  const context={module:{exports:{}},savingRef:{current:false},submitted:false,
    items:draft.items,given:{current:draft.responses},requestId:draft.requestId,draftKey:'quiz:a:store',courseId:'course',sops:[],
    currentTenantEpoch:()=>1,isStaleEpoch:()=>false,
    onSavingChange:()=>{},setSaving:()=>{},setSaveFailed:v=>state.failed=v,setFollowupFailed:()=>{},setMissedTitles:()=>{},setSubmitted:()=>{},setDone:v=>state.done=v,
    savePendingDraft:async(k,v)=>disk.set(k,JSON.stringify(v)),clearPendingDraft:async k=>disk.delete(k),
    recordStaffQuizAttempt:async(responses,course,id)=>{assert.ok(disk.has('quiz:a:store'));server.set(id,responses);return loseAck?null:id},
    recordQuizStats:async()=>{},onPass:async()=>{assert.equal(loseAck,false);passed++;return true},onFinished:async()=>{}};
  vm.runInNewContext(ts.transpileModule('module.exports = '+finish,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {finish:context.module.exports,state};
}
(async()=>{
  const draft={requestId:'stable-request',items:[{id:'q1',entry_ids:['e1']}],marks:[true],responses:[{itemId:'q1',response:{choice:0},ord:0}]};
  const first=boot(draft);await first.finish(draft.marks);
  assert.equal(first.state.failed,true);assert.equal(first.state.done,false);assert.equal(passed,0);
  const restored=JSON.parse(disk.get('quiz:a:store'));assert.equal(restored.requestId,draft.requestId);
  loseAck=false;const restarted=boot(restored);await restarted.finish(restored.marks);
  assert.equal(server.size,1);assert.equal(passed,1);assert.equal(restarted.state.done,true);assert.equal(disk.size,0);
  console.log('PASS actual finish: lost acknowledgement, restart, same request, one submission, confirmed understanding');
})().catch(e=>{console.error(e);process.exitCode=1});
