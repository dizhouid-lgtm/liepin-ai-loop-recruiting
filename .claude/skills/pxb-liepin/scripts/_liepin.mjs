// 跨平台调用 liepin CLI 的薄封装。Windows 下 liepin 是 .cmd,必须 shell:true 才找得到。
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { existsSync, utimesSync } from 'fs';

// 单账号搜索锁(与 lock.mjs 共用同一路径)。liepin 每次成功调用会 touch 它:
// 锁寿命跟着真实活动走,长回合(精筛 10 份可超 30 分钟)不再中途被判过期。
export const LOCK_FILE = path.join(os.homedir(), '.liepin-cli', '.search-lock');

// 找出残留的 liepin 浏览器进程(命令行里带 .liepin-cli profile 的 chrome/edge)。
// spawnSync 超时只杀得到 shell,杀不到孙进程浏览器;残留会占死 profile,让后续每条命令都卡住。
export function listOrphanChrome() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync('powershell', ['-NoProfile', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' OR Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*.liepin-cli*' } | Select-Object -ExpandProperty ProcessId"],
        { encoding: 'utf8', timeout: 30000 });
      return (r.stdout || '').split(/\r?\n/).map(s => parseInt(s.trim(), 10)).filter(Boolean);
    }
    const r = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 30000 });
    return (r.stdout || '').split('\n')
      .map(l => l.match(/^\s*(\d+)\s+(.*)$/))
      .filter(m => m && m[2].includes('.liepin-cli') && /chrome|chromium|msedge/i.test(m[2]))
      .map(m => +m[1]);
  } catch { return []; }
}

export function killOrphanChrome() {
  const killed = [];
  for (const pid of listOrphanChrome()) {
    try { process.kill(pid, 'SIGKILL'); killed.push(pid); } catch {}
  }
  return killed;
}

// 分类错误:调用方(如 fetch)按 kind/detail 决定单份跳过还是整批停。
function fail(kind, msg, detail = '') {
  const e = new Error(msg);
  e.kind = kind;     // timeout | spawn | exit | nojson
  e.detail = detail; // 原始 stderr/stdout 片段——判"登录/被踢"用它,别用我们自己拼的提示语
  return e;
}

// 跑一条 liepin 命令,返回 stdout 里第一个 JSON(数组或对象)。失败抛错(由调用方停手)。
// liepin 输出前常有非 JSON 前导,故从首个 '['/'{' 起截取(替原 PS 的 IndexOf 技巧)。
// timeoutMs:硬超时——liepin 卡住(撞反爬/滑块/未登录/Chrome 卡死)就强杀并抛错,
//   绝不让脚本无限阻塞;强杀后自动清残留浏览器(否则占死 profile,后面每条都卡)。
export function liepinJson(args, { open = '[', timeoutMs = 360000 } = {}) {
  // 必须带 --json:否则 liepin 走人类可读/交互模式,输出无法解析、甚至会挂起干等(卡死主因)。
  const r = spawnSync('liepin', [...args, '--json'], {
    shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs, killSignal: 'SIGKILL',
    env: { ...process.env, LIEPIN_HEADLESS: 'true' },
  });
  // 超时:Node 会置 r.error(code ETIMEDOUT)并把 r.signal 设为 killSignal。
  if (r.error && (r.error.code === 'ETIMEDOUT' || r.signal)) {
    const killed = killOrphanChrome();
    throw fail('timeout',
      `liepin ${args.join(' ')} 超过 ${Math.round(timeoutMs / 1000)}s 无响应,已强杀` +
      (killed.length ? `并清掉 ${killed.length} 个残留浏览器进程` : '') + '(防静默挂死)。\n' +
      `常见原因:撞反爬/滑块验证、未登录、或本机 Chrome 卡住。\n` +
      `处理:① 确认已登录(liepin login);② 过几分钟换时段再试;③ 把 --limit 调小(如 20)。`);
  }
  if (r.error) throw fail('spawn', `liepin 启动失败: ${r.error.message}`);
  if (r.status !== 0) {
    const tail = (r.stderr || '').slice(0, 500);
    throw fail('exit', `liepin ${args.join(' ')} 退出码 ${r.status}（反爬/被踢/坏参数?）\n${tail}`, tail);
  }
  const out = r.stdout || '';
  const i = out.indexOf(open);
  if (i < 0) throw fail('nojson', `liepin 输出无 JSON（可能被踢/未登录）:\n${out.slice(0, 300)}`, out.slice(0, 300));
  let parsed;
  try { parsed = JSON.parse(out.slice(i)); }
  catch { throw fail('nojson', `liepin 输出的 JSON 不完整/夹杂错误文本:\n${out.slice(i, i + 300)}`, out.slice(i, i + 300)); }
  // 成功即续锁(锁在才 touch;锁不在=没抢锁或已释放,不越权造锁)
  try { if (existsSync(LOCK_FILE)) utimesSync(LOCK_FILE, new Date(), new Date()); } catch {}
  return parsed;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const jitter = (min, max) => min + Math.floor(Math.random() * (max - min));
