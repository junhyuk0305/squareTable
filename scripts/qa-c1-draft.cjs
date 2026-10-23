const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const disk=new Map();
const composer=fs.readFileSync('src/components/work/TaskComposerModal.tsx','utf8');
const keyExpression=composer.match(/const key = (pendingDraftKey\('work'[^\n]+);/)[1];
function composerKey(draftContext){return vm.runInNewContext(keyExpression,{pendingDraftKey:boot().pendingDraftKey,userId:'a',unitId:'store',props:{editTemplate:{id:'dpr_routine'},draftContext}})}
assert.notEqual(composerKey('single:2026-10-24'),composerKey('single:2026-10-25'),'different routine dates must not restore the same retry id');
assert.notEqual(composerKey('global'),composerKey('single:2026-10-24'),'routine modes must not share drafts');
function boot(){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/storage/pendingDraft.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{module:mod,exports:mod.exports,require:()=>({getItem:async k=>disk.get(k)??null,setItem:async(k,v)=>{disk.set(k,v)},removeItem:async k=>{disk.delete(k)}})});return mod.exports}
(async()=>{const a=boot();const key=a.pendingDraftKey('work','a','store');await a.savePendingDraft(key,{ids:['same-id'],text:'task'});const b=boot();assert.equal((await b.loadPendingDraft(key)).ids[0],'same-id');assert.equal(await b.loadPendingDraft(b.pendingDraftKey('work','b','store')),null);assert.equal(await b.loadPendingDraft(b.pendingDraftKey('work','a','other')),null);await b.clearPendingDraft(key);assert.equal(await a.loadPendingDraft(key),null);console.log('PASS restart keeps id and draft, account/store isolation, success clears')})().catch(e=>{console.error(e);process.exitCode=1});
