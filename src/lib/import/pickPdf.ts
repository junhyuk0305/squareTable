// lib/import/pickPdf.ts — 네이티브 기본판(모듈 통째 분기: pickPdf.web.ts 가 웹판).
// 네이티브는 추후 expo-document-picker 도입 후 지원 — 그때까지 버튼 자체를 숨긴다
// (PDF_PICK_SUPPORTED). Android 는 TWA(웹 래핑)라 웹판이 곧 Android 경로이고,
// 이 파일이 실제로 쓰이는 곳은 iOS 네이티브 빌드뿐이다.
// 플랫폼 예외표: 00_핵심/플랫폼_배포현황_LIVE.md §2

export type PickedPdf = { base64: string; name: string; size: number };

export const PDF_PICK_SUPPORTED = false;

export async function pickPdf(): Promise<PickedPdf | null> {
  return null; // 네이티브는 추후 expo-document-picker 도입
}
