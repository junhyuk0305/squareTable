// 극단/예외 입력 실통신 테스트 — 실제 고객이 칠 법한 난잡한 입력에 대해 square가 어떻게 반응하는지.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
function parseEnv(f){const o={};try{for(const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}}catch{}return o;}
const env = parseEnv(here('../.env'));
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
// 자격증명은 환경변수로만(레포에 비번 박지 않음): QA_EMAIL=… QA_PASSWORD=… node scripts/qa-knowhow-extreme.mjs
const EMAIL = process.env.QA_EMAIL, PASSWORD = process.env.QA_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('QA_EMAIL / QA_PASSWORD 환경변수를 설정하세요(파일럿 계정).'); process.exit(1); }

async function signIn(){const r=await fetch(`${URL_}/auth/v1/token?grant_type=password`,{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON},body:JSON.stringify({email:EMAIL,password:PASSWORD})});const j=await r.json();if(!j.access_token)throw new Error('login fail');return j.access_token;}
async function callAI(token,task,payload){const r=await fetch(`${URL_}/functions/v1/ai`,{method:'POST',headers:{'Content-Type':'application/json',apikey:ANON,Authorization:`Bearer ${token}`},body:JSON.stringify({task,payload})});return {ok:r.ok,status:r.status,body:await r.json().catch(()=>({}))};}
function loadGuide(){const s=readFileSync(here('../src/data/extraction-master.ts'),'utf8');const m=s.match(/EXTRACTION_MASTER = `([\s\S]*?)`;/);return m?m[1]:'';}

const CASES = [
  '아아아아', 'ㅁㄴㅇㄹ', 'ㅋㅋㅋㅋㅋ', 'ㅠㅠ', 'ㅎㅇ', '?????', '...', '12345', '!!!!!',
  '😀😀😀', '테스트', 'test', '그냥', '아', 'ㅇㅇ', '몰라', '없음', '오늘 날씨 좋다',
  '안녕하세요', '사장님 사랑해요', 'ㅅㅂ', '꺼져', '       ', 'ㅏㅏㅏ', 'asdf', 'ㅋ',
];

const main = async () => {
  const guide = loadGuide();
  const token = await signIn();
  console.log('✓ login\n');
  for (const raw of CASES) {
    const r = await callAI(token, 'square', { rawText: raw, category: 'Routine', categoryGuide: guide });
    const b = r.body || {};
    const seg0 = b.segments?.[0];
    const steps = b.square?.action?.steps || [];
    const scripts = b.square?.action?.scripts || [];
    const publishable = steps.length >= 1 || scripts.length >= 1;
    console.log(`[${JSON.stringify(raw)}] cat=${seg0?.category} title="${b.title}" situ="${b.square?.situation}" steps=${JSON.stringify(steps)} usable=${b.usable} fu=${JSON.stringify(b.followups)} → ${publishable ? '⚠️저장가능' : '저장불가'}`);
  }
};
main().catch((e) => { console.error(e.message); process.exit(1); });
