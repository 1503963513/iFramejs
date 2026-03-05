# iframe-js

**iframe-js** 是一款轻量、安全、优雅的跨域 iframe 通信库。完美解决原生 `postMessage` 来源不可控、回调地狱、缺乏送达确认等痛点。

## 🎮 在线体验 (Live Demo)

👉 **[点击这里体验：基础通信与 Promise ACK 确认机制 Demo](https://resource.zhuoson.com/demo/iframe-demo/index.html)**

👉 **[点击这里体验：自动高度适应 (Auto Resize) 功能 Demo](https://resource.zhuoson.com/demo/iframe-demo/Highly-monitored.html)**

👉 **[点击这里体验：全局状态同步 (State Sync) 与 RPC 远程调用 Demo](https://resource.zhuoson.com/demo/iframe-demo/remote-invocation.html)**

> 💡 **Tip：** 体验时强烈建议打开浏览器的 **开发者工具 (F12) -> 控制台 (Console)**，您可以直观地查看到底层的双向通信细节、未就绪消息的“队列排队”过程，以及极致的 ACK 确认回执等完整动态日志！

---

## ✨ 核心特性

- **RPC 远程过程调用**：像调用本地异步函数一样调用跨域 iframe 中的函数，完美获取返回值。
- **全局状态共享 (State Sync)**：内置跨域状态机，支持多端状态增量/全量实时同步（类似微缩版 Pinia）。
- **自动高度适应 (Auto Resize)**：子页面基于 `ResizeObserver` 智能探测 DOM 变化，父页面 iframe 标签高度自动无缝伸缩，彻底告别双滚动条。
- **真正的多实例隔离**：完美支持在同一父页面中嵌入多个独立 iframe，底层自动进行环境隔离与引用校验，消息与状态互不干扰。

- **优雅的事件驱动**：告别冗长的 `if-else`，支持类似 EventBus 的 `action/emit` 自定义事件分发。

- **可靠的 ACK 确认机制**：支持带超时控制的双向消息/事件确认（Promise API）。无视跨域与重定向引发的引用漂移，确保回执 100% 准确送达；同域下更支持异步等待执行结果。

- **内置离线消息队列**：无惧 iframe 尚未加载完成，未就绪的消息将自动进入队列，等待 `isReady` 放行或 `onload` 后自动按序发送。

- **严苛的安全策略**：内置严格的 Origin 白名单校验与跨域 DOM 异常防御，彻底拦截非法来源消息与脚本注入污染。

---

## 📦 安装与引入

#### NPM / Yarn / pnpm (推荐)

适用于 Vue、React 等现代前端工程化项目：

```sh
npm i iframe-js
```

#### CDN 引入 (ES Module)

适用于现代浏览器的原生 HTML 项目：

```sh
https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v2.2.1/index.min.js
https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v2.2.1/ejs/index.min.js

<script type="module">
  import Iframe from 'https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v2.2.1/ejs/index.min.js';
</script>
```

## 🚀 快速开始

## 框架中使用 (以 Vue 3 为例)

```vue
<script setup>
import { onMounted, ref } from 'vue';

import Iframe from 'iframe-js'; // 引入默认导出的 Iframe 类

const iframeRef = ref(null);

onMounted(() => {
    // 1. 初始化父页面实例
    const iframe = new Iframe({
        container: iframeRef.value,
        url: '[http://127.0.0.1:5501/child.html](http://127.0.0.1:5501/child.html)',
        whiteList: ['[http://127.0.0.1:5501](http://127.0.0.1:5501)'], // 必填：配置通信白名单
        timeout: 5000, // 可选：全局 ACK 超时时间 (ms)
    });

    // 2. 监听子页面的自定义事件
    iframe.action('childReady', (e) => {
        console.log('收到子页面事件:', e.data);
    });
});
</script>

<template>
    <div class="app_container">
        <iframe class="iframe" ref="iframeRef"></iframe>
    </div>
</template>
```

## 原生 JS 使用

#### 父页面 (Parent)

```JavaScript
<script type="module">
import Iframe from './iframe.js';
// 1. 初始化实例

const iframe = new Iframe({
  container: document.getElementById('child'),
  url: '[http://127.0.0.1:5501/child.html](http://127.0.0.1:5501/child.html)' + window.location.search,
  whiteList: ['[http://127.0.0.1:5501](http://127.0.0.1:5501)'],
  timeout: 5000
});

// 2. 接收普通消息
iframe.message = (e) => {
  console.log('父页面接收到普通消息', e);
  document.getElementById('opt').innerText = e.data.msg;
};

// 3. 发送带 ACK 确认的自定义事件
document.getElementById('btn').onclick = async function () {
  const isReceived = await iframe.emitToChildWithAck('handel', { msg: 'hello child' });
  console.log(isReceived ? '子页面已确认收到' : '发送超时或失败');
};
</script>
```

#### 子页面 (Child)

```JavaScript
<script type="module">
import Iframe from './iframe.js';

// 1. 初始化实例，传入当前 iframe 唯一标识
const childApp = new Iframe('game1');
// 2. 添加白名单 (信任的父页面 Origin)
childApp.addWhiteList('[http://127.0.0.1:5501](http://127.0.0.1:5501)');
// 3. 监听 iframe onload
childApp.action('onload', () => {
  console.log('子页面初始化完毕');
  // 主动通知父页面
  childApp.emit('childReady', { status: 'success' });
});

// 4. 监听来自父页面的事件 (与父页面的 emit 对应)
childApp.action('handel', (e) => {
  console.log('子页面接收到自定义事件', e.data);
});
</script>
```

---

## 📖 API Reference

## 基础通信 API

- **`sendMessage(payload: any, options?: { origin?: string })`** 发送普通消息。`payload` 为任意可序列化的数据。返回 `string` (内部生成的消息 ID) 或 `false`。

- **`message`** (属性) 用于接收普通消息的回调函数覆盖。例：`iframe.message = (e) => { console.log(e.data) }`。

- **`action(name: string, callback: Function)`** 监听自定义事件。`callback` 会接收到一个对象 `{ source: string, data: any }`。

- **`removeAction(name: string)`** 移除指定的自定义事件监听器。

- **`emit(event: string, payload?: any)`** 触发对方的自定义事件。返回 `boolean` 表示是否调用成功。

## 高级确认机制 (ACK API)

> 以下方法均返回 `Promise<boolean>`。成功收到对方确认返回 `true`；超时、或目标页面尚未 Ready 且长期未加载，返回 `false`。**支持省略 `timeout`，将使用实例化时的默认超时时间。**

**父页面调用:**

- `sendMessageWithAckToChild(payload: any, timeout?: number)`

- `emitToChildWithAck(event: string, payload?: any, timeout?: number)`

**子页面调用:**

- `sendMessageParentWithAck(payload: any, timeout?: number)`

- `emitToParentWithAck(event: string, payload?: any, timeout?: number)`

## 状态与生命周期

- **`isReady(): boolean`** 检查通信是否就绪（DOM是否加载完、白名单是否配置且上下文合法）。未就绪时发出的 ACK 消息会自动进入内部队列。

- **`destroy()`** 彻底销毁实例。主动阻断所有进行中的 Promise 队列，清理所有事件监听器和内存占用（强烈推荐在 Vue/React 的 `onUnmounted` / `useEffect` 清理函数中调用）。

## 工具类 `IframeUtils` (按需引入)

提供静态方法辅助判断环境：

```JavaScript
import { IframeUtils } from 'iframe-js';
const isEmbed = IframeUtils.isEmbedded(); // 检测当前页面是否被内嵌在 iframe 中
```

---

## 🛡️ 安全与白名单策略 (`whiteList`)

为了防御跨站点脚本攻击 (XSS) 和恶意消息注入，iframe-js 强制启用了 Origin 白名单校验机制。

## 配置具体 Origin (推荐)

仅允许指定的域名、协议、端口与当前实例通信：

```JavaScript
iframe.addWhiteList('[https://www.trusted-domain.com](https://www.trusted-domain.com)');
iframe.addWhiteList(['http://localhost:8080', '[https://api.my-domain.com](https://api.my-domain.com)']);
```

## 使用 `*` 通配符 (开发/开放平台模式)

在某些场景下（如：本地动态端口开发、向全网开放的第三方公开挂件），你可能无法预知对方的 Origin。此时可以配置通配符 `*`：

```JavaScript
// 允许接收来自任何域名的消息
iframe.addWhiteList('*');
```

> **⚠️ 安全警告**：开启 `*` 后，任何恶意网站嵌入你的 iframe 都可以向你发送伪造消息。请在业务代码中**不要**通过 `*` 环境传递敏感的用户令牌或私密数据。

## 白名单动态管理 API

- `addWhiteList(url: string | string[])`: 动态添加信任的 Origin。

- `removeWhiteList(url: string | string[])`: 移除已存在的 Origin。

- `updateWhite(oldUrl: string, newUrl: string)`: 更新指定的白名单记录。

- `getWhiteList(): string[]`: 获取当前实例生效的所有白名单列表。

---

## 💡 进阶使用示例

## 结合 Promise 的双向 ACK 与队列防丢机制

发送方在发出消息后，内部会挂起一个 Promise 等待对方的回执。**哪怕对方 iframe 尚未加载完毕**，消息也会安全地暂存在本地队列中，待双方握手成功后自动发出，彻底消灭时序引发的丢包问题。

```JavaScript

// 场景：子页面向父页面发起支付请求，并等待确认
document.getElementById('payBtn').onclick = async () => {
  console.log('发起请求，等待对方确认...');
  // 触发父页面的 'requestPayment' 事件，设定超时 8000ms
  // 若父页面未就绪，消息自动进入队列等待；就绪后自动发出并开始计时
  const isConfirmed = await childApp.emitToParentWithAck('requestPayment', { amount: 100 }, 8000);
  if (isConfirmed) {
    console.log('✅ 对方已收到并确认请求！');
  } else {
    console.error('❌ 请求超时，对方未响应或已断开连接');
  }
};

```

## 🔥 高阶特性指南 (Advanced)

### 1. RPC 远程函数调用 (Remote Procedure Call)

彻底告别繁琐的事件发布订阅，直接获取跨域函数的计算结果或异步数据。

**提供方 (比如父页面暴露查询接口):**

```javascript
// 暴露一个名为 'getUserInfo' 的方法，支持 async/await
iframeApp.expose('getUserInfo', async (params) => {
    console.log('收到请求参数:', params.id);
    const res = await fetch(`/api/user/${params.id}`);
    return await res.json(); // 直接 return 数据
});
```

**调用方 (比如子页面发起远程调用):**

```javascript
document.getElementById('btn').onclick = async () => {
    try {
        // 像调用本地函数一样丝滑！支持超时控制
        const userInfo = await childApp.callRemote('getUserInfo', { id: 1001 }, 5000);
        console.log('获取到远端数据:', userInfo);
    } catch (error) {
        console.error('RPC 调用失败或超时:', error.message);
    }
};
```

### 2. 状态共享同步 (State Sync)

极其适合“全局深色模式切换”、“多语言包切换”或“全局用户信息共享”场景。

**父页面 (初始化/修改状态):**

```javascript
// 1. 设置初始状态（即便子页面还没加载完，也会在加载后自动全量推过去）
iframeApp.setState({ theme: 'dark', user: { name: '张三' } });

// 2. 随时更新状态
iframeApp.setState({ theme: 'light' });
```

**子页面 (监听状态变化):**

```javascript
// 监听状态变化（获取合并后的最新全量状态）
childApp.onStateChange((newState, oldState) => {
    if (newState.theme === 'dark') {
        document.body.classList.add('dark-mode');
    }
});

// 主动获取当前状态
const currentState = childApp.getState();
```

### 3. 自动高度适应 (Auto Resize)

彻底解决 iframe 跨域高度自适应难题。

**父页面 (授权接收高度同步):**

```javascript
// 父页面只需要调用这一行即可授权接收
iframeApp.enableAutoResize();
```

**子页面 (开启高度探测):**

```javascript
// 开启智能探测，当页面 DOM 变化被撑开时，父页面的 iframe 会自动变长！
childApp.startAutoResizer({
    target: 'body', // 可选，默认监听 body
    offset: 20, // 可选，额外补偿高度（比如底部有 fixed 阴影时）
});

// 不需要时可停止监听
// childApp.stopAutoResizer();
```
