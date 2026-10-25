import { z } from 'zod'

/**
 * Standard tokenized carbon credit rate: $20 / metric ton CO2 = $0.02 / kg CO2
 */
export const CARBON_PRICE_PER_KG_USDC = 0.02
export const TOKENIZED_CARBON_CREDIT_MINT = 'CarbCreditNCT111111111111111111111111111111'

/**
 * Carbon offset action schema
 */
export const CarbonOffsetActionSchema = z.object({
  action_type: z.literal('BUY_AND_BURN'),
  allocation_usdc: z.number().nonnegative(),
})

/**
 * Yield routing action schema
 */
export const YieldRoutingActionSchema = z.object({
  action_type: z.literal('DEPOSIT_LIQUIDITY'),
  target_protocol: z.string().min(1),
  allocation_usdc: z.number().nonnegative(),
  expected_apy: z.number().nonnegative(),
  offset_yield_percent: z.number().min(0).max(100).optional(),
})

/**
 * Individual optimal yield position allocation schema
 */
export const YieldPositionAllocationSchema = z.object({
  protocol: z.string().min(1),
  allocation_usdc: z.number().nonnegative(),
  share_percent: z.number().min(0).max(100),
  expected_apy: z.number().nonnegative(),
})

/**
 * On-chain pre-commitment instruction metadata schema
 */
export const PreCommitmentInstructionSchema = z.object({
  commitment_type: z.literal('YIELD_SPLIT_ON_WITHDRAWAL'),
  delegated_yield_percent: z.number().min(0).max(100),
  carbon_credit_token_mint: z.string().min(1),
  estimated_credits_kg_co2: z.number().nonnegative(),
  estimated_burn_usdc: z.number().nonnegative(),
  suggested_yield_percent: z.number().min(0).max(100).optional(),
  target_footprint_kg_co2: z.number().nonnegative().optional(),
})

/**
 * Subsequent withdrawal routing action schema
 * Pre-commits the % offset yield to the subsequent withdrawal's yield
 */
export const SubsequentWithdrawalActionSchema = z.object({
  action_type: z.literal('WITHDRAW_AND_OFFSET'),
  target_protocol: z.string().min(1),
  timeframe_months: z.number().positive(),
  gross_yield_usdc: z.number().nonnegative(),
  offset_burn_usdc: z.number().nonnegative(),
  net_yield_usdc: z.number().nonnegative(),
  principal_returned_usdc: z.number().nonnegative(),
  total_user_payout_usdc: z.number().nonnegative(),
  offset_yield_percent: z.number().min(0).max(100),
})

/**
 * Main TerraYield execution payload schema
 */
export const TerraYieldExecutionSchema = z.object({
  execution_id: z.string().min(1),
  carbon_offset_action: CarbonOffsetActionSchema,
  yield_routing_action: YieldRoutingActionSchema,
  yield_positions: z.array(YieldPositionAllocationSchema).optional(),
  pre_commitment: PreCommitmentInstructionSchema.optional(),
  subsequent_withdrawal_action: SubsequentWithdrawalActionSchema.optional(),
  reasoning_log: z.string().min(1).max(1000),
})

/**
 * Input schema for the reasoning engine
 */
export const YieldRouteInputSchema = z
  .object({
    total_liquidity: z.number().positive('Total liquidity must be greater than 0'),
    offset_obligation: z.number().nonnegative('Offset obligation cannot be negative').optional(),
    offset_yield_percent: z.number().min(0).max(100).optional(),
    carbon_footprint_kg: z.number().nonnegative('Carbon footprint cannot be negative').optional(),
    diversify_positions: z.boolean().optional(),
    timeframe_months: z.number().positive().optional(),
    current_apys: z
      .array(
        z.object({
          protocol: z.string().min(1, 'Protocol name cannot be empty'),
          apy: z.number().nonnegative('APY cannot be negative'),
        })
      )
      .min(1, 'At least one protocol APY must be provided'),
  })
  .refine(
    (data) => {
      if (data.offset_obligation !== undefined) {
        return data.offset_obligation <= data.total_liquidity
      }
      return true
    },
    {
      message: 'Carbon offset obligation cannot exceed total liquidity',
      path: ['offset_obligation'],
    }
  )

/**
 * Helper to calculate the suggested % of resulting yield to delegate
 * in order to offset a target carbon footprint (in kg CO2).
 */
export function calculateSuggestedYieldDelegation(params: {
  carbonFootprintKg: number
  totalLiquidity: number
  apyPercent: number
  timeframeMonths: number
}): {
  footprintCostUsdc: number
  projectedGrossYieldUsdc: number
  suggestedYieldPercent: number
  uncappedYieldPercent: number
  requiredCapitalForFullOffsetUsdc: number
  coveragePercentAtMaxYield: number
} {
  const { carbonFootprintKg, totalLiquidity, apyPercent, timeframeMonths } = params
  const footprintCostUsdc = Number((carbonFootprintKg * CARBON_PRICE_PER_KG_USDC).toFixed(2))
  const projectedGrossYieldUsdc = Number(
    (totalLiquidity * (apyPercent / 100) * (timeframeMonths / 12)).toFixed(2)
  )

  if (footprintCostUsdc <= 0) {
    return {
      footprintCostUsdc: 0,
      projectedGrossYieldUsdc,
      suggestedYieldPercent: 0,
      uncappedYieldPercent: 0,
      requiredCapitalForFullOffsetUsdc: 0,
      coveragePercentAtMaxYield: 100,
    }
  }

  const periodRate = (apyPercent / 100) * (timeframeMonths / 12)
  const requiredCapitalForFullOffsetUsdc =
    periodRate > 0 ? Math.ceil(footprintCostUsdc / periodRate) : 0

  if (projectedGrossYieldUsdc <= 0) {
    return {
      footprintCostUsdc,
      projectedGrossYieldUsdc: 0,
      suggestedYieldPercent: 100,
      uncappedYieldPercent: 100,
      requiredCapitalForFullOffsetUsdc,
      coveragePercentAtMaxYield: 0,
    }
  }

  const rawPct = (footprintCostUsdc / projectedGrossYieldUsdc) * 100
  const uncappedYieldPercent = Number(rawPct.toFixed(1))
  const suggestedYieldPercent = Math.min(100, Math.max(1, Number(rawPct.toFixed(1))))
  const coveragePercentAtMaxYield = Math.min(
    100,
    Number(((projectedGrossYieldUsdc / footprintCostUsdc) * 100).toFixed(1))
  )

  return {
    footprintCostUsdc,
    projectedGrossYieldUsdc,
    suggestedYieldPercent,
    uncappedYieldPercent,
    requiredCapitalForFullOffsetUsdc,
    coveragePercentAtMaxYield,
  }
}

/**
 * Type exports
 */
export type CarbonOffsetAction = z.infer<typeof CarbonOffsetActionSchema>
export type YieldRoutingAction = z.infer<typeof YieldRoutingActionSchema>
export type YieldPositionAllocation = z.infer<typeof YieldPositionAllocationSchema>
export type PreCommitmentInstruction = z.infer<typeof PreCommitmentInstructionSchema>
export type SubsequentWithdrawalAction = z.infer<typeof SubsequentWithdrawalActionSchema>
export type TerraYieldExecution = z.infer<typeof TerraYieldExecutionSchema>
export type YieldRouteInput = z.infer<typeof YieldRouteInputSchema>


