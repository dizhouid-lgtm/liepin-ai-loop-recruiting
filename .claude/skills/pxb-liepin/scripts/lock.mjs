// 单账号搜索锁——跨平台(替原 PowerShell 抢锁块)。
// 单账号串行调 liepin,绝不并发。锁文件 ~/.liepin-cli/.search-lock,30 分钟过期;
// liepin 每次成功调用会自动 touch 锁(见 _liepin.mjs),长回合不会中途过期。
// renew/release 校验岗位:锁在别岗手里时续不动、放不掉(防两个会话并发调 liepin)。
// 用法:
//   node lock.mjs acquire <岗位>   抢锁;占用中且未过期 → 退出码 1(调用方应排队)
//   node lock.mjs renew   <岗位>   每轮回搜前续命;非本岗持锁 → 退出码 1(重新排队)
//   node lock.mjs release <岗位>   步骤4 出 PDF 交复核时释放;非本岗持锁且未过期 → 退出码 1(不动别人的锁)
import path from 'path';
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from 'fs';
import { LOCK_FILE } from './_liepin.mjs';

const STALE_MIN = 30;
const action = process.argv[2];
const label = process.argv[3] || '未命名岗位';
const lock = LOCK_FILE;

// 每轮开工前把纪律重新打进上下文——长循环里 SKILL 正文会被压缩掉,靠这几行防漂移。
const DISCIPLINE =
  '本轮纪律:① 先发一行心跳再继续 ② 粗筛三桶:即否→set 粗筛不合适 / ~10 最对口→fetch 精筛 / 其余留未精筛 ' +
  '③ 精筛完立刻 set 待定|精筛不合适 ④ stats 看待定,≥5 → 出 PDF + release ⑤ jd-round 记本轮';

// 锁内容格式「占锁:<岗位> <ISO时间>」,读出岗位名
function holder() {
  try { return (readFileSync(lock, 'utf8').match(/^占锁:(.+?) \S+$/) || [])[1] || '未知'; }
  catch { return '未知'; }
}
function ageMin() { return (Date.now() - statSync(lock).mtimeMs) / 60000; }
function stamp() {
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, `占锁:${label} ${new Date().toISOString()}`, 'utf8');
}

if (action === 'acquire') {
  if (existsSync(lock)) {
    const age = ageMin();
    if (age < STALE_MIN) { console.error(`别处在搜(「${holder()}」,锁 ${age.toFixed(1)} 分钟前更新),排队`); process.exit(1); }
    console.error(`锁已过期(「${holder()}」,${age.toFixed(1)} 分钟),夺锁`);
  }
  stamp();
  console.log('已占锁:' + label);
  console.log(DISCIPLINE);
} else if (action === 'renew') {
  if (!existsSync(lock)) { console.error('锁不存在,无法续命——先 acquire'); process.exit(1); }
  const h = holder();
  if (h !== label) { console.error(`锁在「${h}」手里,不是「${label}」的,别续——重新 acquire 排队`); process.exit(1); }
  stamp();
  console.log('已续命:' + label);
  console.log(DISCIPLINE);
} else if (action === 'release') {
  if (!existsSync(lock)) { console.log('锁本就不在,视为已释放'); }
  else {
    const h = holder();
    if (h !== label && ageMin() < STALE_MIN) { console.error(`锁在「${h}」手里(${ageMin().toFixed(1)} 分钟前活跃),不动`); process.exit(1); }
    rmSync(lock, { force: true });
    console.log(h !== label ? `已清掉「${h}」的过期锁` : '已释放锁:' + label);
  }
} else {
  console.error('用法: node lock.mjs acquire|renew|release <岗位>');
  process.exit(2);
}
