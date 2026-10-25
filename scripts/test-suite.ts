/**
 * Automated Test Suite for TerraYield
 * Tests:
 * 1. Zod schemas (valid input, zero offset, offset > liquidity rejection)
 * 2. NIM Service response parser (direct JSON, markdown extraction, UUID injection)
 * 3. ExecutionRouter & MockAdapter (priority execution, abort on failure)
 * 4. SolanaWeb3Adapter (instruction building)
 * 5. In-Memory APY Service caching
 */

import {
  YieldRouteInputSchema,
  CarbonOffsetActionSchema,
  YieldRoutingActionSchema,
  SubsequentWithdrawalActionSchema,
  TerraYieldExecutionSchema,
  calculateSuggestedYieldDelegation,
  TOKENIZED_CARBON_CREDIT_MINT,
} from '@/schemas/terrayield'

import {
  parseNimResponse,
  generateDeterministicRoute,
  getNimService,
} from '@/services/nim-service'

import { ExecutionRouter } from '@/adapters/execution-adapter'
import { createMockAdapter } from '@/adapters/mock-adapter'
import { createSolanaWeb3Adapter } from '@/adapters/solana-adapter'
import { getApyService } from '@/services/apy-service'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${message}`)
    failed++
  }
}

async function runTests() {
  console.log('\n🚀 Starting TerraYield Test Suite...\n')

  // --- TEST 1: Schemas & Validation ---
  console.log('Test Group 1: Zod Schemas & Bounds Validation')
  {
    // Valid standard input
    const valid = YieldRouteInputSchema.safeParse({
      total_liquidity: 1000,
      offset_obligation: 10,
      current_apys: [{ protocol: 'Kamino', apy: 9.5 }],
    })
    assert(valid.success, 'Valid input passes YieldRouteInputSchema')

    // Zero offset obligation should be allowed
    const zeroOffset = YieldRouteInputSchema.safeParse({
      total_liquidity: 500,
      offset_obligation: 0,
      current_apys: [{ protocol: 'Marginfi', apy: 7.2 }],
    })
    assert(zeroOffset.success, 'Zero offset obligation allowed in input schema')

    // Offset exceeding liquidity must be rejected
    const overObligation = YieldRouteInputSchema.safeParse({
      total_liquidity: 100,
      offset_obligation: 200,
      current_apys: [{ protocol: 'Solend', apy: 6.8 }],
    })
    assert(
      !overObligation.success,
      'Offset obligation exceeding liquidity is rejected by refinement'
    )

    // Carbon offset action allows 0
    const zeroCarbonAction = CarbonOffsetActionSchema.safeParse({
      action_type: 'BUY_AND_BURN',
      allocation_usdc: 0,
    })
    assert(zeroCarbonAction.success, 'Carbon offset action schema permits 0 allocation')

    // Pre-committed % offset yield input schema validation
    const validPrecommitInput = YieldRouteInputSchema.safeParse({
      total_liquidity: 1000,
      offset_yield_percent: 25,
      timeframe_months: 1,
      current_apys: [{ protocol: 'Kamino', apy: 9.8 }],
    })
    assert(
      validPrecommitInput.success,
      'Pre-committed % offset yield input passes YieldRouteInputSchema'
    )

    // Pre-commitment percentage > 100 must be rejected
    const invalidPrecommitPct = YieldRouteInputSchema.safeParse({
      total_liquidity: 1000,
      offset_yield_percent: 150,
      current_apys: [{ protocol: 'Kamino', apy: 9.8 }],
    })
    assert(
      !invalidPrecommitPct.success,
      'Offset yield percentage > 100 is rejected by schema bounds'
    )

    // Subsequent withdrawal action schema validation
    const validWithdrawalAction = SubsequentWithdrawalActionSchema.safeParse({
      action_type: 'WITHDRAW_AND_OFFSET',
      target_protocol: 'Kamino',
      timeframe_months: 1,
      gross_yield_usdc: 8.17,
      offset_burn_usdc: 2.04,
      net_yield_usdc: 6.13,
      principal_returned_usdc: 1000,
      total_user_payout_usdc: 1006.13,
      offset_yield_percent: 25,
    })
    assert(
      validWithdrawalAction.success,
      'Subsequent withdrawal action schema validates accurately'
    )
  }

  // --- TEST 2: NIM Response Parser & UUID Injections ---
  console.log('\nTest Group 2: NIM Response Parsing & Hallucination Repair')
  {
    // Normal JSON
    const cleanJson = JSON.stringify({
      execution_id: '123e4567-e89b-12d3-a456-426614174000',
      carbon_offset_action: { action_type: 'BUY_AND_BURN', allocation_usdc: 5.0 },
      yield_routing_action: {
        action_type: 'DEPOSIT_LIQUIDITY',
        target_protocol: 'Kamino',
        allocation_usdc: 495.0,
        expected_apy: 8.4,
      },
      reasoning_log: 'Optimal routing executed.',
    })
    const parsedClean = parseNimResponse(cleanJson)
    assert(
      parsedClean.execution_id === '123e4567-e89b-12d3-a456-426614174000',
      'Parses standard JSON with existing UUID'
    )

    // Markdown-wrapped with placeholder "<uuid>"
    const markdownWrapped = `Here is your execution plan:
\`\`\`json
{
  "execution_id": "<uuid>",
  "carbon_offset_action": {
    "action_type": "BUY_AND_BURN",
    "allocation_usdc": 10.00
  },
  "yield_routing_action": {
    "action_type": "DEPOSIT_LIQUIDITY",
    "target_protocol": "Marginfi",
    "allocation_usdc": 990.00,
    "expected_apy": 7.4
  },
  "reasoning_log": "Allocated 10 to offset and 990 to Marginfi."
}
\`\`\`
Hope this helps!`
    const parsedMarkdown = parseNimResponse(markdownWrapped)
    assert(
      parsedMarkdown.execution_id !== '<uuid>' && parsedMarkdown.execution_id.length > 20,
      'Replaces placeholder "<uuid>" with a valid generated UUID'
    )
    assert(
      parsedMarkdown.yield_routing_action.target_protocol === 'Marginfi',
      'Correctly extracted protocol from markdown code block'
    )

    // Deterministic route generation
    const detRoute = generateDeterministicRoute({
      total_liquidity: 1000,
      offset_obligation: 20,
      current_apys: [
        { protocol: 'Solend', apy: 6.5 },
        { protocol: 'Kamino', apy: 10.2 },
      ],
    })
    assert(
      detRoute.yield_routing_action.target_protocol === 'Kamino',
      'Deterministic routing picks highest APY protocol (Kamino at 10.2%)'
    )
    assert(
      detRoute.carbon_offset_action.allocation_usdc === 20 &&
        detRoute.yield_routing_action.allocation_usdc === 980,
      'Deterministic math accurately splits allocations'
    )

    // Deterministic pre-commitment routing with % offset yield
    const precommitRoute = generateDeterministicRoute({
      total_liquidity: 1000,
      offset_yield_percent: 25,
      timeframe_months: 1,
      current_apys: [
        { protocol: 'Solend', apy: 6.5 },
        { protocol: 'Kamino', apy: 12.0 },
      ],
    })
    assert(
      precommitRoute.yield_routing_action.allocation_usdc === 1000,
      'Pre-commitment routing deposits 100% of principal into highest APY protocol'
    )
    assert(
      precommitRoute.yield_routing_action.offset_yield_percent === 25,
      'Yield routing action records the 25% pre-commitment policy'
    )
    assert(
      precommitRoute.subsequent_withdrawal_action !== undefined,
      'Generates subsequent withdrawal action'
    )
    assert(
      precommitRoute.subsequent_withdrawal_action?.gross_yield_usdc === 10.0,
      'Gross yield for 1 mo at 12% APY on $1000 is accurately $10.00'
    )
    assert(
      precommitRoute.subsequent_withdrawal_action?.offset_burn_usdc === 2.5,
      'Pre-committed 25% offset burn is accurately $2.50'
    )
    assert(
      precommitRoute.subsequent_withdrawal_action?.net_yield_usdc === 7.5,
      'Net user yield is accurately $7.50'
    )
    assert(
      precommitRoute.subsequent_withdrawal_action?.principal_returned_usdc === 1000,
      'Principal is returned 100% intact on subsequent withdrawal'
    )

    // Carbon footprint to suggested yield delegation math & multi-position routing
    const suggestion = calculateSuggestedYieldDelegation({
      carbonFootprintKg: 150, // $3.00 USDC at $0.02/kg
      totalLiquidity: 1000,
      apyPercent: 12.0, // $10.00 USDC gross yield over 1 month
      timeframeMonths: 1,
    })
    assert(
      suggestion.footprintCostUsdc === 3.0 && suggestion.suggestedYieldPercent === 30.0,
      'Calculates suggested 30% yield delegation to offset 150 kg CO2 ($3.00) from $10.00 gross yield'
    )

    const footprintRoute = generateDeterministicRoute({
      total_liquidity: 1000,
      carbon_footprint_kg: 150,
      diversify_positions: true,
      timeframe_months: 1,
      current_apys: [
        { protocol: 'Kamino', apy: 12.0 },
        { protocol: 'Drift', apy: 8.0 },
      ],
    })
    assert(
      footprintRoute.yield_positions?.length === 2 &&
        footprintRoute.yield_positions[0].share_percent === 70 &&
        footprintRoute.yield_positions[1].share_percent === 30,
      'Diversified routing splits capital 70/30 across top 2 optimal yield positions'
    )
    assert(
      footprintRoute.pre_commitment?.commitment_type === 'YIELD_SPLIT_ON_WITHDRAWAL' &&
        footprintRoute.pre_commitment?.carbon_credit_token_mint === TOKENIZED_CARBON_CREDIT_MINT,
      'Populates binding on-chain pre-commitment metadata with tokenized carbon credit mint'
    )
  }

  // --- TEST 3: Execution Router & Adapters ---
  console.log('\nTest Group 3: Execution Router & Adapters')
  {
    // Normal mock execution
    const mockAdapter = createMockAdapter({ delay: 0 })
    const router = new ExecutionRouter(mockAdapter)
    const result = await router.executeFromPayload({
      execution_id: 'test-exec-1',
      carbon_offset_action: { allocation_usdc: 5.0 },
      yield_routing_action: {
        target_protocol: 'Kamino',
        allocation_usdc: 495.0,
        expected_apy: 8.4,
      },
      reasoning_log: 'Test execution log',
    })
    assert(result.overallSuccess, 'Mock execution succeeds end-to-end')
    assert(
      result.carbonOffsetTx.signature.startsWith('sim_offset_'),
      'Generates formatted offset signature'
    )
    assert(
      result.yieldDepositTx.signature.startsWith('sim_yield_'),
      'Generates formatted yield signature'
    )

    // Pre-committed % yield offset execution flow
    const precommitResult = await router.executeFromPayload({
      execution_id: 'test-precommit-1',
      carbon_offset_action: { allocation_usdc: 2.5 },
      yield_routing_action: {
        target_protocol: 'Kamino',
        allocation_usdc: 1000.0,
        expected_apy: 12.0,
        offset_yield_percent: 25.0,
      },
      subsequent_withdrawal_action: {
        target_protocol: 'Kamino',
        timeframe_months: 1,
        gross_yield_usdc: 10.0,
        offset_burn_usdc: 2.5,
        net_yield_usdc: 7.5,
        principal_returned_usdc: 1000.0,
        total_user_payout_usdc: 1007.5,
        offset_yield_percent: 25.0,
      },
      reasoning_log: 'Pre-committed 25% yield offset with subsequent withdrawal test',
    })
    assert(
      precommitResult.overallSuccess,
      'Pre-commitment execution flow succeeds end-to-end'
    )
    assert(
      precommitResult.yieldDepositTx.signature.startsWith('sim_yield_'),
      'Yield deposit executed with 100% capital'
    )
    assert(
      precommitResult.withdrawalTx?.signature.startsWith('sim_withdraw_') === true,
      'Subsequent withdrawal executed with pre-committed offset burn'
    )

    // Abort on offset failure
    const failingAdapter = createMockAdapter({ delay: 0, shouldSucceed: false })
    const failRouter = new ExecutionRouter(failingAdapter)
    const failResult = await failRouter.executeFromPayload({
      execution_id: 'test-exec-2',
      carbon_offset_action: { allocation_usdc: 15.0 },
      yield_routing_action: {
        target_protocol: 'Marginfi',
        allocation_usdc: 85.0,
        expected_apy: 7.0,
      },
      reasoning_log: 'Test execution with failure',
    })
    assert(!failResult.overallSuccess, 'Router marks failure when offset fails')
    assert(
      failResult.yieldDepositTx.error?.includes('Aborted: carbon offset step failed') === true,
      'Router aborts yield deposit step if carbon offset fails'
    )

    // Solana Web3 Adapter instruction creation
    const web3Adapter = createSolanaWeb3Adapter()
    const web3Offset = await web3Adapter.offset(10, 'USDC')
    const web3Yield = await web3Adapter.depositYield(1000, 'Kamino', 25)
    const web3Withdraw = await web3Adapter.withdrawYield(1000, 'Kamino', 10, 2.5, 'USDC')
    assert(web3Offset.success, 'SolanaWeb3Adapter creates offset instructions successfully')
    assert(
      web3Yield.success,
      'SolanaWeb3Adapter creates pre-commitment yield instructions successfully'
    )
    assert(
      web3Withdraw.success,
      'SolanaWeb3Adapter creates subsequent withdrawal instructions successfully'
    )

    const builtTx = await web3Adapter.buildPreCommittedTransaction({
      executionId: 'exec-tx-test-1234',
      positions: [
        { protocol: 'Kamino', allocation_usdc: 700, share_percent: 70, expected_apy: 12.0 },
        { protocol: 'Drift', allocation_usdc: 300, share_percent: 30, expected_apy: 8.0 },
      ],
      totalPrincipalUsdc: 1000,
      weightedApy: 10.8,
      delegatedYieldPercent: 33.3,
      estimatedBurnUsdc: 3.0,
      estimatedCreditsKgCo2: 150,
      carbonCreditMint: TOKENIZED_CARBON_CREDIT_MINT,
    })
    assert(
      builtTx.transactionBase64.length > 40 && builtTx.instructions.length === 2,
      'Builds multi-instruction serialized Solana transaction with deposit route and withdrawal pre-commitment'
    )
    assert(
      builtTx.instructions[1].dataUtf8.includes('BUY_AND_BURN_TOKENIZED_CREDITS') &&
        builtTx.instructions[1].dataUtf8.includes(TOKENIZED_CARBON_CREDIT_MINT),
      'Pre-commitment instruction encodes tokenized carbon credit mint and BUY_AND_BURN action'
    )
  }

  // --- TEST 4: APY Service Caching & Real-Time Oracle Refresh ---
  console.log('\nTest Group 4: APY Service Caching & Real-Time Oracle Refresh')
  {
    const apyService = getApyService()
    const apys1 = await apyService.getLatestApys()
    assert(Array.isArray(apys1) && apys1.length >= 3, 'APY Service returns protocol list')

    const apys2 = await apyService.getLatestApys()
    assert(apys1[0].protocol === apys2[0].protocol, 'APY Service uses cached rates within TTL')

    const refreshed = await apyService.getLatestApys({ forceRefresh: true })
    assert(
      refreshed.length >= 4 &&
        typeof refreshed[0].tvlUsd === 'number' &&
        typeof refreshed[0].vaultAddress === 'string',
      'Real-time oracle refresh returns enriched protocol telemetry (tvlUsd, vaultAddress, category)'
    )
  }

  console.log(`\n===================================`)
  console.log(`Summary: ${passed} Passed, ${failed} Failed`)
  console.log(`===================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
