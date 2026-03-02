export interface IframeOptions {
  /** 挂载的 iframe DOM 节点 (父页面必填) */
  container?: HTMLIFrameElement;
  /** 子页面的 URL (父页面必填) */
  url?: string;
  /** 允许通信的 origin 白名单 */
  whiteList?: string[];
  /** 全局默认的 ACK 确认超时时间 (毫秒)，默认 5000 */
  timeout?: number;
}

export interface EmbedStatus {
  /** 是否被内嵌在 iframe 中 */
  isEmbedded: boolean;
  /** 当前环境是否能够使用 postMessage 通信 */
  canCommunicate: boolean;
  /** 是否存在父窗口 */
  hasParent: boolean;
  /** 是否存在同源的 frameElement 引用 */
  hasFrameElement: boolean;
  /** 当前是否为浏览器顶层窗口 */
  isTopWindow: boolean;
}

export interface MessagePayload {
  data: any;
  source: string;
  id: string;
  timestamp: number;
}

export class Iframe {
  /**
   * 构造函数
   * @param options 父页面的配置对象，或子页面的 name 字符串
   * @param config 专供子页面使用的额外配置对象 (可选)
   */
  constructor(options: IframeOptions | string, config?: { timeout?: number });

  /** 当前实例名称 */
  name: string;
  /** 挂载的 window 对象 */
  iframe: Window | null;
  /** 消息发送对方窗口的 origin */
  postOrigin: string;
  /** 通信白名单列表 */
  Whitelist: string[];

  /** 接收普通消息的回调函数 */
  message?: (payload: MessagePayload) => void;

  /** 检查通信是否就绪 (iframe 是否加载且白名单不为空) */
  isReady(): boolean;
  /** 获取当前运行的嵌入状态环境 */
  getEmbedStatus(): EmbedStatus;

  /** 添加白名单 */
  addWhiteList(url: string | string[]): void;
  /** 移除白名单 */
  removeWhiteList(url: string | string[]): void;
  /** 更新指定的白名单记录 */
  updateWhite(oldUrl: string, newUrl: string): void;

  /** 发送普通消息 (自动判断环境) */
  sendMessage(payload: any, options?: any): string | boolean;
  /** 父页面发送普通消息到子页面 */
  sendMessageParent(payload: any, options?: any): string | boolean;
  /** 子页面发送普通消息到父页面 */
  sendMessageChild(payload: any, options?: any): string | boolean;

  /** 发送带确认的普通消息到子页面 */
  sendMessageWithAckToChild(payload: any, timeout?: number): Promise<boolean>;
  /** 发送带确认的普通消息到父页面 */
  sendMessageParentWithAck(payload: any, timeout?: number): Promise<boolean>;

  /** 监听/绑定自定义事件 */
  action(name: string, callback: (payload: MessagePayload) => void): void;
  /** 移除自定义事件监听器 */
  removeAction(name: string): void;

  /** 触发目标的自定义事件 (自动判断环境) */
  emit(event: string, payload?: any): boolean;
  /** 发送带确认的自定义事件到子页面 */
  emitToChildWithAck(event: string, payload?: any, timeout?: number): Promise<boolean>;
  /** 发送带确认的自定义事件到父页面 */
  emitToParentWithAck(event: string, payload?: any, timeout?: number): Promise<boolean>;

  /** 彻底销毁实例，清理所有监听器和内存 */
  destroy(): void;
}