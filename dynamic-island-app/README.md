# 桌面灵动岛 · 暖米纸

Windows 顶部居中的小胶囊：记待办、看清单、连续工作到点提醒你起身。

平时它收起成屏幕顶部中央的一条细线，鼠标不碰它就完全不占地方，不会压住浏览器标签栏。

## 怎么用

> 想给别人介绍这个应用？直接打开 `介绍页.html`（单文件网页，可本地双击或传给别人看）。

**免安装版（推荐，绿色版）**：双击 `dist\DeskIsland-1.0.0-portable.exe` 就能用。单个文件，不写安装信息、不进「设置 → 应用」，拷到任何地方（U 盘也行）都能跑。

**安装版**：双击 `dist\DeskIsland-1.0.0-setup.exe`，一路下一步，装完开始菜单和桌面会有「灵动岛」快捷方式。

**开发版**：双击 `启动灵动岛.bat`。

- 平时：屏幕顶部中央一条 4px 细线，其余地方什么都没有
- 动键鼠工作时自动收起；停手 15 秒，它就在当前页面上自己出现
- 把鼠标停在细线上约 0.2 秒：胶囊滑下来，显示还有几件待办 + 距离起身提醒的倒计时
- 按 `Ctrl + Alt + D`：不用找细线，直接唤出并展开清单
- 点一下胶囊：展开待办清单，回车即可添加，点圆圈打勾，鼠标移到条目上出现 × 删除
- 点右上角 ⚙：设置专注周期（25/45/60/90 分钟）、提醒音、自动收起模式、开机自启、退出
- 连续工作到设定时长：胶囊自动展开成提醒条，「好的」清零重新计时，「稍后 5 分钟」推迟

自动收起有三种模式（智能 / 悬停 / 常驻），见下面的「显隐逻辑」。

## 计时规则

- 每 1 秒读一次系统空闲时间（`powerMonitor.getSystemIdleTime()`）
- 键鼠有输入才累计专注时长
- 连续 3 分钟无输入 → 判定为已离开，专注计时自动清零，不会你人在开会它还催你起身

## 显隐逻辑（为什么不挡标签栏）

主进程每 60ms 用 `screen.getCursorScreenPoint()` 读一次系统光标位置，维护三个状态：

| 状态 | 触发条件 | 画面 | 鼠标 |
|---|---|---|---|
| `idle` | 收起状态 | 只有顶部 4px 细线 | 完全穿透 |
| `near` | 悬停唤出 / 自动显示 | 胶囊落下来 | 仍然穿透 |
| `over` | 光标进入胶囊范围 0.1 秒 | 胶囊保持 | 接管，可点击 |

### 三档「自动收起」模式

设置里可选，默认 **智能**：

| 模式 | 行为 |
|---|---|
| 常驻 | 一直显示，只有光标在胶囊上时才接管鼠标 |
| 悬停 | 只有把鼠标停到顶部细线才出现，离开 1.2 秒收回 |
| **智能** | 动键鼠就收起；停手 15 秒在当前页面自动出现；再动键鼠 0.4 秒收回 |

智能模式只看一个信号：`powerMonitor.getSystemIdleTime()` —— 多久没碰键鼠。不区分前台是桌面还是别的程序，停手就在当前页面上显示出来。

几个刻意的设计：

- **可交互和可见是两条独立的时间线**。光标一离开胶囊就立刻恢复穿透（`near`），但视觉上再留一会儿才消失，所以不会"刚移开点不到底下的东西"。
- **收起状态下光标划过胶囊所在的区域不算数**。岛不可见时，那块地方应该归底下的窗口，不能因为光标恰好路过就把窗口变成可点击。
- **唤出必须停在细线上**，而不是"碰到屏幕顶部"。划过顶部不会弹出，点浏览器标签不会误触。
- **进入胶囊有 0.1 秒延迟**，快速划过时不吞掉点击。
- 用主进程轮询而不是渲染层的 `mousemove`：窗口是透明且穿透的，`mousemove` 在鼠标快速移出时会丢，状态会卡住。轮询读的是系统光标，不会丢。

起身提醒不受显隐影响：到点时窗口会被钉住（`pinForever`）并强制显示，处理完「好的 / 稍后」才恢复自动收起。

## 数据存在哪

- 待办：`%APPDATA%\desk-island\todos.json`
- 设置：`%APPDATA%\desk-island\settings.json`

删掉这两个文件即恢复默认。

## 版本检查

只做提示，不下载、不安装：

1. 启动 8 秒后（避开开屏抢网络）请求 `https://api.github.com/repos/hhpsilence/to-do-reminder/releases/latest`，比对 `tag_name` 和 `app.getVersion()`。
2. 有新版时，收起态的胶囊右侧亮一个小圆点，展开后列表头出现 `v1.2.0 ↑` 胶囊，设置页「版本」一行显示 `v1.1.0 → v1.2.0`。
3. 点胶囊或版本号 → 用系统浏览器打开 Release 页面，自己挑 setup 还是 portable。

之后每 6 小时查一次；失败就静默重试（30 分钟后），不打扰人。手动点设置页的版本号可以立刻查一次，并区分「已是最新」和「检查失败」。

为什么不做 electron-updater 那套自动更新：安装包 87 MB，而 portable 版运行时解压到临时目录、没有可替换的安装位置，自动更新对它完全无效；差分下载又要求本地缓存着上一版安装包，实际只有「装过两版以上的 setup 版用户」才吃得到收益。加上 GitHub Releases 在国内直连不稳，为省几十 MB 引入一整套更新链和它的坑，不划算。

**发新版时**：把 `package.json` 的 `version` 改掉 → 重新打包 → 在 GitHub 发一个 tag 更高的 Release（`v1.2.0`）并上传 exe。老用户下次启动就会看到小圆点。注意 tag 必须能被 `parseInt` 解析成数字（`v1.2.0` 可以，`v1.2.0-beta` 会被当成 `1.2.0`）。

## 开发

```bash
npm install      # 首次
npm start        # 调试运行（带控制台）
```

自检模式（不开界面，打印渲染状态后退出）：

```bash
set ISLAND_SELFTEST=1 && npx electron .
```

显隐状态机自检（喂一串假光标位置，验证 idle → near → over → idle）：

```bash
set ISLAND_SELFTEST_PRESENCE=1 && npx electron .
```

抓真实窗口截图（收起态 + 唤出态各一张，输出到指定目录）：

```bash
set ISLAND_SHOT=C:\temp && npx electron .
```

调试用的环境变量：

| 变量 | 作用 |
|---|---|
| `ISLAND_UPDATE_MOCK=1.2.0` | 假装远端有 1.2.0，用来看新版本提示长什么样（不发网络请求） |
| `ISLAND_USERDATA=C:\temp\x` | 换一份数据目录，自检或想同时开两份时用，不动日常数据 |

页面本身支持用 hash 预览各种状态，浏览器直接打开 `src/index.html` 也能看（走内置 mock 数据）：

`#open`、`#settings`、`#alert`、`#away`、`#wake`、`#update`，可以用逗号叠加，例如 `index.html#settings,update`。

## 结构

```
main.js            主进程：窗口、置顶、显隐状态机、计时、存储、版本检查、IPC
preload.js         暴露给页面的安全接口
src/index.html     胶囊结构（细线 / 收起 / 提醒 / 展开 / 设置）
src/style.css      暖米纸主题 + 顶部细线
src/renderer.js    交互逻辑 + 浏览器预览用的 mock 接口
build/icon.png     应用图标（1024x1024，由 tools/make-icon.py 生成）
tools/make-icon.py 图标生成脚本（纯 Python 画图，无需 Pillow）
```

## 打包

```bash
npm run dist            # 生成 dist\DeskIsland-1.0.0-setup.exe（NSIS 安装包）
npm run dist:portable   # 生成 dist\DeskIsland-1.0.0-portable.exe（免安装单文件）
npm run dist:dir        # 只生成目录版 dist\win-unpacked
```

装完 exe 在 `%LOCALAPPDATA%\Programs\DeskIsland\DeskIsland.exe`，卸载在「设置 → 应用」里。
数据目录固定为 `%APPDATA%\desk-island`，卸载重装不会丢待办。

### 免安装版是怎么工作的

electron-builder 的 `portable` 目标本质是一个自解压程序：双击后把应用解压到 `%TEMP%\nsXXXX.tmp\app`，运行完再删掉。因此启动会比安装版慢 1～2 秒（解压 200 MB 左右）。

这带来一个必须处理的坑：**免安装版里 `process.execPath` 指向的是那个临时副本，退出就没了**。如果拿它去注册开机自启，下次开机一定启动失败。所以 `main.js` 里做了判断：

```js
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE || '';
const isPortable = !!PORTABLE_EXE;
```

开机自启注册的是 `PORTABLE_EXECUTABLE_FILE`（也就是你双击的那个 portable.exe 本体）。移动了 exe 也没关系——每次启动都会用当前路径重新写一遍自启项。

## 排查

启动异常时看 `%TEMP%\desk-island-boot.log`，里面记录了 userData 路径、单实例锁、窗口创建等关键节点。

## 已知限制

- 安装包和免安装版都没有做代码签名，首次运行 Windows 可能弹 SmartScreen「已保护你的电脑」，点「更多信息 → 仍要运行」即可。
- 开机自启注册在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的 `electron.app.DeskIsland`，记录的是「当前正在运行的 exe 路径」，换位置后重新打开一次应用会自动修正。
- **安装版和免安装版共用同一份数据（`%APPDATA%\desk-island`）和同一个自启项**，所以别同时开两个——单实例锁会让后启动的那个直接退出。想同时跑两份，用 `ISLAND_USERDATA` 指到另一个目录（注意自启项仍只有一份）。
- 免安装版每次启动都要解压，冷启动比安装版慢；任务栏、开始菜单里不会有快捷方式，需要的话自己右键 exe 发送到桌面。
- 版本检查走 `api.github.com`。如果所在网络访问不了 GitHub，它只会安静地失败（启动日志里有一行 `update check failed`），不会弹任何提示，也不影响其他功能。
