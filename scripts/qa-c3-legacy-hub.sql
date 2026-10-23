-- Local docker only; every fixture and claim rolls back.
begin;
set local session_replication_role = replica;
insert into auth.users(id,email) values
 ('c3000000-0000-4000-8000-000000000001','c3-owner@local.test'),
 ('c3000000-0000-4000-8000-000000000002','c3-staff@local.test'),
 ('c3000000-0000-4000-8000-000000000003','c3-staff2@local.test'),
 ('c3000000-0000-4000-8000-000000000004','c3-foreign@local.test');
insert into public.profiles(id,name,role,unit_id,active_unit_id) values
 ('c3000000-0000-4000-8000-000000000001','owner','owner','qa-c3','qa-c3'),
 ('c3000000-0000-4000-8000-000000000002','staff','junior','qa-c3','qa-c3'),
 ('c3000000-0000-4000-8000-000000000003','staff2','junior','qa-c3','qa-c3'),
 ('c3000000-0000-4000-8000-000000000004','foreign','junior','qa-c3-other','qa-c3-other');
insert into public.units(id,store_name,owner_id) values('qa-c3','C2','c3000000-0000-4000-8000-000000000001'),('qa-c3-other','other','c3000000-0000-4000-8000-000000000004');
insert into public.unit_members(unit_id,user_id,role) select unit_id,id,role from public.profiles where id::text like 'c3000000-%';
set local session_replication_role = origin;
select public.admin_activate_store('qa-c3',1,'multi');
select set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000001',true);
insert into public.playbook_entries(id,unit_id,category,title) values('qa-c3-entry','qa-c3','qa','C3 entry');
insert into public.training_courses(id,unit_id,key,name,min_items,max_items,active,audience,created_at)
 values('qa-c3-old','qa-c3','old','old',1,10,true,'staff','2026-07-01'),
       ('qa-c3-new','qa-c3','new','new',1,10,true,'staff',now());
insert into public.course_entries(course_id,entry_id,unit_id)
 values('qa-c3-old','qa-c3-entry','qa-c3'),('qa-c3-new','qa-c3-entry','qa-c3');
insert into public.quiz_items(id,unit_id,course_id,entry_ids,kind,format,payload,source,status,created_by)
 select 'qa-c3-item-'||c.key,'qa-c3',c.id,array['qa-c3-entry'],'t0','mc4',
 '{"ask":"C3","choices":["a","b","c","d"],"answer_index":0,"explain":"C3"}'::jsonb,
 'owner','active','c3000000-0000-4000-8000-000000000001'::uuid
 from public.training_courses c where c.unit_id='qa-c3';
insert into public.quiz_assignments(id,unit_id,course_id,user_id,scheduled_on,sent_at)
 values('qa-c3-assignment','qa-c3','qa-c3-new','c3000000-0000-4000-8000-000000000002',current_date,now());
select set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ declare v_home int; v_hub int; begin
 select count(*) into v_home from public.my_legacy_quiz_open();
 if v_home<>1 then raise exception 'C3 old quiz expected 1, got %',v_home; end if;
 select count(*) into v_hub from public.my_units_notif_data() n
  where n.unit_id='qa-c3' and (n.source='legacy_quiz' or (n.source='quiz' and n.payload->>'state'='todo'));
 select v_home+count(*) into v_home from public.quiz_assignment_progress(null) where state='todo';
 if v_hub<>2 or v_home<>v_hub then raise exception 'C3 home % hub %',v_home,v_hub; end if;
 if has_function_privilege('authenticated','public.quiz_legacy_open_courses(text,uuid)','execute') then raise exception 'C3 internal function exposed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000004',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.my_units_notif_data() where unit_id='qa-c3') then raise exception 'C3 other tenant leaked'; end if;
end $$;
reset role;
rollback;
select 'PASS C3 old+new home=hub=2, tenant boundary';
