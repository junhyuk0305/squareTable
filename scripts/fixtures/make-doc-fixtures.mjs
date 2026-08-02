// PDF 추출(doc_extract) QA 픽스처 생성기 — 의존성 0으로 raw PDF 를 직접 조립한다.
//   ① qa-doc-text.pdf : 텍스트 레이어 PDF(Helvetica·ASCII) — "PDF mime 수용 + 텍스트 추출" 검증용
//   ② qa-doc-scan.pdf : 이미지(JPEG)만 든 스캔형 PDF(한국어) — "내장 OCR 경로" 검증용
// ②의 JPEG 은 Windows PowerShell(System.Drawing·맑은 고딕)로 렌더한다 — Windows 전용.
// 재생성: node scripts/fixtures/make-doc-fixtures.mjs
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// ── raw PDF 조립(오브젝트 본문 배열 → xref 오프셋 계산) ──────
function buildPdf(objects) {
  let out = Buffer.from('%PDF-1.4\n', 'latin1');
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(out.length);
    out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), objects[i], Buffer.from('\nendobj\n', 'latin1')]);
  }
  const xrefAt = out.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.concat([out, Buffer.from(xref, 'latin1')]);
}

// ── ① 텍스트 PDF ────────────────────────────────────────────
const LINES = [
  '[OPEN]',
  '1. Preheat espresso machine 20 minutes',
  '2. Check cash drawer 50000 won',
  '[RECIPE]',
  'Iced americano: no syrup, water 200ml',
  '[CLOSING]',
  'Empty the grinder hopper and clean',
];
{
  const body = LINES.map((l, i) => `${i === 0 ? '' : '0 -24 Td '}(${l}) Tj`).join('\n');
  const stream = `BT /F1 14 Tf 50 700 Td\n${body}\nET`;
  const pdf = buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', 'latin1'),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), Buffer.from(stream, 'latin1'), Buffer.from('\nendstream', 'latin1')]),
  ]);
  writeFileSync(here('./qa-doc-text.pdf'), pdf);
  console.log(`qa-doc-text.pdf: ${pdf.length}B`);
}

// ── ② 스캔형 PDF (한국어 JPEG 1장) ──────────────────────────
{
  const jpgPath = here('./qa-doc-scan.jpg');
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap(1000, 1400)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = 'AntiAlias'
$font = New-Object System.Drawing.Font('Malgun Gothic', 26)
$text = "[오픈]\`n머신 20분 예열 후 시운전 2잔\`n포스 시재 5만원 확인\`n\`n[레시피]\`n아이스 아메리카노는 시럽 없이 물 200ml\`n\`n[마감]\`n그라인더 원두 비우고 청소\`n행주 삶고 냉장고 온도 확인"
$g.DrawString($text, $font, [System.Drawing.Brushes]::Black, 50, 50)
$g.Dispose()
$bmp.Save('${jpgPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bmp.Dispose()
`;
  // JPEG 이 이미 있으면 렌더 생략(이 저장소 QA 환경에서 PowerShell 스폰이 간헐 실패해,
  // 수동 렌더 후 재실행하는 경로를 열어둔다). 없을 때만 렌더 시도.
  let jpg;
  try {
    jpg = readFileSync(jpgPath);
  } catch {
    // -Command 인라인은 한글·개행이 콘솔 코드페이지에 씹힌다 → UTF-8(BOM) .ps1 파일로 실행.
    const psPath = here('./make-doc-fixtures.tmp.ps1');
    writeFileSync(psPath, '﻿' + ps, 'utf8');
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], { stdio: 'inherit' });
    rmSync(psPath);
    jpg = readFileSync(jpgPath);
  }
  // JPEG SOF0/SOF2 에서 픽셀 크기 파싱(하드코딩하면 렌더 크기 변경 시 조용히 어긋난다)
  let w = 0, h = 0;
  for (let i = 2; i < jpg.length - 9; ) {
    if (jpg[i] !== 0xff) { i++; continue; }
    const marker = jpg[i + 1];
    if (marker === 0xc0 || marker === 0xc2) { h = jpg.readUInt16BE(i + 5); w = jpg.readUInt16BE(i + 7); break; }
    i += 2 + jpg.readUInt16BE(i + 2);
  }
  if (!w || !h) throw new Error('JPEG 크기 파싱 실패');
  const stream = `q ${w * 0.5} 0 0 ${h * 0.5} 46 ${842 - h * 0.5 - 46} cm /Im0 Do Q`;
  const pdf = buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>', 'latin1'),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, 'latin1'),
      jpg,
      Buffer.from('\nendstream', 'latin1'),
    ]),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), Buffer.from(stream, 'latin1'), Buffer.from('\nendstream', 'latin1')]),
  ]);
  writeFileSync(here('./qa-doc-scan.pdf'), pdf);
  console.log(`qa-doc-scan.pdf: ${pdf.length}B (${w}x${h})`);
}
