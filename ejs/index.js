const EVENT_HEAD_PREFIX = 'postHead_';
const ACK_HEAD_PREFIX = 'ackHead_';

class IframeUtils {
    static isSameDomain(url1, url2) {
        if (!url1 || !url2 || url1 === '*' || url2 === '*') return false;
        try {
            const origin1 = new URL(url1, window.location.href).origin;
            const origin2 = new URL(url2, window.location.href).origin;
            return origin1 === origin2;
        } catch (e) {
            return false;
        }
    }

    static getOrigin(url) {
        if (!url) return null;
        if (url === '*') return '*';
        try {
            return new URL(url).origin;
        } catch (e) {
            console.warn('[Iframe-js] Invalid URL:', url);
            return null;
        }
    }

    static isEmbedded() {
        try {
            return window.self !== window.top || window.frameElement !== null;
        } catch (e) {
            return true;
        }
    }
}

class Iframe {
    constructor(options) {
        this._defaultTimeout = options?.timeout || 5000;

        this._customMap = new Map();
        this._pendingMessages = new Map();
        this._eventHandlers = new Map();
        this._rpcMethods = new Map();
        this._state = {};
        this._stateListeners = new Set();

        this._messageQueue = [];

        this.Whitelist = [];
        this._originCache = new Set();
        this._messageListener = null;
        this._isDestroyed = false;
        this._iframeLoaded = false;
        this._autoResizeEnabled = false;
        this._resizeObserver = null;

        switch (true) {
            case !!options?.container:
                const { container, url, whiteList } = options;
                if (!container || !url) {
                    console.error('[Iframe-js] Iframe constructor: container and url are required');
                    return;
                }
                container.src = url;
                this.Whitelist = whiteList || [];
                this._updateOriginCache();
                this.iframeNode = container;
                this.iframe = container.contentWindow;

                try {
                    this.doc = container.contentDocument || container.contentWindow.document;
                } catch (e) {
                    this.doc = null;
                }

                const originalOnload = container.onload;
                container.onload = () => {
                    this._iframeLoaded = true;
                    this.iframe = container.contentWindow;
                    if (originalOnload) {
                        originalOnload.call(container);
                    }
                    this.onload();
                    this._flushMessageQueue();
                };

                this.iframeInit();
                this.name = options.name || `iframe_parent_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                this.url = url;
                this.postOrigin = IframeUtils.getOrigin(url) || url;
                break;

            case options?.nodeName === 'IFRAME':
                this.iframeNode = options;
                this.iframe = options.contentWindow;
                try {
                    this.doc = options.contentDocument || options.contentWindow.document;
                } catch (e) {
                    this.doc = null;
                }

                const originalNodeOnload = options.onload;
                options.onload = () => {
                    this._iframeLoaded = true;
                    this.iframe = options.contentWindow;
                    if (typeof originalNodeOnload === 'function') {
                        originalNodeOnload.call(options);
                    }
                    this.onload();
                    this._flushMessageQueue();
                };

                this.iframeInit();
                this.name = `iframe_parent_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
                break;

            case typeof options === 'string':
                this.childInit();
                this.name = options;
                console.warn('[Iframe-js] Set the X-Frame-Options of the target URL to ALLOW-FROM uri...');

                const parentOrigin = location.ancestorOrigins?.[0];
                this.url = parentOrigin || '*';
                this.postOrigin = parentOrigin || '*';

                if (parentOrigin && parentOrigin !== 'null') {
                    this.addWhiteList(parentOrigin);
                }
                break;

            default:
                console.warn('[Iframe-js] Iframe constructor: invalid options');
                break;
        }
    }

    _flushMessageQueue() {
        this._syncFullState();
        if (this._messageQueue.length > 0) {
            console.log(`[Iframe-js] [Queue] Flushing ${this._messageQueue.length} pending messages...`);
            this._messageQueue.forEach(({ payload, options, resolve, isAck }) => {
                if (isAck) {
                    this._sendWithAckCore(payload, options.timeout, options).then(resolve);
                } else {
                    this.sendMessage(payload, options);
                    if (resolve) resolve(true);
                }
            });
            this._messageQueue = [];
        }
    }

    _targetSend(target, payload, options) {
        if (!target) {
            console.error('[Iframe-js] targetSend: target is null or undefined');
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
                message.action = EVENT_HEAD_PREFIX + options.event;
            }

            if (options.requireAck) {
                message.requireAck = true;
                message.ackEvent = ACK_HEAD_PREFIX + message.id;
            }

            const targetOrigin = options.origin && options.origin !== '*' ? options.origin : this.postOrigin;
            if (!targetOrigin || targetOrigin === '*') {
                console.warn('[Iframe-js] [Security] Sending message to "*" is not recommended for sensitive data.');
            }

            target.postMessage(message, targetOrigin || '*');
            return message.id;
        } catch (e) {
            console.error('[Iframe-js] targetSend error:', e);
            return false;
        }
    }

    _sendWithAckCore(payload, timeout = this._defaultTimeout, options) {
        return new Promise((resolve) => {
            if (this._isDestroyed) return resolve(false);

            if (!this.isReady()) {
                console.warn('[Iframe-js] iframe not ready, pushing ACK message to queue');
                this._messageQueue.push({ payload, options: { ...options, timeout }, resolve, isAck: true });
                return;
            }

            const targetWindow = this.iframe;

            if (!targetWindow) {
                console.error('[Iframe-js] _sendWithAckCore: target window is null');
                return resolve(false);
            }

            const messageId = this._targetSend(targetWindow, payload, { ...options, requireAck: true });

            if (!messageId) return resolve(false);

            const timer = setTimeout(() => {
                this._pendingMessages.delete(messageId);
                console.warn(`[Iframe-js] Message timeout: ${messageId}`);
                resolve(false);
            }, timeout);

            this._pendingMessages.set(messageId, { timeout: timer, resolve });
        });
    }

    _updateOriginCache() {
        this._originCache.clear();
        this.Whitelist.forEach((url) => {
            const origin = IframeUtils.getOrigin(url);
            if (origin) this._originCache.add(origin);
        });
    }
    whetherEembed() {
        return window.self !== window.top || window.frameElement !== null;
    }
    iframeInit() {
        this.sendMessage = this.sendMessageParent;
        this.emit = this.sendEmitEventParent;
        this.openEventListener();
    }
    childInit() {
        this.sendMessage = this.sendMessageChild;
        this.emit = this.sendEmitEventChild;
        this.iframe = window.parent;
        this.openEventListener();
    }

    openEventListener() {
        if (this._messageListener) return;

        this._messageListener = (e) => {
            if (this._isDestroyed) return;

            if (e.data?.ack && e.data?.messageId && this._pendingMessages.has(e.data.messageId)) {
                const pending = this._pendingMessages.get(e.data.messageId);
                clearTimeout(pending.timeout);
                pending.resolve(e.data.ack);
                this._pendingMessages.delete(e.data.messageId);
                return;
            }

            if (e.data?.isRpcRes && e.data?.callId && this._pendingMessages.has(e.data.callId)) {
                const pending = this._pendingMessages.get(e.data.callId);
                clearTimeout(pending.timeout);
                if (e.data.error) {
                    pending.reject(new Error(e.data.error));
                } else {
                    pending.resolve(e.data.result);
                }
                this._pendingMessages.delete(e.data.callId);
                return;
            }

            if (e.data?.isStateSync && e.data?.state) {
                const oldState = { ...this._state };
                this._state = { ...this._state, ...e.data.state };

                this._stateListeners.forEach((listener) => {
                    try {
                        listener(this._state, oldState);
                    } catch (err) {
                        console.error('[Iframe StateSync] listener error:', err);
                    }
                });
                return;
            }

            if (e.data?.isAutoResize && e.data?.height) {
                if (this._autoResizeEnabled && this.iframeNode) {
                    this.iframeNode.style.height = `${e.data.height}px`;
                }
                return; // 拦截完毕
            }

            if (this._originCache.size === 0) {
                if (this.iframe === window.parent) {
                    this.addWhiteList(e.origin);
                } else {
                    console.warn(`[Iframe-js] [Iframe Blocked] Origin missing in whitelist: ${e.origin}`);
                    return;
                }
            } else {
                if (!this._originCache.has(e.origin) && !this._originCache.has('*')) {
                    console.warn(`[Iframe-js] [Iframe Blocked] Origin missing in whitelist: ${e.origin}`);
                    return;
                }
            }

            if (this.iframe && e.source !== this.iframe) {
                return;
            }

            if (!e.data.source?.includes('Iframe-Child-Screen')) return;
            if (!this._knownOrigin) this._knownOrigin = e.origin;

            let val = {
                data: e.data.data,
                source: e.data.source.replace('Iframe-Child-Screen', ''),
                id: e.data.id,
                timestamp: e.data.timestamp,
            };

            if (val.source === this.name) return;

            if (e.data?.requireAck && e.data?.ackEvent) {
                try {
                    const targetOrigin = e.origin && e.origin !== 'null' ? e.origin : '*';
                    e.source.postMessage(
                        {
                            source: 'Iframe-Child-Screen' + this.name,
                            ack: true,
                            messageId: e.data.id,
                            timestamp: Date.now(),
                        },
                        targetOrigin,
                    );
                } catch (err) {
                    console.error('[Iframe-js] Failed to send ACK back:', err);
                }
            }

            if (e.data?.isRpcReq && e.data?.methodName) {
                const handler = this._rpcMethods.get(e.data.methodName);
                // 封装返回结果的通信函数
                const sendResponse = (error, result) => {
                    try {
                        const targetOrigin = e.origin && e.origin !== 'null' ? e.origin : '*';
                        e.source.postMessage(
                            {
                                source: 'Iframe-Child-Screen' + this.name,
                                isRpcRes: true,
                                callId: e.data.callId,
                                result: result,
                                error: error ? String(error) : null,
                                timestamp: Date.now(),
                            },
                            targetOrigin,
                        );
                    } catch (err) {
                        console.error('[Iframe] RPC send response failed:', err);
                    }
                };
                if (!handler) {
                    return sendResponse(`RPC Method "${e.data.methodName}" not found on target.`);
                }
                try {
                    // 巧妙利用 Promise.resolve 兼容同步和异步(async)函数
                    Promise.resolve(handler(e.data.params, { source: this.name }))
                        .then((res) => sendResponse(null, res))
                        .catch((err) => sendResponse(err?.message || err));
                } catch (err) {
                    sendResponse(err?.message || err);
                }
                return;
            }

            if (e.data?.action) {
                const handler = this._eventHandlers.get(e.data.action) || this._customMap.get(e.data.action);
                if (handler) handler(val);
                return;
            }

            if (this.message) this.message(val);
        };

        window.addEventListener('message', this._messageListener, false);
    }

    onload() {
        if (!this.iframe) return;
        try {
            if (this.iframe['onload']) {
                this.iframe['onload']();
            }
        } catch (e) {}
    }

    addWhiteList(url) {
        if (Array.isArray(url)) {
            const validUrls = url.filter((u) => u && typeof u === 'string');
            this.Whitelist = [...this.Whitelist, ...validUrls];
        } else if (url && typeof url === 'string') {
            this.Whitelist.push(url);
        }
        this._updateOriginCache();
    }

    getEmbedStatus() {
        const isEmbed = IframeUtils.isEmbedded();
        let canCommunicate = false;

        if (isEmbed) {
            canCommunicate = !!window.parent && typeof window.parent.postMessage === 'function';
        }

        return {
            isEmbedded: isEmbed,
            canCommunicate: canCommunicate,
            hasParent: !!window.parent,
            hasFrameElement: !!window.frameElement,
            isTopWindow: window.self === window.top,
        };
    }

    isReady() {
        if (this._isDestroyed) {
            console.warn('[Iframe-js] isReady: instance is destroyed');
            return false;
        }

        if (this._originCache.size === 0) {
            console.warn('[Iframe-js] isReady: whitelist is empty, communication may be blocked');
        }

        const isChildRole = this.iframe === window.parent;

        if (isChildRole) {
            const status = this.getEmbedStatus();
            if (!status.canCommunicate) {
                console.warn('[Iframe-js] isReady: child cannot communicate with parent window');
                return false;
            }
            return true;
        } else {
            if (!this._iframeLoaded) {
                console.warn('[Iframe-js] isReady: parent waiting, iframe not loaded yet');
                return false;
            }
            if (!this.iframe) {
                console.warn('[Iframe-js] isReady: parent iframe target is missing');
                return false;
            }
            return true;
        }
    }

    removeWhiteList(url) {
        if (Array.isArray(url)) {
            const validUrls = url.filter((u) => u && typeof u === 'string');
            this.Whitelist = [...this.Whitelist, ...validUrls];
        } else if (url && typeof url === 'string') {
            this.Whitelist.push(url);
        }
        this._updateOriginCache();
    }

    updateWhite(oldUrl, newUrl) {
        if (!oldUrl || !newUrl) {
            console.warn('[Iframe-js] updateWhite: oldUrl and newUrl are required');
            return;
        }
        const index = this.Whitelist.indexOf(oldUrl);
        if (index !== -1) {
            this.Whitelist[index] = newUrl;
            this._updateOriginCache();
        }
    }

    expose(methodName, handler) {
        if (this._isDestroyed) return;
        if (typeof handler !== 'function') {
            console.error('[Iframe RPC] handler must be a function');
            return;
        }
        this._rpcMethods.set(methodName, handler);
    }

    callRemote(methodName, params = {}, timeout = this._defaultTimeout) {
        return new Promise((resolve, reject) => {
            if (this._isDestroyed) return reject(new Error('Instance is destroyed'));

            const targetWindow = this.iframe;
            if (!targetWindow) return reject(new Error('Target window is null'));

            // 借用底层的 messageQueue 机制，如果还没 ready 则排队（选做）
            if (!this.isReady()) {
                console.warn('[Iframe RPC] iframe not ready, pushing RPC call to queue');
                this._messageQueue.push({
                    isAck: false, // 不走普通 ack 逻辑
                    payload: null,
                    resolve: () => this.callRemote(methodName, params, timeout).then(resolve).catch(reject),
                });
                return;
            }

            const callId = 'rpc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

            try {
                const message = {
                    source: 'Iframe-Child-Screen' + this.name,
                    isRpcReq: true,
                    methodName: methodName,
                    callId: callId,
                    params: params, // 携带参数
                    timestamp: Date.now(),
                };

                const targetOrigin = this.postOrigin || '*';
                targetWindow.postMessage(message, targetOrigin);

                // 设置 RPC 专属超时监听
                const timer = setTimeout(() => {
                    this._pendingMessages.delete(callId);
                    reject(new Error(`RPC call "${methodName}" timeout after ${timeout}ms`));
                }, timeout);

                // 复用你的 _pendingMessages 容器存 resolve 和 reject
                this._pendingMessages.set(callId, { timeout: timer, resolve, reject });
            } catch (e) {
                reject(new Error(`RPC send failed: ${e.message}`));
            }
        });
    }

    sendMessageWithAckToChild(payload, timeout = this._defaultTimeout) {
        return this._sendWithAckCore(payload, timeout, { type: 0, origin: this.postOrigin });
    }

    emitToChildWithAck(event, payload = {}, timeout = this._defaultTimeout) {
        if (this._isDestroyed) return Promise.resolve(false);

        if (IframeUtils.isSameDomain(window.location.href, this.url)) {
            try {
                const handler = this.iframe[EVENT_HEAD_PREFIX + event];
                if (typeof handler === 'function') {
                    return Promise.resolve(handler({ source: this.name, data: payload }))
                        .then(() => true)
                        .catch((e) => {
                            console.error('[Iframe-js] Same-domain ACK handler error:', e);
                            return false;
                        });
                }
                return Promise.resolve(false);
            } catch (e) {
                return Promise.resolve(false);
            }
        }

        return this._sendWithAckCore(payload, timeout, { type: 1, event, origin: this.postOrigin });
    }

    getWhiteList() {
        return [...this.Whitelist];
    }
    sendMessageParent(payload, options) {
        if (this._isDestroyed) {
            console.warn('[Iframe-js] sendMessageParent: instance is destroyed');
            return false;
        }
        if (!this.iframe) {
            console.error('[Iframe-js] sendMessageParent: iframe is null or undefined');
            return false;
        }
        return this._targetSend(this.iframe, payload, options || { type: 0, origin: this.postOrigin });
    }

    sendEmitEventParent(event, payload = {}) {
        if (this._isDestroyed) {
            console.warn('[Iframe-js] sendEmitEventParent: instance is destroyed');
            return false;
        }
        if (!event || typeof event !== 'string') {
            console.error('[Iframe-js] sendEmitEventParent: eventName must be a non-empty string');
            return false;
        }

        if (IframeUtils.isSameDomain(window.location.href, this.url)) {
            try {
                const handler = this.iframe[EVENT_HEAD_PREFIX + event];
                if (handler && typeof handler === 'function') {
                    handler({
                        source: this.name,
                        data: payload,
                    });
                    return true;
                } else {
                    console.warn(`[Iframe-js] sendEmitEventParent: event "${event}" not found`);
                    return false;
                }
            } catch (e) {
                console.error('[Iframe-js] sendEmitEventParent error:', e);
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

    sendMessageChild(payload = {}, options) {
        if (this._isDestroyed) {
            console.warn('[Iframe-js] sendMessageChild: instance is destroyed');
            return false;
        }
        try {
            const origin = this._knownOrigin || this.postOrigin;
            return this._targetSend(window.parent, payload, options || { type: 0, origin: origin });
        } catch (e) {
            console.error('[Iframe-js] sendMessageChild error:', e);
            return false;
        }
    }

    sendEmitEventChild(event, payload = {}) {
        if (this._isDestroyed) {
            console.warn('[Iframe-js] sendEmitEventChild: instance is destroyed');
            return false;
        }
        return this.sendMessageChild(payload, {
            type: 1,
            event: event,
            origin: this.postOrigin,
        });
    }

    sendMessageParentWithAck(payload, timeout = this._defaultTimeout) {
        return this._sendWithAckCore(payload, timeout, { type: 0, origin: this.postOrigin });
    }

    emitToParentWithAck(event, payload = {}, timeout = this._defaultTimeout) {
        return this._sendWithAckCore(payload, timeout, { type: 1, event: event, origin: this.postOrigin });
    }

    action(name, fun) {
        if (this._isDestroyed) return;
        if (name === 'postMessage' || arguments.length !== 2 || typeof fun !== 'function' || !name) return;

        const eventKey = EVENT_HEAD_PREFIX + name;

        this._eventHandlers.set(eventKey, fun);

        if (IframeUtils.isSameDomain(window.location.href, this.url)) {
            if (this.iframe === window.parent) {
                window[eventKey] = fun;
            }
        } else {
            this._customMap.set(eventKey, fun);
        }
    }
    getState() {
        return { ...this._state };
    }

    onStateChange(listener) {
        if (this._isDestroyed) return;
        if (typeof listener === 'function') {
            this._stateListeners.add(listener);
        }
    }

    offStateChange(listener) {
        this._stateListeners.delete(listener);
    }

    setState(partialState) {
        if (this._isDestroyed || !partialState || typeof partialState !== 'object') return;

        const oldState = { ...this._state };
        this._state = { ...this._state, ...partialState };

        this._stateListeners.forEach((listener) => {
            try {
                listener(this._state, oldState);
            } catch (err) {
                console.error('[Iframe StateSync] listener error:', err);
            }
        });

        if (this.isReady()) {
            this._sendStateSync(partialState);
        }
    }

    _sendStateSync(partialState) {
        const targetWindow = this.iframe;
        if (!targetWindow) return;
        try {
            const message = {
                source: 'Iframe-Child-Screen' + this.name,
                isStateSync: true,
                state: partialState,
                timestamp: Date.now(),
            };
            const targetOrigin = this.postOrigin || '*';
            targetWindow.postMessage(message, targetOrigin);
        } catch (e) {
            console.error('[Iframe StateSync] sync failed:', e);
        }
    }

    _syncFullState() {
        if (Object.keys(this._state).length > 0 && this.isReady()) {
            this._sendStateSync(this._state);
        }
    }

    enableAutoResize() {
        if (this._isDestroyed || this.iframe === window.parent) return;
        this._autoResizeEnabled = true;
    }

    startAutoResizer(config = {}) {
        if (this._isDestroyed || this.iframe !== window.parent) return;
        if (this._resizeObserver) return;

        const targetNode = config.target ? document.querySelector(config.target) : document.body;
        if (!targetNode) {
            console.warn('[Iframe Resize] Target node not found');
            return;
        }

        const offset = config.offset || 0;

        const sendHeight = () => {
            try {
                const height = Math.max(targetNode.scrollHeight, targetNode.offsetHeight, document.documentElement.offsetHeight);

                const message = {
                    source: 'Iframe-Child-Screen' + this.name,
                    isAutoResize: true,
                    height: height + offset,
                    timestamp: Date.now(),
                };
                window.parent.postMessage(message, this.postOrigin || '*');
            } catch (e) {
                console.error('[Iframe Resize] Failed to send height:', e);
            }
        };

        this._resizeObserver = new ResizeObserver(() => {
            sendHeight();
        });

        this._resizeObserver.observe(targetNode);
        sendHeight();
    }

    stopAutoResizer() {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
    }

    removeAction(name) {
        const eventKey = EVENT_HEAD_PREFIX + name;
        if (IframeUtils.isSameDomain(window.location.href, this.url) && this.iframe === window.parent) {
            delete window[eventKey];
        }
        this._customMap.delete(eventKey);
        this._eventHandlers.delete(eventKey);
    }

    destroy() {
        if (this._isDestroyed) {
            console.warn('[Iframe-js] destroy: instance already destroyed');
            return;
        }

        this._isDestroyed = true;

        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        this.iframeNode = null;

        this._pendingMessages.forEach((pending, id) => {
            clearTimeout(pending.timeout);
            if (pending.resolve) pending.resolve(false);
        });
        this._pendingMessages.clear();
        this._messageQueue = [];

        if (this._messageListener) {
            window.removeEventListener('message', this._messageListener, false);
            this._messageListener = null;
        }

        this._eventHandlers.forEach((_, key) => {
            if (IframeUtils.isSameDomain(window.location.href, this.url)) {
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
        this._stateListeners.clear();
        this._state = {};

        console.info('[Iframe-js] Iframe instance destroyed');
    }
    BlockingLog() {
        console.log = function () {};
    }
}

export { IframeUtils, Iframe };
export default Iframe;
