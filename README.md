# Post-message-Iframe

Post-message-Iframe： 解决 IFrame 通信；优雅使用 PostMessage

> 大小仅2kb



cdn:

```sh
https://cdn.jsdelivr.net/gh/1503963513/iFramejs@v1.0.0/index.min.js
```

Vue:

```vue
<script setup>
import { onMounted, ref } from 'vue';
import { Iframe } from 'iframe-js';
const iframeRef = ref(null);
onMounted(() => {
  const iframe = new Iframe({
    container: iframeRef.value,
    url: '...',
    whiteList: ['https://www.baidu.com'], // add white list
  });
});
</script>

<template>
  <div class="app_container">
    <iframe class="iframe" ref="iframeRef"></iframe>
  </div>
</template>
```

## start

- parent.html

```js
import { Iframe } from './Iframe.js';
var count = 0;

// create iframe
const iframe = new Iframe({
  container: document.getElementById('child'),
  url: 'http://127.0.0.1:5501/child.html' + window.location.search,
  whiteList: ['http://127.0.0.1:5501'], // add white list
});

// receive messages callback
iframe.message = (e) => {
  console.log('parent接收到默认消息', e);
  const { source, data } = e;
  opt.innerText = data.msg;
};

iframe.action('handel', (e) => {
  console.log('parent接收到自定义消息', e);
});

dom.onclick = function () {
  count++;
  //  Send custom message
  iframe.emit('handel', { msg: 'hello child' + count });
  //  Send default message
  iframe.sendMessage({ msg: 'hello child' + count });
};
```

- child.html

```js
import { Iframe } from './Iframe.js';
var count = 0;

// create IframeName, Name = game1
const parent = new Iframe('game1');
// add white list
parent.addWhiteList(['http://127.0.0.1:5501']);

// iframe onload
parent.action('onload', () => {
  console.log('load');
});

// receive messages callback
parent.message = (data) => {
  console.log('child接收普通消息', data);
  const { msg } = data.data;
  opt.innerText = msg;
};

// Bind custom message events
parent.action('handel', (e) => {
  console.log('child接收到自定义消息', e);
});

// click event sendMessage
dom.onclick = function () {
  count++;
  // Send custom message
  parent.emit('handel', { msg: 'hello parent' + count });
  // Send default message
  parent.sendMessage({ msg: 'hello parent' + count });
};
```

## API

`sendMessage`: 发送

`message`： 接收

`postOrigin` ：消息发送对方窗口的 origin,  默认为` url || window.ancestorOrigins`

`action`:  自定义事件

`emit`： 调用自定义事件

`Whitelis`： 白名单 <Array>



## method

`onload`:  iframe加载完成

`updateWhite`、`addWhiteList`、`removeWhiteList` 更新、加入、 删除新白名单

