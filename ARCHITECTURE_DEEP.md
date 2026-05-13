# ARCHITECTURE_DEEP.md — iframe-js 内核架构深度剖析

> 版本：2.2.1 | 源码入口：`ejs/index.js` (823 行，单文件双角色类)
>
> 本文档跳过表层 API 说明，直击内核设计模式、跨域消息循环机制、内存管理策略及潜在竞态条件。

---

## 一、设计模式的深层实践

### 1.1 单类双角色构造器（Constructor Role Bifurcation）

`Iframe` 类通过 `switch(true)` 模式实现了一个类同时服务于 **父窗口** 和 **子窗口** 两种角色：

```
switch (true) {
    case !!options?.container:    → 父角色（通过 container + url 创建/绑定 iframe）
    case options?.nodeName === 'IFRAME': → 父角色（直接接收已有 iframe DOM 节点）
    case typeof options === 'string':    → 子角色（字符串作为实例名，iframe = window.parent）
    default: → 无效配置
}
```

这种设计的关键洞察是：**父子双方共享完全相同的消息协议和状态机**，区别仅在于"往哪发"和"从哪收"。因此构造器在末尾通过动态方法绑定来实现角色分流：

```javascript
// 父角色
this.sendMessage = this.sendMessageParent;
this.emit = this.sendEmitEventParent;

// 子角色
this.sendMessage = this.sendMessageChild;
this.emit = this.sendEmitEventChild;
```

**评价**：这是一种 **Strategy Pattern 的轻量级实现** —— 通过运行时方法替换而非继承或多态来切换行为。优点是零抽象开销，缺点是 `sendMessage` 的签名在两种角色下语义不同（父角色返回 `string | false`，子角色也返回 `string | false`，但内部 target 不同），在 TypeScript 层面需要通过联合类型来兼容。

### 1.2 Promise 穿透的跨域异步 RPC（Cross-Origin Async RPC via Promise Penetration）

这是本库最核心的设计模式。传统 `postMessage` 是纯异步、无返回值的"发射后不管"（fire-and-forget）模型。iframe-js 通过 **Promise 的 resolve/reject 函数跨作用域传递** 实现了跨域 RPC。

#### 调用端（`callRemote`，第 481-526 行）：

```javascript
callRemote(methodName, params = {}, timeout = this._defaultTimeout) {
    return new Promise((resolve, reject) => {
        const callId = 'rpc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        // 将 resolve 和 reject 存入 Map，key 为 callId
        this._pendingMessages.set(callId, { timeout: timer, resolve, reject });
        targetWindow.postMessage({ isRpcReq: true, callId, methodName, params }, targetOrigin);
    });
}
```

**关键点**：`resolve` 和 `reject` 是 **一等公民对象**，它们被创建于 `new Promise` 的执行器函数中，但通过 `_pendingMessages` Map 被提升到了实例作用域。这意味着它们可以在 **任意后续时间点、任意代码路径** 中被调用 —— 即使是跨越了 iframe 边界的异步消息回调。

#### 响应端（消息监听器内，第 335-368 行）：

```javascript
if (e.data?.isRpcReq && e.data?.methodName) {
    const handler = this._rpcMethods.get(e.data.methodName);
    // Promise.resolve 包装 —— 同时兼容同步和异步 handler
    Promise.resolve(handler(e.data.params, { source: this.name }))
        .then((res) => sendResponse(null, res))
        .catch((err) => sendResponse(err?.message || err));
}
```

`Promise.resolve(handler(...))` 是一个极其精巧的模式：无论 `handler` 返回普通值还是 `Promise`，都能统一进入 `.then()/.catch()` 链。这避免了 `if (result instanceof Promise)` 的类型判断分支。

#### 回调关联（消息监听器内，第 255-265 行）：

```javascript
if (e.data?.isRpcRes && e.data?.callId && this._pendingMessages.has(e.data.callId)) {
    const pending = this._pendingMessages.get(e.data.callId);
    clearTimeout(pending.timeout);
    if (e.data.error) {
        pending.reject(new Error(e.data.error));  // ← 跨域触发 reject
    } else {
        pending.resolve(e.data.result);            // ← 跨域触发 resolve
    }
    this._pendingMessages.delete(e.data.callId);
}
```

**完整的异步穿透链路**：

```
调用端 callRemote()
  → new Promise 创建 resolve/reject
  → resolve/reject 存入 _pendingMessages[callId]
  → postMessage({ isRpcReq, callId })
      ↓ 跨域传输
响应端 message 事件
  → 查找 _rpcMethods[methodName]
  → Promise.resolve(handler()) 执行
  → postMessage({ isRpcRes, callId, result/error })
      ↓ 跨域传输
调用端 message 事件
  → 查找 _pendingMessages[callId]
  → pending.resolve(result) 或 pending.reject(error)
  → 最初的 Promise 链完成
```

**评价**：这种模式本质上是 **Promise-based Correlation Pattern** —— 利用唯一 ID（callId）作为关联键，将两个跨域的异步操作"缝合"为一个完整的 Promise 生命周期。它比传统的回调注册模式（`on('response', handler)`）更优雅，因为调用者可以使用 `async/await` 语法：

```javascript
const result = await iframe.callRemote('getUser', { id: 1 });
```

仿佛在调用本地函数一样，背后却是两次跨域 `postMessage`。

### 1.3 ACK 确认机制（Acknowledgment Pattern）

ACK 机制与 RPC 共享同一套 `_pendingMessages` 基础设施，但语义更简单：

- 发送端：消息携带 `requireAck: true` + `ackEvent: 'ackHead_' + messageId`
- 接收端：收到后立即回复 `{ ack: true, messageId }`
- 发送端：通过 messageId 关联，resolve 对应的 Promise

ACK 和 RPC 共享 `_pendingMessages` Map 是一个设计权衡：简化了状态管理（只有一个 pending 表），但也意味着 ACK 的 messageId 和 RPC 的 callId 如果碰撞会导致错误关联。实际中由于前缀不同（ACK 无前缀，RPC 有 `'rpc_'` 前缀），碰撞概率极低。

### 1.4 消息队列与延迟派发（Offline Queue & Deferred Dispatch）

`_messageQueue` 是一个 FIFO 队列，在 iframe 未就绪时缓冲消息：

```javascript
if (!this.isReady()) {
    this._messageQueue.push({
        payload,
        options: { ...options, timeout },
        resolve,
        isAck: true
    });
    return;
}
```

**刷新时机**：iframe 的 `onload` 事件触发时调用 `_flushMessageQueue()`。在刷新前，会先执行 `_syncFullState()` 确保远端拥有最新状态。

**RPC 队列的特殊处理**：RPC 调用在队列中存储的是一个闭包而非原始数据：

```javascript
this._messageQueue.push({
    isAck: false,
    payload: null,
    resolve: () => this.callRemote(methodName, params, timeout).then(resolve).catch(reject),
});
```

这意味着 RPC 调用在队列刷新时会 **重新执行 `callRemote()`**，重新生成 callId 和超时计时器。这是正确的 —— 因为旧的 callId 从未被发送过，不应该存在于 pending 表中。

**潜在问题**：如果 `_flushMessageQueue` 在 `_messageQueue.forEach` 迭代过程中有新消息入队（例如状态同步触发了远端回调），可能导致无限循环。当前实现在迭代后直接 `this._messageQueue = []` 截断，避免了此问题。

---

## 二、通信协议栈（Protocol Stack）

### 2.1 消息帧（Message Frame）结构

iframe-js 定义了 6 种消息帧类型，全部通过 `postMessage` 传输：

#### 基础消息帧（所有消息的骨架）

```javascript
{
    source: 'Iframe-Child-Screen' + instanceName,  // 身份标识 + 魔术前缀
    data: payload,                                   // 用户数据载荷
    id: Date.now() + Math.random().toString(36),     // 唯一消息 ID
    timestamp: Date.now(),                           // 时间戳
}
```

#### 自定义事件帧（type === 1）

```javascript
{
    source: 'Iframe-Child-Screen' + name,
    data: payload,
    id: messageId,
    timestamp: Date.now(),
    action: 'postHead_' + eventName,    // ← 事件名前缀
}
```

#### ACK 请求帧

```javascript
{
    ...基础帧,
    requireAck: true,
    ackEvent: 'ackHead_' + messageId,
}
```

#### ACK 响应帧

```javascript
{
    source: 'Iframe-Child-Screen' + name,
    ack: true,
    messageId: originalMessageId,
    timestamp: Date.now(),
}
```

#### RPC 请求帧

```javascript
{
    source: 'Iframe-Child-Screen' + name,
    isRpcReq: true,
    methodName: string,
    callId: 'rpc_' + Date.now() + '_' + random,
    params: any,
    timestamp: Date.now(),
}
```

#### RPC 响应帧

```javascript
{
    source: 'Iframe-Child-Screen' + name,
    isRpcRes: true,
    callId: string,
    result: any,
    error: string | null,
    timestamp: Date.now(),
}
```

#### 状态同步帧

```javascript
{
    source: 'Iframe-Child-Screen' + name,
    isStateSync: true,
    state: PartialState,
    timestamp: Date.now(),
}
```

#### 自动调高帧

```javascript
{
    source: 'Iframe-Child-Screen' + name,
    isAutoResize: true,
    height: number,
    timestamp: Date.now(),
}
```

### 2.2 协议栈分层模型

```
┌─────────────────────────────────────────┐
│  应用层 (Application Layer)              │
│  - RPC: callRemote / expose             │
│  - State Sync: setState / onStateChange  │
│  - Events: action / emit                │
│  - Auto Resize: enableAutoResize        │
├─────────────────────────────────────────┤
│  会话层 (Session Layer)                  │
│  - ACK 确认机制                          │
│  - Promise 关联 (_pendingMessages)       │
│  - 超时管理 (setTimeout)                 │
│  - 离线队列 (_messageQueue)              │
├─────────────────────────────────────────┤
│  传输层 (Transport Layer)                │
│  - _targetSend: 消息帧序列化             │
│  - targetOrigin 策略                     │
│  - 同域快速路径 (direct window access)   │
├─────────────────────────────────────────┤
│  网络层 (Network Layer)                  │
│  - window.postMessage                   │
│  - window.addEventListener('message')   │
└─────────────────────────────────────────┘
```

### 2.3 消息分发与过滤管线（Message Dispatch Pipeline）

消息监听器（第 244-377 行）是一个 **多层过滤管线**，消息必须通过所有层级才能被处理：

```
入站消息 (MessageEvent)
  │
  ├─ [Filter 1] _isDestroyed 检查 → 丢弃（实例已销毁）
  ├─ [Filter 2] ACK 响应匹配 → 处理并终止（第 247-253 行）
  ├─ [Filter 3] RPC 响应匹配 → 处理并终止（第 255-265 行）
  ├─ [Filter 4] StateSync 消息 → 处理并终止（第 267-279 行）
  ├─ [Filter 5] AutoResize 消息 → 处理并终止（第 281-286 行）
  ├─ [Filter 6] Origin 白名单验证 → 丢弃（第 288-300 行）
  ├─ [Filter 7] source window 验证 → 丢弃（第 302-304 行）
  ├─ [Filter 8] 魔术前缀检查 → 丢弃（第 306 行）
  ├─ [Filter 9] 自身消息过滤 → 丢弃（第 316 行）
  ├─ [Filter 10] ACK 回复 → 发送确认后继续（第 318-333 行）
  ├─ [Filter 11] RPC 请求 → 执行 handler 并终止（第 335-368 行）
  ├─ [Filter 12] 自定义事件 → 分发并终止（第 370-374 行）
  └─ [Filter 13] 普通消息 → 调用 this.message 回调（第 376 行）
```

**注意 Filter 2-5 在安全验证（Filter 6-9）之前执行**。这意味着 ACK 响应、RPC 响应、状态同步和自动调高消息 **不经过 Origin 白名单验证**。这是一个设计选择而非 Bug —— 这些消息类型被认为是在安全连接建立后才产生的，且它们的 callId/messageId 关联机制本身提供了安全保障。但从纵深防御角度看，所有入站消息都应通过安全验证。

### 2.4 N 个 Iframe 嵌套下的消息分发损耗分析

#### 场景：单父页面 + N 个子 iframe

当父页面创建 N 个 `Iframe` 实例时，每个实例注册一个独立的 `message` 事件监听器。由于 `window.postMessage` 会触发 **所有** 注册在 `window` 上的 `message` 监听器，每条消息的广播开销为：

```
O(N) — 每条消息被 N 个监听器各处理一次
```

但每个监听器通过以下机制快速排除不相关的消息：

1. `e.source !== this.iframe` — O(1) 引用比较，排除来自非目标 iframe 的消息
2. `!e.data.source?.includes('Iframe-Child-Screen')` — O(1) 字符串检查
3. `val.source === this.name` — O(1) 自身消息过滤

因此实际的消息分发损耗为 **O(N) 的常数因子** —— 每条消息被 N 个监听器各过滤一次，但只有 1 个监听器会真正处理。

**优化建议**：如果 N 很大（例如微前端架构下 10+ iframe），可以考虑使用 `MessageChannel` 替代全局 `message` 事件，将分发损耗从 O(N) 降至 O(1)。

#### 场景：深层嵌套（A → B → C → ...）

iframe-js **不直接支持跨层级通信**。在 A 嵌套 B 嵌套 C 的场景中，A 和 C 之间无法直接通信。每一层只能与其直接父/子通信：

```
A (parent) ←→ B (child of A, parent of C) ←→ C (child of B)
```

如果需要 A 与 C 通信，B 必须作为中继手动转发消息。库本身不提供任何路由或中继机制。

#### 场景：同源快速路径（Same-Domain Fast Path）

当父窗口和子窗口同源时，`emit` 操作会绕过 `postMessage`，直接通过 `window[eventKey]` 属性访问调用目标函数：

```javascript
if (IframeUtils.isSameDomain(window.location.href, this.url)) {
    const handler = this.iframe[EVENT_HEAD_PREFIX + event];
    if (handler && typeof handler === 'function') {
        handler({ source: this.name, data: payload });
        return true;
    }
}
```

这条路径的优势：
- **零序列化开销**：不需要 JSON 序列化/反序列化
- **同步执行**：不需要事件循环调度
- **可传递非克隆able对象**：如 DOM 节点、函数、循环引用等

---

## 三、内存泄漏风险审计

### 3.1 EventListener 生命周期管理

#### 注册与移除配对分析

| 注册点 | 移除点 | 配对状态 |
|--------|--------|----------|
| `window.addEventListener('message', this._messageListener)` (第 379 行) | `window.removeEventListener('message', this._messageListener)` (第 792 行) | 正常配对 |
| `container.onload` 赋值 (第 77 行) | 无显式移除 | 依赖 DOM 元素销毁 |
| `options.onload` 赋值 (第 103 行) | 无显式移除 | 依赖 DOM 元素销毁 |
| `ResizeObserver.observe()` (第 750 行) | `observer.disconnect()` (第 756/779 行) | 正常配对 |

**风险 1 — iframe DOM 移除但未调用 destroy()**

如果父页面通过 `container.remove()` 或 `container.parentNode.removeChild(container)` 移除了 iframe DOM 元素，但没有调用 `iframe.destroy()`：

- `window` 上的 `message` 事件监听器 **不会被自动移除**（它注册在父页面的 window 上，不随 iframe 移除而消失）
- `_pendingMessages` 中的 Promise 永远不会 resolve（超时后才会清理）
- `_messageQueue` 中的消息永远不会被刷新
- `this.iframe`（contentWindow 引用）在 iframe 移除后变为无效，但不会触发任何错误直到下次操作

**风险等级**：中高。在 SPA 应用中，路由切换时移除 iframe 但忘记调用 `destroy()` 是常见的内存泄漏模式。

**风险 2 — `onload` 回调闭包引用**

```javascript
const originalOnload = container.onload;
container.onload = () => {
    this._iframeLoaded = true;
    this.iframe = container.contentWindow;
    if (originalOnload) originalOnload.call(container);
    this.onload();
    this._flushMessageQueue();
};
```

这个闭包捕获了 `this`（Iframe 实例）和 `container`（DOM 元素）。如果 `container` 被移除但 `onload` 属性未清除，会形成一个循环引用：`container.onload → closure → this → this.iframeNode → container`。现代浏览器的 GC 可以处理这种循环引用，但在旧版 IE 中可能导致泄漏。

### 3.2 _pendingMessages Map 的生命周期

`_pendingMessages` 存储的是 `{ timeout, resolve, reject }` 三元组。每个条目的生命周期：

```
创建 → 存入 Map → 等待响应/超时 → 从 Map 删除
```

**正常路径**：
- ACK：收到 ack 响应 → clearTimeout → resolve → delete（第 247-253 行）
- RPC：收到 rpc 响应 → clearTimeout → resolve/reject → delete（第 255-265 行）

**超时路径**：
- ACK：setTimeout 触发 → delete → resolve(false)（第 209-213 行）
- RPC：setTimeout 触发 → delete → reject(Error)（第 515-517 行）

**销毁路径**：
- destroy() → 遍历所有 pending → clearTimeout → resolve(false) → clear()（第 784-788 行）

**风险 3 — 定时器回调中的 Map 操作顺序**

在超时回调中（第 209-213 行）：

```javascript
const timer = setTimeout(() => {
    this._pendingMessages.delete(messageId);  // 先 delete
    resolve(false);                            // 后 resolve
}, timeout);
```

这个顺序是安全的，因为 `resolve(false)` 不会触发对 `_pendingMessages` 的再次访问（调用者的 `.then()` 链是异步调度的）。

### 3.3 ResizeObserver 内存管理

`startAutoResizer()` 创建 `ResizeObserver` 并观察目标节点：

```javascript
this._resizeObserver = new ResizeObserver(() => { sendHeight(); });
this._resizeObserver.observe(targetNode);
```

**清理路径**：
1. `stopAutoResizer()` — 显式停止
2. `destroy()` — 实例销毁时停止

**风险 4 — targetNode 是动态元素**

如果 `config.target` 指向一个动态创建的 DOM 元素，该元素被移除后 `ResizeObserver` 会自动停止对该元素的观察（浏览器规范行为），但 `_resizeObserver` 引用不会被置空。后续调用 `startAutoResizer()` 时会因 `if (this._resizeObserver) return;` 而提前退出，导致无法重新启动。这是一个 **逻辑泄漏**。

### 3.4 全局 window 属性污染

`action()` 方法在 **同源** 场景下会将 handler 挂载到 `window` 对象：

```javascript
if (IframeUtils.isSameDomain(window.location.href, this.url)) {
    if (this.iframe === window.parent) {
        window[eventKey] = fun;
    }
}
```

**清理**：`removeAction()` 和 `destroy()` 都会 `delete window[eventKey]`。

**风险 5 — action 名称冲突**

`eventKey` 的格式为 `'postHead_' + name`。如果用户注册了 `action('postMessage', fn)`，虽然第 642 行有 `if (name === 'postMessage') return;` 的保护，但这一保护仅在 `action()` 入口处。如果通过其他方式（如直接 `window['postHead_postMessage'] = ...`）设置，仍可能覆盖原生 API。此外，`'postHead_'` 前缀是硬编码的，如果页面中存在其他库也使用此前缀，会产生冲突。

### 3.5 MessageChannel 分析

**本库不使用 MessageChannel**。所有通信通过 `window.postMessage` 进行。

这意味着：
- 不存在 MessageChannel 的端口泄漏问题
- 但也丧失了 MessageChannel 提供的私有通道隔离能力
- 在多实例场景下，每条消息都需要经过完整的过滤管线（见 2.3 节）

---

## 四、安全防御策略分析

### 4.1 Origin 验证机制

iframe-js 实施了三层 Origin 验证：

#### 第一层：白名单自动学习（Auto-Learn）

```javascript
if (this._originCache.size === 0) {
    if (this.iframe === window.parent) {
        // 子角色：自动信任第一个发来消息的 origin
        this.addWhiteList(e.origin);
    } else {
        // 父角色：空白名单则拒绝所有
        console.warn(`Origin missing in whitelist: ${e.origin}`);
        return;
    }
}
```

**安全分析**：子角色在空白名单时 **自动信任第一条消息的 origin**。这意味着：
- 在正常流程中，子 iframe 会自动学习父页面的 origin（因为父页面先发起握手）
- **但恶意页面也可以先发送一条消息来注入自己的 origin 到白名单中**

**攻击场景**：如果攻击者可以在子 iframe 加载后、父页面发送第一条消息之前，通过 `iframe.contentWindow.postMessage()` 向子 iframe 发送消息，攻击者的 origin 会被加入白名单。

**缓解因素**：攻击者需要能在父页面执行 JavaScript（此时已有更大安全问题）。

#### 第二层：白名单匹配

```javascript
if (!this._originCache.has(e.origin) && !this._originCache.has('*')) {
    return; // 拒绝
}
```

`_originCache` 是一个 `Set`，查找复杂度 O(1)。通配符 `'*'` 允许接受所有 origin。

**风险**：`'*'` 通配符会完全禁用 Origin 验证。

#### 第三层：Source Window 引用验证

```javascript
if (this.iframe && e.source !== this.iframe) {
    return;
}
```

`e.source` 是浏览器提供的 `MessageEvent.source` 属性，值为发送消息的 `WindowProxy` 对象。这是一个 **不可伪造的引用**（攻击者无法通过 postMessage 伪造 source）。

**这是最关键的安全屏障**。即使 Origin 验证被绕过（例如通过 `'*'` 通配符），攻击者仍无法通过 source 验证，除非它持有对目标窗口的引用。

### 4.2 Origin 验证失效时的纵深防御

假设最坏情况：Origin 白名单包含 `'*'`，攻击者持有对 iframe 窗口的引用。此时还有以下防线：

1. **魔术前缀检查**：`e.data.source?.includes('Iframe-Child-Screen')` — 攻击者需要知道此前缀
2. **实例名隔离**：`val.source === this.name` — 攻击者需要知道目标实例名
3. **callId/messageId 关联**：RPC/ACK 响应需要匹配已知的 callId/messageId，攻击者无法预测
4. **source window 验证**：`e.source !== this.iframe` — 需要持有正确的窗口引用

但需要注意：魔术前缀 `'Iframe-Child-Screen'` 是 **硬编码在源码中的公开常量**，不能作为真正的安全屏障。实例名可以通过枚举猜测。

### 4.3 消息帧完整性

`postMessage` 传输的数据经过浏览器的 **结构化克隆算法**（Structured Clone Algorithm）。这意味着：
- 数据在传输过程中不会被篡改（浏览器保证）
- 但不提供加密（中间人可在网络层截获，如果页面通过 HTTP 加载）
- 不可序列化的对象（如函数、DOM 节点）会导致 `postMessage` 抛出异常

### 4.4 `removeWhiteList()` Bug 的安全影响

第 450-458 行的 `removeWhiteList()` 方法存在 **复制粘贴 Bug**：它的实现与 `addWhiteList()` 完全相同 —— 它会 **添加** URL 而非 **移除**。

```javascript
removeWhiteList(url) {
    if (Array.isArray(url)) {
        const validUrls = url.filter((u) => u && typeof u === 'string');
        this.Whitelist = [...this.Whitelist, ...validUrls]; // BUG: 应为 filter 而非 concat
    } else if (url && typeof url === 'string') {
        this.Whitelist.push(url); // BUG: 应为 splice/indexOf + 删除
    }
    this._updateOriginCache();
}
```

**安全影响**：
- 无法从白名单中移除已信任的 origin
- 一旦 origin 被加入白名单，将永久信任（直到实例销毁）
- 在需要动态管理信任关系的安全场景中，这是一个 **高危漏洞**

---

## 五、高频 postMessage 性能分析

### 5.1 浏览器主线程阻塞阈值

`postMessage` 本身是异步的 —— 调用后立即返回，消息被放入接收窗口的事件队列中。但以下操作是同步的：

1. **消息序列化**（发送端）：结构化克隆算法在发送端同步执行。对于大型对象（如包含大量数据的嵌套对象或 ArrayBuffer），序列化可能耗时数百毫秒。

2. **事件回调执行**（接收端）：`message` 事件监听器在主线程中同步执行。如果监听器中包含耗时操作（如复杂计算、DOM 操作），会阻塞主线程。

3. **过滤管线开销**（接收端）：每条消息需要通过 ~13 层过滤检查。虽然每层都是 O(1) 操作，但在高频场景下（如每秒数百条消息），累积开销不可忽略。

### 5.2 高频场景下的性能特征

**ResizeObserver 触发频率**：`startAutoResizer()` 中的 `ResizeObserver` 在元素尺寸变化时会触发回调。在动画或窗口拖拽过程中，触发频率可达每秒 60 次。每次触发都会发送一条 `postMessage`。

**状态同步频率**：`setState()` 每次调用都发送一条状态同步消息。在 React/Vue 等框架的响应式更新中，可能会在一帧内调用多次 `setState()`。

**性能建议**：
- 对 `ResizeObserver` 回调添加节流（throttle），如每 100ms 最多发送一次
- 对 `setState` 添加批处理（batch），合并短时间内的多次更新为一条消息
- RPC handler 中避免长时间同步计算

### 5.3 消息帧大小分析

消息帧的基础开销（不含用户数据）：

| 字段 | 估计大小 |
|------|----------|
| `source`（前缀 + 名称） | ~50-80 bytes |
| `id`（时间戳 + 随机字符串） | ~30 bytes |
| `timestamp` | ~13 bytes（数字） |
| `isRpcReq`/`isRpcRes`/`isStateSync` 等标志 | ~20 bytes |
| `callId`（RPC 专用） | ~30 bytes |

基础帧开销约 **140-170 bytes**。对于频繁的小消息（如自动调高、状态同步），帧头开销占比可能超过有效载荷。

---

## 六、竞态条件分析

### 6.1 消息队列与 iframe 加载的竞态

**场景**：父页面在 iframe 加载完成前发送多条消息。

```
时间线：
T1: 父页面创建 Iframe 实例 → _iframeLoaded = false
T2: 父页面调用 sendMessage() → 消息入队 _messageQueue
T3: 父页面调用 callRemote() → RPC 入队 _messageQueue
T4: iframe 加载完成 → onload 触发
T5: _flushMessageQueue() → 先 _syncFullState()，再逐条重发
```

**潜在问题**：如果 iframe 的 `onload` 触发时，子页面中的 `Iframe` 实例尚未初始化完成（例如子页面的 JS 还在解析/执行中），刷新的消息可能会丢失。

**当前实现没有解决这个问题**。`onload` 事件仅表示 iframe 的 DOM 加载完成，不保证子页面的 JavaScript 已执行完毕。更稳健的做法是子页面在初始化完成后主动发送一条"ready"消息，父页面收到后再刷新队列。

### 6.2 多消息到达顺序

`postMessage` 保证消息的到达顺序与发送顺序一致（在同一个事件循环任务中）。但如果发送端在多个不同的异步任务中发送消息，到达顺序可能与预期不同。

**RPC 调用的顺序问题**：

```javascript
// 父页面
const result1 = await iframe.callRemote('methodA'); // 发送 RPC 请求 1
const result2 = await iframe.callRemote('methodB'); // 发送 RPC 请求 2
```

由于 `await` 的存在，第二个 RPC 请求会在第一个完成后才发送，因此到达顺序是确定的。但如果使用 `Promise.all`：

```javascript
const [result1, result2] = await Promise.all([
    iframe.callRemote('methodA'),
    iframe.callRemote('methodB'),
]);
```

两个 RPC 请求几乎同时发送。它们会按发送顺序到达子页面，但子页面的 handler 可能是异步的，如果 handler B 比 handler A 先完成，响应消息的到达顺序可能与请求不同。不过由于 callId 关联机制，这不会导致错误 —— 每个响应通过 callId 精确匹配到对应的 Promise。

### 6.3 destroy() 与进行中操作的竞态

**场景**：`destroy()` 在 RPC 请求正在处理时被调用。

```
时间线：
T1: 子页面收到 RPC 请求，开始执行 handler（异步）
T2: 父页面调用 destroy()
T3: 子页面 handler 完成，尝试发送 RPC 响应
```

T3 时，子页面会发送响应消息到 `e.source`（父窗口引用）。但父页面已经执行了 `destroy()`，`_messageListener` 已被移除。响应消息到达父页面后不会被处理，`_pendingMessages` 中的 Promise 已在 `destroy()` 中被 resolve(false)。

**结论**：这种情况不会导致错误，但调用者会收到 `false` 而非正确结果。对于依赖 RPC 返回值进行副作用的场景（如"保存数据"），可能导致数据不一致。

### 6.4 setState 的竞态

`setState()` 在本地更新状态后立即发送增量同步：

```javascript
setState(partialState) {
    const oldState = { ...this._state };
    this._state = { ...this._state, ...partialState };
    // 本地监听器同步触发
    this._stateListeners.forEach(listener => listener(this._state, oldState));
    // 远程同步
    if (this.isReady()) this._sendStateSync(partialState);
}
```

如果在 `_sendStateSync` 执行前又有新的 `setState` 调用：

```
setState({ a: 1 }) → 本地 state = { a: 1 }, 准备发送 { a: 1 }
setState({ b: 2 }) → 本地 state = { a: 1, b: 2 }, 准备发送 { b: 2 }
```

远端收到两条消息后按序处理，最终状态为 `{ a: 1, b: 2 }` —— 正确。但如果中间发生了 `_syncFullState()`（例如 iframe 重新加载触发了队列刷新），远端可能先收到全量 `{ a: 1, b: 2 }`，然后收到增量 `{ a: 1 }`，最终状态仍然是 `{ a: 1, b: 2 }` —— 仍然正确，因为合并使用的是展开运算符覆盖。

---

## 七、架构缺陷与改进建议

### 7.1 已确认 Bug

| 严重程度 | 问题 | 位置 |
|----------|------|------|
| **P0** | `removeWhiteList()` 实现为添加而非移除 | 第 450-458 行 |
| **P1** | Filter 2-5 在安全验证之前执行 | 第 247-286 行 |
| **P2** | `BlockingLog()` 全局覆盖 `console.log` | 第 816-818 行 |
| **P3** | ResizeObserver 在目标节点移除后不自动置空 | 第 718-752 行 |

### 7.2 架构改进方向

1. **引入 MessageChannel**：替代全局 `message` 事件，实现真正的点对点私有通道，消除 O(N) 广播开销和安全风险。

2. **握手协议**：子页面初始化完成后主动发送"ready"消息，父页面收到后再刷新队列，解决 iframe 加载时序不确定的问题。

3. **消息帧版本号**：在消息帧中添加协议版本号，为未来的不兼容升级提供迁移路径。

4. **状态同步批处理**：对 `setState` 添加微任务批处理，合并同一帧内的多次更新。

5. **同域检测优化**：`isSameDomain` 在每次 `emit`/`action` 时都调用 `new URL()` 构造函数。可以缓存结果。

---

## 八、总结

iframe-js 的核心架构可以用一句话概括：**通过 Promise 的 resolve/reject 一等公民特性，将 postMessage 的 fire-and-forget 模型升级为请求-响应模型，并通过唯一 ID 关联实现了跨域异步 RPC**。

其设计哲学是 **务实而非过度抽象** —— 单类双角色、共享 pending 表、硬编码魔术前缀，这些选择在保持代码简洁性的同时，也带来了安全性和可扩展性上的权衡。作为一个轻量级通信库（<1000 行代码），它在功能完备性（RPC、ACK、状态同步、自动调高）和实现简洁性之间取得了不错的平衡。
