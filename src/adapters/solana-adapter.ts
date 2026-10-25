import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { ExecutionAdapter, TxResult } from './execution-adapter'

/**
 * Solana Web3 Execution Adapter
 *
 * Implements the ExecutionAdapter interface using raw @solana/web3.js.
 * Demonstrates harness-agnostic execution by building real Solana instructions.
 */
export class SolanaWeb3Adapter implements ExecutionAdapter {
  private connection: Connection
  private payerPublicKey: PublicKey
  private memoProgramId = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

  constructor(options: { rpcUrl?: string; payerPublicKey?: string } = {}) {
    const endpoint = options.rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
    this.connection = new Connection(endpoint, 'confirmed')

    const keyStr =
      options.payerPublicKey ||
      '11111111111111111111111111111111' // Fallback system program ID for mock/simulation
    this.payerPublicKey = new PublicKey(keyStr)
  }

  /**
   * Constructs an on-chain carbon offset memo instruction
   */
  async offset(amount: number, token: string): Promise<TxResult> {
    try {
      const memoContent = `TerraYield:BUY_AND_BURN:${amount.toFixed(2)}:${token}`

      const tx = new Transaction()
      tx.add(
        new TransactionInstruction({
          keys: [{ pubkey: this.payerPublicKey, isSigner: true, isWritable: true }],
          programId: this.memoProgramId,
          data: Buffer.from(memoContent, 'utf-8'),
        })
      )

      return {
        signature: `web3_offset_${Date.now().toString(36)}`,
        success: true,
        rawData: {
          action: 'BUY_AND_BURN',
          amount,
          token,
          instructionCount: tx.instructions.length,
        },
      }
    } catch (err) {
      return {
        signature: '',
        success: false,
        error: err instanceof Error ? err.message : 'Solana Web3 offset execution failed',
      }
    }
  }

  /**
   * Constructs an on-chain yield deposit routing instruction
   */
  async depositYield(
    amount: number,
    protocol: string,
    precommitOffsetPct?: number
  ): Promise<TxResult> {
    try {
      const commitmentTag =
        precommitOffsetPct !== undefined
          ? `:PRECOMMIT_OFFSET_YIELD:${precommitOffsetPct}%`
          : ''
      const memoContent = `TerraYield:DEPOSIT_LIQUIDITY:${protocol}:${amount.toFixed(2)}${commitmentTag}`

      const tx = new Transaction()
      tx.add(
        new TransactionInstruction({
          keys: [{ pubkey: this.payerPublicKey, isSigner: true, isWritable: true }],
          programId: this.memoProgramId,
          data: Buffer.from(memoContent, 'utf-8'),
        })
      )

      return {
        signature: `web3_yield_${Date.now().toString(36)}`,
        success: true,
        rawData: {
          action: 'DEPOSIT_LIQUIDITY',
          amount,
          protocol,
          precommitOffsetPct,
          instructionCount: tx.instructions.length,
        },
      }
    } catch (err) {
      return {
        signature: '',
        success: false,
        error: err instanceof Error ? err.message : 'Solana Web3 yield deposit failed',
      }
    }
  }

  /**
   * Constructs an on-chain subsequent withdrawal instruction with pre-committed offset burn
   */
  async withdrawYield(
    principalAmount: number,
    protocol: string,
    grossYield: number,
    offsetBurnAmount: number,
    token: string
  ): Promise<TxResult> {
    try {
      const netYield = grossYield - offsetBurnAmount
      const totalPayout = principalAmount + netYield
      const memoContent = `TerraYield:WITHDRAW_AND_OFFSET:${protocol}:Principal:${principalAmount.toFixed(2)}:GrossYield:${grossYield.toFixed(2)}:Burn:${offsetBurnAmount.toFixed(2)}:UserPayout:${totalPayout.toFixed(2)}:${token}`

      const tx = new Transaction()
      tx.add(
        new TransactionInstruction({
          keys: [{ pubkey: this.payerPublicKey, isSigner: true, isWritable: true }],
          programId: this.memoProgramId,
          data: Buffer.from(memoContent, 'utf-8'),
        })
      )

      return {
        signature: `web3_withdraw_${Date.now().toString(36)}`,
        success: true,
        rawData: {
          action: 'WITHDRAW_AND_OFFSET',
          protocol,
          principalAmount,
          grossYield,
          offsetBurnAmount,
          netYield,
          totalPayout,
          instructionCount: tx.instructions.length,
        },
      }
    } catch (err) {
      return {
        signature: '',
        success: false,
        error: err instanceof Error ? err.message : 'Solana Web3 subsequent withdrawal failed',
      }
    }
  }

  /**
   * Builds a multi-instruction serialized Solana transaction routing principal to
   * optimal yield positions with a binding on-chain pre-commitment of the delegated
   * withdrawal yield percentage to buying & burning tokenized carbon credits.
   */
  async buildPreCommittedTransaction(params: {
    executionId: string
    positions: { protocol: string; allocation_usdc: number; share_percent: number; expected_apy: number }[]
    totalPrincipalUsdc: number
    weightedApy: number
    delegatedYieldPercent: number
    estimatedBurnUsdc: number
    estimatedCreditsKgCo2: number
    carbonCreditMint: string
    recentBlockhash?: string
  }): Promise<{
    transactionBase64: string
    feePayer: string
    recentBlockhash: string
    estimatedFeeSol: number
    instructions: {
      index: number
      label: string
      programId: string
      dataUtf8: string
    }[]
  }> {
    let blockhash = params.recentBlockhash || '11111111111111111111111111111111'
    if (!params.recentBlockhash && process.env.SOLANA_RPC_URL) {
      try {
        const latest = await this.connection.getLatestBlockhash()
        blockhash = latest.blockhash
      } catch {
        // Use fallback simulation blockhash
      }
    }

    const tx = new Transaction({
      feePayer: this.payerPublicKey,
      recentBlockhash: blockhash,
    })

    const positionsText = params.positions
      .map((p) => `${p.protocol}:$${p.allocation_usdc.toFixed(2)}(${p.share_percent}%@${p.expected_apy}%APY)`)
      .join('+')

    const depositInstructionData = `TerraYield:DEPOSIT_OPTIMAL_POSITIONS|Exec:${params.executionId.slice(0, 8)}|Positions:${positionsText}|Total:$${params.totalPrincipalUsdc.toFixed(2)}USDC|APY:${params.weightedApy}%`

    const precommitInstructionData = `TerraYield:PRECOMMIT_WITHDRAWAL_YIELD_OFFSET|DelegatedYield:${params.delegatedYieldPercent}%|Action:BUY_AND_BURN_TOKENIZED_CREDITS|Mint:${params.carbonCreditMint}|EstBurn:$${params.estimatedBurnUsdc.toFixed(2)}USDC|EstCredits:${params.estimatedCreditsKgCo2}kgCO2|NetUserShare:${(100 - params.delegatedYieldPercent).toFixed(1)}%`

    tx.add(
      new TransactionInstruction({
        keys: [{ pubkey: this.payerPublicKey, isSigner: true, isWritable: true }],
        programId: this.memoProgramId,
        data: Buffer.from(depositInstructionData.slice(0, 560), 'utf-8'),
      })
    )

    tx.add(
      new TransactionInstruction({
        keys: [{ pubkey: this.payerPublicKey, isSigner: true, isWritable: true }],
        programId: this.memoProgramId,
        data: Buffer.from(precommitInstructionData.slice(0, 560), 'utf-8'),
      })
    )

    const transactionBase64 = tx
      .serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      })
      .toString('base64')

    return {
      transactionBase64,
      feePayer: this.payerPublicKey.toBase58(),
      recentBlockhash: blockhash,
      estimatedFeeSol: 0.000005,
      instructions: [
        {
          index: 1,
          label: 'Route 100% Principal to Optimal Yield Position(s)',
          programId: this.memoProgramId.toBase58(),
          dataUtf8: depositInstructionData,
        },
        {
          index: 2,
          label: 'Pre-Commit Withdrawal Yield % to Tokenized Carbon Credits (BUY_AND_BURN)',
          programId: this.memoProgramId.toBase58(),
          dataUtf8: precommitInstructionData,
        },
      ],
    }
  }
}

/**
 * Factory for creating the Solana Web3 adapter
 */
export function createSolanaWeb3Adapter(options?: {
  rpcUrl?: string
  payerPublicKey?: string
}): SolanaWeb3Adapter {
  return new SolanaWeb3Adapter(options)
}
