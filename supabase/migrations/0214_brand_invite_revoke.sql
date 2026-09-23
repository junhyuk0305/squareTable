-- 0214_brand_invite_revoke.sql — 본사(브랜드) 축 P3 보강: 매장 초대 취소 (2026-09-23, 사용자 결정)
--
-- 0210 은 만료(14일)만 뒀다. 잘못 보낸 번호·마음이 바뀐 초대를 본사가 거둘 길이 없어 점주 앱에 카드가
-- 14일 동안 남는다 → 본사가 **대기 중인 자기 브랜드 초대**만 'revoked' 로 닫는다(status 값은 0210 check 에 이미 있다).
-- 점주 쪽 my_brand_invites 는 status='pending' 만 보므로 취소 즉시 카드가 사라진다. 0213 의 brand_invite 알림 행은
-- 그대로 두되(이미 배달된 푸시는 되돌릴 수 없다) 알림함에서 탭하면 동의 화면이 "기다리는 요청이 없어요"를 말한다.
create or replace function public.brand_revoke_invite(p_invite_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_brand text := (select public.auth_brand_id());
  v_inv   public.brand_invites%rowtype;
begin
  if v_brand is null then raise exception 'not_brand_member'; end if;
  select * into v_inv from public.brand_invites where id = p_invite_id and brand_id = v_brand;
  if v_inv.id is null then raise exception 'invite_invalid'; end if;
  if v_inv.status <> 'pending' then raise exception 'invite_not_pending'; end if;
  update public.brand_invites set status = 'revoked', used_at = now(), used_by = auth.uid() where id = v_inv.id;
  perform public.brand_log(v_brand, null, 'invite_revoked', jsonb_build_object('invite', v_inv.id, 'kind', v_inv.kind));
end $$;
grant execute on function public.brand_revoke_invite(text) to authenticated;
