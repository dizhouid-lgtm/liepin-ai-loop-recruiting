// 简历存 PDF —— 猎聘禁下载,截原版页面长图切成 A4 拼 PDF(保留原版样子;文字不可选中),方便转发他人。
// 用法: node pdf.mjs [--dir 输出目录] <resume_id> [resume_id=标签] ...
//   - 纯 id：文件名 简历_<id>.pdf ｜ id=标签：文件名 简历_<标签>.pdf(标签如 "张三-大疆",方便辨认)
// 输出目录:① --dir(推荐,跨 shell 一致,精筛用各岗「待定」文件夹);② 环境变量 LIEPIN_PDF_DIR;③ 都没设则存桌面。不存在自动建。
// 退出码:0 全部成功;2 登录页(账号被踢);3 风控(验证页/页面被清空)——整批中止、不存文件;1 其他失败(打印续跑命令)。
//
// 风控纪律(2026-10-15 两次「行为异常」后重写):
//   ① 只复用 CDP 端口上**常驻的有头**浏览器(search/fetch 拉起的那只),端口上没有/是无头 → 直接退出,绝不自己拉浏览器;
//   ② 新开一个标签页干活,结束只关这个标签页 + 断开 CDP,**绝不关浏览器**(会话 cookie is_persistent=0,关浏览器=登出);
//   ③ 导航走 CLI 的 safeGoto(加载期关掉 Runtime 域,否则猎聘把页面清成 about:blank);
//   ④ 不用 page.pdf()(仅无头可用)。截图走 CDP Page.captureScreenshot,PDF 在本地纯 Node 拼,这一步不碰猎聘。
// 渲染:简历页 React/Vue 异步渲染,不能用固定 sleep 就截——必须等到真实简历内容出现;截前点开所有"展开"(见 expandAll)。
import os from 'os';
import path from 'path';
import { existsSync, mkdirSync, writeFileSync, utimesSync } from 'fs';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { cliDist, LOCK_FILE, sleep, jitter } from './_liepin.mjs';

// 参数解析放在碰浏览器之前:用法错/坏 id 先拦下。
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
// 会让猎聘返回"简历信息不存在"错误页——这里提前拦下,别白跑一轮。
const bad = items.filter(it => it.id.length < 20);
if (bad.length) {
  console.error('❌ 以下 id 长度异常(疑似被截断,真实 id 约 25 位),请用完整 id 重试:');
  for (const it of bad) console.error(`   ${it.id} (${it.id.length}位) ← ${it.label}`);
  process.exit(1);
}

let outDir = dirFlag || process.env.LIEPIN_PDF_DIR;
if (outDir) { mkdirSync(outDir, { recursive: true }); }
else { outDir = [path.join(os.homedir(), 'OneDrive', 'Desktop'), path.join(os.homedir(), 'Desktop')].find(existsSync) || path.join(os.homedir(), 'Desktop'); }

const dist = cliDist();
if (!dist) { console.error('定位 @viyzhu/liepin-cli 失败,请先 `npm i -g @viyzhu/liepin-cli`'); process.exit(1); }
const cdpJs = path.join(dist, 'browser', 'cdp_browser.js');
const { REMOTE_DEBUGGING_PORT, probeRemoteHeadless } = await import(pathToFileURL(cdpJs).href);
const { safeGoto } = await import(pathToFileURL(path.join(dist, 'common', 'lpt-utils.js')).href);
// puppeteer-core 用 CLI 自带的那份(与 CLI 同版本),不另装
const pptrMod = await import(pathToFileURL(createRequire(cdpJs).resolve('puppeteer-core')).href);
const puppeteer = pptrMod.default?.connect ? pptrMod.default : pptrMod;

// 与 CLI openResumeImPanel 同一地址:直达 resume/detail,不走 cvview 的客户端重定向
// (重定向发生在 safeGoto 恢复 Runtime 之后,等于带着 Runtime 加载第二个页面 → 被清空)。
const urlFor = id => `https://lpt.liepin.com/resume/detail?resIdEncode=${encodeURIComponent(id)}&sfrom=R_SEARCH_CONDITION`;
const VIEW_W = 1280, VIEW_H = 800;          // 与 CLI config.viewport 一致
const PAGE_H = Math.round(VIEW_W * 297 / 210); // 每页 A4 比例的 CSS 像素高度(1810)
const SCALE = 1.5;                          // 截图倍率:A4 上约 140dpi,够看清小字
const MAX_H = 30000;                        // 页面高度上限(防异常页面无限高)
const SMALL_PDF = 60 * 1024;                // 小于此大概率是空白/错误页
const MARKERS = ['求职意向', '工作经历', '教育经历', '自我评价'];
// 风控验证页:标题"账号行为异常"+"点击验证"按钮,可能 302 到 safe.liepin.com/.../captchaPage_PC
const CAPTCHA_TEXT = /账号行为异常|点击验证|安全验证/;
const isCaptchaUrl = u => /safe\.liepin\.com|captchaPage/i.test(u || '');
const isBlankUrl = u => u === 'about:blank' || (u || '').startsWith('chrome-error://');
const isLoginUrl = u => /passport|\/login/i.test(u || '');

// 轮询直到简历内容出现。渲染中 context 可能被销毁,evaluate 会抛,吞掉继续等。
async function pollResumeReady(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const u = page.url();
    if (isCaptchaUrl(u)) return 'captcha';
    if (isBlankUrl(u)) return 'blanked';
    if (isLoginUrl(u)) return 'login';
    let txt = '';
    try { txt = await page.evaluate(() => document.body?.innerText || ''); }
    catch { await sleep(500); continue; }
    if (CAPTCHA_TEXT.test(txt.slice(0, 300))) return 'captcha';
    if (/登录|登陆|扫码/.test(txt.slice(0, 120))) return 'login';
    if (MARKERS.some(m => txt.includes(m))) return 'ok';
    await sleep(500);
  }
  return isBlankUrl(page.url()) ? 'blanked' : 'timeout';
}

// 点开页面上所有"展开"折叠(个人介绍、工作描述等),否则截到折叠态、内容被截断。
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
  } catch { /* 重渲染偶发 context 销毁,忽略 */ }
}

// 内容总高:文档本身 + 页内滚动容器(简历正文若在内层 div 里滚,文档高度只有一屏)。
const measureHeight = page => page.evaluate(() => {
  const se = document.scrollingElement || document.documentElement;
  let h = se.scrollHeight;
  for (const el of document.querySelectorAll('body *')) {
    if (el.clientHeight < 300 || el.scrollHeight <= el.clientHeight + 20) continue;
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
    h = Math.max(h, el.getBoundingClientRect().top + window.scrollY + el.scrollHeight);
  }
  return Math.ceil(h);
});

// 视口拉到内容总高(内层 100vh 滚动容器随之撑开,内容全部铺开),再按 A4 高度分段截 JPEG。
async function captureSlices(page) {
  let h = VIEW_H;
  for (let k = 0; k < 3; k++) { // 撑高后布局可能再长,最多迭代 3 次
    const m = Math.min(await measureHeight(page), MAX_H);
    if (m <= h) break;
    h = m;
    await page.setViewport({ width: VIEW_W, height: h });
    await sleep(800);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.bringToFront(); // 后台标签页不出帧,截图会挂起/空白
  const cdp = await page.createCDPSession();
  const slices = [];
  try {
    for (let y = 0; y < h; y += PAGE_H) {
      const r = await cdp.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 85, captureBeyondViewport: true, fromSurface: true,
        clip: { x: 0, y, width: VIEW_W, height: Math.min(PAGE_H, h - y), scale: SCALE },
      });
      slices.push(Buffer.from(r.data, 'base64'));
    }
  } finally { await cdp.detach().catch(() => {}); }
  return slices;
}

// 读 JPEG 的 SOF 段拿真实宽高
function jpegSize(buf) {
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC)
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('JPEG 无 SOF 段');
}

// 纯 Node 拼 PDF:每张 JPEG(DCTDecode 直嵌)占一页 A4,按页宽缩放、顶端对齐。
function writePdf(file, jpgs) {
  const PW = 595.28, PH = 841.89;
  const chunks = [], offsets = [];
  let len = 0;
  const put = b => { const x = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(x); len += x.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    put(`${n} 0 obj\n${body}\n`);
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); }
    put('endobj\n');
  };
  const n = jpgs.length, kids = jpgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  jpgs.forEach((jpg, i) => {
    const p = 3 + i * 3, { w, h } = jpegSize(jpg);
    const dh = Math.min(PH, h * PW / w);
    const content = Buffer.from(`q ${PW} 0 0 ${dh.toFixed(2)} 0 ${(PH - dh).toFixed(2)} cm /Im0 Do Q`, 'latin1');
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, `<< /Length ${content.length} >>`, content);
    obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  });
  const total = 3 + n * 3, xref = len;
  put(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let k = 1; k < total; k++) put(String(offsets[k]).padStart(10, '0') + ' 00000 n \n');
  put(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  writeFileSync(file, Buffer.concat(chunks));
  return len;
}

async function renderOne(page, id, out) {
  await page.setViewport({ width: VIEW_W, height: VIEW_H }); // 每份先复位成常规视口再加载,别带着上一份的超高视口
  await safeGoto(page, urlFor(id)).catch(() => {});          // 超时不致命,下面靠内容判定
  const state = await pollResumeReady(page);
  if (state !== 'ok') return state; // login/captcha/blanked 交调用方中止整批;timeout = 没等到简历,不截
  await expandAll(page);
  await sleep(2500); // 内容出现后再 settle,等图片/布局稳定
  const slices = await captureSlices(page);
  return writePdf(out, slices);
}

// 续跑/重跑命令:失败时打印出来,agent 直接照抄,别整批从头再刷
const cmdFor = its => 'node .claude/skills/pxb-liepin/scripts/pdf.mjs --dir "' + outDir + '" '
  + its.map(it => it.id === it.label ? it.id : it.id + '=' + it.label).join(' ');

// 只接常驻有头浏览器:没有 → 不自己拉(新拉的是未登录态);无头 → 不碰(HeadlessChrome UA 会触发风控)。
const headless = await probeRemoteHeadless();
if (headless === null) {
  console.error(`❌ CDP 端口 ${REMOTE_DEBUGGING_PORT} 上没有常驻的猎聘浏览器。pdf.mjs 只复用 search/fetch 拉起的有头浏览器,不自己开。`);
  console.error('先确认登录态(liepin login),再重跑: ' + cmdFor(items));
  process.exit(1);
}
if (headless === true) {
  console.error(`❌ CDP 端口 ${REMOTE_DEBUGGING_PORT} 上是无头浏览器(HeadlessChrome UA 会触发风控),不用它出 PDF。`);
  console.error('等下一条 search/fetch 把它换成有头(脚本会自动处理),再重跑: ' + cmdFor(items));
  process.exit(1);
}

const fails = [];
let browser, page;
try {
  const ver = await (await fetch(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version`)).json();
  browser = await puppeteer.connect({ browserWSEndpoint: ver.webSocketDebuggerUrl, defaultViewport: null });
  page = await browser.newPage(); // 自己的标签页;常驻标签页不动
  for (let i = 0; i < items.length; i++) {
    const { id, label } = items[i];
    const out = path.join(outDir, `简历_${label}.pdf`);
    const size = await renderOne(page, id, out);
    if (size === 'captcha' || size === 'blanked') {
      process.exitCode = 3;
      console.log(`❌ ${id} ` + (size === 'captcha' ? '打开的是"账号行为异常"验证页' : '页面被猎聘清空(about:blank)') +
        '——风控,中止整批(未存 PDF)。按风控纪律第 1 条处理:释放锁、全停,让用户 `liepin login` 完成验证。');
      console.log('验证通过后续跑剩余: ' + cmdFor(items.slice(i)));
      break;
    }
    if (size === 'login') {
      process.exitCode = 2;
      console.log(`❌ ${id} 打开的是登录页——账号被踢,中止整批(后面只会全是登录页)。`);
      console.log('先 `liepin login` 重登,再续跑剩余: ' + cmdFor(items.slice(i)));
      break;
    }
    if (size === 'timeout') {
      process.exitCode ||= 1;
      fails.push(items[i]);
      console.log(`❌ ${id} 15s 内没等到简历内容(${MARKERS.join('/')})——FAIL,未存 PDF`);
    } else if (size < SMALL_PDF) {
      process.exitCode ||= 1;
      fails.push(items[i]);
      console.log(`❌ ${out} 仅 ${Math.round(size / 1024)}KB,疑似空白/错误页——FAIL,这份别交付`);
    } else {
      console.log(`已存 ${out} (${Math.round(size / 1024)}KB)`);
      try { if (existsSync(LOCK_FILE)) utimesSync(LOCK_FILE, new Date(), new Date()); } catch {} // 同 liepinJson:成功即续锁
    }
    if (i < items.length - 1) await sleep(jitter(4000, 11000)); // 与 fetch 同节奏的抖动
  }
  if (fails.length) console.log('坏页稍后单独重跑: ' + cmdFor(fails));
} catch (e) { console.log('ERR:', e?.message || e); process.exitCode ||= 1; }
// 只关自己的标签页、断开 CDP;绝不 browser.close() / closeRemoteBrowser(关浏览器=登出)
finally {
  await page?.close().catch(() => {});
  await browser?.disconnect()?.catch?.(() => {});
}

if (!process.exitCode) {
  console.log('→ 下一步:node .claude/skills/pxb-liepin/scripts/lock.mjs release <岗位>;交付:每人卡片 + 猎聘链接 + PDF,逐份问合适/不合适各为什么');
}
