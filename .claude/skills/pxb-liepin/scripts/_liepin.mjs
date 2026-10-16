// 跨平台调用 liepin CLI 的薄封装。Windows 下 liepin 是 .cmd,必须 shell:true 才找得到。
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { existsSync, utimesSync } from 'fs';
import { pathToFileURL } from 'url';

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

// CLI 的 dist 目录(npm 全局安装)。本进程内只解析一次,解析不到返回 null。
let distCache;
export function cliDist() {
  if (distCache !== undefined) return distCache;
  const r = spawnSync('npm', ['root', '-g'], { shell: true, encoding: 'utf8', timeout: 30000 });
  const p = path.join((r.stdout || '').trim(), '@viyzhu', 'liepin-cli', 'dist');
  return (distCache = r.status === 0 && existsSync(p) ? p : null);
}

// 探测 CDP 端口(默认 53471)上常驻的浏览器:CLI ≥0.2.7 端口上有实例就直接复用,不看 LIEPIN_HEADLESS,
// 于是(旧版 pdf.mjs 等)残留的无头实例会被后续有头 search/fetch 接手、以 HeadlessChrome UA 碰猎聘 → 风控。
// 用 CLI 自己导出的 probeRemoteHeadless/closeRemoteBrowser(读 /json/version 的 UA;优雅关闭,登录态留在 profile)。
// 两者是 async,liepinJson 是同步的,故放子进程里跑。
// 返回 { headless: true|false|null(端口上没实例), closed: bool }。closeHeadless=true 时发现无头就关掉并等端口释放。
export function probeCdpPort({ closeHeadless = false } = {}) {
  const dist = cliDist();
  if (!dist) return { headless: null, closed: false, error: '找不到 liepin-cli' };
  const script = `
    const { probeRemoteHeadless, closeRemoteBrowser } = await import(process.env.PXB_CDP_URL);
    const headless = await probeRemoteHeadless();
    let closed = false;
    if (headless === true && process.env.PXB_CLOSE === '1') {
      closed = await closeRemoteBrowser();
      for (let i = 0; closed && i < 25 && (await probeRemoteHeadless()) !== null; i++) await new Promise(r => setTimeout(r, 200));
    }
    console.log(JSON.stringify({ headless, closed }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PXB_CDP_URL: pathToFileURL(path.join(dist, 'browser', 'cdp_browser.js')).href, PXB_CLOSE: closeHeadless ? '1' : '0' },
  });
  try { return JSON.parse((r.stdout || '').trim().split(/\r?\n/).pop()); }
  catch { return { headless: null, closed: false, error: (r.stderr || r.error?.message || '探测失败').slice(0, 300) }; }
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
  // 一律有头(只有 search/fetch 走这里;pdf.mjs 自己直连常驻有头浏览器,不经此):liepin-cli ≥0.2.7 实测无头 UA 带
  // HeadlessChrome 会被判"行为异常"。强制覆盖,不继承外部 LIEPIN_HEADLESS(用户级环境变量里可能残留 true)。
  const env = { ...process.env, LIEPIN_HEADLESS: 'false' };
  // 再清掉端口上的无头实例(多半是旧版 pdf.mjs 残留),否则 CLI 会直接复用它,上面的 false 不生效。
  const p = probeCdpPort({ closeHeadless: true });
  if (p.headless === true && !p.closed)
    throw fail('spawn', `端口上有无头猎聘浏览器(多半是旧版 pdf.mjs 残留),关闭失败;不能让有头命令复用它(HeadlessChrome UA 会触发风控)。\n` +
      `处理:node .claude/skills/pxb-liepin/scripts/doctor.mjs --kill`);
  if (p.closed) console.error('已关闭端口上残留的无头猎聘浏览器(防 HeadlessChrome UA 触发风控),改由本次有头拉起。');
  // 必须带 --json:否则 liepin 走人类可读/交互模式,输出无法解析、甚至会挂起干等(卡死主因)。
  const r = spawnSync('liepin', [...args, '--json'], {
    shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs, killSignal: 'SIGKILL',
    env,
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
