// 去重台账增删改查——跨平台(替原 PowerShell 的 Import-Csv/Export-Csv 块)。
// 台账只为查重:resume_id,status;状态五值 未精筛/粗筛不合适/精筛不合适/待定/入选。
// 用法:
//   node dedup.mjs seen  <csv>                  打印已收录的 resume_id(每行一个),供搜索去重
//   node dedup.mjs add   <csv> <id...>          新 id 登记为「未精筛」(已存在的跳过),整表重写
//   node dedup.mjs set   <csv> <状态> <id...>   把这些 id 改成指定状态
//   node dedup.mjs list  <csv> <状态>           打印某状态的全部 resume_id(回扫错杀/复判库存用)
//   node dedup.mjs stats <csv>                  打印各状态计数 + 未精筛:精筛 比(健康≈4:1)
import { readLedger, writeLedger } from './_csv.mjs';

const [cmd, csv, ...rest] = process.argv.slice(2);
if (!cmd || !csv) { console.error('用法见脚本头注释'); process.exit(2); }
const STATUSES = ['未精筛', '粗筛不合适', '精筛不合适', '待定', '入选'];

if (cmd === 'seen') {
  for (const r of readLedger(csv)) console.log(r.resume_id);

} else if (cmd === 'add') {
  const rows = readLedger(csv);
  const have = new Set(rows.map(r => r.resume_id));
  let n = 0;
  for (const id of rest) if (id && !have.has(id)) { rows.push({ resume_id: id, status: '未精筛' }); have.add(id); n++; }
  writeLedger(csv, rows);
  console.log(`新增 ${n} 条「未精筛」,台账共 ${rows.length} 条`);

} else if (cmd === 'set') {
  const [status, ...ids] = rest;
  if (!STATUSES.includes(status)) { console.error(`状态须是: ${STATUSES.join(' / ')}`); process.exit(2); }
  const target = new Set(ids);
  const rows = readLedger(csv);
  let n = 0;
  for (const r of rows) if (target.has(r.resume_id)) { r.status = status; n++; }
  writeLedger(csv, rows);
  console.log(`${n} 条改为「${status}」`);

} else if (cmd === 'list') {
  const [status] = rest;
  if (!STATUSES.includes(status)) { console.error(`状态须是: ${STATUSES.join(' / ')}`); process.exit(2); }
  for (const r of readLedger(csv)) if (r.status === status) console.log(r.resume_id);

} else if (cmd === 'stats') {
  const rows = readLedger(csv);
  const c = {};
  for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
  for (const s of STATUSES) console.log(`${s}: ${c[s] || 0}`);
  const fine = (c['精筛不合适'] || 0) + (c['待定'] || 0) + (c['入选'] || 0);
  console.log(`未精筛:精筛 = ${(c['未精筛'] || 0)}:${fine}${fine ? ' (≈' + ((c['未精筛'] || 0) / fine).toFixed(1) + ':1)' : ''}`);
  if (c['待定']) console.log(`⚠ 待定 ${c['待定']} 条挂账 → 先交付复核/催拍板清算(步骤4-5),再开新搜`);

} else { console.error('未知命令: ' + cmd); process.exit(2); }
