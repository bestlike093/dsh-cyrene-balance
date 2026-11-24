# 接入新模型的方法（也是这套驱动的原理）

> 写给下一次要换模型的人——也可能是几天后的我自己。
> 目标不是「给遐蝶做一只桌宠」，是「做一套谁都能跑起来的 Live2D 驱动」。

## 一、为什么是这种形态

旧的 `dsh-cyrene-pet` 把三件事塞进同一扇窗：渲染、拖动、窗口尺寸。拖动交给系统、尺寸又由自己的定时器去改，两边打架，Windows 搬透明无边框窗时还会重算一次外框——于是「一拖就变大」。

新驱动把责任拆开：

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Electron 主进程（`app/main.cjs`） | 开窗、起本地静态服务、转发命令、截图 | 不碰模型、不碰动画 |
| 渲染层（`web/driver.mjs`） | 加载模型、呼吸/眨眼/视线、表情/动作、上报状态 | 不碰窗口尺寸 |
| 模型自己 | moc3、物理、表情、动作 | —— |

窗口只在创建时定尺寸，之后拖动、缩放都不调 `setSize`。这就是「不再变大」的全部原因。

**拖动时的闪烁（2026-11-10 修）**：Windows 搬透明无边框窗时，每挪一下会把外框补大 1~2px；旧版看门狗每帧都把尺寸写回去（`setSize` → 重新合成 → 再写回），一秒几十次，看起来就是高频闪。现在：拖动中看门狗不工作、渲染层冻结 `fit()`，把 `body` 和画布都钉在拖动开始时的像素尺寸（`body` 要设 `position: relative` 当定位基准，底部输入框才不会跟着窗口往下坠），窗口在后台变大，屏幕上看不出来。松手后主进程收尺寸，回一条 `pet:drag-settled`，渲染层收到才解除钉住并重排一次——所以也不会「先变大再缩回」。位置按物理像素取整，避开 150% 缩放的半像素来回补。

## 二、跑一个模型

模型目录要求（Cubism 4 导出）：

```
<任意目录>/
  xxx.model3.json      ← 目录里出现 *.model3.json 就行，名字随意
  xxx.moc3
  texture_0.png        ← 几张纹理都行，model3 里怎么指向就放哪
  xxx.physics3.json    ← 可选
  xxx.cdi3.json        ← 可选，只影响显示名
  expressions/*.exp3.json   ← 可选
  motions/*.motion3.json    ← 可选
```

启动：

```bat
runtime\electron\electron.exe app --model "<模型目录>" --catalog "data\catalog.json"
```

驱动启动后会做三件事：

1. 在模型目录里找 `*.model3.json`（有多个时取名字最短的，建议一个目录一个模型）；
2. 把模型目录整个挂到 `/model/` 下，给渲染层用；
3. 渲染层加载完成后生成 **catalog.json**——这就是「这个模型有什么」的清单。

## 三、catalog.json：模型的能力清单

```jsonc
{
  "driver": "castorice-l2d-driver/0.1.0",
  "model": "/model/xiaodie.model3.json",
  "generatedAt": "2026-11-09T00:32:58.390Z",
  "parameters": [ { "index": 0, "id": "ParamAngleX", "min": -30, "max": 30, "def": 0 }, ... ],
  "expressions": [ { "index": 14, "name": "016脸红", "file": "expressions/e016.exp3.json" }, ... ],
  "motionGroups": {
    "Idle":    [ { "index": 0, "name": "Idle#1", "file": "motions/idle.motion3.json" } ],
    "小动作":  [ { "index": 0, "name": "点头", "file": "motions/nod.motion3.json" }, ... ]
  },
  "groups": [ { "target": "Parameter", "name": "EyeBlink", "ids": ["ParamEyeLOpen", "ParamEyeROpen"] } ],
  "hitAreas": []
}
```

- `parameters`：从 moc3 里读出来的全部参数（id、上下限、默认值）。**没有写死任何通道名**——所以换模型不用改代码。
- `expressions` / `motionGroups`：模型自带的表情和动作，原样搬进来。
- `groups`：EyeBlink、LipSync 这些分组；有 EyeBlink 才会有自动眨眼。
- `hitAreas`：模型若写了命中区，这里会列出来。触摸部位目前不靠它（遐蝶这具模型没写命中区），而是按包围盒高度分六段。

**换模型后先看 catalog.json**：表情在不在、动作组对不对、参数是不是 236 个这种量级。不对就说明模型本身缺东西，不是驱动的问题。

## 四、用命令驱动它

`POST /api/command`，UTF-8 JSON，和窗口无关，外面任何程序都能调：

```jsonc
{ "cmd": "expression", "name": "016脸红" }        // 表情：名字或 index
{ "cmd": "motion", "group": "小动作", "index": 0 } // 动作：组 + 序号
{ "cmd": "motion", "name": "点头" }               // 或者直接给名字
{ "cmd": "say", "text": "……", "duration": 6000 }  // 底部对话框（按字吐出来）
{ "cmd": "typing", "on": true }                  // 气泡里转三个点（等回复时的样子）
{ "cmd": "reaction", "zone": "head" }             // 随机反应（head / body）
{ "cmd": "mood", "name": "angry" }                // 情绪：angry / sad / shy / calm
{ "cmd": "gaze", "x": 1, "y": -0.5 }              // 视线钉住（左+上，-1..1）
{ "cmd": "gaze", "off": true }                    // 视线交还给窗口内鼠标
{ "cmd": "follow-pointer", "off": true }          // 关掉跟随鼠标
{ "cmd": "stop" }                                 // 停动作、清表情
{ "cmd": "params" }                               // 当前全部参数值（调试用）
{ "cmd": "state" }
```

返回 `{ "ok": true, ... }` 或 `{ "ok": false, "error": "..." }`。

### 情绪：表情文件之外，还得补脸

这个模型的表情（exp3）大多只打开特效参数（ParamKeyN），没有动脸：009 生气只加了红气符号和眉。所以驱动加了一层 `mood`：

- `angry`：压眉（ParamBrowLY/RY = -1）、抿嘴（ParamMouthForm = -1）、嘴角下拉；
- `sad`：眉根下垂、嘴形下弯，配 006 黑脸；
- `shy`：挑眉、鼓起脸颊（ParamCheekPuff）。

脸参数在 `beforeModelUpdate` 里写，这样不会被动作和物理盖掉。换模型时如果它的表情本来就换脸，这一层可以不用；参数 id 不一样就改 `moods` 里的键。

点表情芯片时，009 / 006 / 014 / 015 / 016 会自动套上对应情绪；其它表情会把情绪清掉，回到平静。

表情和情绪都会在 **30 秒**后自动回默认（命令里的 `duration` 可改，单位毫秒——调试时用短一点）。这期间再换一个表情或情绪，会替换掉上一个，并重新开始计时；`stop` 也会清掉计时。

回落不能只靠 `setTimeout`：窗口闲置或系统睡眠时定时器会被挂起，醒来也不补发，表情就冻在最后一帧。驱动改成记一个**截止时间**，渲染循环每帧、心跳每 2 秒都拿 `Date.now()` 对一次，过了就收——睡着再醒也会立刻回到默认。

### 摸头 / 戳一下：把动作递进 DSH

点模型会同时做两件事：本地的表情/动作反应，和把一句话递进 DSH 里的会话。递法用自己那个小桥插件（`dsh-castorice-bridge`，装在 profile 的 plugins 里）挂在 DSH web server 上的路由：

```
POST http://127.0.0.1:54819/castorice/say
{ "text": "（风铃碰了碰你的脸。）", "wait": true }
```

插件把 `text` 当成用户发言塞进「遐蝶这间屋子」**最新建出来**的那条会话（`sessionController.prompt`，mode `steer`）；`wait: true` 时等这一轮跑完，回复放在 `value.reply` 里返回。驱动拿到 reply 就显示在头顶气泡（超过 60 字截断），拿不到就显示本地那句兜底。

**碰的是哪儿**：渲染层按模型包围盒的相对高度分七段——`head`（头发/头顶）、`face`（眉眼到下巴）、`shoulder`（颈肩）、`chest`（衣领）、`waist`（肚子/腰）、`skirt`（裙摆）、`foot`（脚踝），比例照这具 chibi 模型量过。`POST /api/command {"cmd":"zone","x":233,"y":300}` 只算部位、不触发递话，校准或排查时用；`{"cmd":"bounds"}` 返回模型包围盒和舞台尺寸。点下去的坐标会打在日志里（`[pointer] down/up`），排查「点了没反应」时先看这两行。

要点：

- DSH 得开着、小桥插件 `dsh-castorice-bridge` 得装好；桥断了驱动会立刻退回本地反应。
- 每戳一次会触发一轮回应；驱动有 1.2 秒冷却，免得连续点出一串。
- 称呼由 `--user-name` 改（默认「风铃」），DSH 地址由 `--dsh-url` 改。
- 插件那边等回复最长 100 秒，驱动这边 120 秒放弃——气泡先出本地那句，她的回话到了再换掉。
- 会话挑的是 `header.createdAt` 最新的那条，不是事件数最多的那条；会话 id 带不带 `session-` 前缀插件都认。
- 窗口底部那只输入框走同一条桥：打的话递给会话，回复回气泡；控制台里的「说话」框只在本地说。
- 反方向也通了：驱动启动时把自己的地址登记到桥插件（`POST /castorice/register`），之后**在 DSH 聊天框里打字**，桥会把会话事件转成 `POST /api/echo`——用户发话就转三个点，助手说完就出气泡并逐字吐。桥自己用 `/say` 递进去的那一轮会压住事件通知，避免重复。
- 气泡宽度按「两个立绘宽」算（`model.getBounds().width * 0.6 * 2`），窗口放不下就收到 96%；等她回话时转三个点，回话按字吐出来。
- 回复里可以带 `[图:id]`、`[动作:名称]`：插件摘掉方括号，`value.emoji` + `value.motion` 一起回来；驱动把表情图挂在气泡左边（顺手按表换脸），再让模型做对应动作。测试用 `{"cmd":"say","text":"…","emoji":"xd-happy","emojiUrl":"…","motion":"歪头"}`。

Windows 上用 PowerShell 调中文命令，记得把 body 转 UTF-8：

```powershell
$json = '{"cmd":"expression","name":"016脸红"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod "http://127.0.0.1:<端口>/api/command" -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes
```

## 五、控制台（图形界面）

不想碰命令行，就双击 `start.cmd`：桌宠和控制台一起开（截图见 `docs/control.png`）。

- **模型**：显示当前目录、参数 / 表情 / 动作数量；「更换模型…」用系统对话框选目录，驱动自己重新载入；「重新载入」重跑当前模型。
- **能力识别**：每次载入（含换模型）都会重算，结果在 `catalog.capability` 里——可动性 Lv.1–5、能做 / 能拼出来 / 做不到、表情 id、动作名。「把这份能力告诉她」把这段递进会话（`wait:false`），「发送自带人设」把 `persona/castorice.md` 递进去；自动识别靠模型自己的参数表，不靠模型名。
- **摆姿势**：`{"cmd":"pose","preset":"shy"}` 或 `{"cmd":"pose","params":{"ParamMouthForm":-1}}`——把参数直接压上去，用来拼模型没自带的情绪；到期自动清，`stop` 也会清。参数表在 `data/catalog.json`。
- **情绪**：生气 / 难过 / 害羞 / 平静四个按钮，点一下同时换特效和脸。
- **说话**：输入一行字，按「说」或回车，角色头顶的气泡就显示出来；桌宠窗口底部也有一行同样的输入框。
- **表情 / 动作**：由 `catalog.json` 生成，点一下就是一条 `expression` / `motion` 命令；「停下来」发 `stop`。
- **视线**：跟随窗口里的鼠标；或按「往左看 / 往右看 / 往上看 / 看回来」把视线钉住。
- **窗口**：大小滑杆按 60%–180% 等比缩放（基准是第一次读到的窗口尺寸，手动填宽高会重设基准）；改宽高、置顶、显示或隐藏桌宠，都走主进程的 IPC，不碰拖动逻辑。`ctl:resize` 会先把目标尺寸写进看门狗的 `sizeLock` 再改窗，否则 resize 事件会让看门狗按旧尺寸改回去。大小和最后停的位置记在 `data/window.json`，下次启动照旧（超出工作区的会夹回来）。
- **打开方法文档**：用系统默认程序打开本文件。

控制台页面是 `/control.html`，由 `app/control-preload.cjs` 暴露几个 `invoke` 通道；它和命令行调的是同一条 `/api/command` 路，所以两边不会打架。

界面自检（排查 GUI 接线是否通）：设两个环境变量再启动，会自动点一次「016脸红」、等心跳、截图后退出：

```bat
set L2D_SELFTEST=1
set L2D_SELFTEST_SHOT=<工作区>\temp\gui_check.png
start.cmd
```

## 六、验证一个模型是否真的跑起来了

无人值守截图（窗口渲染完自动退出）：

```bat
runtime\electron\electron.exe app --model "<目录>" --shot "<工作区>\temp\check.png"
```

拖拽稳定性验证（这台机器实测过一轮，风铃嫌麻烦的话可以跳过）：

1. 启动后用 user32 的 `GetWindowRect` 记下真实矩形（别信 Electron 的 `getBounds`，150% 下它会多报 1～2px）；
2. 用 `SetCursorPos` + `mouse_event` 在模型中心按下、移动、松开；
3. 再看 `GetWindowRect`。

本机实测：连续拖 10 次，真实窗口始终 636 × 960 物理像素（= 424 × 640 DIP），没长。`getBounds` 会漂到 425×641 之类——那是 Electron 的取整谎话，不是窗真胖了。旧版桌宠是**真的**长：用 GetWindowRect 能测出 635×960 → 710×1023。

## 七、换模型要留意的几件事

1. **窗口比例**：模型竖长就 420 × 640，模型横宽就调 `--width/--height`；驱动自己按 `originalWidth/Height` 等比缩放，但窗口太方会显得小。
2. **DPI 与拖动**：150% 缩放下，系统会把被拖动的透明窗悄悄撑大；看门狗只在**不拖的时候**（差超过 2px、且不在拖动中）把尺寸写回，写回前先松开 `setMinimumSize/setMaximumSize`（不可缩放的窗会被 min/max 卡住），拖动结束 120ms 后再收一次。`--no-size-guard` 可以关掉它做对照。
3. **表情名字**：中文名直接用，命令里是 UTF-8；PowerShell 不转 UTF-8 会变成 `??`。
4. **没有物理的模型**：能跑，只是不会自然晃。
5. **没有 Idle 动作组的模型**：站着不动，呼吸/眨眼仍然有（来自 EyeBlink 与呼吸参数）；要不要补程序化的摇摆，等真遇到再说——不硬造。

## 八、还没接的东西

这一版只把「驱动」立起来。旧插件那边已有的这些还没搬：

- 气泡 / 状态栏 / 审批卡
- DSH 会话读取与 `[图:id]`、`[动作:名称]` 标记
- 点击穿透、托盘菜单（现在只有托盘里的 显示/隐藏 与 退出）
- 麦克风口型、VTS、录音回放

接的时候原则不变：**外面通过 `/api/command` 说话，驱动不反向依赖 DSH**。

## 九、参考与许可

- 结构参考：鲸语 jingyu-live2d（MIT）的 `desktop-pet/main.cjs`、`web/pet.mjs`——薄壳、app-region 拖动、页面内渲染这三点。
- 渲染库：pixi.js 6.5.10（MIT）、pixi-live2d-display cubism4（MIT）、Live2D Cubism Core 5.1 / Web Framework（Live2D Inc. 授权）。
- Electron 43.3.0（MIT）。
- 本仓代码可自由改用，但 Live2D 模型与 Cubism Core 的授权跟着各自的条款走。
