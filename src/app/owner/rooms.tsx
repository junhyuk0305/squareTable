import { useEffect } from 'react';
import { router } from 'expo-router';

/**
 * 옛 '채팅방 관리' 화면(사장 전용) — 2026-08-19 폐기.
 *
 * 방 관리가 **방 안**으로 들어갔다: 목록은 업무 탭 루트, 만들기는 그 화면의 ＋,
 * 인원·초대·나가기·삭제·개인 설정은 대화방 서랍(햄버거)이다. 사장 전용 관리 화면이라는 개념 자체가
 * 없어졌다 — 방을 만들고 초대하는 일은 직원도 한다(0148).
 *
 * ★파일을 지우지 않고 리다이렉트로 남긴다 — 옛 링크·푸시·북마크가 죽지 않게(탭을 뺄 때의 규칙과 같다).
 */
export default function OwnerRoomsRedirect() {
  useEffect(() => {
    router.replace('/owner/work');
  }, []);
  return null;
}
