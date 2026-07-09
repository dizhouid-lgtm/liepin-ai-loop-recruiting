// 新岗位一键建档——复制模板三件 + 建两个空文件夹,替代手动照 CLAUDE.md 抄结构。
// 用法: node init-role.mjs "<岗位名>"   (在工作区根目录运行)
// 幂等:已存在的文件/文件夹跳过不覆盖,只补缺的。
import path from 'path';
import { existsSync, mkdirSync, copyFileSync } from 'fs';

const role = process.argv[2];
if (!role) { console.error('用法: node .claude/skills/pxb-liepin/scripts/init-role.mjs "<岗位名>"'); process.exit(2); }

const tplDir = path.join('_共享', '模板');
if (!existsSync(tplDir)) { console.error('找不到 _共享/模板/——请在工作区根目录运行。'); process.exit(1); }

mkdirSync(role, { recursive: true });
const files = [
  ['JD模板.md', 'JD.md'],
  ['候选人池模板.md', '候选人池.md'],
  ['去重台账模板.csv', '去重台账.csv'],
];
for (const [from, to] of files) {
  const dst = path.join(role, to);
  if (existsSync(dst)) { console.log('  ⏭ 已存在,跳过: ' + dst); continue; }
  copyFileSync(path.join(tplDir, from), dst);
  console.log('  ✓ ' + dst);
}
for (const d of ['待定', '参考简历']) {
  const dst = path.join(role, d);
  existsSync(dst) ? console.log('  ⏭ 已存在,跳过: ' + dst + '/') : (mkdirSync(dst), console.log('  ✓ ' + dst + '/'));
}
console.log(`✓ 「${role}」建档完成 → 下一步:按 SKILL 步骤 P 跟用户聊全 JD(填 ${role}/JD.md),再开搜`);
