/**
 * 优点：
 * 代码模块化：使用iframe可以将一个网页划分为多个模块，每个模块单独编写HTML文档，使代码更加模块化和易于维护。
 * 跨域通信：由于浏览器的同源策略，一个网页无法直接访问另一个域名下的内容。但是，使用iframe可以在同一个页面中加载不同域名下的内容，从而实现跨域通信。
 * 独立性：iframe中的文档是独立的，它的样式和JavaScript代码不会影响到外层文档的样式和JavaScript代码。
 * 缺点：
 * 降低性能：每个iframe都需要单独加载和渲染，这会导致网页的加载速度变慢，降低性能。
 * SEO问题：iframe中的内容不会被搜索引擎抓取和索引，这会对网页的SEO产生影响。
 * 安全问题：iframe中的文档可以在外层文档中执行脚本，这可能导致安全问题。
 * 兼容性：
 * Iframe的支持性
 * IE7； 2001
 * safari3.2； 2006
 * firefox 2.0； 2006
 * 其余都兼容， 目前浏览器完全兼容
 * 支持发送file，fileList对象
 * Firefox 6 之前message必须是字符串
 * IE10经过了解有一个问题： https://stackoverflow.com/questions/16226924/is-cross-origin-postmessage-broken-in-ie10
 */
function isFunction(obj) {
  return typeof obj === 'function';
}
class Iframe {
  constructor(options) {
    this.Whitelist = []; // 白名单
    // this.eventHead = 'postHead_'; // event头
    Object.defineProperty(this, 'eventHead', {
      value: 'postHead_', // event头
      writable: false,
      enumerable: false,
      configurable: false,
    });
    switch (true) {
      case !!options?.container:
        const { container, url, whiteList } = options;
        container.src = url;
        this.Whitelist = whiteList || [];
        this.iframe = container.contentWindow;
        this.doc =
          container.contentDocument || container.contentWindow.document;
        container.onload = this.onload();
        this.iframeInit();
        this.name = 'default';
        break;
      case options?.nodeName === 'IFRAME':
        // : HTMLIFrameElement
        this.iframe = options.contentWindow;
        this.doc = options.contentDocument || options.contentWindow.document;
        options.onload = this.onload();
        this.iframeInit();
        this.name = 'default';
        break;
      case typeof options === 'string':
        this.childInit();
        this.name = options;
        console.warn(
          '将目标网址的X-Frame-0ptions设置为 ALLOW-FROM uri：表示页面只能被指定uri的iframe嵌入。'
        );
        break;
      default:
        console.warn(iframe + 'none');
        break;
    }
    // 检测器
    this.whetherEembed();
  }
  whetherEembed() {
    return window.self !== window.top || window.frameElement !== null;
  }
  /**
   *  Listening to window postmessage event
   */
  iframeInit() {
    this.sendMessage = this.sendMessageParent;
    this.emit = this.sendEmitEventParent;
    window.addEventListener(
      'message',
      (e) => {
        if (
          e.data.source?.includes('Iframe-Child-Screen') &&
          this.Whitelist.some((a) => e.origin.includes(a))
        ) {
          if (this.message) {
            this.message({
              data: e.data.data,
              source: e.data.source.replace('Iframe-Child-Screen', ''),
            });
          }
        }
      },
      false
    );
  }
  /**
   * onload sendMessage
   */
  childInit() {
    // console.log(location.ancestorOrigins);
    this.sendMessage = this.sendMessageChild;
    this.emit = this.sendEmitEventChild;
    window.addEventListener(
      'message',
      (e) => {
        if (
          e.data.source?.includes('Iframe-Child-Screen') &&
          this.Whitelist.some((a) => e.origin.includes(a))
        ) {
          if (this.message) {
            this.message({
              data: e.data.data,
              source: e.data.source.replace('Iframe-Child-Screen', ''),
            });
          }
        }
      },
      false
    );
  }
  /**
   *  iframe onload event
   */
  onload() {
    if (this.iframe['onload']) {
      this.iframe['onload']();
    }
  }
  /**
   * @param {*} url url: Array<url as string> | usr as string
   */
  addWhiteList(url) {
    if (Array.isArray(url)) {
      this.Whitelist = [...this.Whitelist, url];
    } else {
      url && this.Whitelist.push(url);
    }
  }
  /**
   * Whitelist processing
   * @param {*} url url: Array<url as string> | usr as string
   */
  removeWhiteList(url) {
    if (Array.isArray(url)) {
      this.Whitelist = this.Whitelist.filter((a) => url.some((b) => a === b));
    } else {
      url ? (this.Whitelist = this.Whitelist.filter((a) => a === url)) : null;
    }
  }
  /**
   *
   * @param {*} oldUrl Old URL Address
   * @param {*} newUrl New URL Address
   */
  updateWhite(oldUrl, newUrl) {
    this.Whitelist.forEach((a) => {
      a === oldUrl ? (a = newUrl) : null;
    });
  }
  /**
   *
   * @returns Whitelist
   */
  getWhiteList() {
    return this.Whitelist;
  }
  /**
   * send Message, send CHild
   * @param {*} event eventName
   * @param {*} msg data
   */
  sendMessageParent(payload) {
    this.iframe.postMessage({
      source: 'Iframe-Child-Screen' + this.name,
      data: payload,
    });
  }
  sendEmitEventParent(event, payload = {}) {
    if (this.iframe[this.eventHead + event]) {
      this.iframe[this.eventHead + event]({
        source: this.name,
        data: payload,
      });
    } else {
      console.warn('event not Function');
    }
  }
  /**
   *send Message, send Parent
   * @param {*} data
   */
  sendMessageChild(payload = {}) {
    window.parent.postMessage({
      source: 'Iframe-Child-Screen' + this.name,
      data: payload,
    });
  }
  sendEmitEventChild(event, payload = {}) {
    if (window.parent[this.eventHead + event]) {
      window.parent[this.eventHead + event]({
        source: this.name,
        data: payload,
      });
    } else {
      console.warn('event not Function');
    }
  }
  /**
   * add window Function
   * @param {*} name eventName || Callback
   * @param {*} fun Callback
   */
  action(name, fun) {
    if (name === 'postMessage') return console.log(name + 'Error：eventName');
    if (arguments.length !== 2)
      return console.log('Error： Please provide name and callback ');
    window[this.eventHead + name] = fun;
  }
  /**
   * Blocking console.logs
   */
  BlockingLog() {
    console.log = function () {};
  }
}

export { Iframe };
