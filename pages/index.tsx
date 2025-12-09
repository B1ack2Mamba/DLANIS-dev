// File: pages/index.tsx
import React from "react";
import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#020617] text-white flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-6xl rounded-[32px] border border-[#262654] bg-gradient-to-b from-[#050816] to-[#020617] p-8 md:p-10 lg:p-12 shadow-[0_0_80px_rgba(66,64,255,0.35)]">
        {/* Top row: logo + wallet button */}
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs font-semibold tracking-[0.35em] text-indigo-300 uppercase">
              DLANIS
            </div>
            <h1 className="mt-3 text-3xl md:text-4xl lg:text-5xl font-extrabold leading-tight">
              Distributed Liquidity &amp; Alignment Network
            </h1>
          </div>

          <div className="ml-auto">
            {/* Default button text is "Select Wallet" */}
            <WalletMultiButton className="!bg-[#6c35ff] hover:!bg-[#7e4bff] !rounded-2xl !px-6 !py-3 !text-[14px] !font-semibold shadow-[0_0_30px_rgba(124,58,237,0.55)]" />
          </div>
        </div>

        {/* Description */}
        <p className="mt-6 max-w-3xl text-sm md:text-base text-neutral-200 leading-relaxed">
          This is the entry point into the DLAN ecosystem: a fund powered by{" "}
          <span className="font-semibold">LP bots</span> (on-chain liquidity
          provision in DLMM pools) together with a{" "}
          <span className="font-semibold">grid hedging bot</span> on
          centralized exchanges. Core revenue comes from this LP + hedge
          engine, and is distributed back to stakers. On top of the fund layer,
          you get a social layer and advanced tools for users who pass further
          alignment levels.
        </p>

        {/* Fronts */}
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {/* Front 1 */}
          <div className="rounded-3xl border border-emerald-500/50 bg-gradient-to-br from-emerald-900/80 to-emerald-900/20 px-5 py-6 shadow-[0_0_40px_rgba(16,185,129,0.25)]">
            <div className="text-sm font-semibold text-emerald-100">
              1st Front • Fund
            </div>
            <p className="mt-3 text-xs md:text-sm text-emerald-50/90 leading-relaxed">
              Staking and claiming from the fund, the base layer of the whole
              system. Core exposure to LP + hedge bots. Recommended entry point
              for new users.
            </p>
            <Link
              href="/app"
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-emerald-950 hover:bg-emerald-400 transition"
            >
              Open Fund Front
            </Link>
          </div>

          {/* Front 2 */}
          <div className="rounded-3xl border border-indigo-500/50 bg-gradient-to-br from-indigo-900/80 to-indigo-900/20 px-5 py-6 shadow-[0_0_40px_rgba(79,70,229,0.35)]">
            <div className="text-sm font-semibold text-indigo-100">
              2nd Front • Social
            </div>
            <p className="mt-3 text-xs md:text-sm text-indigo-50/90 leading-relaxed">
              Profile, friends, direct messages and a global chat. Access is
              opened after reaching <span className="font-semibold">Tier 2</span>{" "}
              on-chain conditions.
            </p>
            <Link
              href="/app2"
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-indigo-500 px-4 py-2 text-xs font-semibold text-indigo-950 hover:bg-indigo-400 transition"
            >
              Open Social Front
            </Link>
          </div>

          {/* Front 3 */}
          <div className="rounded-3xl border border-fuchsia-500/50 bg-gradient-to-br from-fuchsia-900/80 to-fuchsia-900/20 px-5 py-6 shadow-[0_0_40px_rgba(217,70,239,0.35)]">
            <div className="text-sm font-semibold text-fuchsia-100">
              3rd Front • Advanced
            </div>
            <p className="mt-3 text-xs md:text-sm text-fuchsia-50/90 leading-relaxed">
              Advanced modes, experimental strategies and closed features for
              trusted users. High-leverage tools built on top of the fund +
              hedge engine.
            </p>
            <Link
              href="/app3"
              className="mt-4 inline-flex items-center justify-center rounded-2xl bg-fuchsia-500 px-4 py-2 text-xs font-semibold text-fuchsia-950 hover:bg-fuchsia-400 transition"
            >
              Open Advanced Front
            </Link>
          </div>
        </div>

        {/* Small footer text */}
        <p className="mt-6 text-[11px] text-neutral-500">
          Main access goes through the three fronts above. Secret mode is
          unlocked via a hidden trigger in the interface.
        </p>
      </div>
    </main>
  );
}
