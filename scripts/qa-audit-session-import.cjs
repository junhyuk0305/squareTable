// Executes HandoverImport's actual run callback (including persistChunk) and actual entry builder.
// React setters, AI orchestration and the transport write are mocked. No render, model or DB calls.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function moduleFrom(file, mocks={}) {
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};vm.runInNewContext(code,{module:mod,exports:mod.exports,require:n=>{if(n in mocks)return mocks[n];throw Error('Unexpected '+n);},Date});return mod.exports;
}
function runFunction(globals){
  const file='src/components/owner/HandoverImport.tsx';const source=fs.readFileSync(path.join(root,file),'utf8');const sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found;
  function visit(n){if(ts.isVariableDeclaration(n)&&n.name?.text==='run')found=n.initializer.arguments[0];ts.forEachChild(n,visit);}visit(sf);assert.ok(found);
  const code=ts.transpileModule('module.exports = '+found.getText(sf),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};vm.runInNewContext(code,{...globals,module:mod,Date,Error});return mod.exports;
}
async function test(mode){
  let session={unitId:'A',userId:'owner-A',userName:'Owner A',role:'owner'};let id=0;
  const epoch=moduleFrom('src/lib/store/tenantEpoch.ts');
  const change=()=>{session={...session,unitId:'B',userId:'owner-B'};epoch.bumpTenantEpoch();};
  const builder=moduleFrom('src/lib/utils/buildEntry.ts',{'@/lib/store/useSessionStore':{useSessionStore:{getState:()=>session}},'@/lib/utils/id':{genId:()=>String(++id)},'@/lib/utils/knowhowQuality':{sanitizeKeywords:ks=>({kept:ks})}});
  const sq={situation:'QA synthetic situation',quagmire:'',uncover:'',action:{steps:['QA step']},result:{},extract:{do:'',dont:''}};
  const segment={category:'Routine',title:'QA synthetic draft',square:sq,keywords:[]};const saved=[],toasts=[];
  const fn=runFunction({
    tooShort:false,pipelineRunning:false,trimmed:'QA synthetic document',chunkDocument:()=>({chunks:[{section:null,text:'QA'}],truncatedChunks:0}),
    setError(){},setNote(){},setPhase(){},setProg(){},setRawText(){},mounted:{current:true},showToast:m=>toasts.push(m),
    genId:()=>String(++id),drafts:[],storeId:'A',EXTRACTION_MASTER:'',...builder,...epoch,
    usePlaybookStore:{getState:()=>({entries:saved})},isDraft:e=>e.status==='draft',
    addEntry:async entry=>{saved.push(entry);if(mode==='during-write'&&saved.length===1)change();return true;},
    structureDoc:async ({persistChunk})=>{
      if(mode==='before-result'||mode==='aba'){change();if(mode==='aba'){session={...session,unitId:'A',userId:'owner-A'};epoch.bumpTenantEpoch();}}
      return {saved:await persistChunk({section:null},[segment,segment]),failedChunks:0};
    },
  });
  await fn();
  const expected=mode==='normal'?2:mode==='during-write'?1:0;
  assert.equal(saved.length,expected,`${mode}: only writes started before tenant change may be sent`);
  assert.ok(saved.every(e=>e.unit_id==='A'&&e.creator_id==='owner-A'),`${mode}: no draft should inherit later tenant`);
  return {mode,writes:saved.length,unitIds:saved.map(e=>e.unit_id),notices:toasts.length};
}
(async()=>{let pass=0,fail=0;for(const mode of ['before-result','during-write','aba','normal']){try{console.log('PASS '+JSON.stringify(await test(mode)));pass++;}catch(e){console.log('FAIL '+e.message);fail++;}}console.log(`RESULT ${pass} PASS ${fail} FAIL 0 SKIP`);process.exitCode=fail?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
