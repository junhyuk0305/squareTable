-- 0020_drop_stale_rw_policies.sql — 잔존 느슨정책(매장단위 for-all) 제거 [보안 수정]
--
-- 배경(qa 발견, 2026-06-30): 0019 적용 후 RLS 런타임 검증에서 T7 누수 발견 —
--   같은 매장 동료(이수민)가 박지원의 private "내 할일"(demo_t_priv_1)을 본다.
--   0019 의 wt_select_scope 술어만 적용되면 이수민은 수학적으로 반드시 제외되는데 보인다
--   → 0019 밖에 "scope/방을 보지 않는" 느슨한 SELECT 정책이 원격에 잔존하여 permissive OR
--      결합으로 0017(private)·0015(방) 격리를 무력화한다는 의미.
--   유력 원인: 0004 의 매장단위 for-all 정책 `*_rw` 가 0007/0013 의 drop 에도 원격에 살아남음.
--
-- 이 마이그레이션: 죽었어야 할 _rw 정책을 멱등 제거한다(보안 강화 방향 — 느슨정책 제거).
--   ⚠️ 현역 _rw 는 절대 건드리지 않는다:
--      work_done_rw(0015/0019 현역) · unknown_queries_rw · chat_queries_rw · playbook_embeddings_rw.
--   제거 대상은 명령별 정식 정책이 SELECT/INSERT/UPDATE/DELETE 를 모두 커버하므로 deny 공백이 없다:
--      work_templates → wt_select_scope/wt_insert/wt_update/wt_delete
--      work_feed      → wf_select/wf_insert/wf_update/wf_delete
--      attendance     → attendance_read/insert/update/delete
--      wages          → wages_read/wages_write
--
-- 성능(0019)과 분리된 "보안 변경"이므로 별도 파일. 적용 후 cso + qa(T7 + 근태/급여/방 격리) 재검증.

drop policy if exists work_templates_rw on public.work_templates;
drop policy if exists work_feed_rw      on public.work_feed;
drop policy if exists attendance_rw     on public.attendance;
drop policy if exists wages_rw          on public.wages;
