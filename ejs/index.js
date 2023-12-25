var eventHead = 'postHead_';
var customMap = new Map();
function isSameDomain(url1, url2) {
  const a = document.createElement('a');
  a.href = url1;
  const b = document.createElement('a');
  b.href = url2;

  return (
    a.hostname === b.hostname && a.port === b.port && a.protocol === b.protocol
  );
}
function targetSend(target, name, payload, options) {
  switch (options.type) {
    case 0:
      target.postMessage(
        {
          source: 'Iframe-Child-Screen' + name,
          data: payload,
        },
        options.origin || '*'
      );
      break;
    case 1:
      target.postMessage(
        {
          source: 'Iframe-Child-Screen' + name,
          action: eventHead + options.event,
          data: payload,
        },
        options.origin || '*'
      );
  }
}
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
        this.url = url;
        this.postOrigin = url;
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
        this.url = location.ancestorOrigins[0];
        this.postOrigin = location.ancestorOrigins[0];
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
    this.openEventListener();
  }
  /**
   * onload sendMessage
   */
  childInit() {
    // console.log(location.ancestorOrigins);
    this.sendMessage = this.sendMessageChild;
    this.emit = this.sendEmitEventChild;
    this.iframe = window.parent;
    this.openEventListener();
  }
  openEventListener() {
    window.addEventListener(
      'message',
      (e) => {
        if (
          e.data.source?.includes('Iframe-Child-Screen') &&
          this.Whitelist.some((a) => e.origin.includes(a))
        ) {
          let val = {
            data: e.data.data,
            source: e.data.source.replace('Iframe-Child-Screen', ''),
          };
          if (e.data?.action) {
            customMap.get(e.data.action)(val);
            return;
          }
          if (this.message) {
            this.message(val);
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
      this.Whitelist = [...this.Whitelist, ...url];
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
  sendMessageParent(payload, options) {
    targetSend(
      this.iframe,
      this.name,
      payload,
      options || { type: 0, origin: this.postOrigin }
    );
  }
  sendEmitEventParent(event, payload = {}) {
    // If the iframe and main document are not in the same domain (due to cross domain security policies), it is impossible.
    // To bypass this restriction, cross domain messaging can be used.
    if (isSameDomain(window.location.href, this.url)) {
      if (this.iframe[eventHead + event]) {
        this.iframe[eventHead + event]({
          source: this.name,
          data: payload,
        });
      } else {
        console.warn('event not Function');
      }
    } else {
      this.sendMessageParent(payload, {
        type: 1,
        event: event,
        origin: this.postOrigin,
      });
    }
  }
  /**
   *send Message, send Parent
   * @param {*} data
   */
  sendMessageChild(payload = {}, options) {
    targetSend(
      window.parent,
      this.name,
      payload,
      options || { type: 0, origin: this.postOrigin }
    );
  }
  sendEmitEventChild(event, payload = {}) {
    if (isSameDomain(window.location.href, this.url)) {
      if (window.parent[eventHead + event]) {
        window.parent[eventHead + event]({
          source: this.name,
          data: payload,
        });
      } else {
        console.warn('event not Function');
      }
    } else {
      this.sendMessageChild(payload, {
        type: 1,
        event: event,
        origin: this.postOrigin,
      });
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
    if (isSameDomain(window.location.href, this.url)) {
      window[eventHead + name] = fun;
    } else {
      customMap.set(eventHead + name, fun);
    }
  }
  /**
   * Blocking console.logs
   */
  BlockingLog() {
    console.log = function () {};
  }
}

export { Iframe };
