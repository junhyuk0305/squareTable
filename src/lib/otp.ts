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
  }
}

async function callOtp(
  body: { action: 'send' | 'verify'; phone: string; code?: string },
): Promise<{ ok: boolean; reason: OtpReason | null; retryAfterSec: number | null }> {
  try {
    const res = await fetch(OTP_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as
      | { ok?: boolean; reason?: string; retry_after_sec?: number }
      | null;
    if (res.ok && j?.ok) return { ok: true, reason: null, retryAfterSec: null };
    return {
      ok: false,
      reason: (j?.reason as OtpReason) ?? 'network',
      retryAfterSec: typeof j?.retry_after_sec === 'number' ? j.retry_after_sec : null,
    };
  } catch {
    return { ok: false, reason: 'network', retryAfterSec: null };
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

  const verify = async (code: string) => {
    if (busy || !sentTo) return;
    setMsg(null);
    setBusy('verify');
    const r = await callOtp({ action: 'verify', phone: sentTo, code });
    setBusy(null);
    if (r.ok) setVerifiedTo(sentTo);
    else setMsg(reasonMsg(r.reason ?? 'network', r.retryAfterSec));
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
