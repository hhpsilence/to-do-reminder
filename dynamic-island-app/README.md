# 桌面灵动岛 · 暖米纸

Windows 顶部居中的小胶囊：记待办、看清单、连续工作到点提醒你起身。

平时它收起成屏幕顶部中央的一条细线，鼠标不碰它就完全不占地方，不会压住浏览器标签栏。

## 怎么用

> 想给别人介绍这个应用？直接打开 `介绍页.html`（单文件网页，可本地双击或传给别人看）。

**免安装版（推荐，绿色版）**：双击 `dist\DeskIsland-1.0.0-portable.exe` 就能用。单个文件，不写安装信息、不进「设置 → 应用」，拷到任何地方（U 盘也行）都能跑。

**安装版**：双击 `dist\DeskIsland-1.0.0-setup.exe`，一路下一步，装完开始菜单和桌面会有「灵动岛」快捷方式。

**开发版**：双击 `启动灵动岛.bat`。

- 平时：屏幕顶部中央一条 4px 细线，其余地方什么都没有
- 动键鼠工作时自动收起；停手一小会儿（默认 1 分钟，可自己填），它就在当前页面上自己出现
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
| **智能** | 动键鼠就收起；停手到设定分钟数（默认 1 分钟，可填 1～60）在当前页面自动出现；再动键鼠 0.4 秒收回 |

智能模式只看一个信号：`powerMonitor.getSystemIdleTime()` —— 多久没碰键鼠。不区分前台是桌面还是别的程序，停手就在当前页面上显示出来。

设置里「停手自动显示」这一行是两个东西：

- **分钟数输入框**：手动填，1～60 分钟，回车或点别处生效，超出范围自动夹到边界，留空回落 1 分钟。存 `settings.idleMin`。
- **右侧开关**：总开关，存 `settings.autoIdle`（默认开）。关掉后智能模式不再自动弹出，退化成只认顶部细线——分钟数框跟着变灰。

切到「悬停」或「常驻」时整行变灰，因为这两种模式用不到它。

> 1.2.1 把单位从秒改成了分钟，旧配置里的 `idleSec`（比如 15 秒）会在启动时折算成 `idleMin: 1` 并写回文件，不会丢设置。

### 位置：固定顶部 / 可拖拽

默认 **固定顶部**：窗口贴在屏幕最上方中央，配合上面的显隐逻辑。

切到 **可拖拽** 后：

- 按住岛上的空白处（按钮、输入框、列表、设置项除外）就能把整个岛拖到屏幕任意位置，松手记住坐标，下次启动回到原地。
- 这时岛**一直显示**，不再自动收起——它已经不在顶部了，细线和"停手出现"都没意义，`pollPresence` 里直接 `autoShow = true`。
- 位置存在 `settings.winPos`，切换回「固定顶部」会把窗口挪回屏幕顶部中央并清掉这个值。

拖动是渲染层算屏幕位移、主进程按"按下那一刻的窗口位置"平移（`win.setPosition`），不是用 `-webkit-app-region: drag`——那个会把点击一起吞掉，岛就点不开了。位置会被夹在屏幕工作区内，岛本体不会被拖出去。

## 外观

收起态的胶囊左边是那只舞狮小女仆（`src/mascot.png`，128×136 透明底），提醒态、列表页标题旁也各用了一次。配色跟着换成奶白 + 赭橙 + 藏青，暖米纸的底子没动。

图片是拿参考图抠出来的：从四边泛洪清掉背景（只清与边缘连通的部分，所以奶油色鬃毛不会被误伤），边缘按与背景色的距离做羽化。要换形象，替换 `src/mascot.png` 即可，尺寸比 128×136 大一点更好。

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

## 自动更新

分两条路，靠 `app.isPackaged && !isPortable` 判断：

| 版本 | 行为 |
|---|---|
| **安装版（setup）** | `electron-updater` 全自动：后台下载 → 下好了提示「重启更新」→ 点一下静默安装并重启。不点也没关系，下次退出时自动装上（`autoInstallOnAppQuit`）。 |
| **免安装版 / 开发态** | 只查 GitHub Release 的 tag，有新版就提示，点开跳浏览器自己下载。 |

免安装版是解压到 `%TEMP%` 临时目录运行的，没有可替换的安装位置，自动更新对它无效——这不是偷懒，是 portable 这个打包方式本身的限制。

状态机（`upd.status`）：

```
idle → checking → available → downloading → ready
                     ↘ error（只在用户已经知道有新版本时才提示）
```

界面对应：

- 收起态胶囊右侧亮一个小圆点
- 列表头出现 `v1.3.0 ↑` 胶囊，下载中显示百分比 `42%`，下好了变成 `重启更新`
- 设置页「版本」一行：`v1.2.0 → v1.3.0`，就绪时变成 `v1.3.0 已就绪 · 点此重启`

调度：启动 8 秒后第一次查（避开开屏抢网络），之后成功 6 小时、失败 30 分钟重试。检查阶段网络不通就静默跳过，不弹任何东西。

**差量下载**：`electron-builder` 打包时生成的 `.blockmap` 记录了安装包每个块的哈希，`electron-updater` 拿它和旧安装包比对，只下载变化的块。

找旧 blockmap 的顺序是：本地更新缓存 → **旧版本 Release 里那个 `.blockmap` 资源** → 都没有就退回全量。所以：

- **每个 Release 都必须传自己那版的 `.blockmap`**，漏传不会报错，只是那一版升下一版时退化成全量下载。
- 刚装完的第一版升第二版通常仍是全量——本地还没有可复用的旧安装包。

实测（1.1.9 → 1.2.0）：日志里先打 `Download block maps (old: .../v1.1.9/...blockmap)`，因为那个版本不存在而 404，接着 `Cannot download differentially, fallback to full download`，然后安静地走完整下载，全程不影响界面。这个降级是设计好的，不是故障。

**发新版时**：

1. 改 `package.json` 的 `version`
2. `npm run dist`（会生成 `dist/DeskIsland-<版本>-setup.exe`、`.blockmap` 和 **`latest.yml`**）
3. 在 GitHub 建 tag 更高的 Release，把 `setup.exe`、`setup.exe.blockmap`、`latest.yml` 三个文件都传上去

`latest.yml` 是更新的入口清单（版本号、文件名、sha512），**漏传它客户端就会 404，自动更新永远不生效**。portable 包可以一起传，但那只是给免安装用户手动下的。

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
| `ISLAND_SELFTEST=1` | 起来就检查 DOM 结构、加一条待办、然后退出 |
| `ISLAND_SELFTEST_PRESENCE=1` | 喂一串假光标位置，走一遍 idle → near → over → idle |
| `ISLAND_DRAGTEST=1` | 走完整条拖拽 IPC，验证窗口真的移动、位置被记住 |
| `ISLAND_ALERTTEST=1` | 把专注时长压到 1 分钟等提醒自己弹出，逐 50ms 记 `presence` 和上报的岛矩形，用来验证提醒刚弹出时按钮是不是立刻可点 |

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
