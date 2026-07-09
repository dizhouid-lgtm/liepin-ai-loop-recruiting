// 环境体检——开工第一步:cli/补丁/锁/残留浏览器一次查清;✗ 未过先修再开搜。
// 用法: node doctor.mjs [--kill]   --kill = 顺带杀掉残留的 liepin 浏览器进程
// 登录态不在此查(要碰账号):由第一轮 search 当探针(见 SKILL 步骤 0.5)。
import path from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { LOCK_FILE, listOrphanChrome, killOrphanChrome } from './_liepin.mjs';

const kill = process.argv.includes('--kill');
let bad = 0;
const ok = m => console.log('  ✓ ' + m);
const warn = m => console.log('  ⚠ ' + m);
const fail = (m, fix) => { console.log('  ✗ ' + m + (fix ? '  →  修: ' + fix : '')); bad++; };

// 1. Node ≥ 20
const major = +process.versions.node.split('.')[0];
major >= 20 ? ok('Node ' + process.version) : fail('Node ' + process.version + ' < 20', '装 Node LTS ≥ 20');

// 2. liepin-cli 包 + 版本
let dist = null;
try {
  const p = path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@viyzhu', 'liepin-cli', 'dist');
  if (existsSync(p)) dist = p;
} catch {}
let cliVer = '';
if (dist) {
  try { cliVer = JSON.parse(readFileSync(path.join(dist, '..', 'package.json'), 'utf8')).version; } catch {}
  ok('liepin-cli 已装' + (cliVer ? ' v' + cliVer : ''));
} else fail('liepin-cli 未装', 'npm i -g @viyzhu/liepin-cli');

// 2.3 版本下限(0.1.6 起原生带逐段 duty + --user-status/--age 服务端过滤,整个流程按此假设写;本地比对,离线也拦)
const MIN = '0.1.6';
const older = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0); return false; };
if (dist && cliVer && older(cliVer, MIN))
  fail(`liepin-cli v${cliVer} < ${MIN}:精筛缺逐段 duty、求职状态/年龄过滤失效`, 'npm i -g @viyzhu/liepin-cli');

// 2.5 liepin-cli 是否最新(查 npm 源;离线/超时不拦路,查到落后才提示)
if (dist && cliVer) {
  const r = spawnSync('npm', ['view', '@viyzhu/liepin-cli', 'version'], { shell: true, encoding: 'utf8', timeout: 10000 });
  const latest = ((r.status === 0 && r.stdout) || '').trim();
  if (!latest) warn('查不到 npm 源上的最新版(离线/超时?),本次跳过版本比对');
  else if (latest === cliVer) ok('liepin-cli 已是最新版');
  else warn(`liepin-cli v${cliVer} 落后最新版 v${latest}——先问用户再更新: npm i -g @viyzhu/liepin-cli,更新后再跑一次 doctor(无头安全网补丁会被覆盖,按提示重打)`);
}

// 3. liepin 命令可用(PATH)
if (dist) {
  const r = spawnSync('liepin', ['help'], { shell: true, encoding: 'utf8', timeout: 15000 });
  r.status === 0 ? ok('liepin 命令可用') : fail('liepin 命令跑不动(不在 PATH?)', '确认 npm 全局 bin 在 PATH,重开终端再试');
}

// 4. 无头补丁(可选安全网:脚本已强制无头,这补丁防"裸调 liepin"弹窗)
if (dist) {
  const cfg = path.join(dist, 'config.js');
  existsSync(cfg) && readFileSync(cfg, 'utf8').includes("LIEPIN_HEADLESS !== 'false'")
    ? ok('无头补丁已打')
    : warn('无头补丁未打(裸调 liepin 会弹窗)——可跑 node .claude/skills/pxb-liepin/scripts/patch-headless.mjs');
}

// 6. 搜索锁
if (!existsSync(LOCK_FILE)) ok('搜索锁空闲');
else {
  const age = (Date.now() - statSync(LOCK_FILE).mtimeMs) / 60000;
  let holder = '未知'; try { holder = (readFileSync(LOCK_FILE, 'utf8').match(/^占锁:(.+?) \S+$/) || [])[1] || '未知'; } catch {}
  age < 30 ? warn(`搜索锁被「${holder}」持有(${age.toFixed(1)} 分钟前活跃)——别处在搜,排队`)
           : warn(`有过期锁(「${holder}」,${age.toFixed(0)} 分钟)——acquire 会自动夺,无需手动清`);
}

// 7. 残留 liepin 浏览器(占死 profile,后续每条命令都会卡住)
const pids = listOrphanChrome();
if (!pids.length) ok('无残留 liepin 浏览器进程');
else if (kill) { const done = killOrphanChrome(); ok(`已清 ${done.length}/${pids.length} 个残留浏览器进程`); }
else fail(`${pids.length} 个残留 liepin 浏览器进程(PID: ${pids.join(' ')})`, '重跑 doctor 加 --kill,或手动结束这些进程');

console.log(bad ? `✗ ${bad} 项未过,修完再开工` : '✓ 体检通过,可开工(登录态由第一轮 search 探)');
process.exit(bad ? 1 : 0);
