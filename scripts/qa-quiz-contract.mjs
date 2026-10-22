// Real authenticated/anon regression for 0326. Setup/cleanup only uses admin.
// Fixed QA accounts, unique fixtures, no notification dispatch or global signOut.
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import {FIXED,UNIT,login,rolePrecondition} from './lib/qa-fixed-accounts.mjs';
const env={...process.env};
for(const f of ['.env','.env.seed']) for(const line of readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!env[m[1]])env[m[1]]=m[2].trim();}
const url=env.EXPO_PUBLIC_SUPABASE_URL,key=env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const opt={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY,opt),anon=createClient(url,key,opt);
const owner=await login(url,key,FIXED.owner),junior=await login(url,key,FIXED.junior);
const pre=await rolePrecondition({owner,junior});if(pre)throw Error(pre);
for(const c of [owner,junior]){const r=await c.rpc('my_units');if(!r.data?.some(x=>x.unit_id===UNIT&&x.is_active))throw Error('Active unit differs; no mutation');}
const p='qa_contract_'+Date.now(),entries=[p+'_e1',p+'_e2'],courses=[p+'_a',p+'_b'],items=[p+'_i1',p+'_i2',p+'_ib'],link=p+'_l',token=crypto.randomUUID().replaceAll('-',''),assignment=p+'_assignment';
const legacyAssignment=p+'_legacy_assignment';
const must=async(q)=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data;};
let failures=0; const check=(name,ok,detail)=>{ if(!ok)failures++; console.log(ok?'PASS':'FAIL',name,JSON.stringify(detail??'')); };
const out=(name,v)=>console.log(name,JSON.stringify(v));
try{
 for(const id of entries) await must(owner.from('playbook_entries').insert({id,unit_id:UNIT,creator_id:owner.uid,creator_name:'QA',category:'Know-how',subcategory:'일반',title:p,tags:[],search_keywords:[],square:{situation:'마감',action:{steps:['잠근다']},extract:{do:'잠근다',dont:''},result:{before:'',after:'',metric:''},uncover:'',quagmire:''},execution:{tone:'친절',timing:'마감',channel:'구두',stakeholders:[]},stats:{thumbs_up:0,thumbs_down:0,last_used_at:new Date().toISOString(),query_hits_30d:0,resolution_rate:0},photos:[],version:1,status:'published',quality_score:0.6,is_template:false,needs_review:false,correction_points:[],order_index:0}));
 for(const id of courses)await must(owner.from('training_courses').insert({id,unit_id:UNIT,key:id,name:p,min_items:1,max_items:10,position:0,active:true,audience:'guest',start_at:null}));
 for(const course_id of courses)for(const entry_id of entries)await must(owner.from('course_entries').insert({course_id,entry_id,unit_id:UNIT}));
 for(let i=0;i<items.length;i++)await must(owner.from('quiz_items').insert({id:items[i],unit_id:UNIT,course_id:i===2?courses[1]:courses[0],entry_ids:i===0?entries:[entries[0]],kind:'t0',format:'mc4',payload:{ask:p,choices:['정답','오답','다른 답','모름'],answer_index:0,explain:'QA'},source:'owner',status:'active',created_by:owner.uid}));
 await must(owner.from('quiz_links').insert({id:link,course_id:courses[0],unit_id:UNIT,token,expires_at:new Date(Date.now()+3600000).toISOString(),created_by:owner.uid}));
 const staff=await junior.rpc('quiz_staff_record',{p_rows:[{item_id:items[0],response:0,ord:0},{item_id:items[1],response:1,ord:1}]});out('staff_record',staff);
 out('owner_staff_rows',await must(owner.from('quiz_attempts').select('course_id,total,correct,submission_id').in('entry_id',entries)));
 const person=await owner.rpc('quiz_course_person',{p_course_id:courses[0],p_staff_id:junior.uid}); check('person is 1/2',!person.error&&person.data?.[0]?.asked===2&&person.data?.[0]?.correct===1,person);
 const stats=await owner.rpc('quiz_course_stats');const stat=stats.data?.find(r=>r.course_id===courses[0]);check('staff course stats 1/2',!stats.error&&stat?.asked===2&&stat?.correct===1,stat);
 out('anon_servable',await anon.rpc('quiz_link_items',{p_token:token}));
 const crossGrade=await anon.rpc('quiz_link_grade',{p_token:token,p_item_id:items[2],p_response:0});check('cross-course grade denied',!!crossGrade.error,crossGrade);
 const crossSubmit=await anon.rpc('quiz_link_submit',{p_token:token,p_guest_name:p,p_guest_phone:null,p_phone_verified:false,p_answers:[{item_id:items[2],response:0}]});check('cross-course submit rejected',!!crossSubmit.error||crossSubmit.data===0,crossSubmit);
 out('owner_cross_course_record',await must(owner.from('quiz_attempts').select('course_id,total,correct,guest_name').eq('course_id',courses[0])));
 // A fresh assignment cannot use the earlier attempt or global understanding as completion.
 await must(admin.from('quiz_assignments').insert({id:assignment,unit_id:UNIT,course_id:courses[0],user_id:junior.uid,scheduled_on:new Date().toISOString().slice(0,10),sent_at:new Date().toISOString()}));
 await must(admin.from('knowhow_understanding').upsert(entries.map(entry_id=>({unit_id:UNIT,entry_id,staff_id:junior.uid,staff_name:'QA',verified_at:new Date().toISOString()})),{onConflict:'entry_id,staff_id'}));
 const premature=await junior.rpc('mark_quiz_completed',{p_id:assignment});check('global understanding does not complete assignment',!premature.error&&premature.data===false,premature);
 const progress=await junior.rpc('quiz_assignment_progress',{p_course_id:courses[0]});
 const initial=progress.data?.find(r=>r.assignment_id===assignment);
 check('fresh assignment requires two items',!progress.error&&initial?.total_items===2&&initial?.answered_items===0,progress.error??initial);
 const pending=await junior.rpc('quiz_assignment_items',{p_assignment_id:assignment,p_limit:3,p_entry_ids:[entries[1]]});
 check('pending items respect entry filter and strip answer',!pending.error&&pending.data?.length===1&&pending.data[0].id===items[0]&&!('answer_index' in pending.data[0].payload),pending.error??pending.data);
 const request={p_course_id:courses[0],p_request_id:p+'_request',p_rows:[{item_id:items[0],response:0,ord:0},{item_id:items[1],response:1,ord:1}]};
 const [first,retry]=await Promise.all([junior.rpc('quiz_staff_record_v2',request),junior.rpc('quiz_staff_record_v2',request)]);
 check('concurrent staff retry returns one submission',!first.error&&!retry.error&&!!first.data&&first.data===retry.data,{first,retry});
 if(!first.error&&first.data){
   const saved=await must(owner.from('quiz_attempt_items').select('item_id,course_id,entry_ids').eq('submission_id',first.data));
   check('one snapshot per answer with course/entries',saved.length===2&&saved.every(r=>r.course_id===courses[0]&&r.entry_ids?.length),saved);
 }
 const after=await junior.rpc('quiz_assignment_progress',{p_course_id:courses[0]});
 const done=after.data?.find(r=>r.assignment_id===assignment);
 check('incorrect answers still count as answered',!after.error&&done?.answered_items===2&&done?.pending_item_ids.length===0,after.error??done);
 const completed=await junior.rpc('mark_quiz_completed',{p_id:assignment});
 const completedAgain=await junior.rpc('mark_quiz_completed',{p_id:assignment});
 check('completion is true once only',!completed.error&&completed.data===true&&!completedAgain.error&&completedAgain.data===false,{completed,completedAgain});
 const invalid=await junior.rpc('quiz_staff_record_v2',{...request,p_request_id:p+'_invalid',p_rows:[{item_id:items[2],response:0}]});
 // 0203 정책: 다른 코스·지워진 문항은 예외 없이 버린다. 남는 답이 없으면 아무것도 저장하지 않는다.
 check('staff cross-course item is dropped, nothing saved',!invalid.error&&invalid.data===null,invalid);
 const guestArgs={p_token:token,p_guest_name:'QA contract',p_guest_phone:null,p_phone_verified:false,p_request_id:p+'_guest',p_answers:[{item_id:items[0],response:0},{item_id:items[1],response:1}]};
 const [guest1,guest2]=await Promise.all([anon.rpc('quiz_link_submit_v2',guestArgs),anon.rpc('quiz_link_submit_v2',guestArgs)]);
 check('guest retry returns same success',!guest1.error&&!guest2.error&&guest1.data>0&&guest1.data===guest2.data,{guest1,guest2});
 const guestRows=await must(owner.from('quiz_attempts').select('submission_id').eq('course_id',courses[0]).is('staff_id',null));
 check('guest retry writes one submission',new Set(guestRows.map(r=>r.submission_id)).size===1,guestRows);
 // A current item disappearing must not change past score or hide its snapshot.
 const beforeHistory=await owner.rpc('quiz_course_attempt_items',{p_course_id:courses[0]});
 const staffHidden=await junior.rpc('quiz_course_attempt_items',{p_course_id:courses[0]});
 check('staff cannot read answer snapshots',!staffHidden.error&&staffHidden.data?.length===0,staffHidden);
 await must(owner.from('quiz_items').delete().eq('id',items[0]));
 const history=await owner.rpc('quiz_course_attempt_items',{p_course_id:courses[0]});
 check('deleted item snapshots remain visible',!history.error&&history.data?.some(r=>r.item_id===items[0])&&history.data.length===beforeHistory.data?.length,history.error??history.data?.length);
 const historyStats=await owner.rpc('quiz_course_stats');
 const historyStat=historyStats.data?.find(r=>r.course_id===courses[0]);
 check('history score remains per-item after deletion',!historyStats.error&&historyStat?.asked===6&&historyStat?.correct===3,historyStats.error??historyStat);
 const replay=await junior.rpc('quiz_staff_record_v2',request);
 check('idempotent replay survives item deletion',!replay.error&&replay.data===first.data,replay);
 await must(owner.from('quiz_links').update({revoked_at:new Date().toISOString()}).eq('id',link));
 const revoked=await anon.rpc('quiz_link_submit_v2',guestArgs);
 check('revoked link rejects replay',revoked.error?.message==='link_unavailable',revoked);
 // Released apps only send p_rows. Shared legacy items have no recoverable course intent.
 await must(owner.from('quiz_items').update({status:'archived'}).eq('id',items[2]));
 const legacyItem=p+'_legacy_item';items.push(legacyItem);
 await must(owner.from('quiz_items').insert({id:legacyItem,unit_id:UNIT,course_id:null,entry_ids:[entries[1]],kind:'t0',format:'mc4',payload:{ask:'Legacy',choices:['A','B','C','D'],answer_index:0,explain:'QA'},source:'owner',status:'active',created_by:owner.uid}));
 await must(admin.from('quiz_assignments').insert({id:legacyAssignment,unit_id:UNIT,course_id:courses[1],user_id:junior.uid,scheduled_on:new Date().toISOString().slice(0,10),sent_at:new Date().toISOString()}));
 const newShared=await junior.rpc('quiz_staff_record_v2',{p_course_id:courses[0],p_request_id:p+'_new_shared',p_rows:[{item_id:legacyItem,response:0}]});
 check('new v2 accepts shared item in explicit course',!newShared.error&&!!newShared.data,newShared);
 const notOther=await junior.rpc('mark_quiz_completed',{p_id:legacyAssignment});
 check('new explicit response does not satisfy other course',!notOther.error&&notOther.data===false,notOther);
 const oldShared=await junior.rpc('quiz_staff_record',{p_rows:[{item_id:legacyItem,response:0}]});
 check('old signature accepts ambiguous shared item',!oldShared.error&&!!oldShared.data,oldShared);
 const legacyDone=await junior.rpc('mark_quiz_completed',{p_id:legacyAssignment});
 check('old shared item can complete matching assignment',!legacyDone.error&&legacyDone.data===true,legacyDone);
 const legacyStats=await owner.rpc('quiz_course_stats');
 check('ambiguous old response not duplicated into other course stats',!legacyStats.error&&!legacyStats.data?.some(r=>r.course_id===courses[1]),legacyStats.error);
}finally{
 for(const [table,col,ids] of [['quiz_attempt_items','item_id',items],['quiz_attempts','entry_id',entries],['quiz_grade_log','item_id',items],['quiz_assignments','id',[assignment,legacyAssignment]],['knowhow_understanding','entry_id',entries],['quiz_links','id',[link]],['quiz_items','id',items],['course_entries','course_id',courses],['training_courses','id',courses],['knowhow_quiz_stats','entry_id',entries],['playbook_entries','id',entries]]){const r=await admin.from(table).delete().in(col,ids);check('cleanup '+table,!r.error,r.error);}
}

console.log('RESULT',failures?'RED':'GREEN','failures='+failures); process.exitCode=failures?1:0;
