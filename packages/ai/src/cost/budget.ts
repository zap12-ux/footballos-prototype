import { ProviderUnavailableError } from "../errors.js";

/**
 * Per-job spending ledger. A call is reserved *before* it is made with a conservative
 * estimate; if the reservation would push the job past `limitUsd` the call is refused and
 * the job must abort. After the call, the real cost replaces the estimate.
 *
 * Default limit: $25 (owner decision via console, 2026-10-25; FOOTBALLOS_AI_JOB_BUDGET_USD).
 */
export class JobBudget {
  readonly limitUsd: number;
  private spent = 0;
  private reserved = 0;
  private calls = 0;

  constructor(limitUsd: number) {
    if (!Number.isFinite(limitUsd) || limitUsd < 0) throw new Error("limitUsd must be a non-negative number");
    this.limitUsd = limitUsd;
  }

  get spentUsd(): number {
    return this.spent;
  }
  get reservedUsd(): number {
    return this.reserved;
  }
  get callCount(): number {
    return this.calls;
  }
  get remainingUsd(): number {
    return Math.max(0, this.limitUsd - this.spent - this.reserved);
  }

  /**
   * Reserve `estimateUsd` for an upcoming call. Throws `provider_unavailable` with reason
   * `budget_exceeded` (not retryable) when spent + reserved + estimate > limit.
   * A null estimate (unpriced model) is treated as exceeding the budget: we never spend
   * money we cannot account for.
   */
  reserve(estimateUsd: number | null): BudgetReservation {
    if (estimateUsd === null) {
      throw new ProviderUnavailableError({
        provider: "anthropic",
        reason: "budget_exceeded",
        retryable: false,
        message: "model is not in the price table; refusing to spend an unaccountable amount",
      });
    }
    if (this.spent + this.reserved + estimateUsd > this.limitUsd) {
      throw new ProviderUnavailableError({
        provider: "anthropic",
        reason: "budget_exceeded",
        retryable: false,
        message: `job budget $${this.limitUsd.toFixed(2)} would be exceeded (spent $${this.spent.toFixed(4)}, reserved $${this.reserved.toFixed(4)}, next call estimated $${estimateUsd.toFixed(4)})`,
      });
    }
    this.reserved += estimateUsd;
    let settled = false;
    return {
      estimateUsd,
      settle: (actualUsd: number | null) => {
        if (settled) return;
        settled = true;
        this.reserved -= estimateUsd;
        // An unpriced actual cost keeps the estimate on the books (never under-count).
        this.spent += actualUsd ?? estimateUsd;
        this.calls += 1;
      },
      release: () => {
        if (settled) return;
        settled = true;
        this.reserved -= estimateUsd;
      },
    };
  }
}

export interface BudgetReservation {
  estimateUsd: number;
  /** Record the real cost of the completed call. */
  settle(actualUsd: number | null): void;
  /** The call never happened (e.g. transport threw before sending); free the reservation. */
  release(): void;
}
