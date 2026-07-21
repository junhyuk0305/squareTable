/**
 * 웹에서는 네이티브 녹음 바인딩이 필요 없다(웹 경로 = MediaRecorder, recorder.web.ts).
 * 이 빈 구현이 있어야 웹 번들에 expo-audio 가 딸려 들어가지 않는다 — 웹은 코드분할이 안 돼
 * (Expo 56 단일 번들) 안 쓰는 네이티브 모듈이 그대로 용량이 된다.
 */
export function VoiceRecorderBinder() {
  return null;
}
