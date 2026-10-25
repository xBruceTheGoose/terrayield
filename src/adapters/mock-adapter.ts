import { ExecutionAdapter, TxResult } from './execution-adapter'

/**
 * Mock Execution Adapter for local testing, hackathon demonstrations, and simulations.
 * Emits detailed logs and simulates network confirmation latency without broadcasting real transactions.
 */
export class MockExecutionAdapter implements ExecutionAdapter {
  private delay: number
  private shouldSucceed: boolean

  constructor(options: { delay?: number; shouldSucceed?: boolean } = {}) {
    this.delay = options.delay ?? 100 // Simulate Solana network confirmation latency
    this.shouldSucceed = options.shouldSucceed ?? true
  }

  private async simulateDelay(): Promise<void> {
    if (this.delay > 0) {
      return new Promise((resolve) => setTimeout(resolve, this.delay))
    }
  }

  private generateMockSignature(action: string): string {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let randomPart = ''
    for (let i = 0; i < 44; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return `sim_${action}_${randomPart}`
  }

  async offset(amount: number, token: string): Promise<TxResult> {
    await this.simulateDelay()

    console.log(
      `[MockAdapter] 🌿 CARBON OFFSET: Buying & burning ${amount.toFixed(2)} USDC (${token}) for on-chain carbon credits`
    )

    if (!this.shouldSucceed) {
      return {
        signature: '',
        success: false,
        error: 'Simulation failure: carbon offset transaction rejected by cluster',
      }
    }

    const signature = this.generateMockSignature('offset')
    console.log(`[MockAdapter] ✅ Carbon offset successful: ${signature}`)

    return {
      signature,
      success: true,
      rawData: {
        action: 'BUY_AND_BURN',
        amount,
        token,
        impactEstimateKgCo2: Math.round(amount * 50), // Approx. 50 kg CO2 offset per $1
      },
    }
  }

  async depositYield(
    amount: number,
    protocol: string,
    precommitOffsetPct?: number
  ): Promise<TxResult> {
    await this.simulateDelay()

    const commitmentNote =
      precommitOffsetPct !== undefined
        ? ` (Pre-committed ${precommitOffsetPct}% of subsequent yield to carbon offset)`
        : ''

    console.log(
      `[MockAdapter] 💰 YIELD DEPOSIT: Depositing ${amount.toFixed(2)} USDC liquidity into ${protocol}${commitmentNote}`
    )

    if (!this.shouldSucceed) {
      return {
        signature: '',
        success: false,
        error: `Simulation failure: failed to deposit liquidity into ${protocol}`,
      }
    }

    const signature = this.generateMockSignature('yield')
    console.log(`[MockAdapter] ✅ Yield deposit successful: ${signature}`)

    return {
      signature,
      success: true,
      rawData: { action: 'DEPOSIT_LIQUIDITY', amount, protocol, precommitOffsetPct },
    }
  }

  async withdrawYield(
    principalAmount: number,
    protocol: string,
    grossYield: number,
    offsetBurnAmount: number,
    token: string
  ): Promise<TxResult> {
    await this.simulateDelay()

    console.log(
      `[MockAdapter] 🔄 SUBSEQUENT WITHDRAWAL: Harvesting from ${protocol} | Principal: ${principalAmount.toFixed(2)} USDC | Gross Yield: ${grossYield.toFixed(2)} USDC`
    )
    console.log(
      `[MockAdapter] 🌿 PRE-COMMITTED YIELD OFFSET: Buying & burning ${offsetBurnAmount.toFixed(2)} USDC (${token}) for on-chain carbon credits`
    )
    console.log(
      `[MockAdapter] 💵 USER PAYOUT: Returning ${principalAmount.toFixed(2)} USDC principal + ${(grossYield - offsetBurnAmount).toFixed(2)} USDC net yield`
    )

    if (!this.shouldSucceed) {
      return {
        signature: '',
        success: false,
        error: `Simulation failure: failed to execute subsequent withdrawal from ${protocol}`,
      }
    }

    const signature = this.generateMockSignature('withdraw')
    console.log(`[MockAdapter] ✅ Subsequent withdrawal & offset successful: ${signature}`)

    return {
      signature,
      success: true,
      rawData: {
        action: 'WITHDRAW_AND_OFFSET',
        principalAmount,
        grossYield,
        offsetBurnAmount,
        netYield: Number((grossYield - offsetBurnAmount).toFixed(2)),
        totalPayout: Number((principalAmount + (grossYield - offsetBurnAmount)).toFixed(2)),
        token,
        impactEstimateKgCo2: Math.round(offsetBurnAmount * 50),
      },
    }
  }
}

/**
 * Factory function to create mock adapter
 */
export function createMockAdapter(options?: {
  delay?: number
  shouldSucceed?: boolean
}): MockExecutionAdapter {
  return new MockExecutionAdapter(options)
}
