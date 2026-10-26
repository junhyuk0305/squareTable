// C defect follow-up: run the 15 local harnesses serially; preserve every failure.
import { localEnv } from './qa-local-target.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
if(!process.argv.includes('--local')) throw Error('--local required');
const env={...process.env,...localEnv()};
const dir=resolve('../산출물/서비스결함수정_2026-10-23/D2');
mkdirSync(dir,{recursive:true});
const files=['quiz-schedule','brand-deploy','brand-boundary','knowhow-archive','quiz-attempt-integrity','quiz-formats-browser','quiz-junior','quiz-gen','quiz-grading','quiz-link-live','quiz-ui-browser','training','notify-prefs','task-knowhow'];
const results=[];
for(const name of files){
  console.log('START',name);
  const r=spawnSync(process.execPath,[`scripts/qa-${name}.mjs`,'--local'],{env,encoding:'utf8',timeout:180000,maxBuffer:16<<20});
  writeFileSync(resolve(dir,name+'.log'),`${r.stdout??''}\n${r.stderr??''}\nEXIT ${r.status} ${r.error?.message??''}\n`);
  results.push({name,exit:r.status,error:r.error?.message??null});
  writeFileSync(resolve(dir,'results.json'),JSON.stringify(results,null,2));
  console.log('END',name,r.status,r.error?.code??'');
}
process.exitCode=results.some(r=>r.exit!==0)?1:0;
