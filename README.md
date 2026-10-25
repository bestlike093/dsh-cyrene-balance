# dsh-cyrene-balance

在 DeepSeek Harness（DSH）里查询 DeepSeek API 余额与今日消费，支持今日额度上限、超限提醒，以及「只看今日额度 / 只看余额」两种视图。

这是 Cyrene 版「昔涟 · 余额桌宠」的 DSH 移植版：去掉桌面立绘与气泡 UI，保留查询、额度、提醒与账本能力。

## 功能

- **余额查询**：读取 `GET https://api.deepseek.com/user/balance`，展示余额、赠金、今日消费、今日充值、峰谷时段
- **今日额度**：自行设置今日消费上限（0 表示关闭），支持随时调节
- **额度提醒**：
  - 用掉 80% 时提示「已用掉八成」
  - 超过上限时输出醒目的 `⚠ 今日额度已超限`
  - 余额低于阈值时单独提示
- **两种视图**：
  - `today`：只报今日已用 / 额度 / 剩余
  - `balance`：只报余额
  - `all`：全部信息
  - 可以把某个视图设为默认，之后查询不带 `view` 就用它
- **7 天账本**：每次读到余额与上次比较，下降记为消费，上升记为充值；跨天自动归档，保留 30 天

## 安装

### 方式一：本地目录

```bash
cp -r dsh-cyrene-balance ~/.dsh/profiles/node_modules/dsh-cyrene-balance
```

在 `~/.dsh/profiles/web/cordis.patch.yml` 里插入：

```yaml
- insert:
    - id: dsh-cyrene-balance
      name: dsh-cyrene-balance
      config:
        apiKey: sk-你的Key
        balanceThreshold: 20
        dailyLimit: 30
```

重启 `dsh web`。

### 方式二：从压缩包

解压后把整个目录复制到 `~/.dsh/profiles/node_modules/dsh-cyrene-balance/`，再按上面的 YAML 注册。

> `tools` seam 不支持热重载，首次安装或改代码后需要重启。

## 配置

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `apiKey` | string | 空 | DeepSeek API Key；留空时读环境变量 `DEEPSEEK_API_KEY` |
| `balanceThreshold` | number | `20` | 余额提醒阈值（元），0 表示关闭 |
| `dailyLimit` | number | `0` | 今日额度上限（元），0 表示关闭 |
| `view` | string | `all` | 默认视图：`all` / `today` / `balance` |
| `dataDir` | string | `$DSH_HOME/plugin-data/dsh-cyrene-balance` | 自定义数据目录 |

## 工具

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `deepseek_balance` | 查询余额与今日消费 | `view`（可选） |
| `balance_set_limit` | 调节今日额度与提醒阈值 | `limit`、`threshold`（至少一个） |
| `balance_set_view` | 设置默认视图 | `view`（必填） |
| `balance_status` | 查看设置与上次查询 | 无 |
| `balance_history` | 查看最近 7 天消费 | 无 |

示例：

```text
deepseek_balance(view="today")          # 只看今日额度
deepseek_balance(view="balance")        # 只看余额
balance_set_limit(limit=40)             # 今日额度改成 40 元
balance_set_limit(limit=0)              # 关闭今日额度
balance_set_view(view="today")          # 以后默认只报今日额度
```

## 数据与网络

| 位置 | 内容 |
| --- | --- |
| `settings.json` | 阈值、今日额度、默认视图 |
| `ledger.json` | 今日消费/充值与最近 30 天归档 |
| `last.json` | 最近一次查询结果 |

- 只访问 `https://api.deepseek.com/user/balance`
- API Key 来自配置或环境变量，不写入上述数据文件
- 今日消费是用余额变化推断的近似值；充值不会冲掉已记录的消费

## 与 Cyrene 版的差别

| 能力 | Cyrene 版 | DSH 版 |
| --- | --- | --- |
| 桌面立绘 / 气泡 / 小表情 | 有 | 无（DSH 是 Web Agent） |
| 余额与今日消费 | 有 | 有 |
| 今日额度调节 | 右键菜单 + 对话 | 工具调用 + 配置 |
| 额度特殊提醒 | 高亮脉动气泡 + 音效 | 结果里的醒目警告文案 |
| 只看今日额度 / 只看余额 | 气泡视图 | 查询视图 + 默认视图 |

## 相关：带立绘的 DSH 桌宠

本插件只做余额查询与提醒，本身没有界面。想要立绘和桌面交互，可以另装 `dsh-cyrene-pet`，两个插件能同时跑，各管各的。

`dsh-cyrene-pet` 是独立的 DSH 插件：宿主半跑在 dsh 里，渲染半是一个 Electron 进程，复用 dsh 自带的 Electron，不额外下载运行时。它目前实际提供这些能力：

| 能力 | 说明 |
| --- | --- |
| Live2D 立绘 | 透明无边框置顶窗口，12 个表情、5 组动作，自动眨眼与呼吸，视线跟随鼠标 |
| 桌面交互 | 拖拽移动、松手贴边、窗口位置与缩放记忆、非立绘区域点击穿透 |
| 气泡台词 | 台词轮换、说话时口型动画；四种气泡模式：台词与余额交替 / 只看余额 / 只看台词 / 只看今日消费 |
| 状态面板 | CPU / 内存 / GPU / 网速 / 电量 / 余额，三档详细度，可折叠 |
| 提问接管 | 对话里的 `ask_user_question` 可由桌宠逐题问，支持 `pet-all` / `pet-single` / `both` / `web` 四种模式 |
| 风险审批 | `approval/request` 在桌宠里选「允许一次 / 拒绝」 |
| 任务进程 | 读 dsh 的 `todos` 投影，长按立绘播报当前进度 |
| 设置与菜单 | 右键菜单、托盘菜单、设置浮层；dsh 设置页有启动 / 重启 / 关闭卡片 |

安装：

```bash
dsh plugin --profile desktop add <解压后的 dsh-cyrene-pet 目录>
```

装好后重启 dsh。首次启动会在 `~/.dsh/storages/cyrene-pet/runtime/` 下部署桌宠运行时，之后改 `pet/` 里的代码只需要重启桌宠进程。

- 安装包：**dsh-cyrene-pet-1.0.0.zip**
- 夸克网盘：[https://pan.quark.cn/s/0f1c821ace8a](https://pan.quark.cn/s/0f1c821ace8a)
- 打开方式：复制链接后在浏览器访问，或打开夸克 APP 自动识别。

## 素材与版权

这个 DSH 版只包含代码与配置，仓库里没有任何立绘、表情、头像或音效文件。

- 立绘、情绪特写、小表情与状态面板头像只存在于 Cyrene 版插件 `cyrene-balance` 中，取自 Cyrene 客户端自带素材库（`resources/app.asar` 内的 `assets/ui/cyrene-thinking-loop/`、`dist/renderer/stickers/`、`dist/renderer/icons/mimi.png`）。处理方式与逐项对照见 [cyrene-balance 的 MATERIALS.md](https://github.com/bestlike093/cyrene-balance/blob/main/MATERIALS.md)。
- 角色「昔涟」及《崩坏：星穹铁道》的名称、形象与美术归 HoYoverse / 米哈游所有。Cyrene 使用的 Live2D 模型由 B 站 UP 主 [@是依七哒](https://space.bilibili.com/457683484) 制作，本仓库不包含该模型。
- 本仓库的代码以 MIT 许可发布。

## 许可

MIT
