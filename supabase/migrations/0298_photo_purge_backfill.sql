-- 0298_photo_purge_backfill.sql — 이미 지워진 매장의 남은 사진을 삭제 대기열에 한 번 넣는다 (2026-10-06 · F3 · 0278 에서 분리)
--
-- 올리기 조건: 라이브에서 아래 쿼리로 대상 폴더를 눈으로 확인한 뒤. push 엣지가 대기열을 Storage API 로 지우므로 되돌릴 수 없다.
--   select split_part(name,'/',1) as folder, count(*) from storage.objects o
--    where bucket_id = 'playbook-photos' and name like '%/%'
--      and not exists (select 1 from public.units u where u.id = split_part(o.name,'/',1)) group by 1;
--   → 나온 폴더가 전부 지워진 매장 id 여야 한다(매장 폴더가 아닌 경로가 섞여 있으면 이 파일을 고친다).
-- 옛 앱 호환: 안전 | 서버 데이터 정리만 한다. 클라 호출 없음.

-- 한 번 정리: 이미 지워진 매장(units 에 없는 폴더)의 남은 사진.
insert into public.photo_purge_queue(path)
select o.name
  from storage.objects o
 where o.bucket_id = 'playbook-photos'
   and o.name like '%/%'
   and not exists (select 1 from public.units u where u.id = split_part(o.name, '/', 1))
on conflict (path) do nothing;
