// src/lib/otp.ts — 전화번호 SMS 인증(엣지 'otp') 클라이언트 + 화면용 훅.
// 가입 전(무세션) 호출이라 anon 키만 쓴다. 인증의 최종 강제는 서버 게이트(migrations/_hold/0088)가
// 하고, 여기(UI)는 첫 번째 겹이다.
// ★ supabase.functions.invoke 금지 — 브라우저에서 x-client-info 헤더가 자동 부착돼 엣지 CORS
//   프리플라이트가 실패한다(push/notify.ts 에서 라이브 계측으로 확인된 함정 — 동일한 raw fetch 패턴).
import { useEffect, useState } from 'react';
import { otherRoleText } from '@/lib/account/copy';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const OTP_ENDPOINT = `${SUPABASE_URL}/functions/v1/otp`;

export const OTP_RESEND_SECONDS = 60;

type OtpReason =
  | 'cooldown' | 'daily_cap' | 'rate_limited' | 'expired' | 'mismatch'
  | 'too_many' | 'invalid_phone' | 'not_configured' | 'send_failed' | 'network'
  // reset_password(2026-09-23) 전용
  | 'no_account' | 'weak_password'
  // change_phone(0238 Q13) 전용
  | 'phone_taken' | 'unauthorized';

// "N초 후"를 사람이 읽는 단위로. 90초를 "90초"라고 말하면 길게 느껴진다.
function waitText(sec: number): string {
  if (sec >= 3600) return `${Math.ceil(sec / 3600)}시간`;
  if (sec >= 60) return `${Math.ceil(sec / 60)}분`;
  return `${sec}초`;
}

// 에러 문구 — 무슨 일 + 뭘 하면 되는지(simplicity-voice §5). 기술 용어 금지.
// ★ 막힌 경우엔 **남은 시간**을 말한다 — 서버가 retry_after_sec 를 주므로(2026-08-11 QA P1-#3),
//   "잠시 후"로 뭉개면 사용자는 얼마나 기다릴지 몰라 계속 누른다.
function reasonMsg(reason: OtpReason, retryAfterSec: number | null): string {
  const after = retryAfterSec && retryAfterSec > 0 ? waitText(retryAfterSec) : null;
  switch (reason) {
    case 'cooldown':
      return after
        ? `방금 보낸 인증번호가 있어요. ${after} 후에 다시 받을 수 있어요.`
        : '방금 보낸 인증번호가 있어요. 잠시 후 다시 받아주세요.';
    case 'daily_cap':
      return after
        ? `오늘 받을 수 있는 인증번호를 다 썼어요. ${after} 후에 다시 시도해 주세요.`
        : '오늘 받을 수 있는 인증번호를 다 썼어요. 내일 다시 시도해 주세요.';
    case 'rate_limited':
      return `요청이 잠시 몰렸어요. ${after ?? '1분'} 후 다시 시도해 주세요.`;
    case 'expired':
      return '인증번호가 만료됐어요. 다시 받아주세요.';
    case 'mismatch':
      return '인증번호가 맞지 않아요. 다시 확인해 주세요.';
    case 'too_many':
      return '틀린 횟수가 많아요. 인증번호를 다시 받아주세요.';
    case 'invalid_phone':
      return '전화번호 형식을 확인해주세요.';
    case 'not_configured':
      return '지금은 인증번호를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.';
    case 'send_failed':
      return '문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요.';
    case 'network':
      return '연결 문제로 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
    case 'no_account':
      return '이 번호로 가입된 계정이 없어요. 사장님/직원 선택과 번호를 확인해 주세요.';
    case 'weak_password':
      return '비밀번호는 9자 이상이어야 해요.';
    case 'phone_taken':
      return '이미 다른 계정이 쓰는 번호예요. 다른 번호를 입력해 주세요.';
    case 'unauthorized':
      return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  }
}

// accessToken: 로그인한 사용자의 토큰. change_phone 은 이것으로 본인을 확인한다(없으면 401). 나머지는 anon 키.
async function callOtp(
  body: { action: 'send' | 'verify' | 'reset_password' | 'change_phone'; phone: string; code?: string; role?: 'owner' | 'junior'; new_password?: string },
  accessToken?: string,
): Promise<{ ok: boolean; reason: OtpReason | null; retryAfterSec: number | null; otherRole: string | null }> {
  try {
    const res = await fetch(OTP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${accessToken ?? ANON}` },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; reason?: string; retry_after_sec?: number; other_role?: string }
      | null;
    if (res.ok && j?.ok) return { ok: true, reason: null, retryAfterSec: null, otherRole: null };
    return {
      ok: false,
      reason: (j?.reason as OtpReason) ?? 'network',
      retryAfterSec: typeof j?.retry_after_sec === 'number' ? j.retry_after_sec : null,
      otherRole: typeof j?.other_role === 'string' ? j.other_role : null,
    };
  } catch {
    return { ok: false, reason: 'network', retryAfterSec: null, otherRole: null };
  }
}

/**
 * 비밀번호 재설정(전화번호 인증, 2026-09-23) — 인증번호 + 새 비밀번호를 한 번에 보낸다.
 * 서버가 코드를 대조하고(verify 와 같은 규칙) 그 번호·역할 계정의 비밀번호를 바꾼다. 코드는 한 번 쓰면 만료.
 * 성공이면 message 는 null. 실패면 사람이 읽는 이유 한 줄.
 */
export async function resetPasswordByPhone(args: {
  phone: string;
  code: string;
  role: 'owner' | 'junior';
  newPassword: string;
}): Promise<{ ok: boolean; message: string | null }> {
  const r = await callOtp({ action: 'reset_password', phone: args.phone, code: args.code, role: args.role, new_password: args.newPassword });
  if (r.ok) return { ok: true, message: null };
  // Q18(0238): 고른 역할에는 계정이 없고 다른 역할에 있으면 그 역할을 알려 준다. 엣지는 이때 코드를 소모하지 않는다.
  const other = r.reason === 'no_account' ? otherRoleText(r.otherRole) : null;
  return { ok: false, message: other ?? reasonMsg(r.reason ?? 'network', r.retryAfterSec) };
}

/**
 * 번호 바꾸기(0238 Q13) — 새 번호로 받은 인증번호를 로그인 토큰과 함께 보낸다.
 * 엣지가 코드를 대조하고 같은 가입 역할의 다른 계정이 그 번호를 쓰지 않으면 profiles.phone 을 바꾼다.
 * ★verify 를 먼저 부르지 않는다. verify 가 코드를 소모해서 이어서 부르는 change_phone 이 expired 가 된다.
 */
export async function changePhoneByOtp(args: {
  phone: string;
  code: string;
  accessToken: string;
}): Promise<{ ok: boolean; message: string | null }> {
  const r = await callOtp({ action: 'change_phone', phone: args.phone, code: args.code }, args.accessToken);
  return { ok: r.ok, message: r.ok ? null : reasonMsg(r.reason ?? 'network', r.retryAfterSec) };
}

// 화면용 훅 — normalizePhone 된 번호를 받는다. 번호가 바뀌면 sent/verified 가 자동으로 풀린다
// (발송·인증 당시 번호와 현재 번호를 비교하므로 별도 리셋 코드가 필요 없다).
export function usePhoneOtp(normalizedPhone: string) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [verifiedTo, setVerifiedTo] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const send = async () => {
    if (busy) return;
    setMsg(null);
    setBusy('send');
    const r = await callOtp({ action: 'send', phone: normalizedPhone });
    setBusy(null);
    if (r.ok) {
      setSentTo(normalizedPhone);
      setCountdown(OTP_RESEND_SECONDS);
    } else {
      setMsg(reasonMsg(r.reason ?? 'network', r.retryAfterSec));
      // ★ 서버가 "아직 기다려야 한다"고 하면 버튼 카운트다운을 서버 값으로 되살린다.
      //   카운트다운은 원래 이 브라우저에서 방금 보낸 경우에만 존재해서, 새로고침·다른 기기로 오면
      //   버튼이 '인증번호 받기'로 보이고 눌러도 막연히 실패했다(2026-08-11 QA P1-#3).
      //   daily_cap 은 단위가 시간이라 카운트다운으로 세지 않는다 — 문구로만 말한다.
      if ((r.reason === 'cooldown' || r.reason === 'rate_limited') && r.retryAfterSec && r.retryAfterSec > 0) {
        setCountdown(Math.min(r.retryAfterSec, OTP_RESEND_SECONDS));
      }
    }
  };

  // ★성공 여부를 돌려준다 — 호출부가 인증 직후 이어서 해야 할 일(예: profiles.phone 반영)을
  //   상태 반영을 기다리지 않고 그 자리에서 할 수 있게. setVerifiedTo 는 다음 렌더에야 보인다.
  const verify = async (code: string): Promise<boolean> => {
    if (busy || !sentTo) return false;
    setMsg(null);
    setBusy('verify');
    const r = await callOtp({ action: 'verify', phone: sentTo, code });
    setBusy(null);
    if (r.ok) setVerifiedTo(sentTo);
    else setMsg(reasonMsg(r.reason ?? 'network', r.retryAfterSec));
    return r.ok;
  };

  // 서버가 인증을 더는 인정하지 않을 때(PHONE_NOT_VERIFIED) 화면을 '인증번호 받기' 단계로 되돌린다.
  const reset = () => {
    setSentTo(null);
    setVerifiedTo(null);
  };

  return {
    sent: sentTo === normalizedPhone,
    verified: verifiedTo === normalizedPhone,
    countdown,
    busy,
    msg,
    send,
    verify,
    reset,
  };
}
