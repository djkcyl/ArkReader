<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" height="96" alt="ArkReader" />

# ArkReader

**跨平台的《明日方舟》剧情阅读与回放工具**

浏览故事，重温演出，从上次停下的地方继续。

Windows · macOS · Linux · Android

[下载最新版](https://github.com/djkcyl/ArkReader/releases/latest) · [版本记录](https://github.com/djkcyl/ArkReader/releases) · [反馈问题](https://github.com/djkcyl/ArkReader/issues)

</div>

ArkReader 是一款独立运行的非官方剧情播放器。无需安装游戏或登录游戏账号，即可浏览剧情目录、观看剧情演出，也可以切换阅读模式，按照自己的节奏回顾故事。

## 功能

### 找到想看的故事

浏览主题曲、活动故事、故事集、干员密录、集成战略和生息演算等剧情分类。支持搜索干员、章节与剧情；干员密录可按星级、职业、阵营筛选。把喜欢的故事加入收藏，下次直接打开。

### 保留熟悉的播放体验

以原版风格呈现剧情界面、对话、设置和回顾，播放背景、立绘、CG、动画、特效、音乐与影片，并支持剧情中的分支选择。

- **自由控制节奏**：暂停、自动播放、长按快进、桌面 Ctrl 32 倍速，以及剧情进度跳转。
- **切换阅读方式**：在演出模式与阅读模式之间切换，随时回看已经出现的对白。
- **专注观看**：桌面支持窗口全屏与系统全屏，Android 支持横屏播放和触屏操作。
- **同步查看脚本**：在底部切换可读脚本与原文，跟随当前演出，点击脚本行跳转。

### 从上次的进度继续

分别记录单段剧情和章节的阅读百分比。再次打开未读完的剧情时，可以继续阅读，也可以从头开始；重看或倒退不会覆盖已经到达的最高进度。

### 提前缓存，离线阅读

支持单段缓存和批量缓存，在缓存页集中选择剧情、查看任务与下载进度。已经下载的资源可以重复使用，适合提前准备好要看的章节。

### 为剧情库选一首音乐

使用游戏内可选的主界面曲目作为背景音乐，自由切换曲目。声音页面可分别调整界面音效、主页音乐和剧情播放器的音量。进入剧情后，主页音乐会让位给剧情本身的声音。

## 下载

当前版本：**1.1.1**。所有发行文件均附有 [SHA-256 校验值](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/SHA256SUMS.txt)。

| 平台             | 架构          | 安装包                                                                                                           | 免安装包                                                                                                          |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Windows 10 / 11  | x64           | [EXE 安装器](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/ArkReader-1.1.1-windows-x64-setup.exe) | [便携 ZIP](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/ArkReader-1.1.1-windows-x64-portable.zip) |
| macOS 12 及以上  | Apple Silicon | [DMG](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/ArkReader-1.1.1-macos-arm64.dmg)              | [应用 ZIP](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/ArkReader-1.1.1-macos-arm64-app.zip)      |
| Linux            | x64           | [DEB](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/ArkReader-1.1.1-linux-x64.deb)                | [AppImage](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/ArkReader-1.1.1-linux-x64.AppImage)       |
| Android 7 及以上 | ARM64         | [APK](https://github.com/djkcyl/ArkReader/releases/download/v1.1.1/ArkReader-1.1.1-android-arm64.apk)            | —                                                                                                                 |

暂不提供 Intel Mac 和 iOS 版本。macOS 应用尚未公证，首次打开可能需要在系统设置中允许运行。

## 快速开始

1. **下载并打开应用。** Windows 便携版解压后运行 `ArkReader.exe`，保留解压后的完整文件夹。
2. **等待首次准备完成。** 应用会自动获取剧情目录，并准备界面、封面和公共资源，无需手动初始化。
3. **选择剧情，开始阅读。** 章节资源会在需要时下载；准备离线阅读时，可先缓存所需剧情。

## 使用说明

- 首次准备和下载新剧情需要联网。应用每次启动都会检查官方资源更新；已有缓存可在无法联网时继续使用。
- 下载资源、收藏和阅读进度保存在系统用户目录中。桌面的安装版与免安装版共用这些数据，更新程序无需搬动资料库。
- 播放前会检查剧情脚本的兼容性。官方新增指令或参数时，可能需要更新 ArkReader 才能正常播放。

## 反馈

遇到播放异常或界面问题，可以在 [Issues](https://github.com/djkcyl/ArkReader/issues) 中反馈。请附上系统、应用版本、剧情名称和复现步骤；有截图时也可以一并提供。

---

基于 Tauri 与 Rust 构建。ArkReader 与《明日方舟》官方无隶属关系，剧情、图像与音频等游戏资源版权归原权利人所有。发行包不附带游戏资源。

[第三方许可声明](licenses/README.md)
