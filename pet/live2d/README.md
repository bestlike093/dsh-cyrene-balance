# pet/live2d — Live2D 驱动三件套（外挂，仅本地使用）

本目录从 `D:/QQ/live2d-driver-20261110.zip` 原样搬入，用于给桌宠接入表情与动作渲染。三份内容全部保留原署名，不修改作者信息。

## 来源与署名（保留原文）

| 目录 | 内容 | 来源署名 |
| --- | --- | --- |
| `live2d-driver/` | Live2D 桌面驱动：Electron 薄壳 + 网页渲染（Cubism 4），不写死模型 | 驱动标识 `castorice-l2d-driver/0.1.0`；README 原文：「形态参考 [鲸语 jingyu-live2d](https://github.com/InariNGT-Ofiicial/jingyu-live2d) 的 desktop-pet 与 web/pet.mjs 思路，代码是本仓自写的，没有照搬」；MIT |
| `models/xiaodie/` | 模型：31 表情 exp3、9 动作 motion3、236 参数，Cubism 4 | 随驱动提供；仅本地使用 |
| `dsh-castorice-bridge/` | DSH 小桥插件：`/castorice/say` 递话、`/castorice/emoji/...` 供图（58 张表情 PNG 与仓库 `assets/cyrene/emoji` 同名同批） | 随驱动提供 |

## 使用边界

- **仅本地使用，不随发行物打包**：模型文件（`.moc3` / `.model3.json` / 纹理目录）不得进入发布包，与 `assets/ATTRIBUTION.md` 的发布限制一致。
- 协议（catalog 结构、命令分发表、能力识别）已拆进 `lib/companion/assets/live2d-catalog.mjs` 与 `live2d-command.mjs`，核心十域不直接依赖本目录。
- 本目录是渲染外挂，不进 `lib/companion` 十域，不反向依赖核心。
