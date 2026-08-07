-- 0121_owner_scoped_knowhow.sql — 노하우 읽기·쓰기의 **계정 스코프** 경로
--
-- ── 배경(§① 증상 → 구조) ─────────────────────────────────────────────────────
-- 사장의 권한 근거는 `units.owner_id = auth.uid()` 이고 이건 **매장 전체를 덮는다**.
-- 그런데 playbook_entries 의 RLS 는 읽기·쓰기 둘 다 `unit_id = auth_unit_id()` 인데,
-- `auth_unit_id()` = `profiles.active_unit_id` = **"지금 보고 있는 매장"이라는 UI 상태**다.
-- 즉 UI 상태가 권한 정책에 박혀 있다. 층이 어긋난 것이지 사장 권한이 좁은 게 아니다.
-- 그래서 허브(계정 층)에서 "매장을 고르고 전환한다 / 끝나면 되돌린다"는 해법이 아니라
-- **잘못된 층에 맞춘 땜질**이다.
--
-- ── 왜 RLS 를 넓히지 않고 definer 함수를 더하는가 ────────────────────────────
-- 정책을 `owner_id = auth.uid()` 까지 넓히면 **읽기가 조용히 오염된다**:
-- `fetchEntries()`(db.ts)는 unit 필터가 없고 RLS 에 전적으로 기대므로, 정책이 넓어지는 순간
-- 매장 앱의 모든 노하우 화면에 다른 매장 노하우가 섞여 들어온다. 그건 이 작업의 목표가 아니다.
-- definer 함수는 **덧셈만 있고 뺄셈이 없다** — 기존 경로가 1mm 도 안 바뀐다(0120 과 같은 판단).
--
-- ── 격리/보안(db-rls 규칙) ───────────────────────────────────────────────────
-- ★ 쓰기 함수의 유일한 방어선은 아래 `owner_id = auth.uid()` 검사 **한 줄**이다.
--   이게 빠지면 남의 매장에 쓰는 구멍이 된다. 함수 본문을 고칠 때 이 블록을 절대 지우지 말 것.
-- ★ 대상 매장은 **인자(p_unit_id)가 정한다.** 본문(p_entry)이 unit_id 를 뭐라고 하든 덮어쓴다 —
--   본문이 대상을 정할 수 있으면 소유 검사를 통과한 뒤 다른 매장에 쓰는 우회로가 생긴다.
-- ★ 활성 매장(profiles.active_unit_id)은 **건드리지 않는다.** 다른 탭의 맥락이 따라 움직이면 안 된다.
-- 검증: `/cso` + scripts/qa-owner-scoped-knowhow.mjs (서로 다른 계정의 매장에 못 쓰는지 실증).

-- ── 읽기: 소유 매장 전체의 발행 노하우 ───────────────────────────────────────
-- 행이 unit_id 를 들고 있으므로 묶음은 화면이 한다(RPC 가 표현을 정하지 않는다).
-- 노출 범위 = 소유 매장의 published. 초안·검토중은 넘기지 않는다 —
-- 허브는 훑어보는 층이고, 검수는 매장 앱(handover)이 담당한다.
create or replace function public.owner_knowhow_entries()
returns setof public.playbook_entries
language sql stable security definer set search_path = public as $$
  select e.*
  from public.units u
  join public.playbook_entries e on e.unit_id = u.id and e.status = 'published'
  where u.owner_id = (select auth.uid())      -- ★소유 매장만(owner_overview 와 같은 방어선)
    and u.deleted_at is null
  order by e.created_at desc
$$;

grant execute on function public.owner_knowhow_entries() to authenticated;

-- ── 쓰기: 소유 매장 중 **인자가 가리키는** 매장에 노하우 한 건 ────────────────
create or replace function public.owner_insert_knowhow(p_unit_id text, p_entry jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_defaults jsonb;
  v_in       jsonb;
  v_row      public.playbook_entries%rowtype;
begin
  -- ★★ 유일한 방어선. 지우지 말 것.
  if not exists (
    select 1 from public.units u
     where u.id = p_unit_id
       and u.owner_id = (select auth.uid())
       and u.deleted_at is null
  ) then
    raise exception 'not_owner';
  end if;

  -- 본문이 객체가 아니면 아래 jsonb_each 가 원시 에러를 던진다(cannot deconstruct an array).
  -- 소유 검사 뒤라 누출은 없지만, 실패 모드는 우리 말로 나가야 한다(/cso M1).
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'bad_entry';
  end if;

  -- not null 컬럼의 기본값 — jsonb_populate_record 는 없는 키를 NULL 로 채우므로
  -- 컬럼 default 가 발동하지 않는다(명시적 NULL 은 default 를 타지 않는다).
  v_defaults := jsonb_build_object(
    'tags', '[]'::jsonb, 'search_keywords', '[]'::jsonb,
    'square', '{}'::jsonb, 'execution', '{}'::jsonb, 'stats', '{}'::jsonb,
    'photos', '[]'::jsonb, 'version', 1, 'status', 'published', 'quality_score', 0,
    'is_template', false, 'needs_review', false, 'correction_points', '[]'::jsonb,
    'order_index', 0, 'created_at', now(), 'updated_at', now()
  );

  -- 클라 전용 필드(source)는 컬럼이 아니다 — db.ts stripNonColumns 와 같은 규칙.
  -- unit_id 는 아래에서 인자로 덮으므로 여기서 미리 뺀다.
  -- not null 컬럼 키가 명시적 null 로 들어오면 그 키를 버려 기본값이 살아나게 한다.
  select coalesce(jsonb_object_agg(t.k, t.v), '{}'::jsonb)
    into v_in
    from jsonb_each(p_entry - 'source' - 'unit_id') as t(k, v)
   where not (t.v = 'null'::jsonb and v_defaults ? t.k);

  v_row := jsonb_populate_record(
             null::public.playbook_entries,
             v_defaults || v_in || jsonb_build_object('unit_id', p_unit_id)
           );
  -- 저자는 언제나 호출자다 — 본문이 남을 저자로 적어 보내는 것을 받아주지 않는다.
  v_row.creator_id := (select auth.uid())::text;

  -- not null 컬럼 중 기본값을 줄 수 없는 셋(무엇을 쓰는지는 호출부만 안다)은 같은 잣대로 검증한다 —
  -- 하나만 빠뜨리면 그 컬럼만 원시 not-null 위반으로 새어 나간다(/cso M2).
  if v_row.id is null or v_row.id = '' then raise exception 'missing_id'; end if;
  if v_row.title is null or v_row.title = '' then raise exception 'missing_title'; end if;
  if v_row.category is null or v_row.category = '' then raise exception 'missing_category'; end if;

  insert into public.playbook_entries values (v_row.*);
  return v_row.id;
end $$;

grant execute on function public.owner_insert_knowhow(text, jsonb) to authenticated;
