// 精筛取数——跨平台(替原 PowerShell 步骤2 的 resume 循环)。
// 一个循环拉完本页挑出的 ~10 份 = 1 个回合,别开一份判一份。每份间随机抖动防封。
// 失败分两类:
//   账号级(超时/反爬/未登录/连续 2 份失败)→ 整批停(非零退出),打印续跑命令;
//   单份级(该简历已删/隐藏/无权限)→ 跳过继续,结尾列出。
// 原始 JSON 不进上下文,只打窄字段供按 JD 下判决。
// 用法: node fetch.mjs <id1> <id2> ...
import { liepinJson, sleep, jitter } from './_liepin.mjs';

const ids = process.argv.slice(2);
if (!ids.length) { console.error('用法: node fetch.mjs <resume_id...>'); process.exit(2); }

const AUTH_RE = /登录|扫码|被踢|验证|滑块/;  // 出现在原始输出/stderr 里 = 账号级问题
const skipped = [];
let consecFail = 0;

for (let k = 0; k < ids.length; k++) {
  const id = ids[k];
  let r;
  try {
    r = liepinJson(['resume', id], { open: '{', timeoutMs: 150000 });  // 2.5min:单份应很快,超了即异常
    consecFail = 0;
  } catch (e) {
    consecFail++;
    const authy = e.kind === 'timeout' || e.kind === 'spawn' || AUTH_RE.test(e.detail || '');
    if (authy || consecFail >= 2) {
      console.error(`\n第 ${k + 1}/${ids.length} 份(${id})失败,` +
        (authy ? '账号级问题(超时/反爬/未登录)' : `连续 ${consecFail} 份失败(多半不是简历问题)`) + ',整批停手:\n' + e.message);
      if (skipped.length) console.error('本回合已跳过(单份打不开): ' + skipped.join(' '));
      console.error('处置后续跑剩余: node .claude/skills/pxb-liepin/scripts/fetch.mjs ' + ids.slice(k).join(' '));
      process.exit(1);
    }
    console.error(`⚠️ ${id} 打不开(疑似已删/隐藏/无权限),跳过: ` + e.message.split('\n')[0]);
    skipped.push(id);
    if (k < ids.length - 1) await sleep(jitter(4000, 11000));
    continue;
  }

  const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]));
  console.log('==== ' + id + ' ====');
  // 精筛只取「粗筛卡片看不到」的字段——卡片已有 现职/年龄/公司/年限/期望薪资/学历/期望职位,不重复抓。
  // work_history 每段含 duty(逐段职责)= 精筛主看;self_descr 次要(自述,详略不一)。
  // want_city=迁城信号;want_salary 留着供关3 判薪资-成色错配;work_status=约不约得动;industry/education_history(学校)=方向与学校。
  console.log(JSON.stringify(
    pick(r, ['name', 'want_city', 'want_salary', 'industry', 'education_history',
             'work_status', 'work_history', 'self_descr']),
    null, 1));
  if (k < ids.length - 1) await sleep(jitter(4000, 11000)); // 反爬抖动 4-11s
}

console.error(`本回合 ${ids.length - skipped.length}/${ids.length} 份拉完。`);
if (skipped.length) console.error('打不开已跳过(一般直接 set 精筛不合适): ' + skipped.join(' '));
console.error('→ 判完立刻归档:node .claude/skills/pxb-liepin/scripts/dedup.mjs set "<岗位>\\去重台账.csv" 待定|精筛不合适 <id...>;再 stats 看待定,≥5 → 出 PDF');
