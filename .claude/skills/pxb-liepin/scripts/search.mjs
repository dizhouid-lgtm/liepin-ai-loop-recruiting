// 粗筛取数——跨平台(替原 PowerShell 步骤1 整块)。
// 一步完成:liepin search(默认带服务端求职状态过滤)→ 去掉台账里已召回的 → 新人登记「未精筛」
// → 打印窄表给 agent 判断。原始 JSON 不进上下文,只输出窄表(id/姓名/现职/年龄/公司/年限/期望薪资/学历/期望职位)。
// 用法: node search.mjs <csv> "<关键词>" [--city 深圳] [--limit 40] [--experience 3-5年] [--salary 20-30K] [--degree 本科] [--age 25-35] [--user-status 1,2]
//
// 服务端过滤(CLI 原生 --user-status/--age 直接透传;版本下限由 doctor 把关):
// - 求职状态:默认 1,2,5,6,7 = 排除「在职,暂无跳槽打算」「在校,暂时不找工作」(SKILL 通用排除③,
//   约不动、议价难),这类人根本不进召回、不占名额、不耗 fetch。--user-status 不限 可关;码表见 `liepin search --help`。
// - 年龄:--age 25-35(或 25,35),JD 有年龄硬约束就传;不传不过滤。2026-07 实测边界严格生效。
import { readLedger, writeLedger } from './_csv.mjs';
import { liepinJson } from './_liepin.mjs';

const [csv, query, ...flags] = process.argv.slice(2);
if (!csv || !query) { console.error('用法: node search.mjs <csv> "<关键词>" [--city .. --limit .. --experience .. --salary .. --degree .. --user-status ..]'); process.exit(2); }

// --user-status / --age:截下来规范化后原样透传给 CLI。
// 求职状态不传 = 默认排除"暂无跳槽打算/在校不找";传 "不限" = 不过滤。年龄不传 = 不过滤。
function takeFlag(name) {
  const i = flags.indexOf(name);
  if (i < 0) return undefined;
  const v = flags[i + 1] || '';
  flags.splice(i, 2);
  return v;
}
const userStatus = takeFlag('--user-status') ?? '1,2,5,6,7';
if (userStatus && userStatus !== '不限') flags.push('--user-status', userStatus);
const age = (takeFlag('--age') || '').replace('-', ',');
if (age) {
  if (!/^\d{2},\d{2}$/.test(age)) { console.error(`--age 格式不对(要 25-35 或 25,35),收到:${age}`); process.exit(2); }
  flags.push('--age', age);
}
let usNote = (userStatus && userStatus !== '不限')
  ? `求职状态过滤=${userStatus}(默认排除"在职,暂无跳槽打算"等;--user-status 不限 可关)` : '求职状态不过滤';
if (age) usNote += `;年龄过滤=${age}`;

let raw;
try { raw = liepinJson(['search', JSON.stringify(query), ...flags], { open: '[', timeoutMs: 360000 }); }  // 6min:自动翻页给宽
catch (e) { console.error('搜索失败,停手；看报错:\n' + e.message); process.exit(1); }
if (!Array.isArray(raw)) { console.error('搜索返回的不是列表(可能被踢/接口变了),停手:\n' + JSON.stringify(raw).slice(0, 300)); process.exit(1); }

const rows = readLedger(csv);
const seen = new Set(rows.map(r => r.resume_id));
const fresh = raw.filter(x => x.resume_id && !seen.has(x.resume_id));

// 全员登 CSV(查重命根),新人一律「未精筛」
for (const x of fresh) rows.push({ resume_id: x.resume_id, status: '未精筛' });
writeLedger(csv, rows);

// 窄表:卡片只有这几列,判不了能力,只够砍硬约束 + 挑 ~10 进精筛
console.log(`本次召回 ${raw.length}，新增 ${fresh.length}（其余已在台账,跳过）;${usNote}`);
console.log('id\t姓名\t现职\t年龄\t公司\t年限\t期望薪资\t学历\t期望职位');
for (const x of fresh) {
  console.log([x.resume_id, x.name, x.current_title, x.age, x.company, x.experience, x.salary, x.degree, x.title]
    .map(v => v ?? '').join('\t'));
}

// 下一步提示:每轮把三桶纪律重新打进上下文,防长循环漂移
if (!fresh.length) {
  console.log(`→ 本页无新人(全在台账里):换关键词,或挖库存 node .claude/skills/pxb-liepin/scripts/dedup.mjs list "${csv}" 未精筛`);
} else {
  console.log(`→ 下一步(三桶,别漏):卡面即否 → node .claude/skills/pxb-liepin/scripts/dedup.mjs set "${csv}" 粗筛不合适 <id...>`);
  console.log('  ~10 个最对口 → node .claude/skills/pxb-liepin/scripts/fetch.mjs <id...>;其余不动,留「未精筛」当库存');
}
