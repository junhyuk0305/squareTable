// Real authenticated/anon regression for 0326. Setup/cleanup only uses admin.
// Fixed QA accounts, unique fixtures, no notification dispatch or global signOut.
import {readFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createClient} from '@supabase/supabase-js';
import {FIXED,UNIT as FIXED_UNIT,login,rolePrecondition} from './lib/qa-fixed-accounts.mjs';
import {seedVerifiedPhones,cleanupSeededPhones} from './qa-otp-seed.mjs';
// P0(0327) 문구 표 순수 함수 — 서버 코드가 사람 말로 바뀌는지. 백엔드 전에 돌린다.
{const dir=mkdtempSync(join(tmpdir(),'quiz-errors-'));
 execFileSync(process.execPath,['node_modules/typescript/bin/tsc','src/lib/quiz/errors.ts','--outDir',dir,'--module','commonjs','--target','es2020','--skipLibCheck','--ignoreConfig'],{stdio:'pipe'});
 const {quizErrorMessage}=createRequire(import.meta.url)(join(dir,'errors.js'));
 const last=quizErrorMessage({message:'last_quiz_item'},'x');
 if(!last.includes('마지막 문항')||!last.includes('보관'))throw Error('last_quiz_item copy must say last item and archive: '+last);
 if(quizErrorMessage({message:'quiz_no_items'},'x')==='x')throw Error('quiz_no_items copy missing');
 if(quizErrorMessage({message:'unknown_code'},'x')!=='x'||quizErrorMessage(null,'x')!=='x')throw Error('unknown code must fall back');
 if(/[a-z_]{4,}/.test(last))throw Error('copy leaks a code: '+last);
 console.log('PASS quiz error copy (pure)');}
// --local: 로컬 도커(`npx supabase status` 키)만 친다. .env 를 읽지 않고, 주소가 127.0.0.1 이 아니면 멈춘다.
//          고정 계정 대신 이 실행 전용 사장·직원·매장을 만들고 끝에 지운다. 원격 적용 전 마이그레이션 검증용.
const LOCAL=process.argv.includes('--local');
let url,key,srvKey;
if(LOCAL){const st=Object.fromEntries(execFileSync('npx',['supabase','status','-o','env'],{encoding:'utf8',shell:true,stdio:['ignore','pipe','ignore']}).split('\n').map(l=>l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map(m=>[m[1],m[2]]));
 url=st.API_URL;key=st.ANON_KEY;srvKey=st.SERVICE_ROLE_KEY;
 if(!url||!/^http:\/\/127\.0\.0\.1:/.test(url)){console.error('중단: 로컬 도커 주소가 아니다 —',url);process.exit(2);}
}else{const env={...process.env};
 for(const f of ['.env','.env.seed']) for(const line of readFileSync(new URL('../'+f,import.meta.url),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!env[m[1]])env[m[1]]=m[2].trim();}
 url=env.EXPO_PUBLIC_SUPABASE_URL;key=env.EXPO_PUBLIC_SUPABASE_ANON_KEY;srvKey=env.SUPABASE_SERVICE_ROLE_KEY;}
console.log('TARGET',LOCAL?'local':'remote(.env)',url);
const opt={auth:{persistSession:false,autoRefreshToken:false}};
const admin=createClient(url,srvKey,opt),anon=createClient(url,key,opt);
const stamp=String(Date.now()).slice(-8),localUsers=[],localPhones=['0106','0107'].map(x=>x+stamp.slice(0,7));
let UNIT=FIXED_UNIT,owner,junior;
if(LOCAL){
 const signUp=async(email,meta,phone)=>{const c=createClient(url,key,opt);const {data,error}=await c.auth.signUp({email,password:'Test1234!qa',options:{data:{birth_date:'1990-01-15',phone,...meta}}});if(error||!data.session)throw Error('signUp '+email+': '+(error?.message??'no session'));localUsers.push(data.user.id);c.uid=data.user.id;return c;};
 await seedVerifiedPhones(url,srvKey,localPhones);
 owner=await signUp(`qa_contract_o_${stamp}@example.com`,{name:'QA사장',role:'owner'},localPhones[0]);
 const cs=await owner.rpc('create_store',{p_store_name:'계약 '+stamp,p_industry:'카페·디저트',p_biz_no:null});if(cs.error)throw Error('create_store: '+cs.error.message);
 UNIT=cs.data[0].unit_id;
 await admin.rpc('admin_activate_store',{p_unit_id:UNIT,p_days:1,p_plan:'multi'});
 junior=await signUp(`qa_contract_j_${stamp}@example.com`,{name:'QA직원',role:'junior'},localPhones[1]);
 for(const [c,fn,a] of [[junior,'join_by_invite',{p_code:cs.data[0].invite_code}],[owner,'approve_member',{p_uid:junior.uid}]]){const r=await c.rpc(fn,a);if(r.error)throw Error(fn+': '+r.error.message);}
}else{
 owner=await login(url,key,FIXED.owner);junior=await login(url,key,FIXED.junior);
 const pre=await rolePrecondition({owner,junior});if(pre)throw Error(pre);
}
for(const c of [owner,junior]){const r=await c.rpc('my_units');if(!r.data?.some(x=>x.unit_id===UNIT&&x.is_active))throw Error('Active unit differs; no mutation');}
const p='qa_contract_'+Date.now(),entries=[p+'_e1',p+'_e2'],courses=[p+'_a',p+'_b'],items=[p+'_i1',p+'_i2',p+'_ib'],link=p+'_l',token=crypto.randomUUID().replaceAll('-',''),assignment=p+'_assignment';
const legacyAssignment=p+'_legacy_assignment';
// P0(0327) 0문항 장면 전용 fixture. 위 fixture(전 노하우 × 전 코스)와 섞지 않는다.
const zEntry=p+'_ez',zCourse=p+'_z',zItem=p+'_iz',zAssignment=p+'_z_assignment',zLink=p+'_zl';
const must=async(q)=>{const r=await q;if(r.error)throw Error(r.error.message);return r.data;};
let failures=0; const check=(name,ok,detail)=>{ if(!ok)failures++; console.log(ok?'PASS':'FAIL',name,JSON.stringify(detail??'')); };
const out=(name,v)=>console.log(name,JSON.stringify(v));
try{
 for(const id of [...entries,zEntry]) await must(owner.from('playbook_entries').insert({id,unit_id:UNIT,creator_id:owner.uid,creator_name:'QA',category:'Know-how',subcategory:'일반',title:p,tags:[],search_keywords:[],square:{situation:'마감',action:{steps:['잠근다']},extract:{do:'잠근다',dont:''},result:{before:'',after:'',metric:''},uncover:'',quagmire:''},execution:{tone:'친절',timing:'마감',channel:'구두',stakeholders:[]},stats:{thumbs_up:0,thumbs_down:0,last_used_at:new Date().toISOString(),query_hits_30d:0,resolution_rate:0},photos:[],version:1,status:'published',quality_score:0.6,is_template:false,needs_review:false,correction_points:[],order_index:0}));
 for(const id of courses)await must(owner.from('training_courses').insert({id,unit_id:UNIT,key:id,name:p,min_items:1,max_items:10,position:0,active:true,audience:'guest',start_at:null}));
 for(const course_id of courses)for(const entry_id of entries)await must(owner.from('course_entries').insert({course_id,entry_id,unit_id:UNIT}));
 for(let i=0;i<items.length;i++)await must(owner.from('quiz_items').insert({id:items[i],unit_id:UNIT,course_id:i===2?courses[1]:courses[0],entry_ids:i===0?entries:[entries[0]],kind:'t0',format:'mc4',payload:{ask:p,choices:['정답','오답','다른 답','모름'],answer_index:0,explain:'QA'},source:'owner',status:'active',created_by:owner.uid}));
 await must(owner.from('quiz_links').insert({id:link,course_id:courses[0],unit_id:UNIT,token,expires_at:new Date(Date.now()+3600000).toISOString(),created_by:owner.uid}));
 // ── P0(0327) 문항 0개 퀴즈는 존재할 수 없다 ──
 await must(owner.from('training_courses').insert({id:zCourse,unit_id:UNIT,key:zCourse,name:p+' zero',min_items:1,max_items:10,position:0,active:true,audience:'staff',start_at:null}));
 await must(owner.from('course_entries').insert({course_id:zCourse,entry_id:zEntry,unit_id:UNIT}));
 await must(owner.from('quiz_items').insert({id:zItem,unit_id:UNIT,course_id:zCourse,entry_ids:[zEntry],kind:'t0',format:'mc4',payload:{ask:p,choices:['정답','오답','다른 답','모름'],answer_index:0,explain:'QA'},source:'owner',status:'active',created_by:owner.uid}));
 const lastEntry=await owner.from('course_entries').delete().eq('course_id',zCourse).eq('entry_id',zEntry).select('entry_id');
 check('last knowhow removal is last_quiz_item',lastEntry.error?.message==='last_quiz_item',lastEntry.error??lastEntry.data);
 const lastItem=await owner.from('quiz_items').delete().eq('id',zItem).select('id');
 check('last item delete is last_quiz_item (draft too)',lastItem.error?.message==='last_quiz_item',lastItem.error??lastItem.data);
 const lastArchive=await owner.from('quiz_items').update({status:'archived'}).eq('id',zItem).select('id');
 check('last item archive is last_quiz_item',lastArchive.error?.message==='last_quiz_item',lastArchive.error??lastArchive.data);
 await must(admin.from('quiz_assignments').insert({id:zAssignment,unit_id:UNIT,course_id:zCourse,user_id:junior.uid,scheduled_on:new Date().toISOString().slice(0,10),sent_at:new Date(Date.now()-60000).toISOString()}));
 // 보낸 퀴즈의 유일 노하우 보관은 막지 않는다(사장은 노하우를 보관할 수 있어야 한다). 대신 그 퀴즈가 멈춘다.
 const archived=await owner.rpc('archive_knowhow',{p_entry_id:zEntry,p_archived:true});
 check('archiving the only knowhow of a sent quiz is allowed',!archived.error,archived.error);
 const zProg=await junior.rpc('quiz_assignment_progress',{p_course_id:zCourse});
 const zRow=zProg.data?.find(r=>r.assignment_id===zAssignment);
 check('0-item assignment has total 0 (not a quiz to do)',!zProg.error&&(!zRow||zRow.total_items===0),zProg.error??zRow);
 const zDone=await junior.rpc('mark_quiz_completed',{p_id:zAssignment});
 check('0-item assignment never completes',!zDone.error&&zDone.data===false,zDone);
 const zSend=await owner.from('quiz_assignments').insert({id:zAssignment+'_2',unit_id:UNIT,course_id:zCourse,user_id:junior.uid,scheduled_on:new Date(Date.now()+86400000).toISOString().slice(0,10)}).select('id');
 check('owner cannot send a 0-item quiz',zSend.error?.message==='quiz_no_items',zSend.error??zSend.data);
 const zL=await owner.from('quiz_links').insert({id:zLink,course_id:zCourse,unit_id:UNIT,token:crypto.randomUUID().replaceAll('-',''),expires_at:new Date(Date.now()+3600000).toISOString(),created_by:owner.uid}).select('id');
 check('owner cannot open a link for a 0-item quiz',zL.error?.message==='quiz_no_items',zL.error??zL.data);
 const staff=await junior.rpc('quiz_staff_record',{p_rows:[{item_id:items[0],response:0,ord:0},{item_id:items[1],response:1,ord:1}]});out('staff_record',staff);
 out('owner_staff_rows',await must(owner.from('quiz_attempts').select('course_id,total,correct,submission_id').in('entry_id',entries)));
 const person=await owner.rpc('quiz_course_person',{p_course_id:courses[0],p_staff_id:junior.uid}); check('person is 1/2',!person.error&&person.data?.[0]?.asked===2&&person.data?.[0]?.correct===1,person);
 const stats=await owner.rpc('quiz_course_stats');const stat=stats.data?.find(r=>r.course_id===courses[0]);check('C5 self-only old stats are zero',!stats.error&&stat?.submissions===0&&stat?.asked===0&&stat?.correct===0,stat);
 out('anon_servable',await anon.rpc('quiz_link_items',{p_token:token}));
 const crossGrade=await anon.rpc('quiz_link_grade',{p_token:token,p_item_id:items[2],p_response:0});check('cross-course grade denied',!!crossGrade.error,crossGrade);
 const crossSubmit=await anon.rpc('quiz_link_submit',{p_token:token,p_guest_name:p,p_guest_phone:null,p_phone_verified:false,p_answers:[{item_id:items[2],response:0}]});check('cross-course submit rejected',!!crossSubmit.error||crossSubmit.data===0,crossSubmit);
 out('owner_cross_course_record',await must(owner.from('quiz_attempts').select('course_id,total,correct,guest_name').eq('course_id',courses[0])));
 // 발송 시각은 서버 시계로 잡는다. PC 시계가 앞서면 발송 뒤 답이 발송 전으로 보여 RED가 난다.
 const serverAfterLastAnswer=async()=>{const r=await must(owner.from('quiz_attempt_items').select('created_at').in('item_id',items).order('created_at',{ascending:false}).limit(1));return new Date(Date.parse(r[0].created_at)+1).toISOString();};
 // A fresh assignment cannot use the earlier attempt or global understanding as completion.
 await must(admin.from('quiz_assignments').insert({id:assignment,unit_id:UNIT,course_id:courses[0],user_id:junior.uid,scheduled_on:new Date().toISOString().slice(0,10),sent_at:await serverAfterLastAnswer()}));
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
 check('history score remains per-item after deletion, self excluded',!historyStats.error&&historyStat?.asked===4&&historyStat?.correct===2,historyStats.error??historyStat);
 const replay=await junior.rpc('quiz_staff_record_v2',request);
 check('idempotent replay survives item deletion',!replay.error&&replay.data===first.data,replay);
 await must(owner.from('quiz_links').update({revoked_at:new Date().toISOString()}).eq('id',link));
 const revoked=await anon.rpc('quiz_link_submit_v2',guestArgs);
 check('revoked link rejects replay',revoked.error?.message==='link_unavailable',revoked);
 // 0329: 공유 문항(course_id null)은 만들 수 없다. 0329 전(0327)에는 이 장면만 RED 가 정상이다.
 const sharedItem=p+'_shared_item';items.push(sharedItem);
 const shared=await owner.from('quiz_items').insert({id:sharedItem,unit_id:UNIT,course_id:null,entry_ids:[entries[1]],kind:'t0',format:'mc4',payload:{ask:'Shared',choices:['A','B','C','D'],answer_index:0,explain:'QA'},source:'owner',status:'active',created_by:owner.uid}).select('id');
 check('shared item (course_id null) insert is rejected',!!shared.error,shared.error??shared.data);
 // 거부되지 않았으면 바로 지운다. 아래 장면이 공유 문항에 끌려가지 않게 한다.
 if(!shared.error)await must(admin.from('quiz_items').delete().eq('id',sharedItem));
 // Released apps only send p_rows. 옛 클라 흐름은 B 에 속한 문항으로 본다.
 const legacyItem=p+'_legacy_item';items.push(legacyItem);
 await must(owner.from('quiz_items').insert({id:legacyItem,unit_id:UNIT,course_id:courses[1],entry_ids:[entries[1]],kind:'t0',format:'mc4',payload:{ask:'Legacy',choices:['A','B','C','D'],answer_index:0,explain:'QA'},source:'owner',status:'active',created_by:owner.uid}));
 // 0327: B의 유일 문항(ib)은 다른 문항이 생긴 뒤에야 뺄 수 있다. 그래서 B 문항을 먼저 넣는다.
 await must(owner.from('quiz_items').update({status:'archived'}).eq('id',items[2]));
 await must(admin.from('quiz_assignments').insert({id:legacyAssignment,unit_id:UNIT,course_id:courses[1],user_id:junior.uid,scheduled_on:new Date().toISOString().slice(0,10),sent_at:await serverAfterLastAnswer()}));
 const statsBefore=(await owner.rpc('quiz_course_stats')).data?.find(r=>r.course_id===courses[0]);
 const newOther=await junior.rpc('quiz_staff_record_v2',{p_course_id:courses[0],p_request_id:p+'_new_other',p_rows:[{item_id:legacyItem,response:0}]});
 check('new v2 drops item of another course',!newOther.error&&newOther.data===null,newOther);
 const notOther=await junior.rpc('mark_quiz_completed',{p_id:legacyAssignment});
 check('dropped response does not satisfy other course',!notOther.error&&notOther.data===false,notOther);
 const oldRec=await junior.rpc('quiz_staff_record',{p_rows:[{item_id:legacyItem,response:0}]});
 check('old signature accepts course item',!oldRec.error&&!!oldRec.data,oldRec);
 const legacyDone=await junior.rpc('mark_quiz_completed',{p_id:legacyAssignment});
 check('old client flow completes matching assignment',!legacyDone.error&&legacyDone.data===true,legacyDone);
 const legacyStats=await owner.rpc('quiz_course_stats');
 const aAfter=legacyStats.data?.find(r=>r.course_id===courses[0]);
 check('B response not counted into A stats',!legacyStats.error&&aAfter?.asked===statsBefore?.asked&&aAfter?.correct===statsBefore?.correct,{before:statsBefore,after:aAfter});
 // ── 0334 "혼자 할 수 있어요" 출제 범위(10-23 사용자): 새 앱(quiz_self_items_for)만 발송된 퀴즈 문항도 낸다.
 //   출시 앱 경로(코스 없는 quiz_items_for)는 0332 그대로 발송 퀴즈 문항 0개 — 출시 앱 자청 답은 옛 서명이라 퀴즈와 구분이 안 된다(Q1).
 const sentCourseIds=new Set((await must(admin.from('quiz_assignments').select('course_id').eq('unit_id',UNIT).not('sent_at','is',null))).map(r=>r.course_id));
 const itemCourse=new Map((await must(admin.from('quiz_items').select('id,course_id').eq('unit_id',UNIT))).map(r=>[r.id,r.course_id]));
 const oldPick=await junior.rpc('quiz_items_for',{p_entry_ids:entries,p_limit:20,p_course_id:null});
 check('released-app self path offers 0 items of sent quizzes',!oldPick.error&&!(oldPick.data??[]).some(r=>sentCourseIds.has(itemCourse.get(r.id))),oldPick.error??oldPick.data?.map(r=>r.id));
 //   새 앱 자청(v2 · 코스 없음) = self_check · source 'self'. 출시 앱 옛 서명(quiz_staff_record)은 문항의 퀴즈로 귀속(0332 그대로).
 const selfPick=await junior.rpc('quiz_self_items_for',{p_entry_ids:[entries[1]],p_limit:20});
 check('new-app self path offers items of a sent quiz',!selfPick.error&&selfPick.data?.some(r=>r.id===legacyItem),selfPick.error??selfPick.data?.map(r=>r.id));
 await must(admin.from('quiz_assignments').insert({id:legacyAssignment+'_2',unit_id:UNIT,course_id:courses[1],user_id:junior.uid,scheduled_on:new Date(Date.now()+86400000).toISOString().slice(0,10),sent_at:await serverAfterLastAnswer()}));
 const bStatsBefore=(await owner.rpc('quiz_course_stats')).data?.find(r=>r.course_id===courses[1]);
 const selfRec=await junior.rpc('quiz_staff_record_v2',{p_course_id:null,p_request_id:p+'_self',p_rows:[{item_id:legacyItem,response:0,ord:0}]});
 const selfRows=selfRec.data?await must(owner.from('quiz_attempt_items').select('self_check,source,course_id').eq('submission_id',selfRec.data)):[];
 check('new-app self answer on a sent-quiz item is saved as self',!selfRec.error&&!!selfRec.data&&selfRows.length===1&&selfRows[0].self_check===true&&selfRows[0].source==='self',{selfRec,selfRows});
 const selfProg=(await junior.rpc('quiz_assignment_progress',{p_course_id:courses[1]})).data?.find(r=>r.assignment_id===legacyAssignment+'_2');
 check('self answer does not move quiz progress',selfProg?.answered_items===0&&selfProg?.state==='todo',selfProg);
 const selfDone=await junior.rpc('mark_quiz_completed',{p_id:legacyAssignment+'_2'});
 check('self answer does not complete the quiz',!selfDone.error&&selfDone.data===false,selfDone);
 const bStatsSelf=(await owner.rpc('quiz_course_stats')).data?.find(r=>r.course_id===courses[1]);
 check('C5 self answer excluded from old stats columns',bStatsSelf?.submissions===bStatsBefore?.submissions&&bStatsSelf?.asked===bStatsBefore?.asked&&bStatsSelf?.correct===bStatsBefore?.correct,{before:bStatsBefore,after:bStatsSelf});
 check('self answer not in quiz rate (first_asked)',bStatsSelf?.first_asked===bStatsBefore?.first_asked&&bStatsSelf?.first_correct===bStatsBefore?.first_correct,{before:bStatsBefore,after:bStatsSelf});
 const oldRec2=await junior.rpc('quiz_staff_record',{p_rows:[{item_id:legacyItem,response:0}]});
 const oldRows2=oldRec2.data?await must(owner.from('quiz_attempt_items').select('self_check,source,course_id').eq('submission_id',oldRec2.data)):[];
 check('released-app old signature on a sent-quiz item stays quiz-attributed',!oldRec2.error&&oldRows2.length===1&&oldRows2[0].self_check===false&&oldRows2[0].source==='assignment'&&oldRows2[0].course_id===courses[1],{oldRec2,oldRows2});
 const oldProg2=(await junior.rpc('quiz_assignment_progress',{p_course_id:courses[1]})).data?.find(r=>r.assignment_id===legacyAssignment+'_2');
 check('old signature answer moves quiz progress',oldProg2?.answered_items===1,oldProg2);
 // 0334 ③ 카드 "지난번 퀴즈": 내 마지막 퀴즈 제출(자청 제외)의 문항별 맞힘만. 사장 세션은 자기 제출이 없어 0행.
 await junior.rpc('quiz_staff_record_v2',{p_course_id:null,p_request_id:p+'_self2',p_rows:[{item_id:legacyItem,response:1,ord:0}]});
 const lastSub=await junior.rpc('quiz_my_last_submissions',{p_course_ids:[courses[1]]});
 check('last submission = latest quiz submission, self excluded, no answer payload',!lastSub.error&&lastSub.data?.length===1&&lastSub.data[0].submission_id===oldRec2.data&&lastSub.data[0].correct===true&&!('payload' in lastSub.data[0]),lastSub.error??lastSub.data);
 const lastSubOwner=await owner.rpc('quiz_my_last_submissions',{p_course_ids:[courses[1]]});
 check('last submission is mine only',!lastSubOwner.error&&lastSubOwner.data?.length===0,lastSubOwner.error??lastSubOwner.data);
 // 0334 검증 후속: 새 앱 자청도 보관(비활성) 퀴즈의 문항은 내지 않고 받지 않는다(quiz_course_live).
 await must(owner.from('training_courses').update({active:false}).eq('id',courses[1]));
 const archPick=await junior.rpc('quiz_self_items_for',{p_entry_ids:entries,p_limit:20});
 check('new-app self path skips items of an archived quiz',!archPick.error&&!(archPick.data??[]).some(r=>itemCourse.get(r.id)===courses[1]),archPick.error??archPick.data?.map(r=>r.id));
 const archRec=await junior.rpc('quiz_staff_record_v2',{p_course_id:null,p_request_id:p+'_self_arch',p_rows:[{item_id:legacyItem,response:0,ord:0}]});
 check('new-app self submit of an archived-quiz item saves nothing',!archRec.error&&archRec.data===null,archRec);
}finally{
 const zItems=[...items,zItem],zEntries=[...entries,zEntry],zCourses=[...courses,zCourse];
 for(const [table,col,ids] of [['quiz_attempt_items','item_id',zItems],['quiz_attempts','entry_id',zEntries],['quiz_grade_log','item_id',zItems],['quiz_assignments','id',[assignment,legacyAssignment,legacyAssignment+'_2',zAssignment,zAssignment+'_2']],['knowhow_understanding','entry_id',zEntries],['quiz_links','id',[link,zLink]],['quiz_items','id',zItems],['course_entries','course_id',zCourses],['training_courses','id',zCourses],['knowhow_quiz_stats','entry_id',zEntries],['playbook_entries','id',zEntries]]){const r=await admin.from(table).delete().in(col,ids);check('cleanup '+table,!r.error,r.error);}
 if(LOCAL){
  if(UNIT!==FIXED_UNIT){const r=await admin.from('units').delete().eq('id',UNIT);check('cleanup units',!r.error,r.error);}
  for(const id of localUsers){const r=await admin.auth.admin.deleteUser(id);check('cleanup user',!r.error,r.error);}
  await cleanupSeededPhones(url,srvKey,localPhones).catch(()=>{});
 }
}

console.log('RESULT',failures?'RED':'GREEN','failures='+failures); process.exitCode=failures?1:0;
