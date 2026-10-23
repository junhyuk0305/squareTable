-- Local docker only; every fixture and claim rolls back.
begin;
set local session_replication_role = replica;
insert into auth.users(id,email) values
 ('c2000000-0000-4000-8000-000000000001','c2-owner@local.test'),
 ('c2000000-0000-4000-8000-000000000002','c2-staff@local.test'),
 ('c2000000-0000-4000-8000-000000000003','c2-staff2@local.test'),
 ('c2000000-0000-4000-8000-000000000004','c2-foreign@local.test');
insert into public.profiles(id,name,role,unit_id,active_unit_id) values
 ('c2000000-0000-4000-8000-000000000001','owner','owner','qa-c2','qa-c2'),
 ('c2000000-0000-4000-8000-000000000002','staff','junior','qa-c2','qa-c2'),
 ('c2000000-0000-4000-8000-000000000003','staff2','junior','qa-c2','qa-c2'),
 ('c2000000-0000-4000-8000-000000000004','foreign','junior','qa-c2-other','qa-c2-other');
insert into public.units(id,store_name,owner_id) values('qa-c2','C2','c2000000-0000-4000-8000-000000000001'),('qa-c2-other','other','c2000000-0000-4000-8000-000000000004');
insert into public.unit_members(unit_id,user_id,role) select unit_id,id,role from public.profiles where id::text like 'c2000000-%';
set local session_replication_role = origin;
select public.admin_activate_store('qa-c2',1,'multi');
select set_config('request.jwt.claim.sub','c2000000-0000-4000-8000-000000000001',true);
insert into public.work_templates(id,unit_id,text,section,scope,created_by,owner_id,owner_ids)
 values('qa-c2-task','qa-c2','C2 task','open','shared','c2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002',array['c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000003']::uuid[]);
do $$ begin
 if (select count(*) from public.member_notices where unit_id='qa-c2' and kind='assign') <> 2 then raise exception 'C2 new app must queue once per recipient'; end if;
 -- registry taskRoute 와 같은 주소여야 할일 탭이 열린다.
 if exists(select 1 from public.member_notices where unit_id='qa-c2' and kind='assign' and url <> '/junior/work?view=todo&task=qa-c2-task') then raise exception 'C2 url differs from taskRoute'; end if;
 if (select ok from public.push_client_event('c2000000-0000-4000-8000-000000000001','qa-c2',null,'user','assign','qa-c2-task','c2000000-0000-4000-8000-000000000002')) then raise exception 'C2 old app duplicates server'; end if;
end $$;
update public.work_templates set text='C2 retry' where id='qa-c2-task';
do $$ begin
 if (select count(*) from public.member_notices where unit_id='qa-c2' and kind='assign') <> 2 then raise exception 'C2 retry duplicated'; end if;
end $$;
-- A forged cross-store recipient must never be queued, even through a privileged writer.
update public.work_templates set owner_ids='{}',owner_id=null where id='qa-c2-task';
update public.work_templates set owner_ids=array['c2000000-0000-4000-8000-000000000002']::uuid[],owner_id='c2000000-0000-4000-8000-000000000002' where id='qa-c2-task';
do $$ begin
 if (select count(*) from public.member_notices where unit_id='qa-c2' and kind='assign' and claimed_at is null)<>1 then raise exception 'C2 reassignment duplicates pending delivery'; end if;
end $$;
set local session_replication_role = replica;
update public.work_templates set owner_ids=array['c2000000-0000-4000-8000-000000000004']::uuid[],owner_id='c2000000-0000-4000-8000-000000000004' where id='qa-c2-task';
set local session_replication_role = origin;
update public.work_templates set owner_ids=array['c2000000-0000-4000-8000-000000000004']::uuid[] where id='qa-c2-task';
do $$ begin
 if exists(select 1 from public.member_notices where unit_id='qa-c2' and user_id='c2000000-0000-4000-8000-000000000004') then raise exception 'C2 cross-store leak'; end if;
 if exists(select 1 from public.sweep_member_notices() where out_unit_id='qa-c2') then raise exception 'C2 removed assignees still delivered'; end if;
end $$;
rollback;
select 'PASS C2 new/old/retry/multiple/removed/cross-store';
