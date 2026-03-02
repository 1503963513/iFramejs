var eventHead = 'postHead_';
var ackEventHead = 'ackHead_';

/**
 * 判断两个URL是否同域
 * @param {string} url1 第一个URL
 * @param {string} url2 第二个URL
 * @returns {boolean} 是否同域
 */
function isSameDomain(url1, url2) {
  if (!url1 || !url2) return false;
  try {
    const a = document.createElement('a');
    a.href = url1;
    const b = document.createElement('a');
    b.href = url2;
    return (
      a.hostname === b.hostname && a.port === b.port && a.protocol === b.protocol
    );
  } catch (e) {
    console.warn('isSameDomain error:', e);
    return false;
  }
}

/**
 * 解析URL获取origin
 * @param {string} url URL地址
 * @returns {string|null} origin
 */
function getOrigin(url) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch (e) {
    console.warn('Invalid URL:', url);
    return null;
  }
}

/**
 * 检测页面是否在 iframe 中
 * @returns {boolean} 是否在内嵌页面中
 */
function isEmbedded() {
  try {
    return window.self !== window.top || window.frameElement !== null;
  } catch (e) {
    return true;
  }
}

class Iframe {
  /**
   * 构造函数
   * @param {Object|HTMLIFrameElement|string} options 配置对象或iframe元素或名称
   */
  constructor(options) {
    this._defaultTimeout = options?.timeout || 5000;

    this._customMap = new Map();
    this._pendingMessages = new Map();
    this._eventHandlers = new Map();

    this._messageQueue = [];

    this.Whitelist = [];
    this._originCache = new Set();
    this._eventHandlers = new Map();
    this._messageListener = null;
    this._isDestroyed = false;
    this._iframeLoaded = false;

    switch (true) {
      case !!options?.container:
        const { container, url, whiteList } = options;
        if (!container || !url) {
          console.error('Iframe constructor: container and url are required');
          return;
        }
        container.src = url;
        this.Whitelist = whiteList || [];
        this._updateOriginCache();
        this.iframe = container.contentWindow;
        this.doc =
          container.contentDocument || container.contentWindow.document;
        
        // 设置 iframe 加载状态
        const originalOnload = container.onload;
        container.onload = () => {
          this._iframeLoaded = true;
          // 重新获取 contentWindow，确保指向正确的窗口
          this.iframe = container.contentWindow;
          if (originalOnload) {
            originalOnload.call(container);
          }
          this.onload();
          this._flushMessageQueue();
        };
        
        this.iframeInit();
        this.name = 'default';
        this.url = url;
        // 提取 origin 用于 postMessage
        this.postOrigin = getOrigin(url) || url;
        break;
      case options?.nodeName === 'IFRAME':
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
        // 尝试获取父页面的 origin, 如果不可用则使用 *
        this.url = location.ancestorOrigins?.[0] || '*';
        this.postOrigin = location.ancestorOrigins?.[0] || '*';
        break;
      default:
        console.warn('Iframe constructor: invalid options');
        break;
    }
  }

  /**
   * 处理未就绪时的消息队列
   */
  _flushMessageQueue() {
    if (this._messageQueue.length > 0) {
      console.log(`[Queue] Flushing ${this._messageQueue.length} pending messages...`);
      this._messageQueue.forEach(({ payload, options, resolve, isAck }) => {
        if (isAck) {
          // 如果是需要 ACK 的消息，重新走带有 Promise 的逻辑
          this._sendWithAckCore(payload, options.timeout, options).then(resolve);
        } else {
          this.sendMessage(payload, options);
          if (resolve) resolve(true);
        }
      });
      this._messageQueue = [];
    }
  }

  /**
    * 基础发送逻辑集成队列
    * 发送消息到目标窗口
    * @param {Window} target 目标窗口
    * @param {string} name 消息名称
    * @param {*} payload 消息数据
    * @param {Object} options 选项 { type, origin, event, requireAck, ackTimeout }
    */
  _targetSend(target, payload, options) {
    if (!target) {
      console.error('targetSend: target is null or undefined');
      return false;
    }
    try {
      const message = {
        source: 'Iframe-Child-Screen' + this.name,
        data: payload,
        id: Date.now() + Math.random().toString(36),
        timestamp: Date.now(),
      };

      if (options.type === 1) {
        message.action = eventHead + options.event;
      }

      if (options.requireAck) {
        message.requireAck = true;
        message.ackEvent = ackEventHead + message.id;
      }

      target.postMessage(message, options.origin || '*');
      return message.id;
    } catch (e) {
      console.error('targetSend error:', e);
      return false;
    }
  }


  /**
   * 重写带 ACK 的发送核心（抽离复用）
   */
  _sendWithAckCore(payload, timeout = this._defaultTimeout, options) {
    return new Promise((resolve) => {
      if (this._isDestroyed) return resolve(false);
      
      // 队列拦截：如果还没 Ready，存入队列等待
      if (!this.isReady()) {
        console.warn('iframe not ready, pushing ACK message to queue');
        this._messageQueue.push({ payload, options: { ...options, timeout }, resolve, isAck: true });
        return;
      }

      const targetWindow = this.name === 'default' ? this.iframe : window.parent;
      const messageId = this._targetSend(targetWindow, payload, { ...options, requireAck: true });

      if (!messageId) return resolve(false);

      // 设置超时定时器
      const timer = setTimeout(() => {
        this._pendingMessages.delete(messageId);
        console.warn(`Message timeout: ${messageId}`);
        resolve(false);
      }, timeout);

      this._pendingMessages.set(messageId, { timeout: timer, resolve });
    });
  }

  /**
   * 更新origin缓存
   * @private
   */
  _updateOriginCache() {
    this._originCache.clear();
    this.Whitelist.forEach(url => {
      const origin = getOrigin(url);
      if (origin) this._originCache.add(origin);
    });
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
    this.sendMessage = this.sendMessageChild;
    this.emit = this.sendEmitEventChild;
    this.iframe = window.parent;
    this.openEventListener();
  }

  /**
   * 监听器内部作用域映射
   */
  openEventListener() {
    if (this._messageListener) return;

    this._messageListener = (e) => {
      if (this._isDestroyed || this._originCache.size === 0) return;
      if (!e.data.source?.includes('Iframe-Child-Screen')) return;
      if (!this._originCache.has(e.origin)) return;

      if (!this._knownOrigin) this._knownOrigin = e.origin;

      let val = {
        data: e.data.data,
        source: e.data.source.replace('Iframe-Child-Screen', ''),
        id: e.data.id,
        timestamp: e.data.timestamp,
      };

      if (val.source === this.name) return;

      // 处理收到的 ACK 确认（从实例自身的 Map 中取）
      if (e.data?.ack) {
        const pending = this._pendingMessages.get(e.data.messageId);
        if (pending) {
          clearTimeout(pending.timeout);
          pending.resolve(e.data.ack);
          this._pendingMessages.delete(e.data.messageId);
        }
        return;
      }

      // 回复 ACK
      if (e.data?.requireAck && e.data?.ackEvent) {
        e.source.postMessage({
          source: 'Iframe-Child-Screen' + this.name,
          ack: true,
          messageId: e.data.id,
          timestamp: Date.now(),
        }, e.origin);
      }

      // 触发事件分发 (修复 customMap 作用域)
      if (e.data?.action) {
        const handler = this._eventHandlers.get(e.data.action) || this._customMap.get(e.data.action);
        if (handler) handler(val);
        return;
      }

      if (this.message) this.message(val);
    };

    window.addEventListener('message', this._messageListener, false);
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
   * 添加白名单
   * @param {string|Array<string>} url URL地址或URL数组
   */
  addWhiteList(url) {
    if (Array.isArray(url)) {
      const validUrls = url.filter(u => u && typeof u === 'string');
      this.Whitelist = [...this.Whitelist, ...validUrls];
    } else if (url && typeof url === 'string') {
      this.Whitelist.push(url);
    }
    this._updateOriginCache();
  }

  /**
   * 获取嵌入状态
   * @returns {Object} 状态对象 { isEmbedded: boolean, canCommunicate: boolean }
   */
  getEmbedStatus() {
    const isEmbed = isEmbedded();
    let canCommunicate = false;

    if (isEmbed) {
      canCommunicate = !!window.parent && typeof window.parent.postMessage === 'function';
    }

    return {
      isEmbedded: isEmbed,
      canCommunicate: canCommunicate,
      hasParent: !!window.parent,
      hasFrameElement: !!window.frameElement,
      isTopWindow: window.self === window.top
    };
  }

  /**
   * 检查通信是否就绪
   * @returns {boolean} 是否可以通信
   */
  isReady() {
    if (this._isDestroyed) {
      console.warn('isReady: instance is destroyed');
      return false;
    }

    // 父页面角色:检查 iframe 是否存在且已加载
    if (this.iframe && this.name === 'default' && this.url) {
      if (!this._iframeLoaded) {
        console.warn('isReady: iframe not loaded yet');
        return false;
      }
      if (this._originCache.size === 0) {
        console.warn('isReady: whitelist is empty, messages may be blocked');
      }
      return true;
    }

    // 子页面角色:检查是否可以与父窗口通信
    const status = this.getEmbedStatus();
    if (!status.canCommunicate) {
      console.warn('isReady: cannot communicate with parent window');
      return false;
    }

    if (this._originCache.size === 0) {
      console.warn('isReady: whitelist is empty, communication may be blocked');
    }

    return true;
  }

  /**
   * 移除白名单
   * @param {string|Array<string>} url URL地址或URL数组
   */
  removeWhiteList(url) {
    if (Array.isArray(url)) {
      this.Whitelist = this.Whitelist.filter((a) => !url.includes(a));
    } else if (url && typeof url === 'string') {
      this.Whitelist = this.Whitelist.filter((a) => a !== url);
    }
    this._updateOriginCache();
  }

  /**
   * 更新白名单
   * @param {string} oldUrl 旧URL地址
   * @param {string} newUrl 新URL地址
   */
  updateWhite(oldUrl, newUrl) {
    if (!oldUrl || !newUrl) {
      console.warn('updateWhite: oldUrl and newUrl are required');
      return;
    }
    const index = this.Whitelist.indexOf(oldUrl);
    if (index !== -1) {
      this.Whitelist[index] = newUrl;
      this._updateOriginCache();
    }
  }

  /**
   * 发送带确认的消息（父页面发送到子页面）
   * @param {*} payload 消息数据
   * @param {number} timeout 超时时间(毫秒)
   * @returns {Promise<boolean>} 成功收到确认返回 true,超时返回 false
   */
  sendMessageWithAckToChild(payload, timeout = this._defaultTimeout) {
    return new Promise((resolve) => {
      if (this._isDestroyed) {
        console.warn('sendMessageWithAckToChild: instance is destroyed');
        resolve(false);
        return;
      }
      if (!this.iframe) {
        console.error('sendMessageWithAckToChild: iframe is not available');
        resolve(false);
        return;
      }

      const messageId = this._targetSend(
        this.iframe,
        payload,
        { type: 0, origin: this.postOrigin, requireAck: true }
      );

      if (!messageId) {
        console.error('sendMessageWithAckToChild: failed to send message');
        resolve(false);
        return;
      }

      const timer = setTimeout(() => {
        this._pendingMessages.delete(messageId);
        console.warn(`[Parent] Message timeout: ${messageId}`);
        resolve(false);
      }, timeout);

      this._pendingMessages.set(messageId, {
        timeout: timer,
        resolve: resolve,
      });
    });
  }

  /**
   * 发送带确认的自定义事件（父页面发送到子页面）
   * @param {string} event 事件名称
   * @param {*} payload 消息数据
   * @param {number} timeout 超时时间(毫秒)
   * @returns {Promise<boolean>} 成功收到确认返回 true,超时返回 false
   */
  emitToChildWithAck(event, payload = {}, timeout = this._defaultTimeout) {
    if (this._isDestroyed) return Promise.resolve(false);

    // 同域情况：等待目标函数真正的执行结果（支持 Async/Await）
    if (isSameDomain(window.location.href, this.url)) {
      try {
        const handler = this.iframe[EVENT_HEAD + event];
        if (typeof handler === 'function') {
          return Promise.resolve(handler({ source: this.name, data: payload }))
            .then(() => true)
            .catch((e) => {
              console.error('Same-domain ACK handler error:', e);
              return false;
            });
        }
        return Promise.resolve(false);
      } catch (e) {
        return Promise.resolve(false);
      }
    }

    // 跨域情况：走标准的 postMessage ACK
    return this._sendWithAckCore(payload, timeout, { type: 1, event, origin: this.postOrigin });
  }


  /**
   * 获取白名单
   * @returns {Array<string>} 白名单数组
   */
  getWhiteList() {
    return [...this.Whitelist];
  }
  /**
   * 父页面发送消息到子iframe
   * @param {*} payload 消息数据
   * @param {Object} options 选项 { type, origin }
   * @returns {boolean} 发送是否成功
   */
  sendMessageParent(payload, options) {
    if (this._isDestroyed) {
      console.warn('sendMessageParent: instance is destroyed');
      return false;
    }
    if (!this.iframe) {
      console.error('sendMessageParent: iframe is null or undefined');
      return false;
    }
    return this._targetSend(
      this.iframe,
      payload,
      options || { type: 0, origin: this.postOrigin }
    );
  }

  /**
   * 父页面触发子iframe事件
   * @param {string} event 事件名称
   * @param {*} payload 消息数据
   * @returns {boolean} 触发是否成功
   */
  sendEmitEventParent(event, payload = {}) {
    if (this._isDestroyed) {
      console.warn('sendEmitEventParent: instance is destroyed');
      return false;
    }
    if (!event || typeof event !== 'string') {
      console.error('sendEmitEventParent: eventName must be a non-empty string');
      return false;
    }

    if (isSameDomain(window.location.href, this.url)) {
      try {
        const handler = this.iframe[eventHead + event];
        if (handler && typeof handler === 'function') {
          handler({
            source: this.name,
            data: payload,
          });
          return true;
        } else {
          console.warn(`sendEmitEventParent: event "${event}" not found`);
          return false;
        }
      } catch (e) {
        console.error('sendEmitEventParent error:', e);
        return false;
      }
    } else {
      return this.sendMessageParent(payload, {
        type: 1,
        event: event,
        origin: this.postOrigin,
      });
    }
  }

  /**
   * 子页面发送消息到父窗口
   * @param {*} payload 消息数据
   * @param {Object} options 选项 { type, origin }
   * @returns {boolean} 发送是否成功
   */
  sendMessageChild(payload = {}, options) {
    if (this._isDestroyed) {
      console.warn('sendMessageChild: instance is destroyed');
      return false;
    }
    try {
      // 优先使用已知的 origin, 其次使用 postOrigin
      const origin = this._knownOrigin || this.postOrigin;
      return this._targetSend(
        window.parent,
        payload,
        options || { type: 0, origin: origin }
      );
    } catch (e) {
      console.error('sendMessageChild error:', e);
      return false;
    }
  }

  /**
   * 子页面触发父窗口事件
   * @param {string} event 事件名称
   * @param {*} payload 消息数据
   * @returns {boolean} 触发是否成功
   */
  sendEmitEventChild(event, payload = {}) {
    if (this._isDestroyed) {
      console.warn('sendEmitEventChild: instance is destroyed');
      return false;
    }
    if (!event || typeof event !== 'string') {
      console.error('sendEmitEventChild: eventName must be a non-empty string');
      return false;
    }

    if (isSameDomain(window.location.href, this.url)) {
      try {
        const handler = window.parent[eventHead + event];
        if (handler && typeof handler === 'function') {
          handler({
            source: this.name,
            data: payload,
          });
          return true;
        } else {
          console.warn(`sendEmitEventChild: event "${event}" not found`);
          return false;
        }
      } catch (e) {
        console.error('sendEmitEventChild error:', e);
        return false;
      }
    } else {
      return this.sendMessageChild(payload, {
        type: 1,
        event: event,
        origin: this.postOrigin,
      });
    }
  }

  /**
   * 发送带确认的消息（子页面发送到父页面）
   * @param {*} payload 消息数据
   * @param {number} timeout 超时时间(毫秒)
   * @returns {Promise<boolean>} 成功收到确认返回 true,超时返回 false
   */
  sendMessageParentWithAck(payload, timeout = this._defaultTimeout) {
    return new Promise((resolve) => {
      if (this._isDestroyed) {
        console.warn('sendMessageWithAck: instance is destroyed');
        resolve(false);
        return;
      }
      try {
        const messageId = this._targetSend(
          window.parent,
          payload,
          { type: 0, origin: this.postOrigin, requireAck: true }
        );

        if (!messageId) {
          resolve(false);
          return;
        }

        const timer = setTimeout(() => {
          this._pendingMessages.delete(messageId);
          console.warn(`Message timeout: ${messageId}`);
          resolve(false);
        }, timeout);

        this._pendingMessages.set(messageId, {
          timeout: timer,
          resolve: resolve,
        });
      } catch (e) {
        console.error('sendMessageWithAck error:', e);
        resolve(false);
      }
    });
  }

  /**
   * 发送带确认的自定义事件（子页面发送到父页面）
   * @param {string} event 事件名称
   * @param {*} payload 消息数据
   * @param {number} timeout 超时时间(毫秒)
   * @returns {Promise<boolean>} 成功收到确认返回 true,超时返回 false
   */
  emitToParentWithAck(event, payload = {}, timeout = this._defaultTimeout) {
    return new Promise((resolve) => {
      if (this._isDestroyed) {
        console.warn('emitWithAck: instance is destroyed');
        resolve(false);
        return;
      }
      if (!event || typeof event !== 'string') {
        console.error('emitWithAck: eventName must be a non-empty string');
        resolve(false);
        return;
      }

      if (isSameDomain(window.location.href, this.url)) {
        try {
          const handler = window.parent[eventHead + event];
          if (handler && typeof handler === 'function') {
            handler({
              source: this.name,
              data: payload,
            });
            resolve(true);
            return;
          } else {
            console.warn(`emitWithAck: event "${event}" not found`);
            resolve(false);
            return;
          }
        } catch (e) {
          console.error('emitWithAck error:', e);
          resolve(false);
          return;
        }
      }

      try {
        const messageId = this._targetSend(
          window.parent,
          payload,
          { type: 1, event: event, origin: this.postOrigin, requireAck: true }
        );

        if (!messageId) {
          resolve(false);
          return;
        }

        const timer = setTimeout(() => {
          this._pendingMessages.delete(messageId);
          console.warn(`Message timeout: ${messageId}`);
          resolve(false);
        }, timeout);

        this._pendingMessages.set(messageId, {
          timeout: timer,
          resolve: resolve,
        });
      } catch (e) {
        console.error('emitWithAck error:', e);
        resolve(false);
      }
    });
  }

  /**
   * 添加事件监听器
   * @param {string} name 事件名称
   * @param {Function} fun 回调函数
   */
  action(name, fun) {
    if (this._isDestroyed) {
      console.warn('action: instance is destroyed');
      return;
    }
    if (name === 'postMessage') {
      console.error('action: eventName cannot be "postMessage"');
      return;
    }
    if (arguments.length !== 2) {
      console.error('action: Please provide name and callback');
      return;
    }
    if (typeof fun !== 'function') {
      console.error('action: callback must be a function');
      return;
    }
    if (!name || typeof name !== 'string') {
      console.error('action: eventName must be a non-empty string');
      return;
    }

    const eventKey = eventHead + name;
    if (isSameDomain(window.location.href, this.url)) {
      window[eventKey] = fun;
      this._eventHandlers.set(eventKey, fun);
    } else {
      this._customMap.set(eventKey, fun);
      this._eventHandlers.set(eventKey, fun);
    }
  }

  /**
   * 移除事件监听器
   * @param {string} name 事件名称
   */
  removeAction(name) {
    if (!name || typeof name !== 'string') {
      console.error('removeAction: eventName must be a non-empty string');
      return;
    }

    const eventKey = eventHead + name;
    if (isSameDomain(window.location.href, this.url)) {
      delete window[eventKey];
    }
    this._customMap.delete(eventKey);
    this._eventHandlers.delete(eventKey);
  }

  /**
   * 销毁实例，清理所有监听器和资源
   */
  destroy() {
    if (this._isDestroyed) {
      console.warn('destroy: instance already destroyed');
      return;
    }

    this._isDestroyed = true;

    // 清理所有等待中的 Promise 和定时器，防止组件卸载时内存泄漏
    this._pendingMessages.forEach((pending, id) => {
      clearTimeout(pending.timeout);
      // 提前结束 Promise，返回 false 或抛出异常
      if (pending.resolve) pending.resolve(false); 
    });
    this._pendingMessages.clear();
    this._messageQueue = []; // 清空可能还没发出去的消息队列

    if (this._messageListener) {
      window.removeEventListener('message', this._messageListener, false);
      this._messageListener = null;
    }

    this._eventHandlers.forEach((_, key) => {
      if (isSameDomain(window.location.href, this.url)) {
        delete window[key];
      }
      this._customMap.delete(key);
    });
    this._eventHandlers.clear();

    this.iframe = null;
    this.doc = null;
    this.message = null;
    this.sendMessage = null;
    this.emit = null;
    this.Whitelist = [];
    this._originCache.clear();

    console.info('Iframe instance destroyed');
  }
  /**
   * Blocking console.logs
   */
  BlockingLog() {
    console.log = function () {};
  }
}

export { Iframe };
