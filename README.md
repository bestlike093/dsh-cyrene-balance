# dsh-cyrene-pet

昔涟桌面桌宠的 DeepSeek Harness（DSH）版：透明置顶窗口、Live2D 立绘、拖拽贴边、点击穿透、气泡台词、状态面板、右键菜单，并接管对话提问、风险审批与任务进程。

> 仓库名 `dsh-cyrene-balance` 是它最早做余额插件时留下的，包名与插件目录已经改成 `dsh-cyrene-pet`。安装时认包名和目录，不认仓库名。

- 作者：**柒柒（bestlike093）**
- 适用平台：Windows
- 当前版本：**1.0.0**

## 五分钟上手

1. 下载 `dsh-cyrene-pet-1.0.0.zip` 并解压到任意目录，例如 `D:\plugins\dsh-cyrene-pet`。
2. 在终端执行：

   ```bash
   dsh plugin --profile desktop add D:\plugins\dsh-cyrene-pet
   ```

3. 重启 dsh。
4. 桌面上出现透明立绘，单击会说话，说明运行时部署成功。
5. 右键立绘 →「设置」→「余额」，填入 DeepSeek API Key；不填也可以，插件会依次读环境变量 `DEEPSEEK_API_KEY` 和 `~/.dsh/.credentials.yaml`。
6. 右键 →「刷新余额」，状态面板出现数字，两边握手完成。

装完可以用这三件事自查：

| 检查 | 通过的样子 |
| --- | --- |
| 运行时 | 立绘出现，单击有台词和动作 |
| 宿主通信 | 状态面板有 CPU / 内存 / 余额数字，刷新余额会变化 |
| 三块接管 | Agent 提问弹在桌宠、越权审批弹在桌宠、长按立绘有任务播报 |

## 它现在能做什么

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

| 来源 | 地址 |
| --- | --- |
| GitHub Release | [dsh-cyrene-pet-1.0.0.zip](https://github.com/bestlike093/dsh-cyrene-balance/releases/download/v1.0.0/dsh-cyrene-pet-1.0.0.zip) |
| 夸克网盘 | [https://pan.quark.cn/s/0f1c821ace8a](https://pan.quark.cn/s/0f1c821ace8a) |

- 安装包：**dsh-cyrene-pet-1.0.0.zip**（约 28.3 MB）
- 打开方式：复制链接后在浏览器访问，或打开夸克 APP 自动识别。
- Release 页同时提供 SHA-256，下载后可以核对完整性。

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

### 卸载与重装

1. 右键桌宠 →「设置」→「桌宠进程」→ 关掉桌宠。
2. 在 dsh 里移除插件。
3. 需要彻底清理时，再删除 `~/.dsh/storages/cyrene-pet/`（设置、账本、运行时都在里面）。

只删插件目录不会自动清掉 `~/.dsh/storages/cyrene-pet/`，下次装回来设置还在。

## 日常怎么用

### 立绘与窗口

- 拖动立绘移动窗口，松手后自动贴边。
- 单击立绘：随机台词 + 动作。
- 长按立绘：说一遍当前任务进度。
- 立绘以外的透明区域点击会穿透，不挡桌面操作。
- 窗口位置和缩放会记住，下次启动还原。

### 右键菜单

右键立绘或状态面板：

- 显示 / 隐藏状态面板
- 切换气泡模式
- 说句话
- 任务进程（看当前任务清单）
- 换姿势
- 刷新余额
- 设置
- 隐藏桌宠

### 设置浮层

右键 →「设置」，分六组：

| 组 | 设置项 |
| --- | --- |
| 形象与气泡 | 昵称、缩放、气泡字号、气泡形状、气泡不透明度 |
| 状态栏 | 显示状态栏、详细度、不透明度 |
| 提问 | 闲聊提问（关闭 / 15 分钟～2 小时）、对话与审批（四种模式） |
| 互动 | 自动换姿势（关闭 / 30 秒～5 分钟）、音效（关闭 / 轻 / 中 / 响） |
| 桌宠进程 | 重启桌宠、关掉桌宠 |
| 余额 | API Key、余额提醒阈值、今日额度 |

几条合并规则：

- 「开启提问 + 提问间隔」合并为一个下拉，选「关闭」即原来的关闭。
- 「自动换姿势 + 间隔」合并为一个下拉，选「关闭」即原来的关闭。
- 「音效开关 + 音量」合并为一个下拉，选「关闭」即静音。
- 气泡字号三档，气泡形状去掉了 2px 这一档，气泡模式去掉了「只显示余额数字」。
- 余额刷新固定 30 秒缓存，设置里不再单列。
- 旧的 `avatar`、`x`、`y` 三个从未生效的字段已移除。

旧版 `state.json` 会在加载时自动迁移：`askEnabled: false` → `askEveryMinutes: 0`，`idlePose: false` → `poseSeconds: 0`，`soundEnabled: false` → `soundVolume: 0`。

API Key 的解析顺序：设置面板填写的 Key → 环境变量 `DEEPSEEK_API_KEY` → `~/.dsh/.credentials.yaml` 里的 `DEEPSEEK_API_KEY`。已经用 dsh 登录过 DeepSeek 的机器不需要再填一次。

### 气泡模式

| 模式 | 内容 |
| --- | --- |
| `rotate` | 台词与余额交替 |
| `info` | 一直显示余额 |
| `talk` | 只显示台词 |
| `today` | 今日消费 |

### 状态面板与余额

状态面板默认显示 CPU、内存、GPU、网速、电量、余额。详细度三档，双击右上角 `···` 折叠。

余额来自 `https://api.deepseek.com/user/balance`，默认 30 秒缓存。今日消费由余额变化推断，充值不会冲掉已记录的消费。

### 对话提问接管

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
- 等待时长按题数加长：单题 45 秒，之后每多一题加 25 秒；到时把请求 `next()` 交还网页卡片。
- 桌宠没运行、被禁用，或已经有一批题在等回答时，新的请求直接走网页卡片。
- 回答通过 `pet-command.json` 的 `{ action: "answer", askId, answers: [{ id, selected }] }` 回到宿主半。
- 提问到达时如果桌宠是收起状态，会自动显示出来（不抢焦点）。

### 风险审批

沙箱越权这类操作会走 dsh 的 `approval/request` waterfall，桌宠接在同一条链路的入口。

- 气泡显示「想请你批准一下」，正文是「工具名 + 想越权执行」和本地化理由（`displayReason` 优先中文，退回英文，再退回审计原因）。
- 只有两个决定：允许一次 / 拒绝，结果原样回给审批服务（`allowed-once` / `rejected`）。
- 60 秒没决定、请求被撤回或桌宠没运行，就交还网页卡片；撤回按 `cancelled` 结算。
- 审批和对话提问共用「设置 → 对话与审批」这一个模式开关。
- 同一时间只挂起一个审批，第二个请求会走网页卡片。

### 任务进程

桌宠宿主半读 dsh 的 `todos` 会话投影（`dsh-tool-todo` 写的那份），把最近一次活动的根会话里的任务写进 `live.json` 的 `todos` 字段。

- 任务面板列出任务清单（最多 6 条，`✓` 已完成 / `▶` 进行中 / `·` 待办），显示「任务进程 x/y 完成」。
- 长按立绘口头播报进度，例如「任务 2/5 完成，正在做『接入任务进程』，还排着 2 件…」。
- 面板会挡住气泡，所以完整清单放在右键菜单「任务进程」里看。
- 只跟根会话走：子代理的会话不会顶掉你正在做的任务。

## 常见场景怎么设

| 想要的效果 | 建议 |
| --- | --- |
| 专心工作，不想被桌宠打断 | 提问模式选 `web`，或把「闲聊提问」选「关闭」 |
| 边工作边顺手回答 Agent | 保持默认 `pet-all`，桌宠会逐题问 |
| 怕点错授权 | 保持 `pet-all`，审批只在桌宠里点「允许一次」或「拒绝」；不放心就选 `web` 回网页卡片 |
| 桌宠太挡视线 | 拖到屏幕边缘自动贴边，或在设置里改缩放；透明区点击穿透 |
| 只想看余额 | 气泡模式选 `info` 或 `today` |
| 觉得动作太频繁 | 「自动换姿势」调长或关闭 |
| 换电脑 | 把插件目录和 `~/.dsh/storages/cyrene-pet/` 一起带走；API Key 会存在 `state.json` 里 |

## Agent（dsh）升级后可能产生的后果

桌宠依赖 dsh 的内部结构和它自带的 Electron 运行时。dsh 升级不一定坏，但下面这些情况需要知道。

### 1. 运行时副本失效

**现象**：重启 dsh 后桌宠不出现，或进程刚起就退出。

**原因**：`~/.dsh/storages/cyrene-pet/runtime/` 里的 Electron 是从旧安装目录硬链接/复制来的。dsh 换安装路径、换 Electron 主版本、或重装后，旧副本指向的文件已经不存在或版本不匹配。

**处理**：关掉 dsh，删除 `~/.dsh/storages/cyrene-pet/runtime/`，再启动 dsh，插件会重新部署。

### 2. `app.asar` 结构变化

**现象**：桌宠启动后白屏，或 `resources/app` 链接指向错误位置。

**原因**：插件会把 `resources/app.asar` 删掉，换成指向 `pet/` 的目录链接。dsh 升级如果重建了 `app.asar`，或改变了 `resources` 布局，链接会被覆盖。

**处理**：删除 `runtime/` 重新部署；仍不行就检查 `resources/` 下是否又出现了 `app.asar`。

### 3. 插件 API 或注入点变化

**现象**：设置页「昔涟 · 桌宠」卡片消失；提问/审批不再弹在桌宠；控制台报 `ctx.tools`、`ctx.webServer`、`sessionProjections` 之类找不到。

**原因**：宿主半用的是 dsh 的插件接口（`tools`、`webServer`、`approval/request`、`sessionProjections`）。这些接口在 dsh 大版本升级时可能改名或改签名。

**处理**：等插件适配新版本，或回退 dsh。升级前可以先看 dsh 的更新说明里有没有插件 API 变更。

### 4. 任务进程读不到

**现象**：长按立绘说「现在手上还没有任务卡呢」，但对话里明明有任务。

**原因**：`todos` 投影的字段或存放位置变了，或者 dsh 换了写投影的插件。

**处理**：这属于只读展示，不影响 Agent 本身；等适配即可。

### 5. 审批链路顺序变化

**现象**：审批不再弹在桌宠，或者网页卡片和桌宠同时弹。

**原因**：`approval/request` waterfall 的挂载顺序变了，或被别的插件抢先处理。

**处理**：把提问模式改成 `both` 观察谁在接；或临时用 `web` 回网页卡片。

### 6. 端口或 webServer 变化

**现象**：状态面板没数字、刷新余额没反应，但立绘正常。

**原因**：宿主半的 HTTP 路由挂在 dsh 的 webServer 上。dsh 改了端口、路由前缀或鉴权，桌宠轮询就会失败。

**处理**：重启 dsh 和桌宠；仍不行就看 dsh 是否改了本地服务的监听方式。

### 7. 升级时正在进行的提问或审批

**现象**：升级/重启 dsh 时，桌宠气泡里的问题突然消失。

**原因**：提问和审批都有超时，超时或进程退出会把请求交还网页卡片（审批按 `cancelled` 结算）。

**处理**：升级前先答完或取消挂起的请求，避免半途丢状态。

### 8. 数据兼容

`state.json` 的旧字段会在加载时自动迁移。但如果新版本删除了某个字段，旧值会被忽略，不会报错。`ledger.json` 的账本按天归档，跨版本一般能继续读。

### 9. 卸载或更换 dsh

桌宠运行时依赖 dsh 安装目录，卸载 dsh 后桌宠也会随之中断。重装 dsh 后需要重新部署运行时（删 `runtime/` 再启动）。

### 10. 不保证向前兼容

插件会尽量跟着 dsh 更新，但不承诺每个 dsh 新版本都能直接用。升级 dsh 前，建议先备份 `~/.dsh/storages/cyrene-pet/`。

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

## 素材的最原始来源

素材分三层，从源头到本仓库：

**第一层：官方原作**

角色「昔涟」及《崩坏：星穹铁道》的名称、形象、服装与官方美术，著作权归 **HoYoverse / 米哈游（miHoYo）** 所有。本仓库与米哈游、HoYoverse 没有任何隶属、授权或合作关系。

**第二层：Cyrene 客户端资源包**

立绘、表情、状态面板头像等素材取自 Cyrene 客户端自带的「昔涟 · 桌面桌宠」资源包（`resources/app.asar` 内）：

- `assets/ui/cyrene-thinking-loop/`：情绪特写与状态面板立绘
- `dist/renderer/stickers/`：44 张小表情
- `dist/renderer/icons/mimi.png`：状态面板头像
- `pet/assets/live2d/cyrene/`：Live2D 模型（`model.moc3`、`model.physics3.json`、12 个表情、5 组动作、`texture_0.png`）

**Live2D 模型**由 B 站 UP 主 [@是依七哒](https://space.bilibili.com/457683484) 制作，经 Cyrene 资源包引入。本仓库不主张该模型的著作权。

**第三层：本仓库的处理**

本仓库只做了搬运、去白底、缩放、透明化与目录整理，没有重新绘制角色形象。逐项对照与处理记录见 [cyrene-balance 的 MATERIALS.md](https://github.com/bestlike093/cyrene-balance/blob/main/MATERIALS.md)。

素材与代码的授权范围不同：代码是 MIT，`assets/` 与 `pet/assets/` 不在 MIT 范围内，详见 `LICENSE` 的「素材例外（Assets Exception）」。

## 免责声明

1. **非官方作品。** 本项目是个人制作的第三方插件，与 DeepSeek、Live2D Inc.、miHoYo / HoYoverse 均无隶属、授权、赞助或合作关系。
2. **素材版权归原权利人。** 立绘、Live2D 模型、表情、头像等素材的著作权归 HoYoverse / 米哈游及 Live2D 模型制作者所有。本项目仅在个人学习与本机使用范围内引用，**禁止商用、转售、付费分发或二次分发素材**。
3. **代码许可不等于素材许可。** 源代码按 MIT 发布；`assets/`、`pet/assets/` 中的素材不受 MIT 授权，见 `LICENSE` 的素材例外条款。
4. **使用风险自负。** 桌宠会创建透明置顶窗口、改写 `resources/app` 链接、启动独立 Electron 进程。由此产生的窗口异常、桌面操作受阻、系统资源占用等问题，作者不承担赔偿责任。
5. **数据仅供参考。** 余额、今日消费、今日充值由 DeepSeek 接口与本地账本推算，可能有延迟或误差，请以 DeepSeek 官方账单为准。
6. **API Key 由你保管。** Key 保存在本机 `~/.dsh/storages/cyrene-pet/state.json`，不会上传到本项目；因本机泄露、共享电脑或第三方插件读取造成的损失，作者不承担责任。
7. **审批授权后果自负。** 在桌宠上点「允许一次」等于授权 Agent 越权执行对应操作，可能修改文件、访问网络或执行命令。请确认工具名和理由后再点。
8. **提问接管可能漏答。** 桌宠只接管「带选项、无 `intent`」的批次；超时、桌宠未运行或已有挂起请求时，会交还网页卡片，不保证每次都弹在桌宠。
9. **任务进度只读展示。** 任务进程读取 dsh 的 `todos` 投影，不修改任务状态，也不保证与实际执行进度完全同步。
10. **升级兼容性不承诺。** dsh 升级、Electron 主版本变化、插件 API 调整都可能导致桌宠失效，详见「Agent（dsh）升级后可能产生的后果」。
11. **无担保。** 本项目按「现状」提供，不附带任何明示或暗示的担保，包括适销性、特定用途适用性和不侵权担保。
12. **责任上限。** 在适用法律允许的范围内，作者对因使用或无法使用本项目产生的任何直接、间接、附带或后果性损失不承担责任。
13. **第三方冲突。** 同时安装其他桌宠、窗口管理或自动化插件可能产生快捷键、托盘、窗口层级冲突，请自行排查。
14. **删除不自动清理数据。** 卸载插件不会自动删除 `~/.dsh/storages/cyrene-pet/`，需要手动清理。
15. **作者保留权利。** 作者可随时修改、停止分发或调整授权范围；已分发的副本仍受当时条款约束。

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
├─ LICENSE           MIT + 素材例外
└─ package.json
```

## 许可与作者

- 代码：MIT
- 素材：不在 MIT 范围内，著作权归原权利人
- 作者：**柒柒（bestlike093）**
- 问题反馈：[GitHub Issues](https://github.com/bestlike093/dsh-cyrene-balance/issues)
