import { useState } from 'react';

/**
 * 클립보드 복사 + "복사됨" 일시 표시 훅.
 * 실제 복사가 가능한 환경(주로 웹)에서만 copied를 true로 한다(네이티브 거짓 성공 방지).
 * 미지원 환경/실패 시엔 조용히 무시한다.
 */
export function useCopyToClipboard(resetMs = 1500): {
  copied: boolean;
  copy: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    const nav = (globalThis as any).navigator;
    const writeText = nav?.clipboard?.writeText;
    if (typeof writeText !== 'function') return;
    try {
      await writeText.call(nav.clipboard, text);
      setCopied(true);
      setTimeout(() => setCopied(false), resetMs);
    } catch {
      /* 복사 실패 시 상태 변화 없음 */
    }
  };
  return { copied, copy };
}
