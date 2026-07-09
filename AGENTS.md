# AGENTS.md — 给非 Claude 的 AI 编码工具(Codex / Cursor / Copilot / Gemini CLI 等)

本文件只是入口指路,**不含作业内容**。Claude Code 会自动读 `CLAUDE.md` 并自动发现 `.claude/skills/`;其他工具通常不会,所以要你**手动读**下面三份,读完照做:

1. `CLAUDE.md` —— 背景 + 文件结构 + **用前先更新**(git 拉最新;开始任何任务前先做)。
2. `.claude/skills/pxb-liepin/SKILL.md` —— 搜人/筛人**全部作业流程**(含红线)。搜任何人之前先读它,严格照步骤执行。
3. `.claude/skills/liepin-cli/SKILL.md` —— 猎聘 CLI 登录与故障参考。

判断标准只看各岗 `JD.md`。

## 与 Claude Code 的差异(仅这几条,其余全在 SKILL 里)
- **skill 不会自动触发**:把上面的 SKILL 当普通 SOP 文档,任务相关时主动读取。
- **你自己从头串行跑,不用子代理**:单账号单锁,没有并行收益;每跑完一轮输出一行进度。
- **机械活已脚本化**:所有 liepin 调用都走 `.claude/skills/pxb-liepin/scripts/*.mjs`(Node,跨平台),SKILL 里的命令带全路径,照抄即可;相对路径相对工作区根目录。
