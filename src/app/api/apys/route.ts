import { NextRequest, NextResponse } from 'next/server'
import { getApyService } from '@/services/apy-service'

/**
 * GET /api/apys
 * Real-time Solana DeFi Yield Oracle endpoint for the TerraYield middleware layer.
 * Queries live protocol APYs, TVL, and vault addresses when a user provides input
 * so the UI can display accurate yield estimates and optimal routing positions.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const forceRefresh = searchParams.get('refresh') === 'true'

  const apys = await getApyService().getLatestApys({ forceRefresh })
  const sorted = [...apys].sort((a, b) => b.apy - a.apy)

  const best = sorted[0]
  const second = sorted[1] || best
  const weightedSplitApy = Number((best.apy * 0.7 + second.apy * 0.3).toFixed(2))

  return NextResponse.json(
    {
      apys: sorted,
      optimal_single: best,
      optimal_split: {
        primary: best,
        secondary: second,
        weighted_apy: weightedSplitApy,
      },
      fetched_at: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  )
}
