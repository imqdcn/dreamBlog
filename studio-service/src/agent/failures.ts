/** 连续工具失败计数（设计 7.4 第 3 步，需求 10.7）。 */

import { EXECUTION_FAILURE_CODES, type ToolResult } from './types.js';

export const MAX_CONSECUTIVE_FAILURES = 3;

export class ConsecutiveFailures {
  private n = 0;

  /**
   * 按调用顺序记录一个工具结果。
   * 执行类失败累加；成功清零；其余错误（参数无效、未知工具、守卫拒绝、not_found）不改变计数。
   * 空结果（ok:true, empty:true）不改变计数。恰好在第 3 次累加时触发。
   */
  record(result: ToolResult): { count: number; triggered: boolean } {
    let triggered = false;
    if (result.ok) {
      if (!result.empty) this.n = 0;
    } else if (EXECUTION_FAILURE_CODES.includes(result.error.code)) {
      this.n += 1;
      triggered = this.n === MAX_CONSECUTIVE_FAILURES;
    }
    return { count: this.n, triggered };
  }

  get count(): number {
    return this.n;
  }
}
