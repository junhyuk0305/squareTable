const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const source = fs.readFileSync('src/lib/db.ts', 'utf8');
const sf = ts.createSourceFile('db.ts', source, ts.ScriptTarget.Latest, true);
const names = ['readAllPages', 'fetchEntries', 'fetchOwnerKnowhowEntries', 'fetchTemplates', 'mapTemplateRow'];
const code = sf.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(sf)).join('\n');
let fails = 0;
(async () => {
  for (const fn of ['fetchEntries', 'fetchOwnerKnowhowEntries', 'fetchTemplates']) {
    for (const [count, cap, deleting] of [[0,1000,false],[1000,1000,false],[1001,1000,false],[1001,500,false],[1001,500,true]]) {
      let rows = Array.from({length:count}, (_,i) => ({id:String(i).padStart(5,'0'),created_at:'2026-01-01',text:'task'}));
      let calls = 0;
      function query() {
        let after = null, offset = 0, size = 1000;
        const q = {select(){return q},is(){return q},order(){return q},gt(_,id){after=id;return q},limit(n){size=n;return q},range(a,b){offset=a;size=b-a+1;return q},then(resolve){
          if (++calls > 10) throw Error('paging did not terminate');
          const data = rows.filter(r=>after===null || r.id>after).slice(offset,offset+Math.min(size,cap));
          if (deleting && calls===1) rows=rows.slice(1);
          return Promise.resolve({data,error:null}).then(resolve);
        }};return q;
      }
      const mod={exports:{}};
      vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports,HAS_SUPABASE:true,supabase:{from:query,rpc:query},readFail(){}});
      try {const result=await mod.exports[fn]();assert.equal(result.data.length,count);assert.equal(new Set(result.data.map(r=>r.id)).size,count);console.log('PASS',fn,count,cap,deleting);}
      catch(e){fails++;console.error('FAIL',fn,count,cap,deleting,e.message)}
    }
  }
  process.exitCode=fails?1:0;
})();
