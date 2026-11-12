import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { localEnv } from './qa-local-target.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = 8083;
process.chdir(root);

// 다른 작업 세션의 서버가 있으면 새 포트를 임의로 고르지 않고 멈춘다.
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', () => reject(new Error(`localhost:${port} 포트를 사용 중입니다. 기존 서버를 확인하세요.`)));
  probe.listen(port, 'localhost', () => probe.close(resolve));
});

const env = {
  ...process.env,
  ...localEnv(),
  NODE_ENV: 'development',
  EXPO_NO_DOTENV: '1',
  APP_DESIGN_PREVIEW: '1',
  BROWSER: 'none',
};
delete env.CI;
delete env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`앱 디자인 검토: http://localhost:${port}/login`);
console.log('로컬 데이터로 동작합니다. 스타일은 앱 미리보기이며 인증과 정책은 웹 기준입니다.');
const child = spawn(process.execPath, [
  'node_modules/expo/bin/cli', 'start', '--web', '--localhost', '--port', String(port),
], { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('error', () => { console.error('Expo 개발 서버를 시작하지 못했습니다.'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
