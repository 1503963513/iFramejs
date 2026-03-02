# iframe-js

**iframe-js** 是一款轻量、安全、优雅的跨域 iframe 通信库。完美解决原生 `postMessage` 来源不可控、回调地狱、缺乏送达确认等痛点。

## ✨ 核心特性

- **优雅的事件驱动**：告别冗长的 `if-else`，支持类似 EventBus 的 `action/emit` 自定义事件分发。
- **可靠的 ACK 确认机制**：支持带超时控制的双向消息/事件确认（Promise API），同域下更支持异步等待执行结果。
- **安全的白名单管控**：内置严格的 Origin 校验，拦截非法来源消息。
- **内部消息队列**：无惧 iframe 尚未加载完成，未就绪的消息将自动进入队列，等待 `onload` 后自动发送。
- **完全隔离的多实例**：完美支持在同一页面中嵌入多个独立 iframe，状态互不干扰。

---

## 📦 安装与引入

#### NPM / Yarn / pnpm (推荐)

适用于 Vue、React 等现代前端工程化项目：

```sh
npm i iframe-js
```

#### CDN 引入

适用于传统原生 HTML 项目：

```sh
https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v2.0.0/index.min.js

https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v2.0.0/ejs/index.min.js
```

## 🚀 快速开始

## 框架中使用 (以 Vue 3 为例)

Code snippet

```
<script setup>
import { onMounted, ref } from 'vue';
import { Iframe } from 'iframe-js';

const iframeRef = ref(null);

onMounted(() => {
  const iframe = new Iframe({
    container: iframeRef.value,
    url: 'http://127.0.0.1:5501/child.html',
    whiteList: ['http://127.0.0.1:5501'], // 必填：配置通信白名单
    timeout: 5000, // 可选：全局 ACK 超时时间 (ms)
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

JavaScript

```
import { Iframe } from 'https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v2.0.0/ejs/index.min.js';

// 1. 初始化实例
const iframe = new Iframe({
  container: document.getElementById('child'),
  url: 'http://127.0.0.1:5501/child.html' + window.location.search,
  whiteList: ['http://127.0.0.1:5501'],
  timeout: 5000 // 默认 ACK 超时时间
});

// 2. 接收普通消息
iframe.message = (e) => {
  console.log('父页面接收到普通消息', e);
  document.getElementById('opt').innerText = e.data.msg;
};

// 3. 监听自定义事件
iframe.action('handel', (e) => {
  console.log('父页面接收到自定义事件', e.data);
});

// 4. 发送消息
document.getElementById('btn').onclick = function () {
  // 发送自定义事件
  iframe.emit('handel', { msg: 'hello child' });
  // 发送普通消息
  iframe.sendMessage({ msg: 'hello child default' });
};
```

#### 子页面 (Child)

JavaScript

```
import { Iframe } from 'https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v2.0.0/ejs/index.min.js';

// 1. 初始化实例，传入当前 iframe 标识和可选配置
const parent = new Iframe('game1', { timeout: 5000 });

// 2. 添加白名单 (信任的父页面 Origin)
parent.addWhiteList(['http://127.0.0.1:5501']);

// 3. 监听 iframe onload
parent.action('onload', () => {
  console.log('子页面初始化完毕');
});

// 4. 接收普通消息
parent.message = (e) => {
  console.log('子页面接收到普通消息', e);
  document.getElementById('opt').innerText = e.data.msg;
};

// 5. 监听自定义事件
parent.action('handel', (e) => {
  console.log('子页面接收到自定义事件', e.data);
});

// 6. 发送消息
document.getElementById('btn').onclick = function () {
  // 触发父页面的自定义事件
  parent.emit('handel', { msg: 'hello parent' });
  // 发送普通消息给父页面
  parent.sendMessage({ msg: 'hello parent default' });
};
```

---

## 📖 API Reference

## 基础通信 API

- `sendMessage(payload, options)`: 发送普通消息, 返回 `string` (消息 ID) 或 `false`。
- `message`: 属性，用于接收普通消息的回调函数覆盖 (`iframe.message = (e) => {...}`)。
- `action(name, callback)`: 监听/绑定自定义事件。
- `emit(event, payload)`: 触发目标的自定义事件, 返回 `boolean` 表示是否触发成功。

## 高级确认机制 (ACK API)

> 以下方法均返回 `Promise<boolean>`，成功收到对方确认返回 `true`，超时或失败返回 `false`。未指定 `timeout` 时将使用实例化的默认超时时间。

**父页面调用:**

- `sendMessageWithAckToChild(payload, timeout)`: 发送带确认的普通消息到子页面。
- `emitToChildWithAck(event, payload, timeout)`: 发送带确认的自定义事件到子页面。

**子页面调用:**

- `sendMessageParentWithAck(payload, timeout)`: 发送带确认的普通消息到父页面。
- `emitToParentWithAck(event, payload, timeout)`: 发送带确认的自定义事件到父页面。

## 状态与生命周期

- `isReady()`: 检查通信是否就绪 (白名单已配置且上下文合法), 返回 `boolean`。

- `getEmbedStatus()`: 获取当前页面的嵌入状态环境，返回以下对象：

    JavaScript

    ```
    {
      isEmbedded: boolean,      // 是否被内嵌在 iframe 中
      canCommunicate: boolean,  // 当前环境是否能够使用 postMessage 通信
      hasParent: boolean,       // 是否存在父窗口
      hasFrameElement: boolean, // 是否存在同源的 frameElement 引用
      isTopWindow: boolean      // 当前是否为浏览器顶层窗口
    }
    ```

- `destroy()`: 彻底销毁实例，清理所有事件监听器、消息队列和内存占用（推荐在前端组件卸载时调用）。

## 安全与配置

- `postOrigin`: 属性，消息发送对方窗口的 origin，默认为 `url` 解析出的 origin 或 `window.ancestorOrigins`。
- `Whitelist`: 属性，获取当前的白名单数组。
- `addWhiteList(url | url[])`: 动态添加信任的白名单 Origin。
- `removeWhiteList(url | url[])`: 移除白名单 Origin。
- `updateWhite(oldUrl, newUrl)`: 更新指定的白名单记录。

---

## 💡 进阶使用示例

## 检测运行环境

JavaScript

```
const parent = new Iframe('game1');
const status = parent.getEmbedStatus();

if (status.isEmbedded && status.canCommunicate) {
  console.log('当前处于 Iframe 环境，且可以安全通信');
} else {
  console.warn('当前为独立页面或无法通信');
}
```

## 结合 Promise 的双向 ACK 机制

发送方在发出消息后，内部会挂起一个 Promise 等待对方的回执。如果对方顺利接收（同源情况下甚至会等待异步执行完毕），Promise 返回 `true`；如果超过设定时间未收到回执，返回 `false`。

JavaScript

```
// 场景：向父页面发起支付请求，并等待确认
document.getElementById('payBtn').onclick = async () => {
  if (!parent.isReady()) return console.error('通信未就绪');

  console.log('发起请求，等待对方确认...');

  // 触发父页面的 'requestPayment' 事件，设定超时 8000ms
  const isConfirmed = await parent.emitToParentWithAck('requestPayment', { amount: 100 }, 8000);

  if (isConfirmed) {
    console.log('✅ 对方已收到并确认请求！');
  } else {
    console.error('❌ 请求超时，对方未响应');
  }
};
```
