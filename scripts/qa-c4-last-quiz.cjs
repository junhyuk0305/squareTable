const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const src=fs.readFileSync('src/components/WorkBoard.tsx','utf8');
const fragment=src.slice(src.indexOf('  const lastCourseKey ='),src.indexOf('  // 카드의 퀴즈 시작'));
const sf=ts.createSourceFile('board.tsx',src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let ui;
function walk(n){if(ts.isJsxExpression(n)&&n.getText(sf).includes('지난번 퀴즈를 불러오지 못했어요')) ui=n.expression.getText(sf);ts.forEachChild(n,walk)}walk(sf);
assert.ok(ui,'조회 실패 안내와 재시도 UI가 있어야 한다');
let state=[],index=0,effect,result=null;
const context={trainingCards:[{course:{id:'c'}}],activeUnit:'u',userId:'me',quizAttempts:[],view:'chat',isOwner:false,
  useState(initial){const i=index++;if(!(i in state))state[i]=initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]},
  useEffect(fn){effect=fn},fetchMyLastQuizSubmissions:async()=>result,LoadErrorState:'LoadErrorState',React:{createElement:(type,props)=>({type,props})}};
function render(){index=0;const js=ts.transpileModule('(()=>{'+fragment+'\nglobalThis.ui = ('+ui+');})()',{compilerOptions:{jsx:ts.JsxEmit.React}}).outputText;vm.runInNewContext(js,context);return context.ui}
(async()=>{render();effect();await new Promise(r=>setImmediate(r));let out=render();assert.equal(out.type,'LoadErrorState');out.props.onRetry();result={c:[{correct:true}]};render();effect();await new Promise(r=>setImmediate(r));assert.equal(render(),false);result={};effect();await new Promise(r=>setImmediate(r));assert.equal(render(),false);console.log('PASS failure visible, retry success, empty hidden')})().catch(e=>{console.error(e);process.exitCode=1});
