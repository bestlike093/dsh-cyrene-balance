# dsh-cyrene-pet

昔涟桌面桌宠的 DeepSeek Harness（DSH）版：透明置顶窗口、Live2D 立绘、拖拽贴边、点击穿透、气泡台词、状态面板、右键菜单，并接管对话提问、风险审批与任务进程。

> 仓库名 `dsh-cyrene-balance` 是它最早做余额插件时留下的，包名与插件目录已经改成 `dsh-cyrene-pet`。安装时认包名和目录，不认仓库名。

## 功能

| 能力 | 状态 |
| --- | --- |
| 透明无边框置顶窗口 | ✅ |
| Live2D 模型渲染（moc3 + 物理 + 纹理） | ✅ |
| 12 个表情 / 5 组动作 / 自动眨眼与呼吸 | ✅ |
| 视线跟随鼠标 | ✅ |
| 点击命中区域触发表情与动作 | ✅ |
| 鼠标拖拽移动、拖到屏幕边缘吸附贴边 | ✅ |
| 窗口位置与缩放记忆 | ✅ |
| 非立绘区域点击穿透，不挡桌面操作 | ✅ |
| 气泡台词轮换、说话时口型动画 | ✅ |
| 状态面板（CPU / 内存 / GPU / 网速 / 电量 / 余额） | ✅ |
| 状态面板三档详细度 + 折叠 | ✅ |
| dsh 设置页「昔涟 · 桌宠」卡片：启动 / 重启 / 关闭 | ✅ |
| 右键菜单（面板开关 / 气泡模式 / 刷新余额 / 设置 / 隐藏） | ✅ |
| 设置浮层（昵称 / 缩放 / 气泡 / 状态栏 / 提问 / 互动 / 余额） | ✅ |
| DeepSeek 余额与今日消费 | ✅ |
| 对话提问由桌宠逐题接管（`ask_user_question`，四种模式） | ✅ |
| 风险审批（`approval/request`）：桌宠里「允许一次 / 拒绝」 | ✅ |
| 任务进程：读 `todos` 投影，长按播报当前进度 | ✅ |
| 系统托盘 | ✅（无托盘图标资源时自动跳过） |

## 下载

最新安装包：**dsh-cyrene-pet-1.0.0.zip**

- 夸克网盘：[https://pan.quark.cn/s/0f1c821ace8a](https://pan.quark.cn/s/0f1c821ace8a)
- 打开方式：复制链接后在浏览器访问，或打开夸克 APP 自动识别。

## 安装

### 方式一：从压缩包

解压后把整个 `dsh-cyrene-pet/` 目录放到 dsh 的插件目录，再注册：

```bash
dsh plugin --profile desktop add <解压后的 dsh-cyrene-pet 目录>
```

### 方式二：从源码目录

```bash
dsh plugin --profile desktop add <本目录>
```

装好后需要重启 dsh，插件会在启动时自动部署桌宠运行时并拉起桌宠进程。

### 首次启动会做什么

桌宠复用 dsh 自带的 Electron 运行时，不额外下载一套。首次启动时自动执行：

1. 在 `~/.dsh/storages/cyrene-pet/runtime/` 下，用硬链接复制 dsh 安装目录里的 Electron 文件（必须与 dsh 同盘；跨盘时硬链接会被系统拒绝，改用复制）
2. 删除 `resources/app.asar`，把 `resources/app` 目录链接到本插件的 `pet/` 目录
3. 用这个运行时启动 `DeepSeek Harness.exe --no-sandbox`

`resources/app` 是目录链接，所以改 `pet/` 下的代码后重启桌宠进程即可生效，不需要重新部署运行时。

> 宿主若以 Node 模式运行（`ELECTRON_RUN_AS_NODE=1`，用 Electron 二进制跑 Node），桌宠会被当成 Node 直接退出。宿主半在 spawn 时会把这个标记从子进程环境里摘掉；手动排查时也记得先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`。

## 开关与重启

两条路都能启停桌宠，不用重启 dsh：

- **dsh 设置页 →「昔涟 · 桌宠」**：看运行状态、启动 / 重启 / 关闭。桌宠没跑也能用，走宿主半的 `POST /cyrene-pet/control`（`action: start | stop | restart`）。
- **桌宠设置 → 桌宠进程**：重启桌宠 / 关掉桌宠两个按钮，通过 `pet-command.json` 交给宿主半处理。

关闭会把 `state.enabled` 记成 `false`，dsh 下次启动不会自动拉起；在 dsh 设置卡片里点「启动」会重新打开。

## 交互

- 拖动立绘移动窗口，松手后自动贴边
- 单击立绘：随机台词 + 动作
- 长按立绘：说一遍当前任务进程（任务清单在右键菜单「任务进程」里看）
- 右键立绘或状态面板：打开菜单（面板开关 / 气泡模式 / 说句话 / 任务进程 / 换姿势 / 刷新余额 / 设置 / 隐藏）
- 双击状态面板右上角 `···`：折叠 / 展开
- 托盘菜单：显示 / 隐藏、置顶、说句话、换姿势、刷新余额、退出

缩放和详细度只在设置浮层里改一处，右键菜单与托盘不再重复放同一项。

## 设置

右键 →「设置」，分六组：

| 组 | 设置项 |
| --- | --- |
| 形象与气泡 | 昵称、缩放、气泡字号、气泡形状、气泡不透明度 |
| 状态栏 | 显示状态栏、详细度、不透明度 |
| 提问 | 闲聊提问（关闭 / 15 分钟～2 小时）、对话与审批（四种模式） |
| 互动 | 自动换姿势（关闭 / 30 秒～5 分钟）、音效（关闭 / 轻 / 中 / 响） |
| 桌宠进程 | 重启桌宠、关掉桌宠 |
| 余额 | API Key、余额提醒阈值、今日额度 |

合并说明：

- 「开启提问 + 提问间隔」合并为一个下拉，选「关闭」即原来的关闭。
- 「自动换姿势 + 间隔」合并为一个下拉，选「关闭」即原来的关闭。
- 「音效开关 + 音量」合并为一个下拉，选「关闭」即静音。
- 气泡字号由四档收敛为三档，气泡形状去掉 2px 这一档，气泡模式去掉「只显示余额数字」（和「余额」模式重复）。
- 余额刷新间隔固定 30 秒缓存，设置里不再单列。
- 移除三个从未生效的字段：`avatar`、`x`、`y`。

旧版 `state.json` 会在加载时自动迁移：`askEnabled: false` → `askEveryMinutes: 0`，`idlePose: false` → `poseSeconds: 0`，`soundEnabled: false` → `soundVolume: 0`。

API Key 的解析顺序：设置面板填写的 Key → 环境变量 `DEEPSEEK_API_KEY` → `~/.dsh/.credentials.yaml` 里的 `DEEPSEEK_API_KEY`。已经用 dsh 登录过 DeepSeek 的机器不需要再填一次。

## 气泡模式

| 模式 | 内容 |
| --- | --- |
| `rotate` | 台词与余额交替 |
| `info` | 一直显示余额 |
| `talk` | 只显示台词 |
| `today` | 今日消费 |

## 对话提问接管

对话里 `ask_user_question` 的题目可以交给桌宠：宿主半把整批题目写进 `live.json` 的 `ask` 字段（带 `source: "conversation"`），桌宠用提问气泡逐题问，答完一次性回传。

「设置 → 提问 → 对话与审批」有四种模式（风险审批也按同一个模式走）：

| 值 | 行为 |
| --- | --- |
| `pet-all`（默认） | 桌宠逐题问。一批多题时气泡里显示「第 2/3 题」，答完整批一起交回；某题点「跳过」就记成空选项 |
| `pet-single` | 桌宠只接单题批次，多题批次直接交给网页卡片 |
| `both` | 网页卡片照常弹、桌宠也问，谁先答用谁的 |
| `web` | 完全不接管，只走网页卡片 |

规则：

- 每题都带选项、且没有 `intent` 的批次才会进桌宠；需要自由作答或 `plan-review` 审阅的整批仍交给网页卡片。
- 多选题在气泡里点选后按「答好了♪」提交；单选项点一下直接进下一题。
- 等待时长按题数加长：单题 45 秒，之后每多一题加 25 秒；到时把请求 `next()` 交还网页卡片，不会一直卡着。
- 桌宠没运行、被禁用，或已经有一批题在等回答时，新的请求直接走网页卡片。
- 回答通过 `pet-command.json` 的 `{ action: "answer", askId, answers: [{ id, selected }] }` 回到宿主半。
- 提问到达时如果桌宠是收起状态，会自动显示出来（不抢焦点）。

## 风险审批

沙箱越权这类操作会走 dsh 的 `approval/request` waterfall，桌宠接在同一条链路的入口。

- 气泡显示「想请你批准一下」，正文是「工具名 + 想越权执行」和本地化理由（`displayReason` 优先中文，退回英文，再退回审计原因）。
- 只有两个决定：允许一次 / 拒绝，结果原样回给审批服务（`allowed-once` / `rejected`）。
- 60 秒没决定、请求被撤回或桌宠没运行，就交还网页卡片；撤回按 `cancelled` 结算。
- 审批和对话提问共用「设置 → 对话与审批」这一个模式开关，四种模式含义完全一致。
- 同一时间只挂起一个审批，第二个请求会走网页卡片。

## 任务进程

桌宠宿主半读 dsh 的 `todos` 会话投影（`dsh-tool-todo` 写的那份），把最近一次活动的根会话里的任务写进 `live.json` 的 `todos` 字段。

- 任务面板里列出任务清单（最多 6 条，`✓` 已完成 / `▶` 进行中 / `·` 待办），并显示「任务进程 x/y 完成」。
- 长按立绘：桌宠口头播报一遍进度，例如「任务 2/5 完成，正在做『接入任务进程』，还排着 2 件…」；面板会挡住气泡，所以任务清单放在右键菜单「任务进程」里看。
- 全部完成时播报「刚才那批任务都完成啦」；没有任务卡时说「现在手上还没有任务卡呢」。
- 只跟根会话走：子代理的会话不会顶掉你正在做的任务。

## 数据文件

全部位于 `~/.dsh/storages/cyrene-pet/`：

| 文件 | 作用 |
| --- | --- |
| `state.json` | 插件设置（昵称、API Key、阈值、缩放等） |
| `live.json` | 宿主半写给桌宠的实时数据（台词、余额、HUD、提问、任务） |
| `pet-status.json` | 桌宠渲染层回报的状态（模型尺寸、HUD 位置、渲染像素统计） |
| `pet-window.json` | 窗口位置与当前缩放 |
| `pet-command.json` | 桌宠发回宿主半的命令（改设置、刷新余额、回答提问） |
| `ledger.json` | 本地消费账本（用于算今日消费） |

`live.json` 每 4 秒刷新一次，`pet-command.json` 每 1.2 秒轮询一次。

余额接口只访问 `https://api.deepseek.com/user/balance`，默认 30 秒缓存；今日消费由余额变化推断，充值不会冲掉已记录的消费。

## 宿主接口

桌宠进程通过本地文件与宿主半通信，宿主半同时暴露这些 HTTP 路由（挂在 dsh 的 webServer 上）：

- `GET /cyrene-pet/state` / `POST /cyrene-pet/state`
- `POST /cyrene-pet/control`（`action: start | stop | restart`）
- `GET /cyrene-pet/balance`
- `GET /cyrene-pet/hud`
- `GET /cyrene-pet/asset/:name`

## 和 Cyrene 版桌宠的差别

| 能力 | Cyrene 版「昔涟 · 桌面桌宠」 | 本仓库（DSH 版） |
| --- | --- | --- |
| 宿主 | Cyrene 客户端 | dsh + 独立的 Electron 渲染进程 |
| 立绘 | 8 种姿态、44 张小表情（静态素材） | Live2D 模型：12 个表情、5 组动作、眨眼呼吸、视线跟随 |
| 窗口 | 桌面透明立绘 | 透明无边框置顶、拖拽贴边、点击穿透 |
| 气泡 | 台词、提问卡、任务气泡 | 台词气泡 + 口型动画 + 四种气泡模式 |
| 状态面板 | 三档详细度 | CPU / 内存 / GPU / 网速 / 电量 / 余额，三档 + 折叠 |
| 余额 | 有 | 有（同一套 DeepSeek 接口，30 秒缓存） |
| 提问 | 提问卡 | 接管 `ask_user_question`，四种模式 |
| 风险审批 | — | 接管 `approval/request`，允许一次 / 拒绝 |
| 任务 | 任务气泡 | 读 `todos` 投影，长按播报 |
| 安装 | Cyrene 插件目录 | `dsh plugin add` 或解压到插件目录 |

## 和旧版 dsh-cyrene-balance 的差别

| 项目 | 旧版 | 现在 |
| --- | --- | --- |
| 形态 | 纯工具插件，5 个余额工具 | 桌面桌宠 + 宿主半 |
| 界面 | 无 | 透明置顶窗口、Live2D、气泡、状态面板 |
| 余额 | `deepseek_balance` 等工具 | 桌宠显示，宿主半提供 `/cyrene-pet/balance` |
| 配置 | `cordis.patch.yml` | 设置浮层 + `state.json` |
| 提问 / 审批 / 任务 | 无 | 全部接管 |
| 包名 | `dsh-cyrene-balance` | `dsh-cyrene-pet` |

## 已知限制

- 只支持 Windows 的透明置顶窗口行为
- 运行时依赖 dsh 安装目录，卸载 dsh 后桌宠也会随之中断
- 余额接口受 DeepSeek 平台限流影响，默认 30 秒缓存一次
- `ledger.json` 只记录本插件运行期间的余额变化，首次启动时今日消费从 0 开始累计
- 提问只支持「从选项里选」；需要自由输入的题、以及 `plan-review` 审阅，仍要回网页卡片
- 同一时间只接管一批提问，第二批会走网页卡片
- 审批只提供一次性授权（`allowed-once`），没有「总是允许」或规则记忆；需要长期放行请改会话的审批策略

## 目录

```text
dsh-cyrene-pet/
├─ lib/
│  ├─ index.js       宿主半：设置、余额、系统状态、提问、审批、任务、桌宠进程管理
│  └─ client.js      dsh 设置页「昔涟 · 桌宠」卡片
├─ pet/              Electron 渲染半
│  ├─ main.js        透明窗口、拖拽、贴边、托盘、诊断截图
│  ├─ preload.js     IPC 桥
│  ├─ index.html     气泡 / 状态面板 / 菜单 / 设置
│  ├─ renderer.js    Live2D、命中检测、交互、渲染
│  ├─ style.css      气泡与面板样式
│  └─ assets/live2d  渲染库与 Live2D 模型（moc3 / expressions / motions / physics3）
├─ assets/           静态立绘、表情与气泡素材
├─ cordis.patch.yml  插件注入声明
└─ package.json
```

## 素材与版权

仓库内的立绘、表情与状态面板素材来自 Cyrene 客户端自带素材库（`resources/app.asar` 内的 `assets/ui/cyrene-thinking-loop/`、`dist/renderer/stickers/`、`dist/renderer/icons/mimi.png`），处理方式与逐项对照见 [cyrene-balance 的 MATERIALS.md](https://github.com/bestlike093/cyrene-balance/blob/main/MATERIALS.md)。

- 角色「昔涟」及《崩坏：星穹铁道》的名称、形象与美术归 HoYoverse / 米哈游所有。
- Live2D 模型由 B 站 UP 主 [@是依七哒](https://space.bilibili.com/457683484) 制作。
- 本仓库的代码以 MIT 许可发布。

## 许可

MIT
