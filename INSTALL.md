# INSTALL · 把昔涟装到你的桌面上

> 前置：Windows 10/11，已从 [DeepSeek 官网 Harness 页面](https://www.deepseek.com/harness/)下载安装 DeepSeek Harness（DSH）。
> 她是一个 DSH 插件，包名 `dsh-cyrene-pet`。装好后 DSH 会替她拉起桌面端，无需单独启动。

## 方式 A：DSH 应用内安装（推荐，无需终端）

打开 DSH，进入「插件」页面（官方特性页原话：一切皆插件——安装现有插件，或添加自己的插件），搜索或添加 `dsh-cyrene-pet`，按提示安装并重启 DSH。

> 菜单名称随 DSH 版本可能略有差异。本方式有 Windows 实机安装存证：安装记录落在
> `%USERPROFILE%\.dsh\profiles\<profile>\.plugin-manager\`，装完插件出现在同 profile 的
> `node_modules\dsh-cyrene-pet`。

## 方式 B：命令行安装（进阶）

DSH 官方插件机制支持从 git 源或本地目录安装：

```bash
# 从 GitHub 安装（构建约需十几秒）
dsh plugin --profile desktop add "github:bestlike093/dsh-cyrene-balance#main"

# 或本地目录（开发调试用）
dsh plugin --profile desktop add link:/path/to/dsh-cyrene-pet
```

装完重启 DSH 生效。注意：

- `dsh` 命令由 DSH 安装时提供；若你的 PATH 里找不到它，请改用方式 A。
- 仓库名是 `dsh-cyrene-balance`（历史遗留），包名与插件目录名是 `dsh-cyrene-pet`——命令里写仓库地址，DSH 认的是包名。
- 插件按 profile 隔离：装到哪个 profile，就只在哪个 profile 生效，互不干扰。

## 装好之后

1. 打开 DSH 的设置页，找到「昔涟·桌宠」卡片，把开关打开。
2. 贴上你的 API key（她说话用；不贴 key 她也会在桌面上呼吸、眨眼、看你的鼠标）。
3. 桌面上出现她，即安装成功。首次冷装载约 1.7 秒。

## 常见问题

- **桌面上没看到她？** 确认 DSH 至少完整启动过一次（插件在 DSH 运行时才被挂载），再看设置页开关是否打开。
- **升级**：在插件管理里重装新版本即可；她的记忆与设置保存在 `%USERPROFILE%\.dsh\storages\cyrene-pet\`，升级不丢。
- **卸载**：插件管理里移除；如需彻底清理，再删除上述 storages 目录（内含她的全部记忆，删前想清楚）。
