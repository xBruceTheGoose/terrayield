import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About & Architecture | TerraYield',
  description:
    'Learn how TerraYield turns Solana DeFi yield into automated, zero-principal-loss carbon neutrality.',
}

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 font-sans selection:bg-emerald-500 selection:text-white">
      {/* Ambient Glows */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10" aria-hidden="true">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-4xl mx-auto space-y-10">
        {/* Navigation & Header */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
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
              <span className="text-2xl font-black tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                TerraYield
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-emerald-950 text-emerald-400 border border-emerald-800">
                Architecture & Guide
              </span>
            </div>
            <p className="text-sm text-slate-400">
              The AI middleware turning DeFi yield into automated carbon neutrality.
            </p>
          </div>

          <nav aria-label="Main Navigation">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/40 transition-all cursor-pointer shadow-sm"
            >
              <span aria-hidden="true">←</span> Back to Simulator
            </Link>
          </nav>
        </header>

        {/* Hero Section */}
        <article className="space-y-8">
          <section className="space-y-4">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Zero-Loss Climate Action Powered by Solana DeFi
            </h1>
            <p className="text-base text-slate-300 leading-relaxed">
              Traditional carbon offsets feel like a tax: you pay money out of pocket, and it’s gone.
              <strong> TerraYield flips the script with eco-arbitrage</strong>: 100% of your deposit principal remains entirely yours in high-yield Solana DeFi protocols. You only pre-commit a calculated percentage of your future earned yield to purchase and retire verified tokenized carbon credits upon withdrawal.
            </p>

            <div className="grid sm:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  100% Principal Protection
                </div>
                <div className="text-sm text-slate-200">
                  Zero upfront deductions. Every cent of your principal earns compounding yield.
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                  Real-Time Oracle Routing
                </div>
                <div className="text-sm text-slate-200">
                  Live Solana lending telemetry dynamically finds the highest-yielding verified vaults.
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-teal-400">
                  Automated Retirement
                </div>
                <div className="text-sm text-slate-200">
                  On-chain pre-commitment automatically buys &amp; burns tokenized carbon credits on withdrawal.
                </div>
              </div>
            </div>
          </section>

          {/* How It Works: 4 Step Pipeline */}
          <section className="space-y-6 pt-4">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-emerald-950 border border-emerald-600 inline-flex items-center justify-center text-xs text-emerald-400">
                ⚙️
              </span>
              How the Middleware Works
            </h2>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-emerald-400 font-mono text-sm">01.</span>
                    Carbon Footprint Calculation
                  </h3>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-slate-400 border border-slate-800">
                    $0.02 / kg CO₂ ($20 / ton)
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  The user selects a lifestyle profile (or adjusts flight, commute, and home energy sliders) to quantify their carbon footprint. The middleware translates that footprint into the exact dollar cost needed to retire an equivalent weight of tokenized carbon credits (such as NCT / Toucan credits on Solana).
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-cyan-400 font-mono text-sm">02.</span>
                    Live Yield Oracle &amp; Suggested Delegation Math
                  </h3>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-cyan-300 border border-slate-800">
                    Real-Time Telemetry
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  TerraYield queries live APYs and TVLs from premier Solana protocols (Kamino, Drift, Marginfi, Solend/Save). Based on the user’s deposit principal and timeline, the middleware calculates the exact percentage of earned yield required to achieve 100% carbon neutrality—leaving the rest of the yield as pure profit.
                </p>
              </div>

              {/* Step 3 */}
              <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-teal-400 font-mono text-sm">03.</span>
                    Multi-Instruction Solana Transaction Assembly
                  </h3>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-teal-300 border border-slate-800">
                    Atomic Execution
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Instead of requiring complex smart contract deployments, TerraYield leverages Solana’s native multi-instruction transaction format. In a single atomic payload, it deposits 100% of capital into optimal yield vaults and binds an immutable on-chain pre-commitment memo specifying the tokenized carbon mint and yield percentage.
                </p>
              </div>

              {/* Step 4 */}
              <div className="p-5 rounded-2xl bg-slate-900/50 border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="text-emerald-300 font-mono text-sm">04.</span>
                    Subsequent Withdrawal &amp; Automatic Burn
                  </h3>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-emerald-400 border border-slate-800">
                    SPL Token Burn
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  Upon maturity or withdrawal, the position unwinds: 100% of your initial principal is safely returned to your wallet, the pre-committed yield slice purchases and burns tokenized carbon credits on-chain, and the remaining net yield is deposited directly into your balance.
                </p>
              </div>
            </div>
          </section>

          {/* Solana Blinks & Actions */}
          <section className="space-y-4 pt-4">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-cyan-950 border border-cyan-600 inline-flex items-center justify-center text-xs text-cyan-400">
                ⚡
              </span>
              Solana Actions &amp; Blinks (Dialect Standard)
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              TerraYield is natively built on the <strong>Solana Actions specification (v2.1)</strong>.
              Every yield route and pre-commitment configuration generates a shareable <code>solana-action:</code> URL that unfurls into an interactive Blink across X (Twitter), Dialect, Discord, and Solana wallets (Phantom, Backpack, Solflare). Users can inspect, sign, and fund their climate-arbitraged positions in one click without leaving their social feed.
            </p>
          </section>

          {/* Decentralization & IPFS Viability */}
          <section className="p-6 rounded-2xl bg-slate-900/80 border border-cyan-500/30 space-y-3">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span aria-hidden="true">🌐</span> Can TerraYield Be Deployed to IPFS?
            </h2>
            <div className="space-y-2 text-xs sm:text-sm text-slate-300 leading-relaxed">
              <p>
                <strong>Frontend UI (Static Web3 Hosting):</strong> Yes! The entire React user interface, simulator, and wallet connection client can be compiled to static assets (<code>next export</code>) and pinned to <strong>IPFS</strong> or Arweave via Pinata, Fleek, or 4EVERLAND. This provides a permanent, censorship-resistant access portal resolvable via IPNS or Solana Name Service (<code>.sol</code>).
              </p>
              <p>
                <strong>Middleware &amp; Solana Blinks (Dynamic API Layer):</strong> Solana Actions and Blinks require dynamic HTTP endpoints (<code>GET</code> for metadata and <code>POST</code> for live transaction construction). Because IPFS is a decentralized file storage protocol rather than a server runtime, the API middleware operates as an edge function (e.g., Cloudflare Workers, Vercel Edge, or decentralized compute networks like Akash or Phala). This hybrid architecture gives users the censorship-resistance of IPFS for the frontend with the real-time speed of edge computing for DeFi routing.
              </p>
            </div>
          </section>

          {/* CTA Footer */}
          <footer className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-400">
              TerraYield • Built for the Solana Climate &amp; DeFi Ecosystem
            </div>
            <Link
              href="/"
              className="px-5 py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 shadow-md transition-all cursor-pointer"
            >
              Launch Guided Simulator ➔
            </Link>
          </footer>
        </article>
      </div>
    </main>
  )
}
