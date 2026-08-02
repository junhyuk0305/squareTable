// lib/import/pickPdf.web.ts — 웹판: DOM 파일 선택창 → base64.
// Android 는 TWA(웹 래핑)라 이 경로가 곧 Android 앱 경로다. 별도 라이브러리 없이
// input[type=file] 만 쓴다(Expo 56 단일 번들 — 의존성 추가 금지).

export type PickedPdf = { base64: string; name: string; size: number };

export const PDF_PICK_SUPPORTED = true;

export function pickPdf(): Promise<PickedPdf | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        // readAsDataURL 결과 = "data:application/pdf;base64,....." → 콤마 뒤가 base64 본문.
        const url = String(reader.result ?? '');
        const comma = url.indexOf(',');
        resolve(comma >= 0 ? { base64: url.slice(comma + 1), name: f.name, size: f.size } : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(f);
    };
    // 선택창을 그냥 닫은 경우. cancel 미지원 브라우저에선 이 Promise 가 대기 상태로 남지만,
    // 호출부가 "선택 완료 후"에만 로딩 상태를 켜므로 UI 가 잠기지는 않는다.
    input.oncancel = () => resolve(null);
    input.click();
  });
}
