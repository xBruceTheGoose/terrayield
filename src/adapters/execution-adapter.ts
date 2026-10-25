/**
 * Execution Adapter Interface
 *
 * Harness-agnostic interface for executing TerraYield actions.
 * Implementations can use @solana/web3.js, Solana Agent Kit, or any other framework.
 */

export interface TxResult {
  signature: string
  success: boolean
  error?: string
  rawData?: unknown
}

/**
 * Core execution adapter interface
 */
export interface ExecutionAdapter {
  /**
   * Execute carbon offset purchase and burn
   * @param amount USDC amount to spend on carbon credits
   * @param token Token mint address (e.g., USDC mint)
   * @returns Transaction result with signature
   */
  offset(amount: number, token: string): Promise<TxResult>

  /**
   * Deposit liquidity into a yield protocol
   * @param amount USDC amount to deposit
   * @param protocol Protocol identifier (e.g., 'Kamino', 'Marginfi')
   * @param precommitOffsetPct Optional percentage of subsequent yield pre-committed to carbon offset
   * @returns Transaction result with signature
   */
  depositYield(
    amount: number,
    protocol: string,
    precommitOffsetPct?: number
  ): Promise<TxResult>

  /**
   * Execute subsequent withdrawal: withdraws yield + principal, routing pre-committed offset to burn
   * @param principalAmount USDC principal amount returned
   * @param protocol Protocol identifier
   * @param grossYield Gross yield accrued
   * @param offsetBurnAmount Pre-committed yield burned for carbon credits
   * @param token Token mint address
   */
  withdrawYield?(
    principalAmount: number,
    protocol: string,
    grossYield: number,
    offsetBurnAmount: number,
    token: string
  ): Promise<TxResult>
}

/**
 * Execution context for routing decisions
 */
export interface ExecutionContext {
  executionId: string
  carbonOffset: {
    amount: number
    token: string
  }
  yieldDeposit: {
    amount: number
    protocol: string
    expectedApy: number
    offsetYieldPercent?: number
  }
  subsequentWithdrawal?: {
    timeframeMonths: number
    grossYield: number
    offsetBurnAmount: number
    netYield: number
    principalReturned: number
    offsetYieldPercent: number
    token: string
  }
}

/**
 * Result of the full execution flow
 */
export interface ExecutionResult {
  executionId: string
  carbonOffsetTx: TxResult
  yieldDepositTx: TxResult
  withdrawalTx?: TxResult
  overallSuccess: boolean
  reasoningLog: string
}

/**
 * Execution Router - maps LLM output to adapter calls
 */
export class ExecutionRouter {
  constructor(private adapter: ExecutionAdapter) {}

  /**
   * Execute the full TerraYield routing plan
   */
  async execute(
    execution: ExecutionContext,
    reasoningLog: string
  ): Promise<ExecutionResult> {
    // 1. If pre-committed % offset yield with subsequent withdrawal is configured
    if (execution.subsequentWithdrawal) {
      // Step A: Deposit 100% of liquidity into the highest-yielding protocol with pre-commitment attached
      let yieldDepositTx: TxResult = {
        signature: 'skipped_zero_deposit',
        success: true,
        rawData: { note: 'Zero liquidity deposit' },
      }

      if (execution.yieldDeposit.amount > 0) {
        yieldDepositTx = await this.adapter.depositYield(
          execution.yieldDeposit.amount,
          execution.yieldDeposit.protocol,
          execution.yieldDeposit.offsetYieldPercent
        )

        if (!yieldDepositTx.success) {
          return {
            executionId: execution.executionId,
            carbonOffsetTx: {
              signature: '',
              success: false,
              error: 'Aborted: initial yield deposit step failed',
            },
            yieldDepositTx,
            overallSuccess: false,
            reasoningLog: `${reasoningLog} [Execution aborted due to deposit failure: ${yieldDepositTx.error}]`,
          }
        }
      }

      // Step B: Execute subsequent withdrawal simulation if adapter implements it
      let withdrawalTx: TxResult | undefined
      let carbonOffsetTx: TxResult = {
        signature: `precommit_${execution.yieldDeposit.offsetYieldPercent ?? 0}pct_yield`,
        success: true,
        rawData: {
          note: `Pre-committed ${execution.yieldDeposit.offsetYieldPercent}% of subsequent withdrawal yield`,
          offsetBurnUsdc: execution.subsequentWithdrawal.offsetBurnAmount,
        },
      }

      if (this.adapter.withdrawYield) {
        withdrawalTx = await this.adapter.withdrawYield(
          execution.subsequentWithdrawal.principalReturned,
          execution.yieldDeposit.protocol,
          execution.subsequentWithdrawal.grossYield,
          execution.subsequentWithdrawal.offsetBurnAmount,
          execution.subsequentWithdrawal.token
        )
        if (withdrawalTx.success) {
          carbonOffsetTx = {
            signature: withdrawalTx.signature,
            success: true,
            rawData: {
              action: 'WITHDRAW_AND_OFFSET',
              amount: execution.subsequentWithdrawal.offsetBurnAmount,
              grossYield: execution.subsequentWithdrawal.grossYield,
              netYield: execution.subsequentWithdrawal.netYield,
            },
          }
        }
      }

      const overallSuccess =
        yieldDepositTx.success && (withdrawalTx ? withdrawalTx.success : true)

      return {
        executionId: execution.executionId,
        carbonOffsetTx,
        yieldDepositTx,
        withdrawalTx,
        overallSuccess,
        reasoningLog,
      }
    }

    // 2. Legacy upfront execution mode
    let carbonOffsetTx: TxResult = {
      signature: 'skipped_zero_obligation',
      success: true,
      rawData: { note: 'Zero carbon offset required' },
    }

    if (execution.carbonOffset.amount > 0) {
      carbonOffsetTx = await this.adapter.offset(
        execution.carbonOffset.amount,
        execution.carbonOffset.token
      )

      if (!carbonOffsetTx.success) {
        return {
          executionId: execution.executionId,
          carbonOffsetTx,
          yieldDepositTx: {
            signature: '',
            success: false,
            error: 'Aborted: carbon offset step failed',
          },
          overallSuccess: false,
          reasoningLog: `${reasoningLog} [Execution aborted due to offset failure: ${carbonOffsetTx.error}]`,
        }
      }
    }

    // Execute yield deposit for remaining liquidity
    let yieldDepositTx: TxResult = {
      signature: 'skipped_zero_deposit',
      success: true,
      rawData: { note: 'Zero remaining liquidity for yield deposit' },
    }

    if (execution.yieldDeposit.amount > 0) {
      yieldDepositTx = await this.adapter.depositYield(
        execution.yieldDeposit.amount,
        execution.yieldDeposit.protocol
      )
    }

    const overallSuccess = carbonOffsetTx.success && yieldDepositTx.success

    return {
      executionId: execution.executionId,
      carbonOffsetTx,
      yieldDepositTx,
      overallSuccess,
      reasoningLog,
    }
  }

  /**
   * Execute from TerraYield execution payload
   */
  async executeFromPayload(
    payload: {
      execution_id: string
      carbon_offset_action: { allocation_usdc: number }
      yield_routing_action: {
        target_protocol: string
        allocation_usdc: number
        expected_apy: number
        offset_yield_percent?: number
      }
      subsequent_withdrawal_action?: {
        target_protocol?: string
        timeframe_months: number
        gross_yield_usdc: number
        offset_burn_usdc: number
        net_yield_usdc: number
        principal_returned_usdc: number
        total_user_payout_usdc?: number
        offset_yield_percent: number
      }
      reasoning_log: string
    },
    tokenMint: string = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  ): Promise<ExecutionResult> {
    const subsequentWithdrawal = payload.subsequent_withdrawal_action
      ? {
          timeframeMonths: payload.subsequent_withdrawal_action.timeframe_months,
          grossYield: payload.subsequent_withdrawal_action.gross_yield_usdc,
          offsetBurnAmount: payload.subsequent_withdrawal_action.offset_burn_usdc,
          netYield: payload.subsequent_withdrawal_action.net_yield_usdc,
          principalReturned: payload.subsequent_withdrawal_action.principal_returned_usdc,
          offsetYieldPercent: payload.subsequent_withdrawal_action.offset_yield_percent,
          token: tokenMint,
        }
      : undefined

    return this.execute(
      {
        executionId: payload.execution_id,
        carbonOffset: {
          amount: payload.carbon_offset_action.allocation_usdc,
          token: tokenMint,
        },
        yieldDeposit: {
          amount: payload.yield_routing_action.allocation_usdc,
          protocol: payload.yield_routing_action.target_protocol,
          expectedApy: payload.yield_routing_action.expected_apy,
          offsetYieldPercent: payload.yield_routing_action.offset_yield_percent,
        },
        subsequentWithdrawal,
      },
      payload.reasoning_log
    )
  }
}

