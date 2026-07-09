<p align="center">
  <img src="assets/banner.svg" alt="猎聘 AI LOOP 招聘 SKILL — 你打分 AI 迭代，半小时从 1000 份里捞出最对口的那一个" width="100%">
</p>

# 猎聘 AI LOOP 招聘 SKILL

[![license](https://img.shields.io/github/license/dizhouid-lgtm/liepin-ai-loop-recruiting)](LICENSE)
[![release](https://img.shields.io/github/v/release/dizhouid-lgtm/liepin-ai-loop-recruiting)](https://github.com/dizhouid-lgtm/liepin-ai-loop-recruiting/releases)
[![stars](https://img.shields.io/github/stars/dizhouid-lgtm/liepin-ai-loop-recruiting?style=social)](https://github.com/dizhouid-lgtm/liepin-ai-loop-recruiting/stargazers)

> 我的部门缺人已经缺得不行了，每天还看着 HR 慢慢悠悠推过来一两份简历，还都是**，简直太无力了。

这些年我作为用人方越来越觉得：最好的招聘员就是用人端自己。谁天天干这活、将来带这个人，谁最懂要谁，HR 替不了。可筛人偏偏卡在中间——需求交给 HR，他去猜、去搜、捞一摞回来，对不上再来一轮，隔一层糊一层。

所以我给自己做了这套，让用人端直接下场找简历。它是我在 [Pixboom](https://pixboom.com)（我做的高端影像器材出海品牌）招人时磨出来的，跟公司无关，拿去招你自己的人。

怎么用，大概是这样：

开搜前，AI 先跟你把要谁聊清楚——研究你这行的对标公司、读你给的样板简历，再问一句"哪种人看着像、其实不对"，把 JD 里没写明的盲点和反向信号挖出来。

然后它去捞、你来挑：每轮十来分钟，粗筛加精筛过上百份简历，把最对的几个递到你面前。你只管说哪些行、哪些不行、为什么。

它把你的反馈写回 JD，下一轮照更准的画像去捞。几轮下来，捞回来的人越来越像你心里那个。沟通、约面归 HR——它只干一件事：把对的人从人堆里捞干净，放你桌上。

---

## 前置环境（所有人必装，与用什么 AI 无关）

| # | 装什么 | 怎么装 / 验证 |
|---|--------|---------------|
| 1 | **Node.js ≥ 20** | 官网装 LTS。验证 `node -v` |
| 2 | **Chrome 或 Edge** | 常规安装即可(CLI 用它驱动猎聘)。默认位置会自动检测；找不到再设环境变量 `CHROME_PATH` 指向浏览器可执行文件 |
| 3 | **猎聘 CLI(装最新)** | `npm i -g @viyzhu/liepin-cli`。验证 `liepin help`(版本过老 doctor 会查出来,重跑安装命令即升级) |
| 4 | **猎聘招聘者账号** | 需**你自己的猎聘 R 端账号**(能登录 lpt.liepin.com)。**登录这步不用自己敲命令**——首次搜人时 AI 会帮你打开登录页、你扫码即可(见下文流程)。账号本身得你先有 |

> ⚠️ 环境层只需"装好 + 有账号"。**真正的登录、填 JD 都在你跟 AI 的对话里完成,不碰命令行**:你只管说要招什么岗、扫个码,其余 AI 引导。
> mac/Linux 把反斜杠换正斜杠;设环境变量用 `KEY=值 命令` 或 `export KEY=值`。脚本本身跨平台。

装完自检(不需登录)——doctor 全绿即就绪(它会查 cli 版本/无头补丁/锁/残留浏览器):
```bash
node .claude/skills/pxb-liepin/scripts/doctor.mjs
```

## 安装与接入（按你的 AI 工具二选一）

### A. Claude Code（零改造，推荐）
1. 用 Claude Code 打开本文件夹作为工作目录。
2. `CLAUDE.md` 与 `.claude/skills/`(pxb-liepin、liepin-cli)会被**自动发现**。
3. 直接说「给 \<岗位\> 搜人 / 下一轮 / 开简历给我看」，它会自动按 `pxb-liepin` skill 跑流程。

### B. 其他 AI 工具（Codex / Cursor / Copilot / Gemini CLI 等）
这些工具**不会自动发现 `.claude/skills/`**，需手动把 SOP 喂给它:
1. 用该工具打开本文件夹。
2. 入口是根目录 **`AGENTS.md`**(Codex/Cursor/部分 Copilot 会自动读;不自动读的，首条消息让它"先读 AGENTS.md 和那两份 SKILL.md")。
3. `AGENTS.md` 指引它把 `pxb-liepin/SKILL.md`(主流程) + `liepin-cli/SKILL.md`(命令) 当作业手册。
4. **串行执行**:整个流程单账号、单锁、串行,AI 自己从头跑到尾、不用子代理(子代理无并行收益、还更易卡死)；它每轮报一行进度。

## 快速开始：第一次搜人
你只需开口,**JD、建文件夹、登录都交给 AI 引导**:
1. 告诉 AI:「按 `pxb-liepin` 给 \<岗位\> 搜人」——有现成 JD 就直接贴给它;**没有也没关系,开搜前 AI 会先跟你把人员画像聊清**:研究目标公司(对标/竞品/上下游)、读你给的样板简历、问清"哪种人看着像、其实不对",连同硬约束(预算/城市/年龄/招几个)一起写进该岗 `JD.md`,你确认后才开搜。
2. 首次/换机:AI 会打开猎聘登录页,**你扫码**即可(不用敲命令)。
3. 然后它自动跑:抢锁 → 搜一页登台账 → 粗筛挑 ~10 → 精筛按 JD 判 → **轮间报进度**(每轮约 10–20 分钟)→ 攒够一批出 PDF 到 `待定/` → 你复核(说清谁合适/为什么、谁不合适/为什么)→ 入池 + 回写 JD,下一轮更准。

> 想自己先建好岗位文件夹也行:复制 `_共享/模板/` 三件到新文件夹(改名),建空 `待定/`,照 `JD模板.md` 填(公司素材见 `CLAUDE.md`)。

> 🔄 **本工作区还在持续迭代**,每次用之前先 `git pull` 拉最新(AI 也会在开工前自动检查更新,并顺带比对猎聘 CLI 是否落后 npm 最新版——落后会先问你再更新)。你的岗位数据是本地未跟踪文件,`git pull` 不会动。

## 文件结构
```
liepin-ai-loop-recruiting/
├── README.md            本文件:装环境 + 接入
├── CLAUDE.md            背景 + 结构(岗位中立)。Claude Code 自动读
├── AGENTS.md            同上镜像,给非 Claude 工具
├── LICENSE              MIT
├── .claude/skills/
│   ├── pxb-liepin/      作业流程 SKILL.md + scripts/(跨平台 Node 脚本)
│   └── liepin-cli/      猎聘命令参考
└── _共享/
    ├── 搜索队列.md       多对话/多岗排队防互顶
    ├── 公司档案.md       目标公司研究底料(全岗共用)
    └── 模板/            新岗位从这里复制三件
```
治理原则:**判断只看各岗 `JD.md`;通用背景/结构在 `CLAUDE.md`;作业程序在 `pxb-liepin` skill;机械脚本在 `scripts/`。**

## 隐私
简历只存本地、不外发、不传任何外部服务。本仓库不含真实候选人数据;`.gitignore` 已堵死 PDF、登录态与岗位数据，防误传。

## 换公司用
本流程与脚本**岗位中立、公司无关**。换公司只改 `CLAUDE.md`「关于 Pixboom」一节 + 各岗 `JD.md`。

## License
[MIT](LICENSE) © 2026 Lessugar

---

### 故障速查
| 现象 | 处理 |
|---|---|
| `liepin: command not found` | 前置第 3 步没装好;`npm i -g @viyzhu/liepin-cli`，确认 `npm bin -g` 在 PATH |
| 脚本报"定位 @viyzhu/liepin-cli 失败" | 同上;`pdf.mjs` 靠 `npm root -g` 找包 |
| 搜索/拉简历非零退出 | 多半反爬或被踢:停手、别连刷、重登 `liepin login`，降低频率 |
| 出 PDF 存成登录页 | 账号被踢。`pdf.mjs` 会检测登录页、中止整批并非零退出;重登后用它打印的命令续跑剩余 |
| 搜人/精筛时弹有头浏览器 | AI 绕过脚本裸调了 `liepin`，或没先登录。让它只用 `scripts/*.mjs`;并跑一次 `patch-headless.mjs` 当安全网 |
| 粗筛卡很久 / 长时间无响应 | liepin 卡死(反爬/滑块/未登录/Chrome 卡住)。脚本已内置硬超时(search 6min、resume 2.5min),超时会自动中断报错**并清掉残留浏览器进程**;若反复超时:**确认已登录、过几分钟换时段**,别连刷(残留进程也可 `doctor.mjs --kill` 手动清)。`--limit` 仅排查时临时调小,排查完放回 40(漏斗要宽才挑得出人) |
| 精筛看不到逐段职责(duty) | liepin-cli 版本过老,`doctor.mjs` 会拦;`npm i -g @viyzhu/liepin-cli` 升到最新即可 |
| 多对话/多岗同时搜 | 不支持并发:单账号单锁，靠 `_共享/搜索队列.md` 排队 |
