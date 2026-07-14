import { ProviderError } from './provider/providerRouter.js';

/** Rough token estimate: ~4 chars per token. Cheap and provider-agnostic. */
export function countTokens(text: string): number {
  return Math.ceil((text || '').length / 4);
}

/**
 * Tracks token spend across a run and enforces the per-chat and per-project
 * budgets the user sets in the UI. Pulled out of the loop so the accounting is
 * in one place and testable.
 */
export class Budget {
  sessionTokens = 0;
  lastOutputTokens = 0;

  constructor(
    private readonly maxTokens: number | undefined,
    private readonly projectMaxTokens: number | undefined,
    private readonly priorProjectTokens: number,
  ) {}

  /** Add text spend. Set `output` when the text is model output (counts toward lastOutput). */
  add(text: string, output = false): void {
    const t = countTokens(text);
    this.sessionTokens += t;
    if (output) this.lastOutputTokens += t;
  }

  resetLastOutput(): void {
    this.lastOutputTokens = 0;
  }

  /** Throws ProviderError if either budget is exceeded. */
  enforce(): void {
    if (this.maxTokens && this.sessionTokens > this.maxTokens) {
      throw new ProviderError(`Token budget limit (${this.maxTokens} tokens) exceeded. Execution aborted.`);
    }
    if (this.projectMaxTokens && this.priorProjectTokens + this.sessionTokens > this.projectMaxTokens) {
      throw new ProviderError(`Project token budget limit (${this.projectMaxTokens} tokens) exceeded. Execution aborted.`);
    }
  }

  /** Remaining per-chat budget, or undefined if uncapped. */
  remaining(): number | undefined {
    return this.maxTokens ? Math.max(0, this.maxTokens - this.sessionTokens) : undefined;
  }
}
