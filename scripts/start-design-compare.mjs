import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { localEnv } from './qa-local-target.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const port = 8086;
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', () => reject(new Error(`localhost:${port} 포트가 사용 중입니다.`)));
  probe.listen(port, 'localhost', () => probe.close(resolve));
});
const env = { ...process.env, ...localEnv(), NODE_ENV: 'development', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_DESIGN_COMPARE: '1', BROWSER: 'none' };
delete env.CI;
delete env.SUPABASE_SERVICE_ROLE_KEY;
const child = spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--web', '--localhost', '--port', String(port), '--max-workers', '1'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.on('error', () => { console.error('비교 서버를 시작하지 못했습니다.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
