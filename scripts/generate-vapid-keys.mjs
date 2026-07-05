// scripts/generate-vapid-keys.mjs
// 웹푸시(VAPID) 키쌍을 1회 생성한다. 의존성 없이 Node 내장 crypto 만 사용.
//
// 사용:
//   node scripts/generate-vapid-keys.mjs
//
// 출력된 값을 이렇게 배치한다:
//   - VAPID_PUBLIC_KEY  → 엣지 시크릿 + 클라 .env(EXPO_PUBLIC_VAPID_PUBLIC_KEY) 둘 다(공개돼도 됨)
//   - VAPID_PRIVATE_KEY → 엣지 시크릿에만(절대 클라/깃에 넣지 말 것)
//
// 배포(값 세팅):
//   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:contact@team-roundtable.com
//   그리고 .env 에 EXPO_PUBLIC_VAPID_PUBLIC_KEY=<PUBLIC> 추가 후 웹 재빌드.

import { generateKeyPairSync } from 'node:crypto';

// P-256(prime256v1) EC 키쌍 = VAPID 표준.
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' }); // { x, y } (base64url)
const priv = privateKey.export({ format: 'jwk' }); // { d, x, y } (base64url)

const b64uToBuf = (s) => Buffer.from(s, 'base64url');
const bufToB64u = (b) => Buffer.from(b).toString('base64url');

// applicationServerKey(공개키) = 비압축점 0x04 || X || Y 를 base64url.
const publicKeyB64u = bufToB64u(Buffer.concat([Buffer.from([0x04]), b64uToBuf(pub.x), b64uToBuf(pub.y)]));
// 개인키 = d (32바이트) base64url.
const privateKeyB64u = priv.d;

console.log('VAPID_PUBLIC_KEY  =', publicKeyB64u);
console.log('VAPID_PRIVATE_KEY =', privateKeyB64u);
console.log('');
console.log('# 엣지 시크릿:');
console.log(
  `supabase secrets set VAPID_PUBLIC_KEY=${publicKeyB64u} VAPID_PRIVATE_KEY=${privateKeyB64u} VAPID_SUBJECT=mailto:contact@team-roundtable.com`,
);
console.log('');
console.log('# 클라(.env):');
console.log(`EXPO_PUBLIC_VAPID_PUBLIC_KEY=${publicKeyB64u}`);
