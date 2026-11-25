# 第三方归属 · Third-Party Notices

本文件列出 dsh-cyrene-pet 分发中包含的第三方组件及其许可证。
Apache-2.0 §4(d) 要求衍生分发保留本清单。

## 运行时直接依赖

| 组件 | 版本 | 许可证 | 出处 |
|---|---|---|---|
| silk-wasm | ^3.7.1 | MIT | npm，QQ 语音 SILK 编解码；许可证字段系本机已装实例 package.json 一手核读（2026-11-25） |

## 开发依赖（不随产物分发）

| 组件 | 版本 | 许可证 |
|---|---|---|
| typescript | ^5.9.3 | Apache-2.0 |
| vitest | ^5.0.5 | MIT |
| @types/node | ^22.20.5 | MIT |

## 宿主与运行时环境（不在本仓库分发，运行时需要）

| 组件 | 许可证 | 说明 |
|---|---|---|
| DeepSeek Harness（DSH） | MIT（其官方仓库口径） | 宿主应用，本插件以 DSH plugin 形态加载；@deepseek-ai/dsh 与 Apache-2.0 兼容 |
| Electron | MIT | DSH 桌面端打包环境（由宿主提供，非本仓库分发） |

## 角色与素材（许可例外，非归属授予）

「昔涟 / Cyrene」角色形象源自第三方游戏 IP 同人资源，
原角色著作权归其权利人，见 LICENSE「素材例外」与 TRADEMARK.md。
本清单不为素材授予任何权利。

## 维护约定

新增运行时依赖时，在本表加行并注明许可证一手来源（npm registry
页面或包内 LICENSE 文件实读）；N9 治理清账时全表复核一次活性与准确性。
