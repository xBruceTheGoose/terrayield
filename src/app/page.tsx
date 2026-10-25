'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Transaction, Connection } from '@solana/web3.js'

interface ApyEntry {
  protocol: string
  apy: number
  category?: 'Lending' | 'Liquidity' | 'Perps'
  tvlUsd?: number
  vaultAddress?: string
  source?: 'defillama_live' | 'solana_oracle'
  updatedAt?: number
}

interface YieldPositionAllocation {
  protocol: string
  allocation_usdc: number
  share_percent: number
  expected_apy: number
}

interface PreCommitmentInstruction {
  commitment_type: 'YIELD_SPLIT_ON_WITHDRAWAL'
  delegated_yield_percent: number
  carbon_credit_token_mint: string
  estimated_credits_kg_co2: number
  estimated_burn_usdc: number
  suggested_yield_percent?: number
  target_footprint_kg_co2?: number
}

interface SubsequentWithdrawal {
  action_type: string
  target_protocol: string
  timeframe_months: number
  gross_yield_usdc: number
  offset_burn_usdc: number
  net_yield_usdc: number
  principal_returned_usdc: number
  total_user_payout_usdc: number
  offset_yield_percent: number
}

interface DecodedInstruction {
  index: number
  label: string
  programId: string
  dataUtf8: string
}

interface ExecutionResult {
  execution_id: string
  live_apys?: ApyEntry[]
  carbon_offset: {
    action_type: string
    allocation_usdc: number
  }
  yield_routing: {
    action_type: string
    target_protocol: string
    allocation_usdc: number
    expected_apy: number
    offset_yield_percent?: number
  }
  yield_positions?: YieldPositionAllocation[]
  pre_commitment?: PreCommitmentInstruction
  subsequent_withdrawal?: SubsequentWithdrawal
  reasoning_log: string
  transaction_signatures: {
    carbon_offset: string
    yield_deposit: string
    subsequent_withdrawal?: string
  }
  transaction_details?: {
    transaction_base64: string
    fee_payer: string
    recent_blockhash: string
    estimated_fee_sol: number
    instructions: DecodedInstruction[]
  }
  success: boolean
}

interface InjectedSolanaProvider {
  isPhantom?: boolean
  isSolflare?: boolean
  isBackpack?: boolean
  publicKey?: { toString: () => string }
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>
  disconnect: () => Promise<void>
  signTransaction?: (transaction: Transaction) => Promise<Transaction>
  signAndSendTransaction?: (
    transaction: Transaction,
    options?: { minContextSlot?: number }
  ) => Promise<{ signature: string }>
}

const getInjectedSolanaProvider = (): InjectedSolanaProvider | null => {
  if (typeof window === 'undefined') return null
  const win = window as unknown as {
    phantom?: { solana?: InjectedSolanaProvider }
    solflare?: InjectedSolanaProvider
    backpack?: InjectedSolanaProvider
    solana?: InjectedSolanaProvider
  }
  if (win.phantom?.solana?.isPhantom) return win.phantom.solana
  if (win.solflare?.isSolflare) return win.solflare
  if (win.backpack?.isBackpack) return win.backpack
  if (win.solana) return win.solana
  return null
}

type FootprintPresetId = 'low' | 'average' | 'frequent_traveler' | 'custom'

const CARBON_PRICE_PER_KG_USDC = 0.02 // $20 per metric ton CO2 = $0.02 / kg CO2
const TOKENIZED_CARBON_MINT = 'CarbCreditNCT111111111111111111111111111111'

const FOOTPRINT_PRESETS: {
  id: FootprintPresetId
  title: string
  badge: string
  monthlyKg: number
  description: string
  flightsPerYear: number
  weeklyMiles: number
  homeEnergyKg: number
}[] = [
  {
    id: 'low',
    title: '🌱 Low Impact',
    badge: '150 kg/mo',
    monthlyKg: 150,
    description: 'Remote worker, public transit, renewable home energy',
    flightsPerYear: 1,
    weeklyMiles: 25,
    homeEnergyKg: 80,
  },
  {
    id: 'average',
    title: '🏠 Average Citizen',
    badge: '400 kg/mo',
    monthlyKg: 400,
    description: 'Daily commute, standard home energy & cloud compute',
    flightsPerYear: 3,
    weeklyMiles: 120,
    homeEnergyKg: 150,
  },
  {
    id: 'frequent_traveler',
    title: '✈️ Frequent Traveler',
    badge: '950 kg/mo',
    monthlyKg: 950,
    description: 'Monthly flights, heavy AI / Web3 validator compute',
    flightsPerYear: 10,
    weeklyMiles: 200,
    homeEnergyKg: 260,
  },
  {
    id: 'custom',
    title: '🎛️ Custom Calculator',
    badge: 'Activity Sliders',
    monthlyKg: 400,
    description: 'Fine-tune flights, driving, and energy usage below',
    flightsPerYear: 3,
    weeklyMiles: 120,
    homeEnergyKg: 150,
  },
]

export default function Home() {
  // Step 1: Carbon Footprint State
  const [footprintPreset, setFootprintPreset] = useState<FootprintPresetId>('low')
  const [flightsPerYear, setFlightsPerYear] = useState<number>(1)
  const [weeklyDrivingMiles, setWeeklyDrivingMiles] = useState<number>(25)
  const [monthlyHomeEnergyKg, setMonthlyHomeEnergyKg] = useState<number>(80)

  // Step 2: Deposit & Yield Delegation State
  const [totalLiquidity, setTotalLiquidity] = useState<number>(2500)
  const [timeframeMonths, setTimeframeMonths] = useState<number>(1)
  const [autoSyncSuggestedPct, setAutoSyncSuggestedPct] = useState<boolean>(true)
  const [manualOffsetYieldPercent, setManualOffsetYieldPercent] = useState<number>(13.8)

  // Step 3: Real-Time Queried Yield Oracle State (Read-Only Middleware Layer)
  const [diversifyPositions, setDiversifyPositions] = useState<boolean>(true)
  const [apys, setApys] = useState<ApyEntry[]>([
    {
      protocol: 'Kamino (JLP/USDC Vault)',
      apy: 11.2,
      category: 'Liquidity',
      tvlUsd: 184_500_000,
      vaultAddress: 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD',
    },
    {
      protocol: 'Drift (USDC Insurance & Lend)',
      apy: 8.6,
      category: 'Perps',
      tvlUsd: 92_300_000,
      vaultAddress: 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH',
    },
    {
      protocol: 'Marginfi (USDC Main Pool)',
      apy: 7.4,
      category: 'Lending',
      tvlUsd: 146_800_000,
      vaultAddress: 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA',
    },
    {
      protocol: 'Solend / Save (Main Pool USDC)',
      apy: 6.9,
      category: 'Lending',
      tvlUsd: 68_400_000,
      vaultAddress: 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo',
    },
  ])
  const [oracleQuerying, setOracleQuerying] = useState<boolean>(false)
  const [lastOracleSync, setLastOracleSync] = useState<string>('Just now')

  // Simulation & Execution State
  const [result, setResult] = useState<ExecutionResult | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'interactive' | 'blink_preview'>('interactive')

  // Wallet & Solana Blinks Submission State
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletProviderName, setWalletProviderName] = useState<string | null>(null)
  const [submissionChannel, setSubmissionChannel] = useState<'wallet' | 'blink'>('wallet')
  const [txStatus, setTxStatus] = useState<'idle' | 'signing' | 'submitted'>('idle')
  const [submittedVia, setSubmittedVia] = useState<'wallet' | 'blink' | null>(null)
  const [copiedBlinkUrl, setCopiedBlinkUrl] = useState<boolean>(false)

  // Real-time APY oracle fetch triggered automatically as user provides input
  const queryLiveApys = useCallback(async (forceRefresh: boolean = true) => {
    setOracleQuerying(true)
    try {
      const response = await fetch(`/api/apys?refresh=${forceRefresh}`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data.apys) && data.apys.length > 0) {
          setApys(data.apys)
          setLastOracleSync(new Date().toLocaleTimeString())
        }
      }
    } catch {
      // Retain existing oracle snapshot if offline
    } finally {
      setOracleQuerying(false)
    }
  }, [])

  // Query live APYs in real time whenever user adjusts footprint, capital, timeframe, or routing mode
  useEffect(() => {
    const timer = setTimeout(() => {
      queryLiveApys(true)
    }, 260)
    return () => clearTimeout(timer)
  }, [
    totalLiquidity,
    timeframeMonths,
    footprintPreset,
    flightsPerYear,
    weeklyDrivingMiles,
    monthlyHomeEnergyKg,
    diversifyPositions,
    queryLiveApys,
  ])

  // --- Step 1 Math: Calculate Monthly & Horizon Carbon Footprint ---
  // 1 round-trip flight ≈ 300 kg CO2/yr (25 kg/mo); 1 driving mile ≈ 0.4 kg CO2 (4.33 weeks/mo)
  const calculatedMonthlyFootprintKg =
    footprintPreset === 'custom'
      ? Math.round(
          (flightsPerYear * 300) / 12 +
            weeklyDrivingMiles * 4.33 * 0.4 +
            monthlyHomeEnergyKg
        )
      : (FOOTPRINT_PRESETS.find((p) => p.id === footprintPreset)?.monthlyKg ?? 150)

  const horizonFootprintKg = Math.round(calculatedMonthlyFootprintKg * timeframeMonths)
  const horizonFootprintCostUsdc = Number(
    (horizonFootprintKg * CARBON_PRICE_PER_KG_USDC).toFixed(2)
  )

  // --- Step 3 Math: Rank Optimal Yield Positions ---
  const sortedApys = [...apys].sort((a, b) => b.apy - a.apy)
  const bestProtocol = sortedApys[0] || { protocol: 'Kamino (JLP/USDC Vault)', apy: 11.2 }
  const secondProtocol = sortedApys[1] || bestProtocol

  const canDiversify = diversifyPositions && sortedApys.length >= 2
  const effectiveApy = canDiversify
    ? Number((bestProtocol.apy * 0.7 + secondProtocol.apy * 0.3).toFixed(2))
    : bestProtocol.apy

  const previewPositions: YieldPositionAllocation[] = canDiversify
    ? [
        {
          protocol: bestProtocol.protocol,
          allocation_usdc: Number((totalLiquidity * 0.7).toFixed(2)),
          share_percent: 70,
          expected_apy: bestProtocol.apy,
        },
        {
          protocol: secondProtocol.protocol,
          allocation_usdc: Number(
            (totalLiquidity - Number((totalLiquidity * 0.7).toFixed(2))).toFixed(2)
          ),
          share_percent: 30,
          expected_apy: secondProtocol.apy,
        },
      ]
    : [
        {
          protocol: bestProtocol.protocol,
          allocation_usdc: Number(totalLiquidity.toFixed(2)),
          share_percent: 100,
          expected_apy: bestProtocol.apy,
        },
      ]

  // --- Step 2 Math: Projected Yield & Suggested Delegation % ---
  const projectedGrossYield = Number(
    (totalLiquidity * (effectiveApy / 100) * (timeframeMonths / 12)).toFixed(2)
  )

  const periodYieldRate = (effectiveApy / 100) * (timeframeMonths / 12)
  const requiredCapitalForFullNeutrality =
    periodYieldRate > 0 ? Math.ceil(horizonFootprintCostUsdc / periodYieldRate) : 0

  const rawSuggestedPct =
    projectedGrossYield > 0
      ? (horizonFootprintCostUsdc / projectedGrossYield) * 100
      : 100

  const suggestedYieldPercent =
    horizonFootprintCostUsdc <= 0
      ? 0
      : Math.min(100, Math.max(1, Number(rawSuggestedPct.toFixed(1))))

  const isYieldSufficientForFullNeutrality = projectedGrossYield >= horizonFootprintCostUsdc

  const activeOffsetYieldPercent = autoSyncSuggestedPct
    ? suggestedYieldPercent
    : manualOffsetYieldPercent

  const projectedOffsetBurn = Number(
    (projectedGrossYield * (activeOffsetYieldPercent / 100)).toFixed(2)
  )
  const projectedNetYield = Number((projectedGrossYield - projectedOffsetBurn).toFixed(2))
  const projectedTotalPayout = Number((totalLiquidity + projectedNetYield).toFixed(2))
  const projectedCarbonKgRetired = Math.round(projectedOffsetBurn / CARBON_PRICE_PER_KG_USDC)
  const footprintCoveragePercent =
    horizonFootprintKg > 0
      ? Math.min(100, Math.round((projectedCarbonKgRetired / horizonFootprintKg) * 100))
      : 100

  const selectFootprintPreset = (presetId: FootprintPresetId) => {
    setError(null)
    setFootprintPreset(presetId)
    const found = FOOTPRINT_PRESETS.find((p) => p.id === presetId)
    if (found && presetId !== 'custom') {
      setFlightsPerYear(found.flightsPerYear)
      setWeeklyDrivingMiles(found.weeklyMiles)
      setMonthlyHomeEnergyKg(found.homeEnergyKg)
    }
  }

  const executeSimulation = async (params: {
    liquidity: number
    offsetYieldPct: number
    footprintKg: number
    diversify: boolean
    months: number
    account?: string | null
    via?: 'wallet' | 'blink' | null
  }) => {
    setLoading(true)
    setError(null)
    if (params.via) {
      setTxStatus('signing')
    }

    try {
      const response = await fetch('/api/actions/terrayield', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: params.account ?? walletAddress ?? undefined,
          total_liquidity: params.liquidity,
          offset_yield_percent: params.offsetYieldPct,
          carbon_footprint_kg: params.footprintKg,
          diversify_positions: params.diversify,
          timeframe_months: params.months,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to build pre-committed TerraYield transaction')
      }

      if (Array.isArray(data.execution?.live_apys) && data.execution.live_apys.length > 0) {
        setApys(data.execution.live_apys)
        setLastOracleSync(new Date().toLocaleTimeString())
      }

      // If submitted via wallet or blink AND an injected wallet provider is present:
      const provider = getInjectedSolanaProvider()
      const isSimulatedAccount =
        !params.account || params.account === '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'

      if (params.via && provider && !isSimulatedAccount && data.transaction) {
        try {
          // Decode the base64 transaction built by the server
          const binaryString = window.atob(data.transaction)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          const transaction = Transaction.from(bytes)

          let txSignature = ''
          if (typeof provider.signAndSendTransaction === 'function') {
            // Prompts Phantom / Solflare / Backpack popup window!
            const res = await provider.signAndSendTransaction(transaction)
            txSignature = res.signature
          } else if (typeof provider.signTransaction === 'function') {
            const signedTx = await provider.signTransaction(transaction)
            const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
            txSignature = await connection.sendRawTransaction(signedTx.serialize(), {
              skipPreflight: true,
            })
          }

          if (txSignature && data.execution) {
            data.execution.transaction_signatures.yield_deposit = txSignature
          }
        } catch (walletErr: unknown) {
          const wMsg = walletErr instanceof Error ? walletErr.message : String(walletErr)
          const isUserRejected =
            wMsg.toLowerCase().includes('reject') ||
            wMsg.toLowerCase().includes('cancel') ||
            (walletErr as { code?: number })?.code === 4001
          if (isUserRejected) {
            throw new Error('Transaction cancelled in wallet extension.')
          }
          throw new Error(`Wallet extension signing failed: ${wMsg}`)
        }
      }

      setResult(data.execution)
      if (params.via) {
        setSubmittedVia(params.via)
        setTxStatus('submitted')
      } else {
        setTxStatus('idle')
      }
    } catch (err) {
      setTxStatus('idle')
      setError(err instanceof Error ? err.message : 'Unknown execution error')
    } finally {
      setLoading(false)
    }
  }

  const connectSolanaWallet = async (): Promise<string> => {
    setError(null)
    const provider = getInjectedSolanaProvider()
    if (provider && typeof provider.connect === 'function') {
      try {
        const resp = await provider.connect()
        const pubkey = resp?.publicKey?.toString() || provider.publicKey?.toString()
        if (pubkey) {
          setWalletAddress(pubkey)
          const name = provider.isPhantom
            ? 'Phantom Wallet'
            : provider.isSolflare
              ? 'Solflare Wallet'
              : provider.isBackpack
                ? 'Backpack Wallet'
                : 'Injected Solana Wallet'
          setWalletProviderName(name)
          return pubkey
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        if (
          message.toLowerCase().includes('reject') ||
          message.toLowerCase().includes('cancel') ||
          (err as { code?: number })?.code === 4001
        ) {
          setError('Wallet connection cancelled by user.')
          throw err
        }
        console.warn('Injected wallet connection failed, falling back:', err)
      }
    }

    const demoDevnetPubkey = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
    setWalletAddress(demoDevnetPubkey)
    setWalletProviderName('Solana Devnet Signer (Simulation)')
    return demoDevnetPubkey
  }

  const disconnectSolanaWallet = () => {
    setWalletAddress(null)
    setWalletProviderName(null)
    if (submittedVia === 'wallet') {
      setTxStatus('idle')
      setSubmittedVia(null)
    }
  }

  const handleWalletSignAndSubmit = async () => {
    let activePubkey = walletAddress
    if (!activePubkey) {
      activePubkey = await connectSolanaWallet()
    }
    setSubmissionChannel('wallet')
    await executeSimulation({
      liquidity: totalLiquidity,
      offsetYieldPct: activeOffsetYieldPercent,
      footprintKg: horizonFootprintKg,
      diversify: diversifyPositions,
      months: timeframeMonths,
      account: activePubkey,
      via: 'wallet',
    })
  }

  const handleBlinkSubmit = async () => {
    setSubmissionChannel('blink')
    await executeSimulation({
      liquidity: totalLiquidity,
      offsetYieldPct: activeOffsetYieldPercent,
      footprintKg: horizonFootprintKg,
      diversify: diversifyPositions,
      months: timeframeMonths,
      account: walletAddress,
      via: 'blink',
    })
  }

  const actionEndpointPath = `/api/actions/terrayield?total_liquidity=${totalLiquidity}&carbon_footprint_kg=${horizonFootprintKg}&offset_yield_percent=${activeOffsetYieldPercent}&timeframe_months=${timeframeMonths}&diversify_positions=${diversifyPositions}`

  const getFullActionUrl = () => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
    return `${origin}${actionEndpointPath}`
  }

  const getBlinkActionUri = () => `solana-action:${getFullActionUrl()}`

  const getDialectBlinksUrl = () =>
    `https://dial.to/?action=${encodeURIComponent(getBlinkActionUri())}`

  const copyBlinkActionUrl = () => {
    navigator.clipboard.writeText(getBlinkActionUri())
    setCopiedBlinkUrl(true)
    setTimeout(() => setCopiedBlinkUrl(false), 2200)
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (totalLiquidity <= 0) {
      setError('Deposit principal must be greater than $0 USDC.')
      return
    }
    if (activeOffsetYieldPercent < 0 || activeOffsetYieldPercent > 100) {
      setError('Delegated yield percentage must be between 0% and 100%.')
      return
    }
    executeSimulation({
      liquidity: totalLiquidity,
      offsetYieldPct: activeOffsetYieldPercent,
      footprintKg: horizonFootprintKg,
      diversify: diversifyPositions,
      months: timeframeMonths,
      account: walletAddress,
      via: submissionChannel,
    })
  }

  const handleQuickJudgeDemo = async () => {
    const demoLiquidity = 2500
    const demoMonths = 1
    selectFootprintPreset('low')
    setTotalLiquidity(demoLiquidity)
    setTimeframeMonths(demoMonths)
    setDiversifyPositions(true)
    setAutoSyncSuggestedPct(true)

    const pubkey = walletAddress || (await connectSolanaWallet())
    await executeSimulation({
      liquidity: demoLiquidity,
      offsetYieldPct: suggestedYieldPercent,
      footprintKg: 150,
      diversify: true,
      months: demoMonths,
      account: pubkey,
      via: submissionChannel,
    })
  }

  // Active metrics for display (from built result if available, otherwise live preview)
  const displayPositions = result?.yield_positions || previewPositions
  const displayGrossYield =
    result?.subsequent_withdrawal?.gross_yield_usdc ?? projectedGrossYield
  const displayOffsetBurn =
    result?.subsequent_withdrawal?.offset_burn_usdc ?? projectedOffsetBurn
  const displayNetYield =
    result?.subsequent_withdrawal?.net_yield_usdc ?? projectedNetYield
  const displayTotalPayout =
    result?.subsequent_withdrawal?.total_user_payout_usdc ?? projectedTotalPayout
  const displayDelegatedPct =
    result?.subsequent_withdrawal?.offset_yield_percent ?? activeOffsetYieldPercent
  const displayKgCo2 = Math.round(displayOffsetBurn / CARBON_PRICE_PER_KG_USDC)
  const displayTrees = (displayKgCo2 / 21).toFixed(1)

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans selection:bg-emerald-500 selection:text-white">
      {/* Ambient Background Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Image
                src="/logo.png"
                alt="TerraYield Logo"
                width={36}
                height={36}
                className="w-9 h-9 object-contain"
                priority
              />
              <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                TerraYield
              </h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">
                v2.3 • Live Yield Oracle Middleware
              </span>
            </div>
            <p className="text-sm text-slate-400">
              1. Calculate Carbon Footprint ➔ 2. Delegate Suggested % of Yield ➔ 3. Real-Time Oracle Route with Withdrawal Pre-Commit
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            {walletAddress ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-emerald-500/40 font-mono">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <div className="text-left">
                  <div className="text-[10px] text-emerald-400 font-sans font-semibold leading-none">
                    {walletProviderName || 'Connected Wallet'}
                  </div>
                  <div className="text-xs text-white font-bold">
                    {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={disconnectSolanaWallet}
                  className="ml-1 px-2 py-1 rounded-lg bg-slate-950 hover:bg-red-950/60 text-slate-400 hover:text-red-300 border border-slate-800 text-[10px] cursor-pointer transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={connectSolanaWallet}
                className="px-3.5 py-2 rounded-xl font-bold bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/40 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <span aria-hidden="true">👛</span>
                Connect Solana Wallet
              </button>
            )}

            <button
              type="button"
              onClick={handleQuickJudgeDemo}
              disabled={loading}
              className="px-4 py-2 rounded-xl font-bold bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <span aria-hidden="true">⚡</span>
              {loading ? 'Submitting Route...' : '1-Click Judge Demo'}
            </button>
          </div>
        </header>

        {/* Tab Selector & Navigation */}
        <div className="flex flex-wrap items-center justify-between border-b border-slate-800 gap-4 text-sm font-medium">
          <div className="flex gap-6" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'interactive'}
              onClick={() => setActiveTab('interactive')}
              className={`pb-3 transition-colors relative cursor-pointer ${
                activeTab === 'interactive'
                  ? 'text-emerald-400 border-b-2 border-emerald-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              🧭 Guided Footprint & Transaction Simulator
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'blink_preview'}
              onClick={() => setActiveTab('blink_preview')}
              className={`pb-3 transition-colors relative cursor-pointer ${
                activeTab === 'blink_preview'
                  ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              📱 Solana Blink Card Preview (Dialect Standard)
            </button>
          </div>

          <Link
            href="/about"
            className="pb-3 text-slate-400 hover:text-teal-300 transition-colors flex items-center gap-1.5 text-xs font-mono"
          >
            <span aria-hidden="true">📖</span>
            About &amp; Architecture ↗
          </Link>
        </div>

        {/* TAB 1: Guided 3-Step Simulator */}
        {activeTab === 'interactive' && (
          <div className="grid lg:grid-cols-12 gap-8 items-start">
            {/* LEFT COLUMN: Guided 3-Step Configuration Form */}
            <form
              onSubmit={handleFormSubmit}
              action="/api/actions/terrayield"
              method="POST"
              className="lg:col-span-6 space-y-6"
            >
              {/* STEP 1: CARBON FOOTPRINT CALCULATOR */}
              <fieldset className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-xl">
                <legend className="px-2 text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-600 inline-flex items-center justify-center text-[11px]">
                    1
                  </span>
                  Step 1: Calculate Your Carbon Footprint
                </legend>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Select a lifestyle profile or customize your activities to estimate how much CO₂ you emit and the cost in <strong>tokenized carbon credits ($0.02 / kg CO₂)</strong> to neutralize it.
                </p>

                {/* Lifestyle Radio Group (< 6 options per modern web guidance) */}
                <div className="grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Carbon footprint lifestyle preset">
                  {FOOTPRINT_PRESETS.map((preset) => {
                    const isSelected = footprintPreset === preset.id
                    return (
                      <label
                        key={preset.id}
                        htmlFor={`preset-${preset.id}`}
                        className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between gap-1 ${
                          isSelected
                            ? 'bg-emerald-950/50 border-emerald-500 text-white shadow-md shadow-emerald-950/50'
                            : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              id={`preset-${preset.id}`}
                              name="footprint_preset"
                              value={preset.id}
                              checked={isSelected}
                              onChange={() => selectFootprintPreset(preset.id)}
                              className="accent-emerald-500"
                            />
                            <span className="text-xs font-bold">{preset.title}</span>
                          </div>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-emerald-400 border border-slate-800">
                            {preset.badge}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 pl-5 leading-snug">
                          {preset.description}
                        </span>
                      </label>
                    )
                  })}
                </div>

                {/* Custom Sliders */}
                {footprintPreset === 'custom' && (
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="flights-slider" className="text-slate-300 font-medium">
                          ✈️ Round-Trip Flights per Year
                        </label>
                        <span className="font-mono text-emerald-400">{flightsPerYear} flights/yr</span>
                      </div>
                      <input
                        id="flights-slider"
                        name="flights_per_year"
                        type="range"
                        min="0"
                        max="20"
                        step="1"
                        value={flightsPerYear}
                        onChange={(e) => setFlightsPerYear(Number(e.target.value))}
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="driving-slider" className="text-slate-300 font-medium">
                          🚗 Weekly Driving / Transit Distance
                        </label>
                        <span className="font-mono text-emerald-400">{weeklyDrivingMiles} mi/wk</span>
                      </div>
                      <input
                        id="driving-slider"
                        name="weekly_driving_miles"
                        type="range"
                        min="0"
                        max="500"
                        step="10"
                        value={weeklyDrivingMiles}
                        onChange={(e) => setWeeklyDrivingMiles(Number(e.target.value))}
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <label htmlFor="energy-slider" className="text-slate-300 font-medium">
                          ⚡ Home Energy & AI / Web3 Compute
                        </label>
                        <span className="font-mono text-emerald-400">{monthlyHomeEnergyKg} kg CO₂/mo</span>
                      </div>
                      <input
                        id="energy-slider"
                        name="monthly_home_energy_kg"
                        type="range"
                        min="20"
                        max="500"
                        step="10"
                        value={monthlyHomeEnergyKg}
                        onChange={(e) => setMonthlyHomeEnergyKg(Number(e.target.value))}
                        className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                )}

                {/* Step 1 Summary Output Bar */}
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/60 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold">
                      Estimated Footprint ({timeframeMonths} {timeframeMonths === 1 ? 'Month' : 'Months'})
                    </div>
                    <div className="text-lg font-extrabold text-white font-mono">
                      {horizonFootprintKg.toLocaleString()} kg CO₂{' '}
                      <span className="text-xs font-normal text-slate-400">
                        (≈ {(horizonFootprintKg / 21).toFixed(1)} tree-years)
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
                      Tokenized Credit Cost
                    </div>
                    <div className="text-lg font-extrabold text-emerald-400 font-mono">
                      ${horizonFootprintCostUsdc.toFixed(2)} USDC
                    </div>
                  </div>
                </div>
              </fieldset>

              {/* STEP 2: DEPOSIT CAPITAL & AI-SUGGESTED YIELD DELEGATION */}
              <fieldset className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-xl">
                <legend className="px-2 text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-cyan-950 border border-cyan-600 inline-flex items-center justify-center text-[11px]">
                    2
                  </span>
                  Step 2: Deposit Capital & Suggested Yield Delegation
                </legend>

                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Principal Input */}
                  <div className="space-y-1.5">
                    <label htmlFor="principal-input" className="block text-xs font-medium text-slate-300">
                      Deposit Principal (100% Protected)
                    </label>
                    <div className="relative">
                      <input
                        id="principal-input"
                        name="total_liquidity"
                        type="number"
                        min="1"
                        step="any"
                        value={totalLiquidity === 0 ? '' : totalLiquidity}
                        onChange={(e) => {
                          setError(null)
                          const val = e.target.value
                          if (val === '') {
                            setTotalLiquidity(0)
                          } else {
                            const parsed = Number(val)
                            setTotalLiquidity(isNaN(parsed) ? 0 : parsed)
                          }
                        }}
                        onBlur={() => {
                          if (totalLiquidity < 1) {
                            setTotalLiquidity(1)
                          }
                        }}
                        aria-describedby="principal-help"
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-cyan-500"
                        required
                      />
                      <span className="absolute right-3 top-2 text-xs font-mono text-slate-400">
                        USDC
                      </span>
                    </div>
                    <div id="principal-help" className="flex flex-wrap gap-1.5 pt-1">
                      {[1000, 2500, 5000, 10000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => {
                            setError(null)
                            setTotalLiquidity(amt)
                          }}
                          className={`px-2 py-0.5 rounded text-[11px] font-mono border cursor-pointer ${
                            totalLiquidity === amt
                              ? 'bg-cyan-950 text-cyan-300 border-cyan-600 font-bold'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          ${amt.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Yield Accrual Horizon */}
                  <div className="space-y-1.5">
                    <span className="block text-xs font-medium text-slate-300">
                      Yield Accrual Horizon
                    </span>
                    <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Yield accrual horizon">
                      {[
                        { months: 1, label: '1 Month' },
                        { months: 3, label: '3 Months' },
                        { months: 6, label: '6 Months' },
                        { months: 12, label: '1 Year' },
                      ].map((t) => (
                        <button
                          key={t.months}
                          type="button"
                          onClick={() => setTimeframeMonths(t.months)}
                          className={`py-2 px-2.5 rounded-lg border text-xs font-mono transition-colors cursor-pointer ${
                            timeframeMonths === t.months
                              ? 'bg-cyan-950 text-cyan-300 border-cyan-600 font-bold'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Smart AI Recommendation Callout */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/50 via-slate-950 to-cyan-950/40 border border-emerald-600/40 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base" aria-hidden="true">🎯</span>
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                        Suggested Yield Delegation:{' '}
                        <span className="text-white font-mono text-sm">{suggestedYieldPercent}%</span> of Gained Yield
                      </span>
                    </div>

                    {isYieldSufficientForFullNeutrality ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAutoSyncSuggestedPct(true)
                          setManualOffsetYieldPercent(suggestedYieldPercent)
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                          autoSyncSuggestedPct
                            ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/50'
                            : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-bold shadow'
                        }`}
                      >
                        {autoSyncSuggestedPct ? '✓ Using Suggested %' : `Apply Suggested ${suggestedYieldPercent}%`}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setTotalLiquidity(requiredCapitalForFullNeutrality)
                          setAutoSyncSuggestedPct(true)
                        }}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition-all cursor-pointer shadow"
                      >
                        Match Principal (${requiredCapitalForFullNeutrality.toLocaleString()}) for 100% Offset
                      </button>
                    )}
                  </div>

                  {isYieldSufficientForFullNeutrality ? (
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Based on real-time oracle rates (<strong className="text-cyan-300">{effectiveApy}% APY</strong>), your{' '}
                      <strong>${totalLiquidity.toLocaleString()} USDC</strong> principal earns{' '}
                      <strong className="text-cyan-300">${projectedGrossYield.toFixed(2)} USDC</strong> over{' '}
                      {timeframeMonths} {timeframeMonths === 1 ? 'month' : 'months'}. Delegating{' '}
                      <strong className="text-emerald-400">{suggestedYieldPercent}% (${horizonFootprintCostUsdc.toFixed(2)} USDC)</strong>{' '}
                      100% neutralizes your <strong>{horizonFootprintKg} kg CO₂</strong> footprint while you keep{' '}
                      <strong className="text-white">${(projectedGrossYield - horizonFootprintCostUsdc).toFixed(2)} USDC</strong> net profit!
                    </p>
                  ) : (
                    <p className="text-xs text-amber-200/90 leading-relaxed">
                      At live oracle rates (<strong>{effectiveApy}% APY</strong>), your projected yield is{' '}
                      <strong>${projectedGrossYield.toFixed(2)} USDC</strong>, while neutralizing{' '}
                      <strong>{horizonFootprintKg} kg CO₂</strong> requires <strong>${horizonFootprintCostUsdc.toFixed(2)} USDC</strong>.
                      Delegating <strong>100% of yield</strong> offsets <strong>{footprintCoveragePercent}%</strong> of your footprint
                      (or deposit <strong>${requiredCapitalForFullNeutrality.toLocaleString()} USDC</strong> to reach 100% neutrality).
                    </p>
                  )}
                </div>

                {/* Delegation Slider Control */}
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs font-medium">
                    <label htmlFor="delegation-slider" className="text-slate-300">
                      Pre-Committed % of Withdrawal Yield to Carbon Credits
                    </label>
                    <span className="font-mono font-bold text-emerald-400">
                      {activeOffsetYieldPercent}% (${projectedOffsetBurn.toFixed(2)} USDC)
                    </span>
                  </div>
                  <input
                    id="delegation-slider"
                    name="offset_yield_percent"
                    type="range"
                    min="0"
                    max="100"
                    step="0.5"
                    value={activeOffsetYieldPercent}
                    onChange={(e) => {
                      setAutoSyncSuggestedPct(false)
                      setManualOffsetYieldPercent(Number(e.target.value))
                    }}
                    className="w-full accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span>🌿 Burn Carbon Credits: ${projectedOffsetBurn.toFixed(2)} ({projectedCarbonKgKgLabel(projectedCarbonKgRetired)})</span>
                    <span>💵 Net Yield You Keep: ${projectedNetYield.toFixed(2)} ({(100 - activeOffsetYieldPercent).toFixed(1)}%)</span>
                  </div>
                </div>
              </fieldset>

              {/* STEP 3: REAL-TIME MIDDLEWARE YIELD ORACLE & ROUTING */}
              <fieldset className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-xl">
                <legend className="px-2 text-xs font-bold uppercase tracking-wider text-teal-400 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-teal-950 border border-teal-600 inline-flex items-center justify-center text-[11px]">
                    3
                  </span>
                  Step 3: Live Middleware Yield Oracle & Optimal Routing
                </legend>

                {/* Routing Mode Toggle */}
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-xs">
                    <div className="font-semibold text-white">Middleware Routing Strategy</div>
                    <div className="text-[11px] text-slate-400">
                      {canDiversify
                        ? `70/30 Optimal Split (${effectiveApy}% Weighted APY)`
                        : `100% Highest-APY Vault (${effectiveApy}% APY)`}
                    </div>
                  </div>
                  <div className="flex gap-1.5 text-xs font-mono">
                    <button
                      type="button"
                      onClick={() => setDiversifyPositions(false)}
                      className={`px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                        !diversifyPositions
                          ? 'bg-teal-950 text-teal-300 border-teal-600 font-bold'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      Single Best
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiversifyPositions(true)}
                      className={`px-2.5 py-1.5 rounded-lg border cursor-pointer ${
                        diversifyPositions
                          ? 'bg-teal-950 text-teal-300 border-teal-600 font-bold'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}
                    >
                      70/30 Split
                    </button>
                  </div>
                </div>

                {/* Read-Only Real-Time Yield Oracle Telemetry */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap justify-between items-center gap-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          oracleQuerying ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'
                        }`}
                      />
                      <span className="font-semibold text-slate-200">
                        Live Solana Protocol APY Feed (Read-Only Oracle)
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <span className="text-slate-400">
                        {oracleQuerying ? 'Querying oracles...' : `Synced ${lastOracleSync}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => queryLiveApys(true)}
                        disabled={oracleQuerying}
                        className="px-2 py-0.5 rounded bg-slate-950 hover:bg-slate-800 text-teal-300 border border-slate-800 cursor-pointer disabled:opacity-50"
                      >
                        🔄 Refresh
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {sortedApys.map((entry) => {
                      const matchedAlloc = previewPositions.find(
                        (p) => p.protocol === entry.protocol
                      )
                      const tvlMillions = entry.tvlUsd
                        ? `$${(entry.tvlUsd / 1_000_000).toFixed(1)}M TVL`
                        : 'Verified Vault'

                      return (
                        <div
                          key={entry.protocol}
                          className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-all ${
                            matchedAlloc
                              ? 'border-emerald-500/60 bg-emerald-950/20 shadow-sm'
                              : 'border-slate-800/80 bg-slate-950/70 opacity-75'
                          }`}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold text-white truncate">
                                {entry.protocol}
                              </span>
                              {entry.category && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                                  {entry.category}
                                </span>
                              )}
                              {matchedAlloc ? (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700 font-semibold">
                                  👑 Routed {matchedAlloc.share_percent}% ($
                                  {matchedAlloc.allocation_usdc.toLocaleString()})
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-500">
                                  Standby
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                              <span>{tvlMillions}</span>
                              {entry.vaultAddress && (
                                <span>
                                  Vault: {entry.vaultAddress.slice(0, 6)}...
                                  {entry.vaultAddress.slice(-4)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right font-mono shrink-0">
                            <div
                              className={`text-sm font-extrabold ${
                                matchedAlloc ? 'text-emerald-400' : 'text-slate-300'
                              }`}
                            >
                              {entry.apy.toFixed(2)}% APY
                            </div>
                            <div className="text-[10px] text-slate-500">Live Oracle</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 transition-all shadow-lg shadow-emerald-950/50 active:scale-[0.99] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      Building Pre-Committed Solana Transaction...
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">🔨</span>
                      Build Pre-Committed Yield & Carbon Transaction
                    </>
                  )}
                </button>
              </fieldset>
            </form>

            {/* RIGHT COLUMN: Live Transaction Blueprint & Withdrawal Settlement Preview */}
            <div className="lg:col-span-6 space-y-6" aria-live="polite">
              {error && (
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-red-950/50 border border-red-800 text-red-200 text-xs flex items-start gap-3"
                >
                  <span className="text-base" aria-hidden="true">⚠️</span>
                  <div>
                    <strong className="font-bold block text-sm">Validation / Routing Error</strong>
                    <span>{error}</span>
                  </div>
                </div>
              )}

              {/* Visual Transaction Pipeline Card */}
              <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/80 p-6 space-y-6 shadow-2xl backdrop-blur-md">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-3 w-3 rounded-full ${
                        result ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400'
                      }`}
                    />
                    <h2 className="font-bold text-lg text-white">
                      {result
                        ? 'Built Pre-Committed Transaction'
                        : 'Live Transaction Routing Blueprint'}
                    </h2>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-md bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    {result ? 'SIGNED & VERIFIED' : 'LIVE ORACLE ESTIMATE'}
                  </span>
                </div>

                {/* 3-Stage Pipeline */}
                <div className="space-y-4">
                  {/* STAGE 1: Optimal Yield Position Routing */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-cyan-400 uppercase tracking-wider">
                        1. Deposit Route (100% Principal Deployed)
                      </span>
                      <span className="font-mono text-slate-400">
                        Weighted APY: <strong className="text-cyan-300">{effectiveApy}%</strong>
                      </span>
                    </div>

                    <div className="space-y-2">
                      {displayPositions.map((pos, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm" aria-hidden="true">🏦</span>
                            <div>
                              <div className="font-bold text-white">{pos.protocol}</div>
                              <div className="text-[11px] text-slate-400 font-mono">
                                {pos.share_percent}% allocation • {pos.expected_apy}% Live APY
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="font-bold text-cyan-300 text-sm">
                              ${pos.allocation_usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC
                            </div>
                            <div className="text-[10px] text-emerald-400">0% Principal Fee</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* STAGE 2: On-Chain Pre-Commitment Instruction */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-teal-500/30 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-teal-400 uppercase tracking-wider">
                        2. On-Chain Pre-Commitment Policy (Bound at Deposit)
                      </span>
                      <span className="px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800 text-[10px] font-mono">
                        YIELD_SPLIT_ON_WITHDRAWAL
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      Locks a pre-commitment instruction allocating{' '}
                      <strong className="text-emerald-400">{displayDelegatedPct}%</strong> of all accrued yield upon withdrawal to automatically purchase and burn tokenized carbon credits.
                    </p>

                    <div className="grid grid-cols-2 gap-2 pt-1 text-[11px] font-mono">
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <span className="text-slate-400 block">Tokenized Carbon Mint:</span>
                        <span className="text-emerald-300 truncate block" title={TOKENIZED_CARBON_MINT}>
                          {TOKENIZED_CARBON_MINT.slice(0, 16)}...
                        </span>
                      </div>
                      <div className="p-2 rounded bg-slate-900 border border-slate-800">
                        <span className="text-slate-400 block">Footprint Neutralized:</span>
                        <span className="text-white font-bold">
                          ~{displayKgCo2} kg CO₂ ({footprintCoveragePercent}% of target)
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* STAGE 3: Subsequent Withdrawal & Carbon Credit Burn */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/40 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-400 uppercase tracking-wider">
                        3. Subsequent Withdrawal Settlement ({timeframeMonths} {timeframeMonths === 1 ? 'Mo' : 'Mos'})
                      </span>
                      <span className="font-mono text-xs text-white">
                        Gross Yield: <strong>+${displayGrossYield.toFixed(2)} USDC</strong>
                      </span>
                    </div>

                    {/* Visual Yield Split Bar */}
                    <div className="space-y-1.5">
                      <div className="w-full h-3 bg-slate-900 rounded-full overflow-hidden flex border border-slate-800">
                        <div
                          style={{ width: `${Math.max(4, displayDelegatedPct)}%` }}
                          className="bg-emerald-500 h-full transition-all duration-300"
                          title="Pre-Committed Carbon Credit Buy & Burn"
                        />
                        <div
                          style={{ width: `${Math.max(4, 100 - displayDelegatedPct)}%` }}
                          className="bg-cyan-400 h-full transition-all duration-300"
                          title="Net Yield Paid to User"
                        />
                      </div>
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-emerald-400">
                          🌿 {displayDelegatedPct}% Tokenized Carbon Burn: ${displayOffsetBurn.toFixed(2)} ({displayKgCo2} kg CO₂)
                        </span>
                        <span className="text-cyan-300">
                          💵 {(100 - displayDelegatedPct).toFixed(1)}% Net User Yield: +${displayNetYield.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Final Settlement Numbers */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center font-mono">
                      <div className="p-2 rounded-lg bg-slate-900/70">
                        <div className="text-[10px] text-slate-400">Principal Returned</div>
                        <div className="text-xs font-bold text-white">
                          ${totalLiquidity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-900/70">
                        <div className="text-[10px] text-slate-400">Carbon Retired</div>
                        <div className="text-xs font-bold text-emerald-400">
                          {displayKgCo2} kg (≈{displayTrees} trees)
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60">
                        <div className="text-[10px] text-emerald-300">Total User Payout</div>
                        <div className="text-xs font-extrabold text-white">
                          ${displayTotalPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Transaction Submission Hub: Connect Wallet OR Submit via Solana Blinks */}
                <div className="space-y-4 pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">
                      🚀 Choose Transaction Execution Method
                    </span>
                    <span className="text-[11px] font-mono text-slate-400">
                      Est. Network Fee: ~0.000005 SOL
                    </span>
                  </div>

                  {/* Execution Channel Radio Selector (< 6 options per modern web guidance) */}
                  <div
                    className="grid grid-cols-2 gap-3"
                    role="radiogroup"
                    aria-label="Transaction submission method"
                  >
                    <label
                      htmlFor="submit-method-wallet"
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-1.5 ${
                        submissionChannel === 'wallet'
                          ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-md shadow-emerald-950/40'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            id="submit-method-wallet"
                            type="radio"
                            name="submission_channel"
                            value="wallet"
                            checked={submissionChannel === 'wallet'}
                            onChange={() => setSubmissionChannel('wallet')}
                            className="accent-emerald-500"
                          />
                          <span className="text-xs font-bold">👛 Connect & Sign Wallet</span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                          Direct Sign
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug pl-5">
                        Connect Phantom, Solflare, or Devnet Signer to sign the pre-committed route directly.
                      </p>
                    </label>

                    <label
                      htmlFor="submit-method-blink"
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-1.5 ${
                        submissionChannel === 'blink'
                          ? 'bg-cyan-950/40 border-cyan-500 text-white shadow-md shadow-cyan-950/40'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            id="submit-method-blink"
                            type="radio"
                            name="submission_channel"
                            value="blink"
                            checked={submissionChannel === 'blink'}
                            onChange={() => setSubmissionChannel('blink')}
                            className="accent-cyan-400"
                          />
                          <span className="text-xs font-bold">⚡ Submit via Solana Blink</span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                          Actions v2.1
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug pl-5">
                        Execute or share a portable Solana Action Blink across X, Dialect, or mobile wallets.
                      </p>
                    </label>
                  </div>

                  {/* Active Execution Channel Panel */}
                  {submissionChannel === 'wallet' ? (
                    <div className="rounded-xl border border-emerald-500/30 bg-slate-950 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            <span>Solana Wallet Connection</span>
                            {walletAddress && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-700">
                                {walletProviderName}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {walletAddress
                              ? `Signer Fee Payer: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-6)}`
                              : 'No wallet connected yet — connect Phantom/Solflare or use instant Devnet Signer'}
                          </div>
                        </div>

                        {!walletAddress ? (
                          <button
                            type="button"
                            onClick={connectSolanaWallet}
                            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-600/50 cursor-pointer transition-all"
                          >
                            🔌 Connect Wallet
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={disconnectSolanaWallet}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800 cursor-pointer"
                          >
                            Switch / Disconnect
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={handleWalletSignAndSubmit}
                        disabled={loading}
                        className="w-full py-3 rounded-xl font-bold text-xs bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-950/50 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {loading && submissionChannel === 'wallet' ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                            Signing & Broadcasting with Wallet...
                          </>
                        ) : walletAddress ? (
                          <>
                            <span aria-hidden="true">✍️</span>
                            Sign & Submit Transaction ({walletAddress.slice(0, 4)}...{walletAddress.slice(-4)})
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">👛</span>
                            Connect Wallet & Sign Pre-Committed Route
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-cyan-500/30 bg-slate-950 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            <span>Solana Action / Blink Submission</span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                              solana-action:
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Submit directly via the Solana Actions endpoint or copy the Blink URI for any Blink client.
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab('blink_preview')}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 cursor-pointer"
                        >
                          📱 Full Blink Card
                        </button>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={handleBlinkSubmit}
                          disabled={loading}
                          className="flex-1 py-3 px-4 rounded-xl font-bold text-xs bg-gradient-to-r from-cyan-400 to-emerald-400 hover:from-cyan-300 hover:to-emerald-300 text-slate-950 shadow-lg shadow-cyan-950/50 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {loading && submissionChannel === 'blink' ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                              Executing Solana Blink Action...
                            </>
                          ) : (
                            <>
                              <span aria-hidden="true">⚡</span>
                              Submit Transaction via Solana Blink
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={copyBlinkActionUrl}
                          className="py-3 px-3.5 rounded-xl font-mono text-xs bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 cursor-pointer transition-all"
                        >
                          {copiedBlinkUrl ? '✓ Copied Blink URI' : '🔗 Copy Blink Link'}
                        </button>

                        <a
                          href={getDialectBlinksUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-3 px-3.5 rounded-xl font-mono text-xs bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 flex items-center justify-center gap-1 transition-all"
                        >
                          🌐 dial.to ↗
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Clean Human-Readable Transaction Confirmation Receipt (No Raw Bytecode) */}
                  {result && (
                    <div className="space-y-3 pt-2">
                      {/* Route Rationale */}
                      <div className="rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                            <span aria-hidden="true">🧠</span> Middleware Optimization Summary
                          </span>
                          <span className="text-[10px] font-mono text-emerald-400">
                            Route ID: {result.execution_id.slice(0, 8)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          &ldquo;{result.reasoning_log}&rdquo;
                        </p>
                      </div>

                      {/* Confirmed On-Chain Receipt */}
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/15 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-base" aria-hidden="true">✅</span>
                            <div>
                              <div className="text-xs font-bold text-white">
                                Pre-Committed Transaction Confirmed
                              </div>
                              <div className="text-[11px] text-emerald-300 font-mono">
                                {submittedVia === 'blink'
                                  ? 'Submitted via Solana Blink Action (v2.1)'
                                  : `Signed by ${walletProviderName || 'Connected Solana Wallet'}`}
                              </div>
                            </div>
                          </div>

                          {result.transaction_details && (
                            <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-950 text-slate-300 border border-slate-800">
                              Signer: {result.transaction_details.fee_payer.slice(0, 6)}...
                              {result.transaction_details.fee_payer.slice(-4)}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px] font-mono pt-1">
                          <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1">
                            <div className="text-slate-400">1. Optimal Yield Deposit Receipt</div>
                            <div className="text-cyan-300 font-bold truncate">
                              {result.transaction_signatures.yield_deposit}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              100% Principal (${totalLiquidity.toLocaleString()} USDC) Active
                            </div>
                          </div>

                          {result.transaction_signatures.subsequent_withdrawal && (
                            <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1">
                              <div className="text-slate-400">2. Withdrawal Carbon Pre-Commit</div>
                              <div className="text-emerald-400 font-bold truncate">
                                {result.transaction_signatures.subsequent_withdrawal}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {displayDelegatedPct}% of Yield Locked to Carbon Mint
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Solana Blink Preview */}
        {activeTab === 'blink_preview' && (
          <div className="max-w-md mx-auto space-y-4">
            <div className="text-center space-y-1 pb-2">
              <h2 className="font-bold text-white text-lg">Solana Blink Action Card</h2>
              <p className="text-xs text-slate-400">
                Shareable Solana Action card for X/Twitter, Dialect, Phantom, and Backpack.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900 overflow-hidden shadow-2xl">
              <div className="h-44 bg-gradient-to-br from-emerald-900 via-teal-950 to-slate-950 flex flex-col items-center justify-center p-6 text-center border-b border-slate-800">
                <Image
                  src="/logo.png"
                  alt="TerraYield Logo"
                  width={48}
                  height={48}
                  className="w-12 h-12 object-contain mb-2"
                />
                <span className="text-xs uppercase tracking-wider font-bold text-emerald-400">
                  TerraYield • Carbon-Neutral DeFi Blink
                </span>
                <span className="text-[11px] text-slate-400 mt-1 font-mono">
                  Footprint: {horizonFootprintKg} kg CO₂ ➔ Suggested: {suggestedYieldPercent}% Yield
                </span>
              </div>

              <div className="p-5 space-y-4">
                <div className="space-y-1">
                  <h3 className="font-bold text-white text-base">
                    Route Optimal Yield + Pre-Commit Carbon Offset
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Middleware queries live Solana lending rates ({effectiveApy}% Weighted APY) and pre-commits {activeOffsetYieldPercent}% of withdrawal yield to retire tokenized carbon credits.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1.5 font-mono">
                  <div className="flex justify-between text-slate-300">
                    <span>Principal Deployed:</span>
                    <span className="text-white font-bold">${totalLiquidity.toLocaleString()} USDC</span>
                  </div>
                  <div className="flex justify-between text-emerald-400">
                    <span>Pre-Committed Yield ({activeOffsetYieldPercent}%):</span>
                    <span>${projectedOffsetBurn.toFixed(2)} ({projectedCarbonKgRetired} kg CO₂)</span>
                  </div>
                  <div className="flex justify-between text-cyan-300 pt-1 border-t border-slate-800">
                    <span>Est. User Payout ({timeframeMonths} mo):</span>
                    <span className="font-bold">${projectedTotalPayout.toFixed(2)} USDC</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleBlinkSubmit}
                    disabled={loading}
                    className="w-full py-3 rounded-xl font-bold text-xs bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {loading ? 'Submitting Blink Transaction...' : '⚡ Sign & Submit via Solana Blink'}
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={copyBlinkActionUrl}
                      className="py-2 px-3 rounded-xl font-mono text-[11px] bg-slate-950 hover:bg-slate-800 text-cyan-300 border border-slate-800 cursor-pointer"
                    >
                      {copiedBlinkUrl ? '✓ Copied Blink URI' : '🔗 Copy Blink URI'}
                    </button>
                    <a
                      href={getDialectBlinksUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="py-2 px-3 rounded-xl font-mono text-[11px] bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 text-center"
                    >
                      🌐 Open on dial.to ↗
                    </a>
                  </div>
                  <p className="text-[10px] text-slate-500 text-center leading-normal pt-0.5">
                    Note: dial.to requires a publicly accessible HTTPS domain. In local dev, click the submit button above or expose via tunnel/deployment.
                  </p>
                </div>

                {result && txStatus === 'submitted' && (
                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-xs font-mono space-y-1">
                    <div className="text-emerald-300 font-bold">
                      ✅ Blink Transaction Submitted!
                    </div>
                    <div className="text-[11px] text-slate-300 truncate">
                      Tx: {result.transaction_signatures.yield_deposit}
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span>POST /api/actions/terrayield</span>
                <span className="text-emerald-400">Solana Actions v2.1</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function projectedCarbonKgKgLabel(kg: number): string {
  return `~${kg} kg CO₂`
}
