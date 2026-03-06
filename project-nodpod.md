# Nodepod 技术报告

> 范围说明：本报告只讨论 **Nodepod 本体**，不展开上层 `LiveNode Agent` UI 逻辑。

## 1. 项目定位

**Nodepod** 是一个运行在浏览器里的类 Node.js 运行时。  
它不是把原生 Node 二进制搬进浏览器，而是通过下面几类能力组合出一套 **Node 风格开发环境**：

- 内存文件系统
- JavaScript 执行引擎
- Node 内建模块 polyfill
- Web Worker 进程模型
- Service Worker 请求代理与预览桥接

对应入口主要在：

- [src/index.ts](./src/index.ts)
- [src/sdk/nodepod.ts](./src/sdk/nodepod.ts)
- [README.md](./README.md)

---

## 2. Nodepod 是怎么写的

### 2.1 总体架构

Nodepod 的核心不是单个模块，而是几层组合：

| 层 | 作用 | 关键文件 |
|---|---|---|
| SDK 层 | 对外暴露 `Nodepod.boot()`、`spawn()`、`createTerminal()` | [src/sdk/nodepod.ts](./src/sdk/nodepod.ts) |
| 执行引擎层 | 负责脚本执行、模块解析、`require/import` 兼容 | [src/script-engine.ts](./src/script-engine.ts) |
| 文件系统层 | 在内存中实现 POSIX 风格 VFS | [src/memory-volume.ts](./src/memory-volume.ts) |
| polyfill 层 | 模拟 `fs/http/process/child_process/...` | `src/polyfills/*` |
| 进程/线程层 | 用 Web Worker 模拟进程、IPC、VFS 同步 | `src/threading/*` |
| 代理/预览层 | 把浏览器内虚拟服务映射为可访问预览 URL | [src/request-proxy.ts](./src/request-proxy.ts) |

---

### 2.2 文件系统：MemoryVolume

Nodepod 的底层文件系统是 **纯内存 VFS**，不是浏览器真实磁盘。

#### 设计方式

每个节点有三种类型：

- `file`
- `directory`
- `symlink`

文件内容保存在 `Uint8Array`，目录节点持有 `Map<string, VolumeNode>`。

#### 支持的能力

- `readFileSync / writeFileSync`
- `mkdirSync / readdirSync / statSync`
- `symlink`
- `watch`
- 快照序列化 / 恢复

关键实现：
- [src/memory-volume.ts](./src/memory-volume.ts)

#### 作用

Nodepod 里几乎所有能力都建立在这层上：

- npm 安装结果写入 VFS
- shell 命令读写 VFS
- 模块解析从 VFS 读取
- Worker 启动时使用 VFS snapshot

---

### 2.3 脚本执行引擎：ScriptEngine

`ScriptEngine` 是 Nodepod 的第二根主梁。  
它负责把浏览器 JS 运行环境“包一层”，让代码更像在 Node 中执行。

#### 它做的事

- 模块解析
- `require()` 加载
- ESM/CJS 转换
- Node 风格内建模块注入
- `package.json` / exports / conditional exports 处理
- 兼容一部分前端工具链依赖

关键文件：

- [src/script-engine.ts](./src/script-engine.ts)
- [src/syntax-transforms.ts](./src/syntax-transforms.ts)

#### 关键特点

它不是简单 `eval()`，而是维护了自己的模块解析与加载逻辑。  
这也是 Nodepod 能跑 npm 包和 CommonJS 的核心原因。

---

### 2.4 进程模型：ProcessManager + Worker

Nodepod 里的“进程”本质上是 **Web Worker 封装出来的执行单元**。

#### 运行链路

1. 主线程调用 `ProcessManager.spawn()`
2. 创建 Worker
3. 把 cwd、env、VFS snapshot 发给 Worker
4. Worker 内初始化：
   - `MemoryVolume`
   - `ScriptEngine`
   - `NodepodShell`
5. stdout/stderr/exit/cwd-change 等事件通过消息协议回传主线程

关键文件：

- [src/threading/process-manager.ts](./src/threading/process-manager.ts)
- [src/threading/process-handle.ts](./src/threading/process-handle.ts)
- [src/threading/process-worker-entry.ts](./src/threading/process-worker-entry.ts)

#### 设计意义

这让 Nodepod 不只是“执行一段 JS”，而是能模拟：

- `spawn`
- `fork`
- IPC
- 多进程并发
- 服务监听生命周期

---

### 2.5 Shell 与 child_process

Nodepod 的 shell 不是外接的 bash，而是项目内部自己实现的一套 shell 解释器。

#### 核心模块

- [src/shell/shell-interpreter.ts](./src/shell/shell-interpreter.ts)
- [src/polyfills/child_process.ts](./src/polyfills/child_process.ts)

#### 作用

它支持：

- 普通命令执行
- 管道
- 重定向
- `cd`
- 内建命令
- npm/node/npx/git 等命令封装
- stdin/raw mode 交互

这层再通过 Worker 模型与 VFS 组合，才形成 Nodepod 的 terminal 体验。

---

### 2.6 终端层：NodepodTerminal

终端层只负责“交互表现”和“输入控制”，不直接负责执行逻辑。

关键文件：
- [src/sdk/nodepod-terminal.ts](./src/sdk/nodepod-terminal.ts)

#### 主要功能

- prompt 渲染
- 行编辑
- 历史记录
- Ctrl+C
- cooked/raw 模式
- 输出写入

真正的命令执行 wiring 是在：
- [src/sdk/nodepod.ts](./src/sdk/nodepod.ts)

也就是说：

- `NodepodTerminal` 更像 terminal frontend
- `createTerminal()` 才把 terminal 和 shell worker 接上

---

## 3. Nodepod 跑起来的流程

### 3.1 `Nodepod.boot()` 启动流程

`Nodepod.boot()` 是项目主入口，启动步骤很清晰：

1. 检查 `Worker`
2. 检查 `SharedArrayBuffer`
3. 创建 `MemoryVolume`
4. 创建 `ScriptEngine`
5. 创建 `DependencyInstaller`
6. 创建 `RequestProxy`
7. 创建 `ProcessManager`
8. 建立 `VFSBridge`
9. 如果可用，初始化共享内存 VFS 和同步通道
10. 初始化 shell 执行环境
11. 如果传入 `swUrl`，注册 Service Worker

关键文件：
- [src/sdk/nodepod.ts](./src/sdk/nodepod.ts)

---

### 3.2 启动后的两种主要使用方式

#### 方式 A：直接起进程

```ts
await nodepod.spawn("node", ["index.js"]);
```

#### 方式 B：创建交互终端

```ts
const terminal = nodepod.createTerminal(...);
```

前者更像程序化调用，后者更像用户交互式 shell。

---

### 3.3 浏览器内服务怎么跑起来

当 Worker 内代码启动 HTTP server 时：

1. Worker 侧 `http` polyfill 触发监听事件
2. `ProcessManager` 记录 `port -> pid`
3. `RequestProxy` 注册虚拟服务
4. 外层通过虚拟 URL 访问这个端口
5. 请求再被转发回对应 Worker 执行

关键文件：

- [src/polyfills/http.ts](./src/polyfills/http.ts)
- [src/request-proxy.ts](./src/request-proxy.ts)
- [src/sdk/nodepod.ts](./src/sdk/nodepod.ts)

这就是 Nodepod 在浏览器里“跑服务”的核心机制。

---

## 4. Nodepod 原本的坑

### 4.1 依赖浏览器隔离环境

这是最基础的坑。

Nodepod 启动时明确要求：

- `Worker`
- `SharedArrayBuffer`

而 `SharedArrayBuffer` 在现代浏览器里又要求 cross-origin isolation。  
也就是说部署环境必须带：

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

否则运行时直接起不来。

这不是小问题，是架构级前提。

---

### 4.2 不是完整原生 Node

Nodepod 提供的是 **类 Node.js**，不是原生 Node。

README 已明确区分：

- 完整实现模块
- shim / stub 模块

例如：

- `fs/path/events/http/process/child_process` 这类支持较完整
- `dns/http2/tls/vm/v8/inspector` 这类并不等同原生实现

这决定了：
**Nodepod 很强，但不能直接宣称“浏览器里跑完整 Node”。**

---

### 4.3 工具链默认假设是“宿主机环境”

现代前端工具链默认假设：

- 有真实文件系统
- 有原生 binding
- 有 Node 原生模块
- 有系统级 localhost 端口

这些在浏览器里都不成立。  
Nodepod 为了支持这类工具，不得不做很多兼容和替代。

---

### 4.4 预览不是直接访问 localhost

Nodepod 内部服务监听成功，不代表宿主机 `127.0.0.1:port` 会开放。

浏览器里服务访问链路是：

```text
Worker 内 server
-> ProcessManager
-> RequestProxy
-> Service Worker / 虚拟 URL
-> iframe preview
```

所以如果跳过这层，直接在宿主浏览器地址栏访问 `127.0.0.1:4173`，通常会失败。  
这是运行模型决定的，不是简单 bug。

---

### 4.5 多终端共享 cwd

这是项目最近暴露出来的一个真实架构坑。

原先 `createTerminal()` 虽然每次新建 terminal，但执行命令时仍依赖全局 `Nodepod._cwd`。  
结果是：

- 一个 terminal 执行 `cd`
- 另一个 terminal 的有效 cwd 也会被改掉

这个问题根因在 SDK 层，不在 UI 层。  
当前本地分支已经通过“terminal session cwd 隔离”修掉，但从架构角度看，这属于 Nodepod 原本存在的状态共享问题。

---

### 4.6 测试环境依赖虚拟模块

`ProcessManager` 依赖 `virtual:process-worker-bundle`：

- 这是 Vite 插件在构建阶段注入的虚拟模块
- 在普通测试环境里，直接 import 会缺失

这说明 Nodepod 的运行时构建链和测试链之间存在一个典型坑：

> 有些能力依赖 bundler 注入，而不是纯 TypeScript 代码天然存在。

这在浏览器运行时项目里很常见，但需要明确意识到。

---

## 5. Vite 是怎么被支持的

### 5.1 第一层：命令执行与包安装

Vite 能先被装上、跑起来，依赖的是：

- shell
- npm / npx / node 命令实现
- VFS
- 包安装器

关键文件：
- [src/polyfills/child_process.ts](./src/polyfills/child_process.ts)

这是最基础的一层：  
**先保证 `npm install vite`、`npx vite` 不报环境级错误。**

---

### 5.2 第二层：兼容 Rollup / Rolldown 依赖

Vite 生态会依赖很多原生 binding 风格模块。  
Nodepod 在 `script-engine.ts` 里做了专门兼容：

#### 兼容点

- `rollup/parseAst`
- `@rollup/rollup-*`
- `@rolldown/binding-*`

这些模块在浏览器里本来跑不起来，Nodepod 用 polyfill / stub / transform 兼容掉了。

关键文件：
- [src/script-engine.ts](./src/script-engine.ts)

这部分是 Vite 支持的核心，不是外围补丁。

---

### 5.3 第三层：提供 esbuild context 接口

Vite dev server 依赖 esbuild 的增量上下文能力。  
Nodepod 的 esbuild polyfill 提供了 `context()` 接口，暴露：

- `rebuild()`
- `watch()`
- `serve()`
- `dispose()`

关键文件：
- [src/polyfills/esbuild.ts](./src/polyfills/esbuild.ts)

这说明 Nodepod 不是只“假装能 import esbuild”，而是尽量对齐了 Vite dev 场景最需要的接口形状。

---

### 5.4 第四层：HMR 相关文件变化同步

HMR 要成立，不只是 server 能启动，还得让文件变化被观察到。

Nodepod 在两处做了补偿：

#### 补偿 1：VFS -> Worker 广播

主线程文件变化会通过 `VFSBridge` 广播给 Worker。

#### 补偿 2：chokidar 桥接

`events.ts` 里有专门针对 chokidar watcher 的 VFS bridge 逻辑。  
它通过识别 watcher 的 `_watched Map`，把 VFS 变化直接转成 `change/add/unlink` 事件。

关键文件：
- [src/polyfills/events.ts](./src/polyfills/events.ts)

这部分很关键，因为在浏览器里，真实 `fs.watch` 语义本来就不完整。  
Nodepod 是靠这层桥接把 HMR 补起来的。

---

### 5.5 第五层：预览链路

Vite 启动后，要让浏览器真正看到页面，还必须打通预览链：

```text
vite dev server
-> worker port listen
-> ProcessManager 记录端口
-> RequestProxy 注册
-> Service Worker / 虚拟路由
-> iframe preview
```

这部分不是 Vite 本身做的，而是 Nodepod 的预览架构完成的。

关键文件：

- [src/request-proxy.ts](./src/request-proxy.ts)
- [src/polyfills/http.ts](./src/polyfills/http.ts)

---

## 6. 当前代码层面可以怎么评价 Nodepod

### 6.1 做得好的地方

#### 1. 不是单点 hack，而是完整链路设计

Nodepod 不是只做了一个 `fs` polyfill，也不是只做了终端。  
它做的是一条完整链：

- VFS
- 模块执行
- shell
- 进程
- HTTP
- 预览
- 工具链兼容

这点是它真正有价值的地方。

#### 2. 对现代前端工具链做了现实妥协

Vite 能支持，不是“浏览器突然变成 Node 了”，  
而是 Nodepod 在多个层面把原本依赖宿主机的假设改写掉了。

#### 3. 进程与服务模型较完整

`ProcessManager + RequestProxy + Worker` 这套组合，说明它不是玩具级运行器，而是认真做了进程与服务生命周期。

---

### 6.2 需要保持清醒的地方

#### 1. 它仍然是浏览器运行时

不是原生 Node，不是容器，不是系统级 localhost。

#### 2. 部署要求高

生产部署必须认真处理：

- COOP/COEP
- SW
- 预览代理
- CORS 链路

#### 3. 兼容性需要按场景表述

最合理的说法不是：

> “Nodepod 完整支持 Node 和 Vite”

而是：

> “Nodepod 在浏览器中实现了较完整的 Node 风格运行时，并对 Vite dev 场景做了专门兼容。”

这更准确。

---

## 7. 总结

Nodepod 的本质可以概括成一句话：

> **它用浏览器原生能力重新拼出了一套可执行、可交互、可预览的 Node 风格运行环境。**

它最难的地方不是某个 API，而是把以下东西同时打通：

- 文件系统
- 模块解析
- npm 包
- shell
- 多 Worker 进程
- 服务监听
- 预览桥接
- 前端工具链兼容

从架构角度看，Nodepod 不是“浏览器里运行 JS”这么简单，  
而是：

> **浏览器里运行一个尽量接近真实开发环境的工程 runtime。**
