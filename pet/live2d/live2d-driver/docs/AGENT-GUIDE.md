# 给智能体的说明书 · 遐蝶桌宠驱动

> 这份文档写给「接手这具身体的智能体」，不是写给人的安装说明。人看的说明在 `README.md`，实现细节在 `docs/METHOD.md`。
> 目标：读完之后，你知道**这具模型能做什么、怎么驱动、怎么在没有现成表情时拼出情绪**。

## 一、这是什么

- 一个 Electron 薄壳 + 网页渲染的 Live2D 桌面宠物（模型 `xiaodie`，Cubism 4）。
- 两半：
  - `live2d-driver/`：桌宠窗口本体，监听本地 HTTP（端口每次启动随机，见 `/api/state`）。
  - `dsh-castorice-bridge/`：DSH 插件，负责把话递进会话、供表情图、注入人设。
- 智能体和它打交道有两条路：**通过会话说话**（推荐，有气泡和表情图），或者**直接调驱动 HTTP**（要更精确地摆姿势时用）。

## 二、先读清单

| 文件 | 内容 |
| --- | --- |
| `data/catalog.json` | 模型清单：`parameters`（全部参数及范围）、`expressions`（表情）、`motionGroups`（动作组）、`groups`（眨眼/口型）、`capability`（能力识别结果） |
| `persona/castorice.md` | 自带人设（给人/LLM 读的版本） |
| `persona/castorice.persona.json` | 同一个人设的结构化版本（字段化，好解析） |
| `docs/AGENT-GUIDE.md` | 本文件 |

## 三、启动

```bat
runtime\electron\electron.exe app --model models\xiaodie --catalog data\catalog.json --gui
```

或者双击 `start.cmd`。启动后：

- 桌宠窗口出现（右下角，透明无边框，置顶）。
- 控制台窗口出现（模型 / 能力识别 / 表情 / 动作 / 视线 / 窗口尺寸）。
- 打开 `http://127.0.0.1:<端口>/api/state` 能读到 `ready、bounds、renderer`。
- 端口是随机的，`/api/state` 或启动日志里能拿到；控制台里也能看到。

## 四、两条驱动路径

### 4.1 通过会话说话（有气泡）

```http
POST http://127.0.0.1:54819/castorice/say
Content-Type: application/json; charset=utf-8

{ "text": "（风铃摸了摸你的头。）", "wait": true }
```

- `text` 会作为用户发言递进「这间屋子最新建出来的会话」。
- `wait: true` 时等一轮回复，返回 `{ ok, value: { sessionId, reply, emoji, motion } }`。
- 回复里如果带 `[图:id]`，插件会把它摘出来放进 `emoji`（同时校验文件存在）；`[动作:名称]` 同理放进 `motion`。
- 驱动把 `reply` 显示在头顶气泡，把 `emoji` 贴在气泡左边，并让模型做 `motion` 对应的动作。
- 适合：对话、场景化的触摸反馈。

### 4.2 直接调驱动（要精确控制）

```http
POST http://127.0.0.1:<端口>/api/command
Content-Type: application/json; charset=utf-8

{ "cmd": "expression", "name": "016脸红" }
```

返回 `{ ok: true, ... }`。所有命令都走这一条。

## 五、命令表

| cmd | 参数 | 作用 |
| --- | --- | --- |
| `say` | `text`, `duration`(ms), `emojiUrl`, `motion` | 气泡显示文字（可选贴图/动作） |
| `expression` | `name` 或 `index`, `duration` | 切表情；`duration` 后回默认（默认 30s） |
| `motion` | `group`, `index` 或 `name` | 播动作；`name` 会先按名字找组 |
| `mood` | `name`: `angry`/`sad`/`shy`/`calm`, `duration` | 情绪：换特效 + 用参数压脸 |
| `pose` | `preset` 或 `params`, `duration` | **摆姿势**：压任意参数，拼模型没自带的情绪 |
| `gaze` | `x`,`y`（-1..1）或 `off:true` | 视线钉住/复位 |
| `follow-pointer` | `off` | 视线是否跟随鼠标 |
| `stop` | — | 停动作 + 回默认表情 + 清姿势 |
| `params` | — | 读当前所有参数值 |
| `zone` | `x`,`y`（窗口坐标） | 只算触摸部位，不触发递话 |
| `bounds` | — | 模型包围盒 + 舞台尺寸 |
| `expression`/`motion` 的 name | 见 `data/catalog.json` | 名字要和清单一致（中文名直接用，UTF-8 发送） |

## 六、能力识别（`catalog.capability`）

每次载入模型（含换模型）都会重算，字段：

| 字段 | 含义 |
| --- | --- |
| `level` / `levelLabel` / `score` | 可动性档位 Lv.1–5 与分数（脸、身体、四肢、表情、动作、头发、呼吸各占一点） |
| `can` | 模型自带、能直接做的（表情数量、动作组、视线、眨眼、张嘴） |
| `derived` | **能拼出来的**：没有现成表情，但可以靠参数组合得到（皱眉抿嘴、脸红、惊讶、点头/摇头/歪头、看过来） |
| `cannot` | 做不到的（这具模型没有手臂和腿，所以挥手、走路、蹲下都不行） |
| `present` | 每个部位实际有哪些参数（`brows`/`mouth`/`cheeks`/`eyes`/`eyeBall`/`head`/`body`/`arms`/`legs`） |
| `expressions` | 表情 id 列表 |
| `motionGroups` / `motions` | 动作组与动作名 |

等级只是给人看的粗略档；真正决定「能拼出什么」的是 `present`。

## 七、拼表情和姿势

模型自带的表情（expressions）通常只开特效；脸要用参数压。可用预设：

| preset | 压的参数 | 效果 |
| --- | --- | --- |
| `angry` | 眉下降+变形、嘴下撇 | 生气 |
| `sad` | 眉梢下垂+变形、嘴角向下 | 难过 |
| `shy` | 眉抬起、嘴角上扬、脸颊鼓 | 害羞 |
| `surprise` | 睁眼、张嘴 | 惊讶 |
| `sleepy` | 眼睛半闭、眉放松 | 困 |
| `lookLeft` / `lookRight` | 眼球+头部转向 | 看过去 |

用法：

```json
{ "cmd": "pose", "preset": "shy", "duration": 6000 }
```

也可以自己捏：

```json
{ "cmd": "pose", "params": { "ParamMouthForm": -1, "ParamMouthShrug": 1 }, "duration": 5000 }
```

`pose` 可以叠在 `mood` 上；到期自动清；`stop` 也会清。参数名从 `data/catalog.json` 的 `parameters[].id` 里挑，超出 `min/max` 的值会被模型自己夹住。

## 八、表情贴图与气泡标签

回话文本里句尾可以写：

- `[图:id]`：从 `dsh-castorice-bridge/assets/emoji/<id>.png` 取图，贴在气泡左边；`xd-*` 那批还会顺带换脸。
- `[动作:名称]`：让模型做动作（`点头`/`摇头`/`歪头`/`害羞`/`看过来`/`轻晃`/`弹一下`/`打瞌睡`，模型没有的会找相近的）。

可用的贴图 id 见桥插件的 `assets/emoji/` 目录（`xd-happy`、`xd-shy`、`xd-sad`、`xd-angry`、`hmph`、`goodnight` 等）。

## 九、人设

`persona/castorice.md` 是「遐蝶」这具身体自带的人设。控制台的「发送自带人设」会把这段递进会话，接手的智能体照着扮演即可；`castorice.persona.json` 是同一份的结构化版本，方便程序读取。

## 十、常见坑

1. **端口随机**：别写死端口，先读 `/api/state` 或启动日志。
2. **透明窗口**：只有立绘那一块收得到鼠标；顶部的拖动柄亮起后留五秒。
3. **窗口尺寸**：拖动中不改尺寸，松手后看门狗收一次；150% 缩放下会多 1px，正常。
4. **表情 id 大小写**：和 `data/catalog.json` 里一模一样，别猜。
5. **UTF-8**：PowerShell 发中文 body 要转 UTF-8，否则会变成 `??`。
6. **模型没有物理**：能跑，只是不会自然晃。
7. **不要同时开两个驱动**：单实例锁会让第二个实例退出。
