// 简历存 PDF —— 猎聘禁下载,用整页 PDF 代替(自动分页,长简历也完整),方便转发他人。
// 用法: node pdf.mjs [--dir 输出目录] <resume_id> [resume_id=标签] ...
//   - 纯 id：文件名 简历_<id>.pdf ｜ id=标签：文件名 简历_<标签>.pdf(标签如 "张三-大疆",方便辨认)
// 输出目录:① --dir(推荐,跨 shell 一致,精筛用各岗「待定」文件夹);② 环境变量 LIEPIN_PDF_DIR;③ 都没设则存桌面。不存在自动建。
// 退出码:任一份登录页/坏 PDF/异常 → 非零并打印续跑命令,别把 FAIL 的交付;全部成功才 0。
// 注意:① page.pdf() 仅无头可用,别设 LIEPIN_HEADLESS=false;② 占用 liepin profile,别和搜索/看简历 Chrome 同时跑;③ 需账号在线(检测到登录页会中止整批)。
// 渲染:简历页(cvview→resume/detail 重定向 + React/Vue 异步渲染)不能用固定 sleep 就截,
//      必须等到真实简历内容出现再 pdf,否则截到中间态/错误页(表现为所有 PDF 都 ~68KB 一致)。
//      另:截前要点开所有"展开",否则个人介绍/工作描述等折叠内容会被截断(见 expandAll)。
import os from 'os';
import path from 'path';
import { existsSync, mkdirSync, statSync } from 'fs';
import { execSync } from 'child_process';

// 无头硬执行:在加载 CdpBrowser 前锁死,CdpBrowser 启动时即读到,绝不弹有头窗口。
process.env.LIEPIN_HEADLESS = 'true';

// 参数解析放在动态 import 之前:用法错/坏 id 要在碰浏览器前拦下。
const argv = process.argv.slice(2);
let dirFlag = null;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--dir') dirFlag = argv[++i];
  else if (argv[i].startsWith('--dir=')) dirFlag = argv[i].slice(6);
  else rest.push(argv[i]);
}
const items = rest.map(a => { const [id, ...l] = a.split('='); return { id, label: (l.join('=') || id).replace(/[\\/:*?"<>|]/g, '_') }; });
if (!items.length) { console.log('用法: node pdf.mjs [--dir 输出目录] <resume_id> [resume_id=标签] ...'); process.exit(2); }

// id 截断防呆:真实 resume_id 是 25 位(如 f57227747d2aP2f8fb482fb30)。传短了(常见复制漏尾)
// 会让猎聘返回"简历信息不存在"错误页、PDF 截成 ~100KB,且不报错——这里提前拦下,别白跑一轮。
const bad = items.filter(it => it.id.length < 20);
if (bad.length) {
  console.error('❌ 以下 id 长度异常(疑似被截断,真实 id 约 25 位),请用完整 id 重试:');
  for (const it of bad) console.error(`   ${it.id} (${it.id.length}位) ← ${it.label}`);
  process.exit(1);
}

let outDir = dirFlag || process.env.LIEPIN_PDF_DIR;
if (outDir) { mkdirSync(outDir, { recursive: true }); }
else { outDir = [path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Desktop')].find(existsSync) || path.join(os.homedir(), 'Desktop'); }

// 跨平台 + 跨用户:动态解析全局 npm 安装的 liepin-cli dist,不写死任何用户名路径。
let pkgRoot;
try {
  const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  pkgRoot = path.join(npmRoot, '@viyzhu', 'liepin-cli', 'dist');
  if (!existsSync(pkgRoot)) throw new Error('未在 ' + pkgRoot + ' 找到 liepin-cli');
} catch (e) {
  console.error('定位 @viyzhu/liepin-cli 失败,请先 `npm i -g @viyzhu/liepin-cli`:\n' + (e.message || e));
  process.exit(1);
}
const pkg = 'file://' + pkgRoot.replace(/\\/g, '/');
const { CdpBrowser } = await import(`${pkg}/browser/cdp_browser.js`);
const { sleep } = await import(`${pkg}/common/utils.js`);

const base = 'https://lpt.liepin.com/cvview/showresumedetail?resIdEncode=';
const SMALL_PDF = 150 * 1024; // <150KB 大概率是没渲染完/错误页(正常单页简历 ~300KB)
const MARKERS = ['求职意向', '工作经历', '教育经历', '自我评价'];

// 容错读 innerText:cvview→resume/detail 重定向会销毁 execution context,
// page.evaluate 此刻会抛"context destroyed"。不能用 waitForFunction(它把这种异常当失败直接退出),
// 必须自己轮询、吞掉中途异常,直到内容真的出现。
async function pollResumeReady(page, id, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let txt = '';
    try { txt = await page.evaluate(() => document.body.innerText || ''); }
    catch { await sleep(500); continue; } // 重定向中 context 被销毁,稍后再试
    if (/登录|登陆|扫码/.test(txt.slice(0, 120))) return 'login';
    if (MARKERS.some(m => txt.includes(m))) return 'ok';
    await sleep(500);
  }
  return 'timeout';
}

// 点开页面上所有"展开"折叠(个人介绍、工作描述等),否则 PDF 截到折叠态、内容被截断。
async function expandAll(page) {
  try {
    const n = await page.evaluate(() => {
      const KEYS = ['展开', '展开全部', '查看全部', '查看更多'];
      let c = 0;
      for (const el of document.querySelectorAll('a, span, button, i, em')) {
        if (el.childElementCount !== 0) continue;            // 只点叶子,避免父子都点导致再折叠
        if (KEYS.includes((el.textContent || '').trim())) { try { el.click(); c++; } catch {} }
      }
      return c;
    });
    if (n) await sleep(1200); // 等展开内容渲染完
  } catch { /* 重定向/重渲染偶发 context 销毁,忽略 */ }
}

async function renderOne(page, id, out, attempt = 1) {
  await page.goto(base + id, { waitUntil: 'networkidle2' }).catch(() => {});
  const state = await pollResumeReady(page, id);
  if (state === 'login') return 'login';   // 账号被踢:交调用方中止整批
  if (state === 'timeout') console.log(`⚠️ ${id} 15s 内没等到简历内容,仍尝试截 PDF`);
  await expandAll(page); // 点开"展开",否则个人介绍等折叠内容会被截断
  await sleep(2500); // 内容出现后再 settle,等图片/布局稳定(debug 实测固定等待是关键)
  await page.emulateMediaType('screen');
  await page.pdf({ path: out, format: 'A4', printBackground: true });
  const size = statSync(out).size;
  if (size < SMALL_PDF && attempt < 3) {
    console.log(`⚠️ ${id} PDF 仅 ${Math.round(size/1024)}KB(疑似没渲染完),第${attempt}次重试…`);
    await sleep(2500);
    return renderOne(page, id, out, attempt + 1);
  }
  return size;
}

// 续跑/重跑命令:失败时打印出来,agent 直接照抄,别整批从头再刷
const cmdFor = its => 'node .claude/skills/pxb-liepin/scripts/pdf.mjs --dir "' + outDir + '" '
  + its.map(it => it.id === it.label ? it.id : it.id + '=' + it.label).join(' ');

const fails = [];
const b = new CdpBrowser();
try {
  const page = await b.launch();
  for (let i = 0; i < items.length; i++) {
    const { id, label } = items[i];
    const out = path.join(outDir, `简历_${label}.pdf`);
    const size = await renderOne(page, id, out);
    if (size === 'login') {
      process.exitCode = 1;
      console.log(`❌ ${id} 打开的是登录页——账号被踢,中止整批(后面只会全是登录页)。`);
      console.log('先 `liepin login` 重登,再续跑剩余: ' + cmdFor(items.slice(i)));
      break;
    }
    if (size < SMALL_PDF) {
      process.exitCode = 1;
      fails.push(items[i]);
      console.log(`❌ ${out} 仅 ${Math.round(size / 1024)}KB,重试 3 次仍疑似坏页(没渲染完/错误页)——FAIL,这份别交付`);
    } else {
      console.log(`已存 ${out} (${Math.round(size / 1024)}KB)`);
    }
    if (i < items.length - 1) await sleep(1500 + Math.floor(Math.random() * 2000)); // 抖动
  }
  if (fails.length) console.log('坏页稍后单独重跑: ' + cmdFor(fails));
} catch (e) { console.log('ERR:', e?.message || e); process.exitCode = 1; }
finally { await b.close(); }

if (!process.exitCode) {
  console.log('→ 下一步:node .claude/skills/pxb-liepin/scripts/lock.mjs release <岗位>;交付只两样:每份列成可点链接 + 逐份问合适/不合适各为什么');
}
