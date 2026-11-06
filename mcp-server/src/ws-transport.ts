import WebSocket from 'ws';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './logger.js';

export interface WebSocketTransportOptions {
  url: string;
  /** 重连基准延迟（毫秒） */
  reconnectBaseDelayMs?: number;
  /** 重连最大延迟（毫秒） */
  reconnectMaxDelayMs?: number;
}

/**
 * 面向小智 MCP 接入点的 WebSocket 传输层。
 *
 * 接入点协议：WS 连接直接承载 MCP 的 JSON-RPC 2.0 消息，
 * 每个 WS 文本帧即一条 JSON-RPC 消息。接入点负责在「小智端」和本工具端之间转发。
 *
 * 本类实现 MCP SDK 的 Transport 接口，并在连接断开时以指数退避自动重连，
 * 保证作为常驻服务挂在接入点上时的稳健性（Task 7 的守护需求）。
 */
export class WebSocketClientTransport implements Transport {
  private ws?: WebSocket;
  private readonly url: string;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private reconnectAttempts = 0;
  private closedByUser = false;
  private reconnectTimer?: NodeJS.Timeout;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(opts: WebSocketTransportOptions) {
    this.url = opts.url;
    this.baseDelay = opts.reconnectBaseDelayMs ?? 1000;
    this.maxDelay = opts.reconnectMaxDelayMs ?? 30000;
  }

  /** 建立连接。首次连接失败会 reject；连接成功后若断开则自动重连。 */
  start(): Promise<void> {
    this.closedByUser = false;
    return this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info(`正在连接 MCP 接入点：${this.maskUrl(this.url)}`);
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let opened = false;

      ws.on('open', () => {
        opened = true;
        this.reconnectAttempts = 0;
        logger.info('MCP 接入点连接成功');
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        const text = data.toString('utf-8');
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          logger.warn('收到非 JSON 消息，已忽略：', text.slice(0, 200));
          return;
        }
        try {
          const message = JSONRPCMessageSchema.parse(parsed);
          logger.debug('收到消息：', text.slice(0, 500));
          this.onmessage?.(message);
        } catch (e) {
          logger.warn('JSON-RPC 消息校验失败，已忽略：', (e as Error).message);
        }
      });

      ws.on('error', (err: Error) => {
        logger.error('WebSocket 错误：', err.message);
        this.onerror?.(err);
        if (!opened) {
          reject(err);
        }
      });

      ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(`WebSocket 关闭：code=${code} reason=${reason.toString() || '(空)'}`);
        this.ws = undefined;
        if (!opened) {
          // 首次连接就失败，交给 error/reject 处理
          return;
        }
        this.onclose?.();
        if (!this.closedByUser) {
          this.scheduleReconnect();
        }
      });
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const delay = Math.min(
      this.maxDelay,
      this.baseDelay * 2 ** (this.reconnectAttempts - 1)
    );
    logger.info(`将在 ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连`);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        logger.error('重连失败：', (err as Error).message);
        this.scheduleReconnect();
      });
    }, delay);
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket 未连接，无法发送消息'));
        return;
      }
      const text = JSON.stringify(message);
      this.ws.send(text, (err) => {
        if (err) {
          logger.error('发送消息失败：', err.message);
          reject(err);
        } else {
          logger.debug('发送消息：', text.slice(0, 500));
          resolve();
        }
      });
    });
  }

  async close(): Promise<void> {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.ws?.close();
    this.ws = undefined;
  }

  /** 日志里隐藏 token */
  private maskUrl(url: string): string {
    return url.replace(/token=[^&]+/i, 'token=***');
  }
}
