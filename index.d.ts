/**
 * 接收到的普通消息对象格式
 */
export interface IframeMessageEvent<T = any> {
    source: string;
    data: T;
    id: string;
    timestamp: number;
}

/**
 * 接收到的自定义事件对象格式
 */
export interface IframeActionEvent<T = any> {
    source: string;
    data: T;
}

/**
 * 嵌入状态对象
 */
export interface EmbedStatus {
    isEmbedded: boolean;
    canCommunicate: boolean;
    hasParent: boolean;
    hasFrameElement: boolean;
    isTopWindow: boolean;
}

/**
 * 父页面初始化配置项
 */
export interface ParentIframeOptions {
    container: HTMLIFrameElement;
    url: string;
    whiteList?: string | string[];
    name?: string;
    timeout?: number;
}

/**
 * 子页面初始化配置项
 */
export interface ChildIframeOptions {
    name: string;
    timeout?: number;
}

/**
 * 自动高度同步配置项
 */
export interface AutoResizerConfig {
    /** 监听的目标节点选择器，默认为 'body' */
    target?: string;
    /** 额外的高度补偿值 (px) */
    offset?: number;
}

export declare class IframeUtils {
    static isSameDomain(url1: string, url2: string): boolean;
    static getOrigin(url: string): string | null;
    static isEmbedded(): boolean;
}

export default class Iframe {
    constructor(options: ParentIframeOptions | ChildIframeOptions | string | HTMLIFrameElement);

    Whitelist: string[];
    postOrigin: string;
    message: ((e: IframeMessageEvent) => void) | null;

    isReady(): boolean;
    getEmbedStatus(): EmbedStatus;

    addWhiteList(url: string | string[]): void;
    removeWhiteList(url: string | string[]): void;
    updateWhite(oldUrl: string, newUrl: string): void;
    getWhiteList(): string[];

    action<T = any>(name: string, callback: (e: IframeActionEvent<T>) => void): void;
    removeAction(name: string): void;
    emit(event: string, payload?: any): boolean;
    sendMessage(payload: any, options?: { origin?: string; type?: number }): string | false;

    // ==========================================
    // ACK 确认机制 API (Promise)
    // ==========================================
    sendMessageWithAckToChild(payload: any, timeout?: number): Promise<boolean>;
    emitToChildWithAck(event: string, payload?: any, timeout?: number): Promise<boolean>;
    sendMessageParentWithAck(payload: any, timeout?: number): Promise<boolean>;
    emitToParentWithAck(event: string, payload?: any, timeout?: number): Promise<boolean>;

    // ==========================================
    // 高级特性: RPC 远程过程调用
    // ==========================================
    /**
     * 暴露一个本地方法供远端调用
     * @param methodName 方法名称
     * @param handler 处理函数（支持返回 Promise 的异步函数）
     */
    expose<T = any, R = any>(methodName: string, handler: (params: T, context?: { source: string }) => R | Promise<R>): void;

    /**
     * 调用远端暴露的方法，并等待返回值
     * @param methodName 远端方法名称
     * @param params 传递给远端函数的参数
     * @param timeout 超时时间(ms)
     */
    callRemote<T = any, R = any>(methodName: string, params?: T, timeout?: number): Promise<R>;

    // ==========================================
    // 高级特性: 状态共享 (State Sync)
    // ==========================================
    /** 获取当前全量状态 */
    getState<T = Record<string, any>>(): T;

    /** 增量或全量更新状态，并自动同步给远端 */
    setState<T = Record<string, any>>(partialState: Partial<T>): void;

    /** 监听状态变化 */
    onStateChange<T = Record<string, any>>(listener: (newState: T, oldState: T) => void): void;

    /** 移除状态监听 */
    offStateChange<T = Record<string, any>>(listener: (newState: T, oldState: T) => void): void;

    // ==========================================
    // 高级特性: 自动高度适应 (Auto Resize)
    // ==========================================
    /** (父页面专用) 开启自动接收并同步 iframe 高度 */
    enableAutoResize(): void;

    /** (子页面专用) 开启自动探测自身高度并上报给父页面 */
    startAutoResizer(config?: AutoResizerConfig): void;

    /** (子页面专用) 停止自动上报高度 */
    stopAutoResizer(): void;

    /** 彻底销毁实例，清理所有资源 */
    destroy(): void;
    BlockingLog(): void;
}
