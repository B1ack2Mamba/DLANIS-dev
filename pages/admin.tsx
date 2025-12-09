// File: pages/dlan_vip.tsx
// VIP-фронт (3-й): просмотр DLAN-баланса + управление VIP (tier 3) + применение vip.json

import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddress, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Toaster, toast } from "sonner";
import { Buffer } from "buffer";
import { RefreshCw, Shield, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";

import idlJson from "../idl/dlan_stake.json";

// Polyfill Buffer
// @ts-ignore
(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;

// ===== IDL / Program ID =====================================================

const ENV_PROGRAM_ID = process.env.NEXT_PUBLIC_DLAN_PROGRAM_ID;
const IDL_PROGRAM_ID = (idlJson as any)?.metadata?.address || (idlJson as any)?.address;
const FALLBACK_PROGRAM_ID = "3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7";
const PROGRAM_ID = new PublicKey(ENV_PROGRAM_ID || IDL_PROGRAM_ID || FALLBACK_PROGRAM_ID);

const idl: any = idlJson as any;
idl.metadata = idl.metadata ?? {};
idl.metadata.address = idl.metadata.address || idl.address || PROGRAM_ID.toBase58();

// ===== Const / utils ========================================================

const DEFAULT_DLAN_MINT = new PublicKey("9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR");

function shortPk(pk?: PublicKey | string | null) {
  const s = typeof pk === "string" ? pk : pk?.toBase58();
  if (!s) return "—";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function u8ToString(arr?: number[] | Uint8Array | null, len?: number): string {
  if (!arr) return "";
  const u8 = Array.isArray(arr) ? Uint8Array.from(arr) : arr;
  const view = typeof len === "number" && len >= 0 ? u8.subarray(0, len) : u8;
  try {
    return new TextDecoder().decode(view).replace(/\u0000+$/g, "");
  } catch {
    return "";
  }
}

function anchorErrorToText(err: any): string {
  const raw = String(err?.error?.errorMessage || err?.message || err);
  const m = raw.toLowerCase();
  if (m.includes("tier 3 required")) return "Нужен VIP-уровень (tier 3).";
  if (m.includes("unauthorized admin")) return "Только админ может делать это действие.";
  if (m.includes("profile mismatch")) return "Аккаунт доступа принадлежит другому пользователю.";
  return raw;
}

// форматирование целых токенов
const fmtUnitsInt = (n: anchor.BN, decimals: number) => {
  const denom = 10 ** decimals;
  const whole = Math.floor(Number(n.toString()) / denom);
  return Number.isFinite(whole) ? whole.toLocaleString() : "0";
};

type VipJsonTier = {
  wallet: string;
  buttons?: number[];
  fee_recipient?: string;
};
type VipJson = {
  invest_usd_per_dlan_rule?: { dlan_per_usd_per_day?: number };
  invest_fee_recipient?: string;
  tiers?: VipJsonTier[];
};

// ===== Small UI kit =========================================================

const Btn = (props: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}) => {
  const { children, onClick, type, variant = "primary", disabled, loading, className } = props;
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const pal: Record<string, string> = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500",
    secondary: "bg-neutral-800 text-white hover:bg-neutral-700",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
    ghost: "bg-white text-neutral-800 hover:bg-neutral-50 border border-neutral-200",
  };
  const state = disabled || loading ? "opacity-50 pointer-events-none" : "";
  return (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${pal[variant]} ${state} ${className || ""}`}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-[0_10px_30px_rgba(36,0,255,0.06)] ${className}`}>{children}</div>
);
const CardHeader = ({ children, className = "" }: { children: React.ReactNode; className?: string }) =>
  <div className={`p-4 pb-2 ${className}`}>{children}</div>;
const CardTitle = ({ children, className = "" }: { children: React.ReactNode; className?: string }) =>
  <h3 className={`text-base font-bold tracking-tight ${className}`}>{children}</h3>;
const CardContent = ({ children, className = "" }: { children: React.ReactNode; className?: string }) =>
  <div className={`p-4 pt-0 space-y-3 ${className}`}>{children}</div>;

const MiniStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-neutral-200 bg-white p-3">
    <div className="text-sm font-semibold">{label}</div>
    <div className="mt-1 text-2xl font-extrabold">{value}</div>
  </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 outline-none ring-indigo-500 focus:ring-2 placeholder-neutral-400 ${props.className || ""}`}
  />
);

// ===== Main component =======================================================

export default function DlanVipPage() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(
    () =>
      wallet?.publicKey
        ? new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" })
        : null,
    [connection, wallet],
  );

  const program = useMemo(
    () => (provider ? (new anchor.Program(idl as Idl, provider) as any) : null),
    [provider],
  );

  // PDAs
  const configPda = useMemo(
    () => PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0],
    [],
  );
  const userAccessPda = useMemo(
    () =>
      wallet.publicKey
        ? PublicKey.findProgramAddressSync(
            [Buffer.from("user-access"), wallet.publicKey.toBuffer()],
            PROGRAM_ID,
          )[0]
        : null,
    [wallet.publicKey],
  );

  const [config, setConfig] = useState<any | null>(null);
  const [userAccess, setUserAccess] = useState<any | null>(null);
  const [dlanMint, setDlanMint] = useState<PublicKey | null>(null);

  const tryFetch = useCallback(async (ns: any, pda: PublicKey) => {
    try {
      if (typeof ns.fetchNullable === "function") return await ns.fetchNullable(pda);
      return await ns.fetch(pda);
    } catch {
      return null;
    }
  }, []);

  const pullOnchain = useCallback(async () => {
    if (!program) return;
    try {
      const acc = program.account as any;
      const cfg = await tryFetch(acc.socialConfig, configPda);
      setConfig(cfg);
      if (cfg?.dlanMint) setDlanMint(new PublicKey(cfg.dlanMint));
      else setDlanMint(DEFAULT_DLAN_MINT);

      if (wallet.publicKey && userAccessPda) {
        const ua = await tryFetch(acc.userAccess, userAccessPda);
        setUserAccess(ua);
      } else {
        setUserAccess(null);
      }
    } catch (e) {
      console.error(e);
    }
  }, [program, configPda, userAccessPda, wallet.publicKey, tryFetch]);

  useEffect(() => {
    pullOnchain();
  }, [pullOnchain]);

  // ==== DLAN баланс / supply =================================================

  const [dlanDecimals, setDlanDecimals] = useState<number>(9);
  const [dlanTotalUnits, setDlanTotalUnits] = useState<anchor.BN>(new anchor.BN(1));
  const [dlanUserUnits, setDlanUserUnits] = useState<anchor.BN>(new anchor.BN(0));

  useEffect(() => {
    (async () => {
      if (!provider) return;
      const mintPk = dlanMint || DEFAULT_DLAN_MINT;
      try {
        const mintInfo = await getMint(provider.connection, mintPk);
        setDlanDecimals(mintInfo.decimals);
        setDlanTotalUnits(new anchor.BN(mintInfo.supply.toString()));
        if (wallet.publicKey) {
          const ata = await getAssociatedTokenAddress(mintPk, wallet.publicKey);
          const bal = await provider.connection.getTokenAccountBalance(ata).catch(() => null);
          setDlanUserUnits(
            bal?.value?.amount ? new anchor.BN(bal.value.amount) : new anchor.BN(0),
          );
        } else {
          setDlanUserUnits(new anchor.BN(0));
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [provider, wallet.publicKey, dlanMint]);

  const dlanUserWhole = useMemo(
    () => fmtUnitsInt(dlanUserUnits, dlanDecimals),
    [dlanUserUnits, dlanDecimals],
  );
  const dlanTotalWhole = useMemo(
    () => fmtUnitsInt(dlanTotalUnits, dlanDecimals),
    [dlanTotalUnits, dlanDecimals],
  );
  const dlanPct = useMemo(() => {
    if (dlanTotalUnits.isZero()) return "0.00%";
    const p = (dlanUserUnits.toNumber() / Number(dlanTotalUnits.toString())) * 100;
    return `${p.toFixed(2)}%`;
  }, [dlanUserUnits, dlanTotalUnits]);

  // ==== Tier / admin ========================================================

  const myTier = Number(userAccess?.tier ?? 0);
  const adminPk = config?.admin ? new PublicKey(config.admin) : null;
  const isAdmin =
    !!wallet.publicKey && !!adminPk && wallet.publicKey.equals(adminPk as PublicKey);

  // ==== VIP JSON ============================================================

  const [vipJson, setVipJson] = useState<VipJson | null>(null);
  const [loadingVipJson, setLoadingVipJson] = useState(false);

  const loadVipJson = useCallback(async () => {
    try {
      setLoadingVipJson(true);
      const r = await fetch("/vip.json");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as VipJson;
      setVipJson(data);
      toast.success("vip.json загружен");
    } catch (e: any) {
      toast.error(`Не удалось прочитать vip.json: ${e?.message || String(e)}`);
    } finally {
      setLoadingVipJson(false);
    }
  }, []);

  useEffect(() => {
    // один раз подцепим vip.json, чтобы был под рукой
    loadVipJson().catch(() => {});
  }, [loadVipJson]);

  // ==== Admin: setVipTier ===================================================

  const [targetWallet, setTargetWallet] = useState("");
  const [busySingle, setBusySingle] = useState(false);
  const [busyVipJsonApply, setBusyVipJsonApply] = useState(false);

  const setVipFor = useCallback(
    async (walletStr: string, value: boolean) => {
      if (!program || !wallet.publicKey) {
        toast.error("Нет соединения или кошелька");
        return;
      }
      if (!isAdmin) {
        toast.error("Только админ может менять VIP-уровни");
        return;
      }
      let userPk: PublicKey;
      try {
        userPk = new PublicKey(walletStr.trim());
      } catch {
        toast.error("Неверный адрес кошелька");
        return;
      }

      try {
        setBusySingle(true);
        const admin = wallet.publicKey;
        const user = userPk;
        const userAccess = PublicKey.findProgramAddressSync(
          [Buffer.from("user-access"), user.toBuffer()],
          PROGRAM_ID,
        )[0];

        await (program.methods as any)
          .setVipTier(value)
          .accounts({
            admin,
            user,
            userAccess,
            config: configPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        toast.success(
          value
            ? `Выдан VIP (tier 3) для ${shortPk(user)}`
            : `VIP снят (tier → 2) для ${shortPk(user)}`,
        );

        // обновим свои данные, если меняли сами себя
        if (wallet.publicKey.equals(user)) pullOnchain();
      } catch (e: any) {
        toast.error(anchorErrorToText(e));
      } finally {
        setBusySingle(false);
      }
    },
    [program, wallet.publicKey, isAdmin, configPda, pullOnchain],
  );

  const applyVipJson = useCallback(async () => {
    if (!program || !wallet.publicKey) {
      toast.error("Нет соединения или кошелька");
      return;
    }
    if (!isAdmin) {
      toast.error("Только админ может применять vip.json");
      return;
    }

    try {
      setBusyVipJsonApply(true);
      // если по какой-то причине не загружен — догружаем
      let cfg = vipJson;
      if (!cfg) {
        const r = await fetch("/vip.json");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        cfg = (await r.json()) as VipJson;
        setVipJson(cfg);
      }
      const tiers = cfg?.tiers || [];
      if (tiers.length === 0) {
        toast.error("В vip.json нет списка tiers");
        return;
      }

      const admin = wallet.publicKey;

      for (const t of tiers) {
        try {
          const user = new PublicKey(t.wallet);
          const userAccess = PublicKey.findProgramAddressSync(
            [Buffer.from("user-access"), user.toBuffer()],
            PROGRAM_ID,
          )[0];

          await (program.methods as any)
            .setVipTier(true)
            .accounts({
              admin,
              user,
              userAccess,
              config: configPda,
              systemProgram: SystemProgram.programId,
            })
            .rpc();

          toast.success(`VIP выдан: ${shortPk(user)}`);
        } catch (e: any) {
          console.error(e);
          toast.error(`Ошибка для ${t.wallet}: ${anchorErrorToText(e)}`);
        }
      }
    } catch (e: any) {
      toast.error(`Ошибка применения vip.json: ${e?.message || String(e)}`);
    } finally {
      setBusyVipJsonApply(false);
    }
  }, [program, wallet.publicKey, isAdmin, configPda, vipJson]);

  // ==== UI helpers ==========================================================

  const clusterLabel = useMemo(() => {
    const ep = (connection as any)?._rpcEndpoint || "";
    if (ep.includes("devnet")) return "Devnet";
    if (ep.includes("testnet")) return "Testnet";
    return "Mainnet";
  }, [connection]);

  const tierBadgeColor =
    myTier >= 3 ? "bg-emerald-100 text-emerald-700 border-emerald-300" : myTier >= 2
      ? "bg-indigo-100 text-indigo-700 border-indigo-300"
      : "bg-neutral-100 text-neutral-700 border-neutral-200";

  const tierIcon =
    myTier >= 3 ? <ShieldCheck className="h-4 w-4" /> : myTier >= 2 ? <Shield className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />;

  const myTierLabel =
    myTier >= 3 ? "Tier 3 (VIP)" : myTier === 2 ? "Tier 2" : myTier === 1 ? "Tier 1" : "Tier 0";

  const adminName = adminPk ? shortPk(adminPk) : "не задан";

  // ==== Render =============================================================

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#faf7ff] to-[#f4f7ff] text-neutral-900">
      <Toaster position="bottom-right" richColors closeButton />

      <div className="mx-auto max-w-6xl px-4 pt-4 pb-10">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-extrabold flex items-center gap-2">
            DLAN VIP Front
          </div>

          <span className="ml-2 rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold border border-neutral-200">
            {clusterLabel}
          </span>

          <span className="ml-2 rounded-full bg-white px-3 py-1 text-xs font-semibold border border-neutral-200">
            {wallet.publicKey ? shortPk(wallet.publicKey) : "Нет кошелька"}
          </span>

          <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold border ${tierBadgeColor}`}>
            {tierIcon}
            {myTierLabel}
          </span>
        </div>

        <div className="mt-2 text-xs text-rose-600">
          Для активации VIP-функций твой адрес должен быть в <code>vip.json</code>, а админ
          (config.admin) должен один раз вызвать <code>set_vip_tier(true)</code> — теперь это можно
          сделать прямо отсюда.
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* LEFT: DLAN баланс и объяснение */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <CardTitle>DLAN баланс</CardTitle>
                <div className="mt-1 text-xs text-neutral-500">
                  Эти показатели считаются по тому же <code>dlan_mint</code>, что и на основном
                  фронте.
                </div>
              </div>
              <Btn
                variant="ghost"
                onClick={() => {
                  pullOnchain();
                }}
                className="!py-1.5 !px-3 text-xs"
              >
                <RefreshCw className="h-4 w-4" /> Обновить
              </Btn>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <MiniStat label="Твой DLAN" value={dlanUserWhole} />
                <MiniStat label="Всего DLAN" value={dlanTotalWhole} />
                <MiniStat label="Твоя доля" value={dlanPct} />
              </div>

              <div className="mt-4 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-600">
                Этот экран — надстройка над 2-м фронтом. Стейк/клейм ты продолжаешь делать там.
                Здесь — именно VIP-соц. награды, которые завязаны на <code>rewardAnswer</code>,{" "}
                <code>rewardFriendAdd</code> и <code>claimSocialDlan</code>, плюс выдача VIP для
                других.
              </div>
            </CardContent>
          </Card>

          {/* RIGHT: VIP Social + Admin */}
          <Card>
            <CardHeader>
              <CardTitle>VIP Social Rewards</CardTitle>
              <div className="mt-1 text-xs text-neutral-500">
                Этот фронт рассчитан на VIP-участников (<strong>tier 3+</strong>). Сами награды
                за ответы/друзей/клейм берутся из ончейна через{" "}
                <code>rewardAnswer / rewardFriendAdd / claimSocialDlan</code>. Ниже — панель
                управления VIP для админа.
              </div>
              <div className="mt-2 text-xs text-neutral-500">
                Админ (config.admin):{" "}
                <span className="font-semibold">{adminName}</span>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {!isAdmin && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 flex gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-[1px]" />
                  <div>
                    Ты не являешься админом в <code>SocialConfig</code>. VIP-тиеры может менять
                    только кошелёк <span className="font-semibold">{adminName}</span>. Зайди сюда с
                    этого адреса, чтобы выдавать tier-3 другим кошелькам.
                  </div>
                </div>
              )}

              {/* Admin block */}
              <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <div className="font-semibold text-sm">
                    Админ: управление VIP (tier 3)
                  </div>
                </div>

                <div className="text-xs text-neutral-500">
                  Впиши адрес кошелька и нажми «Выдать VIP», чтобы вызвать{" "}
                  <code>set_vip_tier(true)</code>. Кнопка «Снять VIP» вызовет{" "}
                  <code>set_vip_tier(false)</code> и опустит его до tier 2.
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <Input
                    placeholder="Кошелёк пользователя (Solana address)"
                    value={targetWallet}
                    onChange={(e) => setTargetWallet(e.target.value)}
                  />

                  <div className="flex flex-wrap gap-2">
                    <Btn
                      onClick={() => setVipFor(targetWallet, true)}
                      disabled={!isAdmin || !targetWallet.trim()}
                      loading={busySingle}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Выдать VIP (tier 3)
                    </Btn>

                    <Btn
                      variant="secondary"
                      onClick={() => setVipFor(targetWallet, false)}
                      disabled={!isAdmin || !targetWallet.trim()}
                      loading={busySingle}
                    >
                      <Shield className="h-4 w-4" />
                      Снять VIP (до tier 2)
                    </Btn>
                  </div>
                </div>

                <div className="mt-3 border-t border-neutral-200 pt-3 text-xs text-neutral-500">
                  <div className="flex items-center gap-2 mb-2">
                    <UserPlus className="h-4 w-4" />
                    <span className="font-semibold">Массово по vip.json</span>
                  </div>
                  <div className="mb-2">
                    Файл <code>/public/vip.json</code> содержит список{" "}
                    <code>tiers[].wallet</code>. Кнопка ниже пробежит по нему и вызовет{" "}
                    <code>set_vip_tier(true)</code> для каждого адреса.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Btn
                      variant="ghost"
                      onClick={loadVipJson}
                      disabled={loadingVipJson}
                      loading={loadingVipJson}
                    >
                      <RefreshCw className="h-4 w-4" /> Перечитать vip.json
                    </Btn>
                    <Btn
                      onClick={applyVipJson}
                      disabled={!isAdmin}
                      loading={busyVipJsonApply}
                    >
                      <UserPlus className="h-4 w-4" />
                      Применить vip.json (выдать VIP)
                    </Btn>
                  </div>
                  {vipJson?.tiers && (
                    <div className="mt-2 text-[11px] text-neutral-500">
                      Найдено адресов в <code>tiers</code>:{" "}
                      <span className="font-semibold">
                        {vipJson.tiers.length}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
