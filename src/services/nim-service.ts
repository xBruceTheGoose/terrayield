import OpenAI from 'openai'
import {
  TerraYieldExecutionSchema,
  YieldRouteInput,
  TerraYieldExecution,
  YieldPositionAllocation,
  CARBON_PRICE_PER_KG_USDC,
  TOKENIZED_CARBON_CREDIT_MINT,
  calculateSuggestedYieldDelegation,
} from '../schemas/terrayield'
import { v4 as uuidv4, validate as uuidValidate } from 'uuid'

/**
 * System prompt for the TerraYield reasoning engine as specified in instructions
 */
export const SYSTEM_PROMPT = `You are the TerraYield reasoning engine, an autonomous DeFi agent. Your mandate is to balance yield maximization with automated climate action.

Core Routing Mandates:
1. Yield Maximization & Capital Preservation:
   - When a percentage offset yield is pre-committed (offset_yield_percent): Allocate 100% of the total liquidity into the highest-yielding protocol so the user's principal is never impaired upfront.
   - When an upfront offset obligation is explicitly requested without a percentage: Deduct that dollar obligation from total liquidity and allocate the remainder to the highest APY protocol.
2. Pre-Commitment to Subsequent Withdrawal:
   - The % offset yield is pre-committed to the subsequent withdrawal's yield.
   - Upon subsequent withdrawal / harvest, the pre-committed % of accrued yield is burned for carbon credits (BUY_AND_BURN), and 100% of principal plus net yield is returned to the user.
3. Protocol Selection: Select the protocol with the highest APY from current APYs.
4. Output format: Output ONLY valid JSON matching the exact schema required. Do not include markdown formatting or preamble.

Required JSON Output Structure:
{
  "execution_id": "<uuid>",
  "carbon_offset_action": {
    "action_type": "BUY_AND_BURN",
    "allocation_usdc": 2.04
  },
  "yield_routing_action": {
    "action_type": "DEPOSIT_LIQUIDITY",
    "target_protocol": "Kamino",
    "allocation_usdc": 1000.00,
    "expected_apy": 9.8,
    "offset_yield_percent": 25.0
  },
  "subsequent_withdrawal_action": {
    "action_type": "WITHDRAW_AND_OFFSET",
    "target_protocol": "Kamino",
    "timeframe_months": 1,
    "gross_yield_usdc": 8.17,
    "offset_burn_usdc": 2.04,
    "net_yield_usdc": 6.13,
    "principal_returned_usdc": 1000.00,
    "total_user_payout_usdc": 1006.13,
    "offset_yield_percent": 25.0
  },
  "reasoning_log": "<1-2 sentence explanation for the UI>"
}`

/**
 * Creates the user prompt with the input data
 */
export function createUserPrompt(input: YieldRouteInput): string {
  const apyList = input.current_apys
    .map((a) => `- ${a.protocol}: ${a.apy}% APY`)
    .join('\n')

  const footprintInfo =
    input.carbon_footprint_kg !== undefined
      ? `\nEstimated Carbon Footprint: ${input.carbon_footprint_kg} kg CO2 ($${(input.carbon_footprint_kg * CARBON_PRICE_PER_KG_USDC).toFixed(2)} USDC tokenized credit cost)`
      : ''

  const offsetDesc =
    input.offset_yield_percent !== undefined
      ? `Pre-committed Offset Yield: ${input.offset_yield_percent}% of subsequent withdrawal's yield (Timeframe: ${input.timeframe_months ?? 1} month(s))${footprintInfo}`
      : `Carbon Offset Obligation: $${input.offset_obligation ?? 0} USD${footprintInfo}`

  return `Total Liquidity: $${input.total_liquidity} USDC
${offsetDesc}
Current APYs:
${apyList}

Calculate the optimal routing across yield positions with pre-committed subsequent withdrawal yield allocated to tokenized carbon credits, and return the JSON execution payload.`
}

/**
 * Deterministic fallback routing logic when NIM is in simulation mode or offline
 */
export function generateDeterministicRoute(input: YieldRouteInput): TerraYieldExecution {
  // Find protocol(s) sorted by highest APY
  const sortedApys = [...input.current_apys].sort((a, b) => b.apy - a.apy)
  const bestProtocol = sortedApys[0] || { protocol: 'Kamino', apy: 8.4 }

  // Determine optimal yield position allocations (single optimal vault or diversified top-2 split)
  const shouldDiversify = Boolean(input.diversify_positions && sortedApys.length >= 2)
  const yieldPositions: YieldPositionAllocation[] = shouldDiversify
    ? [
        {
          protocol: sortedApys[0].protocol,
          allocation_usdc: Number((input.total_liquidity * 0.7).toFixed(2)),
          share_percent: 70,
          expected_apy: sortedApys[0].apy,
        },
        {
          protocol: sortedApys[1].protocol,
          allocation_usdc: Number(
            (input.total_liquidity - Number((input.total_liquidity * 0.7).toFixed(2))).toFixed(2)
          ),
          share_percent: 30,
          expected_apy: sortedApys[1].apy,
        },
      ]
    : [
        {
          protocol: bestProtocol.protocol,
          allocation_usdc: Number(input.total_liquidity.toFixed(2)),
          share_percent: 100,
          expected_apy: bestProtocol.apy,
        },
      ]

  const effectiveApy = shouldDiversify
    ? Number(((sortedApys[0].apy * 0.7 + sortedApys[1].apy * 0.3)).toFixed(2))
    : bestProtocol.apy

  const targetProtocolLabel = shouldDiversify
    ? `${sortedApys[0].protocol} (70%) + ${sortedApys[1].protocol} (30%)`
    : bestProtocol.protocol

  // Check if user specified % offset yield or carbon footprint for pre-committed subsequent withdrawal
  if (input.offset_yield_percent !== undefined || input.carbon_footprint_kg !== undefined) {
    const timeframeMonths = input.timeframe_months ?? 1
    const suggestion =
      input.carbon_footprint_kg !== undefined
        ? calculateSuggestedYieldDelegation({
            carbonFootprintKg: input.carbon_footprint_kg,
            totalLiquidity: input.total_liquidity,
            apyPercent: effectiveApy,
            timeframeMonths,
          })
        : undefined

    const effectiveOffsetPct =
      input.offset_yield_percent !== undefined
        ? input.offset_yield_percent
        : (suggestion?.suggestedYieldPercent ?? 25)

    const grossYield = Number(
      (input.total_liquidity * (effectiveApy / 100) * (timeframeMonths / 12)).toFixed(2)
    )
    const offsetBurn = Number(
      (grossYield * (effectiveOffsetPct / 100)).toFixed(2)
    )
    const netYield = Number((grossYield - offsetBurn).toFixed(2))
    const totalUserPayout = Number((input.total_liquidity + netYield).toFixed(2))
    const estimatedCreditsKgCo2 = Math.round(offsetBurn / CARBON_PRICE_PER_KG_USDC)

    return {
      execution_id: uuidv4(),
      carbon_offset_action: {
        action_type: 'BUY_AND_BURN',
        allocation_usdc: offsetBurn,
      },
      yield_routing_action: {
        action_type: 'DEPOSIT_LIQUIDITY',
        target_protocol: targetProtocolLabel,
        allocation_usdc: Number(input.total_liquidity.toFixed(2)),
        expected_apy: effectiveApy,
        offset_yield_percent: effectiveOffsetPct,
      },
      yield_positions: yieldPositions,
      pre_commitment: {
        commitment_type: 'YIELD_SPLIT_ON_WITHDRAWAL',
        delegated_yield_percent: effectiveOffsetPct,
        carbon_credit_token_mint: TOKENIZED_CARBON_CREDIT_MINT,
        estimated_credits_kg_co2: estimatedCreditsKgCo2,
        estimated_burn_usdc: offsetBurn,
        suggested_yield_percent: suggestion?.suggestedYieldPercent,
        target_footprint_kg_co2: input.carbon_footprint_kg,
      },
      subsequent_withdrawal_action: {
        action_type: 'WITHDRAW_AND_OFFSET',
        target_protocol: targetProtocolLabel,
        timeframe_months: timeframeMonths,
        gross_yield_usdc: grossYield,
        offset_burn_usdc: offsetBurn,
        net_yield_usdc: netYield,
        principal_returned_usdc: Number(input.total_liquidity.toFixed(2)),
        total_user_payout_usdc: totalUserPayout,
        offset_yield_percent: effectiveOffsetPct,
      },
      reasoning_log: `Pre-committed ${effectiveOffsetPct}% of yield to buy & burn tokenized carbon credits (~${estimatedCreditsKgCo2} kg CO₂) upon withdrawal. 100% of principal ($${input.total_liquidity.toFixed(2)} USDC) routes to ${targetProtocolLabel} at ${effectiveApy}% APY. Over ${timeframeMonths} mo, projected gross yield is $${grossYield.toFixed(2)} USDC ($${offsetBurn.toFixed(2)} carbon burn + $${netYield.toFixed(2)} net user yield).`,
    }
  }

  // Legacy fallback when only absolute dollar offset_obligation is provided
  const offsetAllocation = Math.min(input.offset_obligation ?? 0, input.total_liquidity)
  const remainingLiquidity = Math.max(0, input.total_liquidity - offsetAllocation)

  return {
    execution_id: uuidv4(),
    carbon_offset_action: {
      action_type: 'BUY_AND_BURN',
      allocation_usdc: Number(offsetAllocation.toFixed(2)),
    },
    yield_routing_action: {
      action_type: 'DEPOSIT_LIQUIDITY',
      target_protocol: bestProtocol.protocol,
      allocation_usdc: Number(remainingLiquidity.toFixed(2)),
      expected_apy: bestProtocol.apy,
    },
    reasoning_log: `Allocated $${offsetAllocation.toFixed(2)} to on-chain carbon offset (BUY_AND_BURN) and routed remaining $${remainingLiquidity.toFixed(2)} USDC to ${bestProtocol.protocol} at ${bestProtocol.apy}% APY.`,
  }
}

/**
 * Validates and repairs the NIM response, handling markdown blocks,
 * missing UUIDs, and malformed wrapper text.
 */
export function parseNimResponse(rawResponse: string): TerraYieldExecution {
  let parsedObject: Record<string, unknown> | null = null

  // 1. Try direct JSON parse
  try {
    parsedObject = JSON.parse(rawResponse)
  } catch {
    // 2. Try markdown extraction (```json ... ``` or ``` ... ```)
    const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (jsonMatch) {
      try {
        parsedObject = JSON.parse(jsonMatch[1])
      } catch {
        // Continue to regex object finder
      }
    }

    // 3. Try to locate first '{' and last '}'
    if (!parsedObject) {
      const firstBrace = rawResponse.indexOf('{')
      const lastBrace = rawResponse.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          parsedObject = JSON.parse(rawResponse.slice(firstBrace, lastBrace + 1))
        } catch {
          // Fall through
        }
      }
    }
  }

  if (!parsedObject || typeof parsedObject !== 'object') {
    throw new Error(
      `Failed to parse valid JSON from NIM response: ${rawResponse.slice(0, 200)}`
    )
  }

  // 4. Inject or fix execution_id if placeholder or invalid UUID
  const rawId = (parsedObject as Record<string, unknown>).execution_id
  if (
    !rawId ||
    typeof rawId !== 'string' ||
    rawId === '<uuid>' ||
    !uuidValidate(rawId)
  ) {
    ;(parsedObject as Record<string, unknown>).execution_id = uuidv4()
  }

  // 5. Parse through Zod schema
  return TerraYieldExecutionSchema.parse(parsedObject)
}

/**
 * NVIDIA NIM Service for TerraYield reasoning
 */
export class NimService {
  private client: OpenAI | null = null
  private isSimulationMode = false

  constructor() {
    const apiKey = process.env.NVIDIA_API_KEY
    if (!apiKey || apiKey === 'your_nvidia_api_key_here') {
      console.warn(
        '[NimService] No valid NVIDIA_API_KEY found; operating in deterministic simulation mode.'
      )
      this.isSimulationMode = true
    } else {
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      })
    }
  }

  /**
   * Generates a yield routing decision using NVIDIA NIM (or simulation fallback)
   */
  async generateYieldRoute(input: YieldRouteInput): Promise<TerraYieldExecution> {
    if (this.isSimulationMode || !this.client) {
      return generateDeterministicRoute(input)
    }

    const userPrompt = createUserPrompt(input)

    try {
      const completion = await this.client.chat.completions.create({
        model: 'meta/llama-3.1-70b-instruct',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 600,
      })

      const rawResponse = completion.choices[0]?.message?.content
      if (!rawResponse) {
        throw new Error('Empty response from NVIDIA NIM')
      }

      const execution = parseNimResponse(rawResponse)

      // Post-validation: ensure allocations reconcile to total liquidity
      if (input.offset_yield_percent !== undefined) {
        // In pre-commitment mode, 100% of liquidity is deposited into the protocol to maximize yield
        execution.yield_routing_action.allocation_usdc = input.total_liquidity
      } else {
        const totalAllocated =
          execution.carbon_offset_action.allocation_usdc +
          execution.yield_routing_action.allocation_usdc

        // If NIM had slight rounding error, adjust the yield portion to preserve conservation of capital
        if (Math.abs(totalAllocated - input.total_liquidity) > 0.001) {
          execution.yield_routing_action.allocation_usdc = Number(
            (input.total_liquidity - execution.carbon_offset_action.allocation_usdc).toFixed(2)
          )
        }
      }

      return execution
    } catch (error) {
      console.warn(
        '[NimService] Error querying NVIDIA NIM, falling back to deterministic route:',
        error
      )
      return generateDeterministicRoute(input)
    }
  }
}

/**
 * Singleton instance getter
 */
let nimServiceInstance: NimService | null = null

export function getNimService(): NimService {
  if (!nimServiceInstance) {
    nimServiceInstance = new NimService()
  }
  return nimServiceInstance
}
