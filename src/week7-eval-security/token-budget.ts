// 学习目标：Token 预算
// 成本与上下文长度直接相关：需要在调用前后做估算、限额与降级。

/**
 * 粗略估算 token 数（不依赖 tokenizer，够用且快）：
 * - 中日韩字符：约 1 字符 ≈ 1 token
 * - 其他字符：约 4 字符 ≈ 1 token
 */
export function estimateTokens(text: string): number {
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const otherCount = Math.max(0, text.length - cjkCount);
  return cjkCount + Math.ceil(otherCount / 4);
}

export interface BudgetSnapshot {
  limit: number;
  used: number;
  remaining: number;
  exceeded: boolean;
}

export class TokenBudget {
  private used = 0;

  constructor(private readonly limit: number) {}

  /** 记一次消耗，返回本次消耗量 */
  consume(text: string): number {
    const tokens = estimateTokens(text);
    this.used += tokens;
    return tokens;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get exceeded(): boolean {
    return this.used > this.limit;
  }

  /** 超预算时抛出，由上层决定是裁剪上下文还是拒绝请求 */
  assertWithinBudget(): void {
    if (this.exceeded) {
      throw new Error(
        `Token 预算已超限：已用 ${this.used}，上限 ${this.limit}`
      );
    }
  }

  snapshot(): BudgetSnapshot {
    return {
      limit: this.limit,
      used: this.used,
      remaining: this.remaining,
      exceeded: this.exceeded,
    };
  }
}
