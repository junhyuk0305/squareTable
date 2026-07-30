// src/lib/otp.ts — 전화번호 SMS 인증(엣지 'otp') 클라이언트 + 화면용 훅.
// 가입 전(무세션) 호출이라 anon 키만 쓴다. 인증의 최종 강제는 서버 게이트(migrations/_hold/0088)가
// 하고, 여기(UI)는 첫 번째 겹이다.
// ★ supabase.functions.invoke 금지 — 브라우저에서 x-client-info 헤더가 자동 부착돼 엣지 CORS
//   프리플라이트가 실패한다(push/notify.ts 에서 라이브 계측으로 확인된 함정 — 동일한 raw fetch 패턴).
import { useEffect, useState } from 'react';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const OTP_ENDPOINT = `${SUPABASE_URL}/functions/v1/otp`;

export const OTP_RESEND_SECONDS = 60;

type OtpReason =
  | 'cooldown' | 'daily_cap' | 'rate_limited' | 'expired' | 'mismatch'
  | 'too_many' | 'invalid_phone' | 'not_configured' | 'send_failed' | 'network';

// 에러 문구 — 무슨 일 + 뭘 하면 되는지(simplicity-voice §5). 기술 용어 금지.
const REASON_MSG: Record<OtpReason, string> = {
  cooldown: '방금 보낸 인증번호가 있어요. 잠시 후 다시 받아주세요.',
  daily_cap: '오늘 받을 수 있는 인증번호를 다 썼어요. 내일 다시 시도해 주세요.',
  rate_limited: '요청이 잠시 몰렸어요. 1분 후 다시 시도해 주세요.',
  expired: '인증번호가 만료됐어요. 다시 받아주세요.',
  mismatch: '인증번호가 맞지 않아요. 다시 확인해 주세요.',
  too_many: '틀린 횟수가 많아요. 인증번호를 다시 받아주세요.',
  invalid_phone: '전화번호 형식을 확인해주세요.',
  not_configured: '지금은 인증번호를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.',
  send_failed: '문자를 보내지 못했어요. 잠시 후 다시 시도해 주세요.',
  network: '연결 문제로 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

async function callOtp(
  body: { action: 'send' | 'verify'; phone: string; code?: string },
): Promise<{ ok: boolean; reason: OtpReason | null }> {
  try {
    const res = await fetch(OTP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; reason?: string } | null;
    if (res.ok && j?.ok) return { ok: true, reason: null };
    return { ok: false, reason: (j?.reason as OtpReason) ?? 'network' };
  } catch {
    return { ok: false, reason: 'network' };
  }
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
      setMsg(REASON_MSG[r.reason ?? 'network']);
    }
  };

  const verify = async (code: string) => {
    if (busy || !sentTo) return;
    setMsg(null);
    setBusy('verify');
    const r = await callOtp({ action: 'verify', phone: sentTo, code });
    setBusy(null);
    if (r.ok) setVerifiedTo(sentTo);
    else setMsg(REASON_MSG[r.reason ?? 'network']);
  };

  return {
    sent: sentTo === normalizedPhone,
    verified: verifiedTo === normalizedPhone,
    countdown,
    busy,
    msg,
    send,
    verify,
  };
}
