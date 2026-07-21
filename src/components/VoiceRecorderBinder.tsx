import { useEffect } from 'react';
import { useAudioRecorder } from 'expo-audio';

import { bindRecorder, NATIVE_RECORDING_OPTIONS } from '@/lib/voice/recorder';

/**
 * 네이티브 녹음 인스턴스를 앱 루트에서 한 번 만들어 voice 모듈에 넘긴다.
 *
 * 왜 이 우회가 필요한가: expo-audio 는 recorder 인스턴스를 만드는 명령형 API를 문서화하지
 * 않았고(useAudioRecorder 훅이 유일한 경로), 우리 녹음 코드는 React 컴포넌트가 아니라
 * lib/voice/recorder.ts 모듈에서 start/stop 을 호출한다. 그래서 훅은 여기서만 부르고
 * 인스턴스만 모듈에 주입한다.
 *
 * ⚠️ 웹에서는 절대 렌더하지 않는다(웹은 MediaRecorder 경로 = recorder.web.ts).
 *    호출부에서 Platform.OS 로 걸러 조건부 렌더한다 — 훅 자체를 조건부로 부르지 않기 위해
 *    분기는 이 컴포넌트 바깥에 둔다.
 */
export function VoiceRecorderBinder() {
  const recorder = useAudioRecorder(NATIVE_RECORDING_OPTIONS);
  useEffect(() => {
    bindRecorder(recorder);
    return () => bindRecorder(null);
  }, [recorder]);
  return null;
}
