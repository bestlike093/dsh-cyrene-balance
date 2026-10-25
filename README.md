# dsh-cyrene-balance

## 下载安装

到 [Releases](https://github.com/bestlike093/dsh-cyrene-balance/releases/latest) 下载安装包，解压后复制到 `~/.dsh/profiles/node_modules/`，再在 profile 的 `cordis.patch.yml` 里注册。

| 安装包 | 大小 | SHA-256 |
| --- | --- | --- |
| `dsh-cyrene-balance-1.0.0.zip` | 7.6 KB | `9ce06859481f7cd381ebd66c181d592db5567dac6a096c7a737f60df8c29fc7b` |

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

## 许可

MIT
