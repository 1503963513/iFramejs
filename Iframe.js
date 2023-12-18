function isFunction(obj) {
  return typeof obj === 'function';
}
var eventHead = 'postHead_';
class Iframe {
  constructor(options) {
    this.Whitelist = [];
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
          'Set the X-Frame-0ptions of the target URL to ALLOW-FROM uri: This means that the page can only be embedded in iframes with the specified uri.'
        );
        break;
      default:
        console.warn('iframe none');
        break;
    }
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
    if (this.iframe[eventHead + event]) {
      this.iframe[eventHead + event]({
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
    if (window.parent[eventHead + event]) {
      window.parent[eventHead + event]({
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
    window[eventHead + name] = fun;
  }
  /**
   * Blocking console.logs
   */
  BlockingLog() {
    console.log = function () {};
  }
}

export { Iframe };
