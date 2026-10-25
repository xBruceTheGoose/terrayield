import { NextRequest, NextResponse } from 'next/server'
import { ACTIONS_CORS_HEADERS } from '@solana/actions'
import { PublicKey } from '@solana/web3.js'
import { getNimService } from '@/services/nim-service'
import { getApyService } from '@/services/apy-service'
import { createMockAdapter } from '@/adapters/mock-adapter'
import { createSolanaWeb3Adapter } from '@/adapters/solana-adapter'
import { ExecutionRouter } from '@/adapters/execution-adapter'
import {
  YieldRouteInputSchema,
  TerraYieldExecutionSchema,
  TOKENIZED_CARBON_CREDIT_MINT,
  CARBON_PRICE_PER_KG_USDC,
} from '@/schemas/terrayield'
import { z } from 'zod'

/**
 * OPTIONS /api/actions/terrayield
 * Preflight handler required by Solana Actions specification for CORS.
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: ACTIONS_CORS_HEADERS,
  })
}

/**
 * GET /api/actions/terrayield
 * Returns Solana Action metadata for the Blink
 */
export async function GET(request: NextRequest) {
  const liveApys = await getApyService().getLatestApys()
  const topProtocol = liveApys[0] || { protocol: 'Kamino', apy: 11.2 }

  const url = new URL(request.url)
  const presetLiquidity = url.searchParams.get('total_liquidity') || '2500'
  const presetFootprint = url.searchParams.get('carbon_footprint_kg') || '150'
  const presetOffsetPct = url.searchParams.get('offset_yield_percent') || '13.8'
  const presetMonths = url.searchParams.get('timeframe_months') || '1'
  const presetDiversify = url.searchParams.get('diversify_positions') || 'true'

  const payload = {
    title: 'TerraYield: AI Eco-Arbitrage Middleware',
    icon: 'https://raw.githubusercontent.com/solana-labs/blinks/main/icons/earth.png',
    description: `Real-time Solana DeFi yield routing middleware (Top Live Rate: ${topProtocol.protocol} @ ${topProtocol.apy}% APY). Pre-commits a % of withdrawal yield to buy & burn tokenized carbon credits.`,
    label: 'Execute TerraYield',
    links: {
      actions: [
        {
          type: 'post',
          label: `Quick Route $${presetLiquidity} USDC (${presetOffsetPct}% Yield Pre-Commit)`,
          href: `/api/actions/terrayield?total_liquidity=${presetLiquidity}&carbon_footprint_kg=${presetFootprint}&offset_yield_percent=${presetOffsetPct}&timeframe_months=${presetMonths}&diversify_positions=${presetDiversify}`,
        },
        {
          type: 'post',
          label: 'Custom Eco-Yield Route',
          href: '/api/actions/terrayield',
          parameters: [
            {
              name: 'total_liquidity',
              label: 'Deposit Principal (USDC)',
              type: 'number',
              required: true,
              min: 1,
            },
            {
              name: 'carbon_footprint_kg',
              label: 'Monthly Carbon Footprint to Offset (kg CO2)',
              type: 'number',
              required: false,
              min: 0,
            },
            {
              name: 'offset_yield_percent',
              label: '% Offset Yield Pre-Committed to Withdrawal (0-100%, optional override)',
              type: 'number',
              required: false,
              min: 0,
              max: 100,
            },
            {
              name: 'timeframe_months',
              label: 'Yield Accrual Timeframe (Months)',
              type: 'number',
              required: false,
              min: 1,
            },
          ],
        },
      ],
    },
  }

  return NextResponse.json(payload, {
    headers: ACTIONS_CORS_HEADERS,
  })
}

/**
 * POST /api/actions/terrayield
 * Executes the TerraYield reasoning and returns transaction data
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => ({}))
    const url = new URL(request.url)

    // Support both Solana Blink payloads ({ account, data }), URL query params, and direct REST bodies
    const accountStr = rawBody.account || rawBody.accountPubkey || null
    const paramData = rawBody.data || rawBody

    // Coerce values to handle numeric strings from form submissions or Blink query strings
    const totalLiquidityRaw =
      paramData.total_liquidity ?? url.searchParams.get('total_liquidity') ?? 500
    const offsetObligationRaw =
      paramData.offset_obligation ?? url.searchParams.get('offset_obligation')
    const offsetYieldPercentRaw =
      paramData.offset_yield_percent ?? url.searchParams.get('offset_yield_percent')
    const carbonFootprintKgRaw =
      paramData.carbon_footprint_kg ?? url.searchParams.get('carbon_footprint_kg')
    const diversifyPositionsRaw =
      paramData.diversify_positions ?? url.searchParams.get('diversify_positions')
    const timeframeMonthsRaw =
      paramData.timeframe_months ?? url.searchParams.get('timeframe_months') ?? 1
    const apysRaw = paramData.apys

    const total_liquidity =
      typeof totalLiquidityRaw === 'number'
        ? totalLiquidityRaw
        : parseFloat(totalLiquidityRaw) || 500

    let offset_yield_percent: number | undefined = undefined
    if (offsetYieldPercentRaw !== undefined && offsetYieldPercentRaw !== null && offsetYieldPercentRaw !== '') {
      offset_yield_percent =
        typeof offsetYieldPercentRaw === 'number'
          ? offsetYieldPercentRaw
          : parseFloat(offsetYieldPercentRaw)
    }

    let carbon_footprint_kg: number | undefined = undefined
    if (carbonFootprintKgRaw !== undefined && carbonFootprintKgRaw !== null && carbonFootprintKgRaw !== '') {
      carbon_footprint_kg =
        typeof carbonFootprintKgRaw === 'number'
          ? carbonFootprintKgRaw
          : parseFloat(carbonFootprintKgRaw)
    }

    const diversify_positions = Boolean(diversifyPositionsRaw)

    let offset_obligation: number | undefined = undefined
    if (offset_yield_percent === undefined && offsetObligationRaw !== undefined && offsetObligationRaw !== null && offsetObligationRaw !== '') {
      offset_obligation =
        typeof offsetObligationRaw === 'number'
          ? offsetObligationRaw
          : parseFloat(offsetObligationRaw) || 0
    }

    const timeframe_months =
      typeof timeframeMonthsRaw === 'number'
        ? timeframeMonthsRaw
        : parseFloat(timeframeMonthsRaw) || 1

    // Parse APYs whether provided as array or JSON string, or fetch from live cached oracle
    let current_apys: { protocol: string; apy: number }[] = await getApyService().getLatestApys()

    if (apysRaw) {
      if (Array.isArray(apysRaw)) {
        current_apys = apysRaw
      } else if (typeof apysRaw === 'string' && apysRaw.trim().length > 0) {
        try {
          const parsed = JSON.parse(apysRaw)
          if (Array.isArray(parsed) && parsed.length > 0) {
            current_apys = parsed
          }
        } catch {
          return NextResponse.json(
            {
              error:
                'Invalid APYs format. Expected array or JSON string: [{"protocol":"Kamino","apy":8.4}]',
            },
            { status: 400, headers: ACTIONS_CORS_HEADERS }
          )
        }
      }
    }

    // Validate with Zod schema
    const validatedInput = YieldRouteInputSchema.parse({
      total_liquidity,
      offset_obligation,
      offset_yield_percent,
      carbon_footprint_kg,
      diversify_positions,
      timeframe_months,
      current_apys,
    })

    // 1. Run NIM reasoning engine
    const nimService = getNimService()
    const execution = await nimService.generateYieldRoute(validatedInput)

    // 2. Validate output schema
    const validatedExecution = TerraYieldExecutionSchema.parse(execution)

    // 3. Execute via mock adapter (harness-agnostic execution layer)
    const mockAdapter = createMockAdapter()
    const router = new ExecutionRouter(mockAdapter)
    const result = await router.executeFromPayload(validatedExecution)

    const message = validatedExecution.subsequent_withdrawal_action
      ? `TerraYield Pre-Commitment Decision:
💰 100% Principal Deposit: $${validatedExecution.yield_routing_action.allocation_usdc.toFixed(2)} USDC → ${validatedExecution.yield_routing_action.target_protocol} (${validatedExecution.yield_routing_action.expected_apy}% APY)
🔒 Pre-Commitment: ${validatedExecution.yield_routing_action.offset_yield_percent}% of subsequent withdrawal's yield auto-committed to tokenized carbon credits
🔄 Subsequent Withdrawal (${validatedExecution.subsequent_withdrawal_action.timeframe_months} mo):
   • Gross Yield: $${validatedExecution.subsequent_withdrawal_action.gross_yield_usdc.toFixed(2)} USDC
   • 🌿 Tokenized Carbon Burn: $${validatedExecution.subsequent_withdrawal_action.offset_burn_usdc.toFixed(2)} USDC (~${Math.round(validatedExecution.subsequent_withdrawal_action.offset_burn_usdc / CARBON_PRICE_PER_KG_USDC)} kg CO₂)
   • 💵 Net User Yield: $${validatedExecution.subsequent_withdrawal_action.net_yield_usdc.toFixed(2)} USDC
   • 🏦 Total Payout: $${validatedExecution.subsequent_withdrawal_action.total_user_payout_usdc.toFixed(2)} USDC

RATIONALE: ${validatedExecution.reasoning_log}`
      : `TerraYield Decision:
🌿 Carbon Offset: $${validatedExecution.carbon_offset_action.allocation_usdc.toFixed(2)} → ${validatedExecution.carbon_offset_action.action_type}
💰 Yield Deposit: $${validatedExecution.yield_routing_action.allocation_usdc.toFixed(2)} → ${validatedExecution.yield_routing_action.target_protocol} (${validatedExecution.yield_routing_action.expected_apy}% APY)

RATIONALE: ${validatedExecution.reasoning_log}`

    // 4. Build serialized Solana transaction with optimal yield routing + pre-commitment instruction
    let resolvedPubkeyStr = '11111111111111111111111111111111'
    if (accountStr) {
      try {
        resolvedPubkeyStr = new PublicKey(accountStr).toBase58()
      } catch {
        // Fallback to simulation pubkey if invalid account string provided
      }
    }

    const web3Adapter = createSolanaWeb3Adapter({ payerPublicKey: resolvedPubkeyStr })
    const positions = validatedExecution.yield_positions || [
      {
        protocol: validatedExecution.yield_routing_action.target_protocol,
        allocation_usdc: validatedExecution.yield_routing_action.allocation_usdc,
        share_percent: 100,
        expected_apy: validatedExecution.yield_routing_action.expected_apy,
      },
    ]
    const delegatedPct =
      validatedExecution.yield_routing_action.offset_yield_percent ??
      validatedExecution.subsequent_withdrawal_action?.offset_yield_percent ??
      0
    const estimatedBurnUsdc =
      validatedExecution.subsequent_withdrawal_action?.offset_burn_usdc ??
      validatedExecution.carbon_offset_action.allocation_usdc
    const estimatedCreditsKgCo2 = Math.round(estimatedBurnUsdc / CARBON_PRICE_PER_KG_USDC)

    const builtTx = await web3Adapter.buildPreCommittedTransaction({
      executionId: validatedExecution.execution_id,
      positions,
      totalPrincipalUsdc: validatedExecution.yield_routing_action.allocation_usdc,
      weightedApy: validatedExecution.yield_routing_action.expected_apy,
      delegatedYieldPercent: delegatedPct,
      estimatedBurnUsdc,
      estimatedCreditsKgCo2,
      carbonCreditMint:
        validatedExecution.pre_commitment?.carbon_credit_token_mint ??
        TOKENIZED_CARBON_CREDIT_MINT,
    })

    const responsePayload: Record<string, unknown> = {
      type: 'transaction',
      message,
      transaction: builtTx.transactionBase64,
      execution: {
        execution_id: validatedExecution.execution_id,
        live_apys: current_apys,
        carbon_offset: validatedExecution.carbon_offset_action,
        yield_routing: validatedExecution.yield_routing_action,
        yield_positions: positions,
        pre_commitment: validatedExecution.pre_commitment ?? {
          commitment_type: 'YIELD_SPLIT_ON_WITHDRAWAL',
          delegated_yield_percent: delegatedPct,
          carbon_credit_token_mint: TOKENIZED_CARBON_CREDIT_MINT,
          estimated_credits_kg_co2: estimatedCreditsKgCo2,
          estimated_burn_usdc: estimatedBurnUsdc,
        },
        subsequent_withdrawal: validatedExecution.subsequent_withdrawal_action,
        reasoning_log: validatedExecution.reasoning_log,
        transaction_signatures: {
          carbon_offset: result.carbonOffsetTx.signature,
          yield_deposit: result.yieldDepositTx.signature,
          subsequent_withdrawal: result.withdrawalTx?.signature,
        },
        transaction_details: {
          transaction_base64: builtTx.transactionBase64,
          fee_payer: builtTx.feePayer,
          recent_blockhash: builtTx.recentBlockhash,
          estimated_fee_sol: builtTx.estimatedFeeSol,
          instructions: builtTx.instructions,
        },
        success: result.overallSuccess,
      },
    }

    return NextResponse.json(responsePayload, {
      headers: ACTIONS_CORS_HEADERS,
    })
  } catch (error) {
    console.error('[TerraYield API] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400, headers: ACTIONS_CORS_HEADERS }
      )
    }

    if (error instanceof Error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: ACTIONS_CORS_HEADERS }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: ACTIONS_CORS_HEADERS }
    )
  }
}
