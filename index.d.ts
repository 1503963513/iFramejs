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
    /** iframe DOM 节点 */
    container: HTMLIFrameElement;
    /** 目标 iframe 的完整 URL */
    url: string;
    /** 允许通信的 Origin 白名单 */
    whiteList?: string | string[];
    /** 实例唯一命名（可选，不传会自动生成） */
    name?: string;
    /** 全局 ACK 默认超时时间 (毫秒)，默认 5000 */
    timeout?: number;
}

/**
 * 子页面初始化配置项
 */
export interface ChildIframeOptions {
    /** 实例唯一命名标识 */
    name: string;
    /** 全局 ACK 默认超时时间 (毫秒)，默认 5000 */
    timeout?: number;
}

/**
 * IframeUtils 工具类
 */
export declare class IframeUtils {
    /** 判断两个URL是否同域 */
    static isSameDomain(url1: string, url2: string): boolean;
    /** 解析URL获取origin */
    static getOrigin(url: string): string | null;
    /** 检测当前页面是否被内嵌在 iframe 中 */
    static isEmbedded(): boolean;
}

/**
 * 核心 Iframe 通信类
 */
export default class Iframe {
    /**
     * 构造函数
     * @param options 父级配置对象，或子级配置对象，或直接传入子级命名字符串
     */
    constructor(options: ParentIframeOptions | ChildIframeOptions | string | HTMLIFrameElement);

    /** 当前允许通信的白名单数组 */
    Whitelist: string[];
    /** 消息发送对方窗口的 origin */
    postOrigin: string;

    /**
     * 属性：接收普通消息的回调函数
     * @example iframe.message = (e) => { console.log(e.data) }
     */
    message: ((e: IframeMessageEvent) => void) | null;

    /**
     * 检查通信是否就绪 (DOM是否加载完、白名单是否配置)
     */
    isReady(): boolean;

    /**
     * 获取当前页面的嵌入状态环境
     */
    getEmbedStatus(): EmbedStatus;

    /**
     * 动态添加信任的白名单 Origin
     */
    addWhiteList(url: string | string[]): void;

    /**
     * 移除白名单 Origin
     */
    removeWhiteList(url: string | string[]): void;

    /**
     * 更新指定的白名单记录
     */
    updateWhite(oldUrl: string, newUrl: string): void;

    /**
     * 获取当前的白名单数组
     */
    getWhiteList(): string[];

    /**
     * 监听/绑定自定义事件
     * @param name 事件名称
     * @param callback 回调函数
     */
    action<T = any>(name: string, callback: (e: IframeActionEvent<T>) => void): void;

    /**
     * 移除已绑定的自定义事件监听器
     * @param name 事件名称
     */
    removeAction(name: string): void;

    /**
     * 触发目标的自定义事件
     * @param event 事件名称
     * @param payload 附带数据
     * @returns 是否触发成功
     */
    emit(event: string, payload?: any): boolean;

    /**
     * 发送普通消息
     * @param payload 消息内容
     * @param options 发送选项
     * @returns 成功返回消息ID，失败返回 false
     */
    sendMessage(payload: any, options?: { origin?: string; type?: number }): string | false;

    // ==========================================
    // ACK 确认机制 API (Promise)
    // ==========================================

    /**
     * 发送带确认的普通消息到子页面
     * @param payload 消息内容
     * @param timeout 超时时间(ms)，不传则使用默认配置
     */
    sendMessageWithAckToChild(payload: any, timeout?: number): Promise<boolean>;

    /**
     * 发送带确认的自定义事件到子页面
     * @param event 事件名称
     * @param payload 附带数据
     * @param timeout 超时时间(ms)
     */
    emitToChildWithAck(event: string, payload?: any, timeout?: number): Promise<boolean>;

    /**
     * 发送带确认的普通消息到父页面
     * @param payload 消息内容
     * @param timeout 超时时间(ms)
     */
    sendMessageParentWithAck(payload: any, timeout?: number): Promise<boolean>;

    /**
     * 发送带确认的自定义事件到父页面
     * @param event 事件名称
     * @param payload 附带数据
     * @param timeout 超时时间(ms)
     */
    emitToParentWithAck(event: string, payload?: any, timeout?: number): Promise<boolean>;

    /**
     * 彻底销毁实例，清理所有事件监听器、消息队列和内存占用
     */
    destroy(): void;

    /**
     * 屏蔽组件内部的 console.log 日志
     */
    BlockingLog(): void;
}
