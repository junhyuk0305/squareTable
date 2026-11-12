import { useEffect, useRef, useState } from 'react';
import { designComparisonEnabled, type DesignCategory } from '@/lib/theme/designComparison';

const categories: { id: DesignCategory; label: string; detail: string }[] = [
  { id: 'surface', label: '카드와 색', detail: '흰 무테 카드 · 모서리 16 · 회색 바탕 · 노란 주요 버튼' },
  { id: 'type', label: '글자', detail: '본문 16 / 700 · 설명 15 / 400 · 제목 위계' },
  { id: 'spacing', label: '간격', detail: '카드 간격 16 · 설정 행 상하 8 · 끝여백' },
  { id: 'header', label: '상단 제목', detail: '콘텐츠 최소 48 · 상하 여백 4' },
];
const screens = [
  { path: '/login', label: '로그인' },
  { path: '/stores', label: '매장 목록' },
  { path: '/account-settings', label: '계정 설정' },
];

export default function DesignComparison() {
  const [path, setPath] = useState('/login');
  const [selected, setSelected] = useState<DesignCategory[]>(categories.map(c => c.id));
  const [revision, setRevision] = useState(0);
  const [sync, setSync] = useState(true);
  const before = useRef<HTMLIFrameElement>(null);
  const after = useRef<HTMLIFrameElement>(null);
  const syncing = useRef(false);
  const syncEnabled = useRef(sync);
  useEffect(() => { syncEnabled.current = sync; }, [sync]);
  if (!designComparisonEnabled) return null;

  const followScroll = (source: HTMLIFrameElement | null, sourceIndex: number) => {
    source?.contentDocument?.addEventListener('scroll', event => {
      if (!syncEnabled.current || syncing.current || !event.target || !('scrollHeight' in event.target)) return;
      const scroller = event.target as HTMLElement;
      if (scroller.scrollHeight <= scroller.clientHeight) return;
      const target = sourceIndex ? before.current : after.current;
      const peer = Array.from(target?.contentDocument?.querySelectorAll('div') ?? []).find(el => {
        const css = target!.contentWindow!.getComputedStyle(el);
        return ['auto', 'scroll'].includes(css.overflowY) && el.scrollHeight > el.clientHeight;
      });
      if (!peer) return;
      syncing.current = true;
      peer.scrollTop = scroller.scrollTop;
      requestAnimationFrame(() => { syncing.current = false; });
    }, { capture: true });
  };

  const candidate = `${path}?design=${selected.join(',')}`;
  return (
    <main style={{ height: '100%', overflow: 'auto', background: '#eef0f3', color: '#20242c', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ padding: '20px 24px 16px', background: '#fff', borderBottom: '1px solid #e1e4e8' }}>
        <div style={{ fontSize: 12, color: '#68717e', marginBottom: 6 }}>디자인 시스템 비교 · 실제 Expo 웹</div>
        <h1 style={{ fontSize: 24, margin: '0 0 8px', fontWeight: 800 }}>같은 화면, 외형만 바꾸면</h1>
        <p style={{ margin: 0, color: '#58616d', fontSize: 14 }}>왼쪽은 현재 앱, 오른쪽은 선택한 규칙을 적용한 화면입니다. 항목과 메뉴 순서는 같습니다.</p>
      </header>
      <style>{`
        .compare-layout { padding:20px; display:flex; gap:24px; align-items:flex-start; justify-content:center; }
        .compare-controls { width:200px; flex-shrink:0; }
        .compare-frames { display:grid; grid-template-columns:repeat(2,minmax(320px,390px)); gap:20px; min-width:660px; }
        .compare-frame { min-width:0; }
        @media(max-width:1100px) {
          .compare-layout { flex-direction:column; gap:16px; padding:12px; }
          .compare-controls { width:100%; }
          .compare-controls h2,.compare-controls p,.compare-rule-detail { display:none !important; }
          .compare-controls nav { display:flex !important; margin-bottom:12px; }
          .compare-rules { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:12px; }
          .compare-rules label { margin-bottom:0 !important; }
          .compare-actions { display:flex; flex-wrap:wrap; align-items:center; gap:12px; }
          .compare-actions label,.compare-actions button { margin-top:0 !important; width:auto !important; }
          .compare-frames { width:100%; min-width:652px; align-self:flex-start; justify-content:center; gap:12px; }
        }
      `}</style>
      <div className="compare-layout">
        <aside className="compare-controls">
          <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>비교할 화면</h2>
          <nav style={{ display: 'grid', gap: 6 }}>
            {screens.map(screen => <button key={screen.path} onClick={() => { setPath(screen.path); setRevision(r => r + 1); }} aria-pressed={path === screen.path} style={{ ...button, textAlign: 'left', background: path === screen.path ? '#20242c' : '#fff', color: path === screen.path ? '#fff' : '#20242c' }}>{screen.label}</button>)}
          </nav>
          <h2 style={{ fontSize: 15, margin: '24px 0 12px' }}>오른쪽에 적용할 규칙</h2>
          <div className="compare-rules">{categories.map(category => <label key={category.id} title={category.detail} style={{ display: 'block', marginBottom: 18, cursor: 'pointer' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}><input type="checkbox" checked={selected.includes(category.id)} onChange={() => setSelected(items => items.includes(category.id) ? items.filter(i => i !== category.id) : [...items, category.id])} />{category.label}</span>
            <span className="compare-rule-detail" style={{ display: 'block', margin: '6px 0 0 25px', fontSize: 12, lineHeight: 1.6, color: '#68717e' }}>{category.detail}</span>
          </label>)}</div>
          <div className="compare-actions">
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={button} onClick={() => setSelected(categories.map(c => c.id))}>모두 켜기</button>
            <button style={button} onClick={() => setSelected([])}>모두 끄기</button>
          </div>
          <label style={{ display: 'block', fontSize: 13, marginTop: 20 }}><input type="checkbox" checked={sync} onChange={e => setSync(e.target.checked)} /> 함께 스크롤</label>
          <button style={{ ...button, width: '100%', marginTop: 10 }} onClick={() => setRevision(r => r + 1)}>양쪽 화면 다시 열기</button>
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: '#68717e' }}>매장·설정은 로그인 후 비교할 수 있습니다. 한쪽에서 로그인한 뒤 화면을 다시 열면 같은 계정으로 표시됩니다.</p>
          <p style={{ fontSize: 12, lineHeight: 1.7, color: '#68717e' }}>기준: main 29f4d2d<br />검토용 로컬 데이터<br />운영 서비스에는 적용하지 않았습니다.</p>
        </aside>
        <div className="compare-frames">
          {[{ name: '현재 앱', caption: '기존 외형 유지', ref: before, src: path, key: `before-${path}-${revision}` }, { name: '외형 규칙 적용', caption: selected.length ? categories.filter(c => selected.includes(c.id)).map(c => c.label).join(' · ') : '모두 끔 · 왼쪽과 동일', ref: after, src: candidate, key: `after-${candidate}-${revision}` }].map((frame, index) => <section key={index} className="compare-frame">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ fontSize: 12, fontWeight: 800, background: index ? '#fee500' : '#dfe3e9', borderRadius: 6, padding: '4px 7px' }}>{index ? 'B' : 'A'}</span><h2 style={{ fontSize: 17, margin: 0 }}>{frame.name}</h2></div>
            <p style={{ fontSize: 12, color: '#68717e', height: 18, margin: '0 0 12px' }}>{frame.caption}</p>
            <iframe key={frame.key} ref={frame.ref} title={frame.name} src={frame.src} onLoad={() => followScroll(frame.ref.current, index)} style={{ display: 'block', width: '100%', height: 700, border: 0, borderRadius: 16, background: '#fff', boxShadow: '0 3px 20px #18203512' }} />
          </section>)}
        </div>
      </div>
    </main>
  );
}

const button = { border: 0, borderRadius: 9, padding: '11px 12px', background: '#fff', fontSize: 13, fontWeight: 650, cursor: 'pointer' } as const;
