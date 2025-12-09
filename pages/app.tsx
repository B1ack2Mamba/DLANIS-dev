// File: pages/dlan_tier1.tsx
// Tier 1 – простой финансовый фронт: стейк + клейм + KPI без соц.части.

import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import {
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getMint,
} from "@solana/spl-token";
import { Toaster, toast } from "sonner";
import { Buffer } from "buffer";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/router";

// Polyfill Buffer
// @ts-ignore
(globalThis as any).Buffer =
    (globalThis as any).Buffer || Buffer;

// ===== IDL / Program ID =====================================================
import idlJson from "../idl/dlan_stake.json";
const ENV_PROGRAM_ID = process.env.NEXT_PUBLIC_DLAN_PROGRAM_ID;
const IDL_PROGRAM_ID =
    (idlJson as any)?.metadata?.address || (idlJson as any)?.address;
const FALLBACK_PROGRAM_ID =
    "3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7";
const PROGRAM_ID = new PublicKey(
    ENV_PROGRAM_ID || IDL_PROGRAM_ID || FALLBACK_PROGRAM_ID
);
const idl: any = idlJson as any;
idl.metadata = idl.metadata ?? {};
idl.metadata.address =
    idl.metadata.address || idl.address || PROGRAM_ID.toBase58();

// ===== Const / Utils ========================================================
const USTATS_SEED = "ustats2";
const UACCESS_SEED = "user-access";
const USDT_DECIMALS = 6;
const SECS_PER_DAY = 86_400;

// Порог для разблокировки 2-го фронта
const CLAIMS_TARGET = 60;
const DLAN_TARGET = 100;

// Dev fallback quote
const FIXED_USD_PER_SOL = 200;

const DEFAULT_DLAN_MINT = new PublicKey(
    "9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR"
);
const USDT_MINT = new PublicKey(
    "3pqJ783gQtGVvEwRYSzEx78FTDP6cAfMB9xZ2qBscpxS"
);
const ADMIN_SOL_WALLET = new PublicKey(
    "Gxovarj3kNDd6ks54KNXknRh1GP5ETaUdYGr1xgqeVNh"
);

// ДОЛЖЕН совпадать с fee_owner в программе!
const FEE_WALLET = new PublicKey(
    "F5rP2d1tGcy2zv5bv3qdfj11GZNiC9ZVxMBFy7aaetzS"
);

function shortPk(pk?: PublicKey | string | null) {
    const s = typeof pk === "string" ? pk : pk?.toBase58();
    if (!s) return "—";
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function tryPubkey(s: string): PublicKey | null {
    try {
        return new PublicKey(s.trim());
    } catch {
        return null;
    }
}

function anchorErrorToText(err: any): string {
    const raw = String(
        err?.error?.errorMessage || err?.message || err
    );
    const m = raw.toLowerCase();
    if (m.includes("wrong mint")) return "Неверный mint.";
    if (m.includes("already been processed"))
        return "Транзакция уже обработана (повтор).";
    if (m.includes("investment exceeds limit"))
        return "Превышен лимит инвестиций по поинтам.";
    if (m.includes("not enough elapsed days"))
        return "Недостаточно прошедших дней для клейма.";
    if (m.includes("not enough claims"))
        return "Недостаточно клеймов для разблокировки.";
    if (m.includes("not enough dlan"))
        return "Недостаточно DLAN для разблокировки.";
    return raw;
}

const fmtUnitsInt = (n: anchor.BN, decimals: number) => {
    const denom = 10 ** decimals;
    const whole = Math.floor(Number(n.toString()) / denom);
    return Number.isFinite(whole) ? whole.toLocaleString() : "0";
};
const fmtUSDTInt = (usdtUnits: number | bigint) => {
    const n =
        typeof usdtUnits === "bigint"
            ? Number(usdtUnits)
            : Number(usdtUnits);
    const whole = Math.floor(n / 10 ** USDT_DECIMALS);
    return Number.isFinite(whole) ? whole.toLocaleString() : "0";
};

// ===== Small UI kit ========================================================
const BTN_W = "w-44";

const Btn = (props: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
    variant?: "primary" | "secondary" | "danger" | "ghost";
    disabled?: boolean;
    loading?: boolean;
    className?: string;
}) => {
    const {
        children,
        onClick,
        type,
        variant = "primary",
        disabled,
        loading,
        className,
    } = props;
    const base =
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-indigo-500";
    const pal: Record<string, string> = {
        primary: "bg-indigo-600 text-white hover:bg-indigo-500",
        secondary: "bg-neutral-800 text-white hover:bg-neutral-700",
        danger: "bg-rose-600 text-white hover:bg-rose-500",
        ghost:
            "bg-white text-neutral-800 hover:bg-neutral-50 border border-neutral-200",
    };
    const state =
        disabled || loading ? "opacity-50 pointer-events-none" : "";
    return (
        <button
            type={type || "button"}
            onClick={onClick}
            disabled={disabled || loading}
            className={`${base} ${pal[variant]} ${state} ${className || ""
                }`}
        >
            {children}
        </button>
    );
};

const Card = ({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) => (
    <div
        className={`rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-[0_10px_30px_rgba(36,0,255,0.06)] ${className}`}
    >
        {children}
    </div>
);

const CardHeader = ({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) => <div className={`p-4 pb-2 ${className}`}>{children}</div>;

const CardTitle = ({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) => (
    <h3 className={`text-base font-bold tracking-tight ${className}`}>
        {children}
    </h3>
);

const CardContent = ({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) => (
    <div className={`p-4 pt-0 space-y-3 ${className}`}>{children}</div>
);

const MiniStat = ({
    label,
    value,
}: {
    label: string;
    value: string;
}) => (
    <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <div className="text-sm font-semibold">{label}</div>
        <div className="mt-1 text-2xl font-extrabold">{value}</div>
    </div>
);

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
        {...props}
        className={`w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 outline-none ring-indigo-500 focus:ring-2 placeholder-neutral-400 ${props.className || ""
            }`}
    />
);

// ===== Stake + Claim card (как в базовом фронте) ===========================
type StakeAutoProps = {
    provider: anchor.AnchorProvider | null;
    program: anchor.Program<Idl> | null;
    dlanMintFromConfig: PublicKey | null;
    aprWithFee: string;
    onManualClaim: (payoutBase58?: string) => void;
    onOpenDetails: () => void;
};

function StakeAutoCard(props: StakeAutoProps) {
    const {
        provider,
        program,
        dlanMintFromConfig,
        aprWithFee,
        onManualClaim,
        onOpenDetails,
    } = props;

    const dlanMintUse = dlanMintFromConfig || DEFAULT_DLAN_MINT;
    const [stakeSol, setStakeSol] = useState<string>("1.000001");
    const [previewUsd, setPreviewUsd] = useState<number>(0);
    const [busyStake, setBusyStake] = useState(false);
    const [payout, setPayout] = useState<string>("");

    useEffect(() => {
        const sol = Math.max(0, Number(stakeSol || "0"));
        setPreviewUsd(sol * FIXED_USD_PER_SOL);
    }, [stakeSol]);

    const handleStakeFixed = useCallback(async () => {
        if (!provider || !program)
            return toast.error("Подключите кошелёк");
        try {
            setBusyStake(true);
            const me = provider.wallet.publicKey!;
            const [mintAuth] = PublicKey.findProgramAddressSync(
                [Buffer.from("mint-auth")],
                program.programId
            );
            const toOwner = me;
            const userDlanAta = await getAssociatedTokenAddress(
                dlanMintUse,
                toOwner
            );

            const solNum = Math.max(0, Number(stakeSol || "0"));
            if (!solNum) return toast.error("Введите количество SOL");
            const lamports = Math.floor(solNum * 1e9);

            const usdtUnits = Math.floor(
                solNum * FIXED_USD_PER_SOL * 10 ** USDT_DECIMALS
            );
            const mintInfo = await getMint(
                provider.connection,
                dlanMintUse
            );
            const d = mintInfo.decimals;
            const dlanUnits =
                d >= USDT_DECIMALS
                    ? usdtUnits * 10 ** (d - USDT_DECIMALS)
                    : Math.floor(usdtUnits / 10 ** (USDT_DECIMALS - d));
            if (dlanUnits <= 0) return toast.error("Слишком маленькая сумма");

            const userStats =
                PublicKey.findProgramAddressSync(
                    [Buffer.from(USTATS_SEED), me.toBuffer()],
                    program.programId
                )[0];

            await (program.methods as any)
                .stakeAndMintPriced(
                    new anchor.BN(lamports),
                    new anchor.BN(dlanUnits)
                )
                .accounts({
                    authority: me,
                    admin: ADMIN_SOL_WALLET,
                    mint: dlanMintUse,
                    userToken: userDlanAta,
                    mintAuthority: mintAuth,
                    userStats,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .rpc();

            toast.success(
                `Stake: ${solNum} SOL → ~${(
                    solNum * FIXED_USD_PER_SOL
                ).toFixed(0)} USDT, DLAN начислены`
            );
        } catch (e: any) {
            toast.error(anchorErrorToText(e));
        } finally {
            setBusyStake(false);
        }
    }, [provider, program, stakeSol, dlanMintUse]);

    return (
        <Card className="p-4">
            {/* ОДНА линия: SOL input + Stake */}
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <Input
                    className="h-10"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={stakeSol}
                    onChange={(e) => setStakeSol(e.target.value)}
                    placeholder="Сумма в SOL"
                />
                <Btn
                    onClick={handleStakeFixed}
                    disabled={!provider || busyStake}
                    className={`${BTN_W} h-10`}
                >
                    {busyStake ? "…" : "Stake"}
                </Btn>
            </div>
            <div className="mt-1 text-sm">
                ~
                {Number.isFinite(previewUsd)
                    ? previewUsd.toFixed(0)
                    : "0"}{" "}
                USDT • APR ≈ {aprWithFee}
            </div>

            {/* Manual claim to payout */}
            <div className="mt-4 rounded-xl border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                    <div className="font-semibold">Клейм на адрес</div>
                    <button
                        onClick={onOpenDetails}
                        className="text-sm text-indigo-700 hover:underline"
                    >
                        Детали
                    </button>
                </div>

                <div className="mt-2 grid grid-cols-[1fr_auto] gap-3">
                    <div className="space-y-1">
                        <Input
                            placeholder="Адрес payout (2/3). Пусто → на ваш USDT ATA"
                            value={payout}
                            onChange={(e) => setPayout(e.target.value)}
                        />
                        <div className="text-xs text-neutral-500">
                            2/3 уйдут на payout, 1/3 — комиссия. Если поле пустое —
                            2/3 придут на ваш USDT ATA.
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 items-stretch">
                        <Btn
                            variant="secondary"
                            onClick={() => onManualClaim(payout || undefined)}
                            className={`${BTN_W}`}
                        >
                            Claim
                        </Btn>
                    </div>
                </div>
            </div>
        </Card>
    );
}

// ===== Unlock 2nd front card ===============================================
type UnlockSecondFrontCardProps = {
    provider: anchor.AnchorProvider | null;
    program: any | null;
    dlanMint: PublicKey | null;
    dlanHuman: number;
    claimsCount: number;
    userAccess: any | null;
    onUnlocked?: () => void;
};

function UnlockSecondFrontCard(props: UnlockSecondFrontCardProps) {
    const {
        provider,
        program,
        dlanMint,
        dlanHuman,
        claimsCount,
        userAccess,
        onUnlocked,
    } = props;
    const router = useRouter();
    const [busy, setBusy] = useState(false);

    const tier = userAccess ? Number(userAccess.tier ?? 1) : 1;
    const unlocked = tier >= 2;

    const claimsProgress = Math.min(claimsCount, CLAIMS_TARGET);
    const dlanProgress = Math.min(Math.floor(dlanHuman), DLAN_TARGET);

    const enoughClaims = claimsCount >= CLAIMS_TARGET;
    const enoughDlan = dlanHuman >= DLAN_TARGET;
    const canUnlock =
        !unlocked && enoughClaims && enoughDlan && !!provider && !!program;

    const handleUnlock = useCallback(async () => {
        if (!provider || !program) {
            toast.error("Подключите кошелёк");
            return;
        }
        const me = provider.wallet.publicKey as PublicKey | null;
        if (!me) {
            toast.error("Подключите кошелёк");
            return;
        }

        try {
            setBusy(true);

            const [userAccessPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(UACCESS_SEED), me.toBuffer()],
                program.programId
            );
            const [userStatsPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(USTATS_SEED), me.toBuffer()],
                program.programId
            );
            const mintPk = dlanMint || DEFAULT_DLAN_MINT;
            const userDlanAta = await getAssociatedTokenAddress(
                mintPk,
                me
            );

            const acc = program.account as any;
            let ua: any = null;
            try {
                ua = await acc.userAccess.fetch(userAccessPda);
            } catch {
                ua = null;
            }

            // Если UserAccess ещё нет — инициализируем с tier = 1
            if (!ua) {
                await (program.methods as any)
                    .initUserAccess()
                    .accounts({
                        authority: me,
                        userAccess: userAccessPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
            }

            // Разблокировка 2-го фронта
            await (program.methods as any)
                .unlockSecondFront()
                .accounts({
                    authority: me,
                    userAccess: userAccessPda,
                    userStats: userStatsPda,
                    dlanMint: mintPk,
                    userDlanAta,
                })
                .rpc();

            toast.success("2-й фронт разблокирован");
            onUnlocked?.();
        } catch (e: any) {
            toast.error(anchorErrorToText(e));
        } finally {
            setBusy(false);
        }
    }, [provider, program, dlanMint, onUnlocked]);

    return (
        <Card className="p-4">
            <CardHeader className="p-0 pb-2">
                <CardTitle>Разблокировка 2-го фронта</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pt-1 space-y-3">
                <div className="text-xs text-neutral-600">
                    2-й фронт даёт доступ к друзьям, личным сообщениям и соц-части
                    DLAN. Пока он не открыт, кошелёк не может добавлять друзей и
                    писать DM.
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <MiniStat
                        label="Клеймы"
                        value={`${claimsProgress}/${CLAIMS_TARGET}`}
                    />
                    <MiniStat
                        label="DLAN"
                        value={`${dlanProgress}/${DLAN_TARGET}`}
                    />
                </div>

                {unlocked ? (
                    <div className="mt-2 space-y-2">
                        <div className="text-sm text-emerald-700 font-semibold">
                            2-й фронт уже открыт для этого кошелька.
                        </div>
                        <Btn
                            variant="secondary"
                            onClick={() => router.push("/app2")}
                            className={BTN_W}
                        >
                            Перейти на 2-й фронт
                        </Btn>
                    </div>
                ) : (
                    <div className="mt-2 space-y-2">
                        {!enoughClaims || !enoughDlan ? (
                            <div className="text-xs text-neutral-500">
                                Для разблокировки нужно минимум{" "}
                                {CLAIMS_TARGET} клеймов и{" "}
                                {DLAN_TARGET} DLAN на вашем кошельке.
                            </div>
                        ) : null}
                        <Btn
                            variant="secondary"
                            onClick={handleUnlock}
                            disabled={!canUnlock || busy}
                            className={BTN_W}
                        >
                            {busy ? "Разблокировка…" : "Разблокировать 2-й фронт"}
                        </Btn>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ===== Main: Tier1 page ====================================================
export default function DlanTier1Page() {
    const { connection } = useConnection();
    const wallet = useWallet();
    const provider = useMemo(
        () =>
            wallet?.publicKey
                ? new anchor.AnchorProvider(
                    connection,
                    wallet as any,
                    { commitment: "confirmed" }
                )
                : null,
        [connection, wallet]
    );
    const program = useMemo(
        () =>
            provider
                ? (new anchor.Program(idl as Idl, provider) as any)
                : null,
        [provider]
    );

    // PDAs
    const [configPda, setConfigPda] = useState<PublicKey | null>(
        null
    );
    const [userStatsPda, setUserStatsPda] =
        useState<PublicKey | null>(null);
    const [globalStatsPda, setGlobalStatsPda] =
        useState<PublicKey | null>(null);
    const [vaultAuth, setVaultAuth] = useState<PublicKey | null>(
        null
    );
    const [vaultAta, setVaultAta] = useState<PublicKey | null>(null);

    useEffect(() => {
        if (!wallet.publicKey) {
            setConfigPda(null);
            setUserStatsPda(null);
            setGlobalStatsPda(null);
        } else {
            setConfigPda(
                PublicKey.findProgramAddressSync(
                    [Buffer.from("config")],
                    PROGRAM_ID
                )[0]
            );
            setUserStatsPda(
                PublicKey.findProgramAddressSync(
                    [Buffer.from(USTATS_SEED), wallet.publicKey.toBuffer()],
                    PROGRAM_ID
                )[0]
            );
            setGlobalStatsPda(
                PublicKey.findProgramAddressSync(
                    [Buffer.from("gstats")],
                    PROGRAM_ID
                )[0]
            );
        }
    }, [wallet.publicKey]);

    // vault-auth + его USDT ATA
    useEffect(() => {
        (async () => {
            if (!program) {
                setVaultAuth(null);
                setVaultAta(null);
                return;
            }
            const [va] = PublicKey.findProgramAddressSync(
                [Buffer.from("vault-auth")],
                PROGRAM_ID
            );
            setVaultAuth(va);
            try {
                const ata = await getAssociatedTokenAddress(
                    USDT_MINT,
                    va,
                    true
                );
                setVaultAta(ata);
            } catch {
                setVaultAta(null);
            }
        })();
    }, [program]);

    // Chain data
    const [userStats, setUserStats] = useState<any | null>(null);
    const [globalStats, setGlobalStats] = useState<any | null>(null);
    const [dlanMint, setDlanMint] = useState<PublicKey | null>(null);
    const [userAccess, setUserAccess] = useState<any | null>(null);

    const tryFetch = useCallback(async (ns: any, pda: PublicKey) => {
        try {
            if (typeof ns.fetchNullable === "function")
                return await ns.fetchNullable(pda);
            return await ns.fetch(pda);
        } catch {
            return null;
        }
    }, []);

    const [refreshing, setRefreshing] = useState(false);
    const pullState = useCallback(async () => {
        if (!program || !wallet.publicKey || !configPda) return;
        setRefreshing(true);
        try {
            const acc = program.account as any;
            const cfg = await tryFetch(acc.socialConfig, configPda);
            setDlanMint(
                cfg ? new PublicKey(cfg.dlanMint) : DEFAULT_DLAN_MINT
            );
            if (userStatsPda)
                setUserStats(await tryFetch(acc.userStats, userStatsPda));
            if (globalStatsPda)
                setGlobalStats(
                    await tryFetch(acc.globalStats, globalStatsPda)
                );

            const [uaPda] = PublicKey.findProgramAddressSync(
                [Buffer.from(UACCESS_SEED), wallet.publicKey.toBuffer()],
                PROGRAM_ID
            );
            setUserAccess(await tryFetch(acc.userAccess, uaPda));
        } finally {
            setRefreshing(false);
        }
    }, [
        program,
        wallet.publicKey,
        configPda,
        userStatsPda,
        globalStatsPda,
        tryFetch,
    ]);

    useEffect(() => {
        pullState();
    }, [pullState]);

    // KPIs по DLAN
    const [dlanDecimals, setDlanDecimals] = useState<number>(9);
    const [dlanTotalUnits, setDlanTotalUnits] = useState<anchor.BN>(
        new anchor.BN(1)
    );
    const [dlanUserUnits, setDlanUserUnits] = useState<anchor.BN>(
        new anchor.BN(0)
    );

    useEffect(() => {
        (async () => {
            if (!provider) return;
            const mintPk = dlanMint || DEFAULT_DLAN_MINT;
            try {
                const mintInfo = await getMint(
                    provider.connection,
                    mintPk
                );
                setDlanDecimals(mintInfo.decimals);
                setDlanTotalUnits(
                    new anchor.BN(mintInfo.supply.toString())
                );
                if (wallet.publicKey) {
                    const ata = await getAssociatedTokenAddress(
                        mintPk,
                        wallet.publicKey
                    );
                    const bal =
                        await provider.connection.getTokenAccountBalance(
                            ata
                        ).catch(() => null);
                    setDlanUserUnits(
                        bal?.value?.amount
                            ? new anchor.BN(bal.value.amount)
                            : new anchor.BN(0)
                    );
                }
            } catch {
                // ignore
            }
        })();
    }, [provider, wallet.publicKey, dlanMint]);

    const dlanUserWhole = useMemo(
        () => fmtUnitsInt(dlanUserUnits, dlanDecimals),
        [dlanUserUnits, dlanDecimals]
    );
    const dlanTotalWhole = useMemo(
        () => fmtUnitsInt(dlanTotalUnits, dlanDecimals),
        [dlanTotalUnits, dlanDecimals]
    );
    const dlanPct = useMemo(() => {
        if (dlanTotalUnits.isZero()) return "0.00%";
        const p =
            (dlanUserUnits.toNumber() /
                Number(dlanTotalUnits.toString())) *
            100;
        return `${p.toFixed(2)}%`;
    }, [dlanUserUnits, dlanTotalUnits]);

    // Timers / reserve / APR
    const [investDays, setInvestDays] = useState<number>(0);
    const [reserveUnits, setReserveUnits] = useState<number>(0);
    const [showClaimModal, setShowClaimModal] = useState(false);

    const denom = 120;
    const dlanHuman = useMemo(
        () => dlanUserUnits.toNumber() / 10 ** dlanDecimals,
        [dlanUserUnits, dlanDecimals]
    );
    const perDayGross = useMemo(
        () => (denom > 0 ? dlanHuman / denom : 0),
        [dlanHuman, denom]
    );
    const perDay = useMemo(
        () => perDayGross * (2 / 3),
        [perDayGross]
    );

    const aprWithFee = useMemo(() => {
        const grossApr = (365 / (denom || 120)) * 100;
        return `${(grossApr * (2 / 3)).toFixed(2)}%`;
    }, [denom]);

    const unitsGrossPerDay = useMemo(
        () => Math.floor(perDayGross * 10 ** USDT_DECIMALS),
        [perDayGross]
    );

    const claimStats = useMemo(() => {
        const maxDays =
            unitsGrossPerDay > 0
                ? Math.floor(reserveUnits / unitsGrossPerDay)
                : 0;
        const daysWithdrawable = Math.min(investDays, maxDays);
        return {
            perDayDisplay: perDay,
            accrued: perDay * investDays,
            withdrawable: perDay * daysWithdrawable,
            daysWithdrawable,
        };
    }, [perDay, investDays, unitsGrossPerDay, reserveUnits]);

    const userWithdrawnWhole = useMemo(
        () => fmtUSDTInt(Number(userStats?.withdrawnUsdtRaw ?? 0)),
        [userStats]
    );
    const globalPaidWhole = useMemo(
        () =>
            fmtUSDTInt(Number(globalStats?.totalUserPaidUsdt ?? 0)),
        [globalStats]
    );
    const globalFeeWhole = useMemo(
        () =>
            fmtUSDTInt(Number(globalStats?.totalFeePaidUsdt ?? 0)),
        [globalStats]
    );
    const userClaimsCount = useMemo(
        () => Number(userStats?.claimsCount ?? 0),
        [userStats]
    );

    const reloadTimersAndReserve = useCallback(async () => {
        if (!provider || !program || !provider.wallet?.publicKey)
            return;
        const me = provider.wallet.publicKey;
        const now = Math.floor(Date.now() / 1000);
        try {
            const [userState] = PublicKey.findProgramAddressSync(
                [Buffer.from("user"), me.toBuffer()],
                program.programId
            );
            let last = 0;
            try {
                const st: any = await (program.account as any).userState.fetch(
                    userState
                );
                last = Number(st.lastInvestTs ?? st.last_invest_ts ?? 0);
            } catch {
                // ignore
            }
            const baseline = last === 0 ? now - SECS_PER_DAY : last;
            const elapsed =
                now > baseline
                    ? Math.floor((now - baseline) / SECS_PER_DAY)
                    : 0;
            setInvestDays(elapsed);
        } catch {
            setInvestDays(0);
        }
        try {
            if (!vaultAta) {
                setReserveUnits(0);
                return;
            }
            const reserveInfo =
                await provider.connection.getTokenAccountBalance(
                    vaultAta
                );
            setReserveUnits(Number(reserveInfo.value.amount) || 0);
        } catch {
            setReserveUnits(0);
        }
    }, [provider, program, vaultAta]);

    useEffect(() => {
        if (!provider || !program) return;
        reloadTimersAndReserve();
        const t = setInterval(reloadTimersAndReserve, 60_000);
        return () => clearInterval(t);
    }, [provider, program, reloadTimersAndReserve]);

    const handleInvestClaim = useCallback(
        async (payoutBase58?: string) => {
            if (!provider || !program)
                return toast.error("Нет соединения");
            if (!vaultAuth || !vaultAta)
                return toast.error("Vault не найден");
            try {
                const me = provider.wallet.publicKey!;
                let days = investDays;
                if (days <= 0) return toast.error("Нет накопленных дней");
                const unitsPerDay = Math.floor(
                    perDayGross * 10 ** USDT_DECIMALS
                );

                // Проверяем резерв
                const reserveInfo =
                    await provider.connection.getTokenAccountBalance(
                        vaultAta
                    );
                let reserveUnitsLocal = Number(reserveInfo.value.amount);
                if (reserveUnitsLocal <= 0)
                    return toast.error("В хранилище пусто");
                const totalWanted = unitsPerDay * days;
                if (reserveUnitsLocal < totalWanted) {
                    const md = Math.floor(reserveUnitsLocal / unitsPerDay);
                    if (md <= 0)
                        return toast.error("Недостаточно USDT в хранилище");
                    days = Math.min(days, md);
                }

                const totalGross = unitsPerDay * days;
                const fee = Math.floor(totalGross / 3);
                const user = totalGross - fee;
                const feeOwner = FEE_WALLET;

                const payoutPk = payoutBase58
                    ? tryPubkey(payoutBase58)
                    : null;
                const userStatsPdaLocal =
                    PublicKey.findProgramAddressSync(
                        [Buffer.from(USTATS_SEED), me.toBuffer()],
                        program.programId
                    )[0];
                const globalStatsPdaLocal =
                    PublicKey.findProgramAddressSync(
                        [Buffer.from("gstats")],
                        program.programId
                    )[0];
                const [userState] = PublicKey.findProgramAddressSync(
                    [Buffer.from("user"), me.toBuffer()],
                    program.programId
                );
                const feeAta = await getAssociatedTokenAddress(
                    USDT_MINT,
                    feeOwner
                );

                if (payoutPk && !payoutPk.equals(me)) {
                    const payoutOwner = payoutPk;
                    const userUsdtAta = await getAssociatedTokenAddress(
                        USDT_MINT,
                        payoutOwner
                    );
                    await (program.methods as any)
                        .investClaimSplitTo(
                            new anchor.BN(user),
                            new anchor.BN(fee),
                            new anchor.BN(days)
                        )
                        .accounts({
                            authority: me,
                            userState,
                            payoutOwner,
                            userToken: userUsdtAta,
                            vaultToken: vaultAta,
                            vaultAuthority: vaultAuth,
                            feeOwner,
                            feeToken: feeAta,
                            usdtMint: USDT_MINT,
                            userStats: userStatsPdaLocal,
                            globalStats: globalStatsPdaLocal,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                            rent:
                                (SYSVAR_RENT_PUBKEY as any) ?? SYSVAR_RENT_PUBKEY,
                        })
                        .rpc();
                    toast.success(
                        `Claim: ${fmtUSDTInt(
                            user
                        )} USDT за ${days} дн. → ${shortPk(
                            payoutOwner
                        )}`
                    );
                } else {
                    const userUsdtAta = await getAssociatedTokenAddress(
                        USDT_MINT,
                        me
                    );
                    await (program.methods as any)
                        .investClaimSplit(
                            new anchor.BN(user),
                            new anchor.BN(fee),
                            new anchor.BN(days)
                        )
                        .accounts({
                            authority: me,
                            userState,
                            userToken: userUsdtAta,
                            vaultToken: vaultAta,
                            vaultAuthority: vaultAuth,
                            feeOwner,
                            feeToken: feeAta,
                            usdtMint: USDT_MINT,
                            userStats: userStatsPdaLocal,
                            globalStats: globalStatsPdaLocal,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                            rent:
                                (SYSVAR_RENT_PUBKEY as any) ?? SYSVAR_RENT_PUBKEY,
                        })
                        .rpc();
                    toast.success(
                        `Claim: ${fmtUSDTInt(
                            user
                        )} USDT за ${days} дн. → ваш ATA`
                    );
                }

                reloadTimersAndReserve();
                pullState();
            } catch (e: any) {
                toast.error(anchorErrorToText(e));
            }
        },
        [
            provider,
            program,
            investDays,
            perDayGross,
            vaultAuth,
            vaultAta,
            reloadTimersAndReserve,
            pullState,
        ]
    );

    const clusterLabel = useMemo(() => {
        const ep = (connection as any)?._rpcEndpoint || "";
        if (ep.includes("devnet")) return "Devnet";
        if (ep.includes("testnet")) return "Testnet";
        return "Mainnet";
    }, [connection]);

    const profileName = "DLAN Finance";

    return (
        <div className="min-h-screen bg-gradient-to-b from-[#faf7ff] to-[#f4f7ff] text-neutral-900">
            <Toaster position="bottom-right" richColors closeButton />

            <div className="mx-auto max-w-4xl px-4 pt-4 pb-10">
                <div className="flex items-center gap-3">
                    <div className="text-2xl font-extrabold">
                        {profileName} — Tier 1
                    </div>
                    <span className="ml-auto rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold border border-neutral-200">
                        {clusterLabel}
                    </span>
                    {wallet.publicKey ? (
                        <span className="ml-2 rounded-full bg-white px-3 py-1 text-xs font-semibold border border-neutral-200">
                            {shortPk(wallet.publicKey)}
                        </span>
                    ) : (
                        <span className="ml-2 rounded-full bg-white px-3 py-1 text-xs font-semibold border border-neutral-200">
                            Нет кошелька
                        </span>
                    )}
                </div>

                <div className="mt-4 space-y-4">
                    <Card className="p-4">
                        <div className="flex items-center gap-2">
                            <Btn
                                variant="ghost"
                                onClick={() => pullState()}
                                className="!py-1.5 !px-3 text-xs"
                            >
                                <RefreshCw className="h-4 w-4" /> Обновить
                            </Btn>
                            {refreshing && (
                                <span className="text-xs text-neutral-500">
                                    Обновление…
                                </span>
                            )}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
                            <MiniStat label="Ваш DLAN" value={dlanUserWhole} />
                            <MiniStat label="Всего DLAN" value={dlanTotalWhole} />
                            <MiniStat label="Доля" value={dlanPct} />
                        </div>
                    </Card>

                    {/* Stake + Claim */}
                    <StakeAutoCard
                        provider={provider}
                        program={program as any}
                        dlanMintFromConfig={dlanMint}
                        aprWithFee={aprWithFee}
                        onManualClaim={handleInvestClaim}
                        onOpenDetails={() => setShowClaimModal(true)}
                    />

                    {/* Разблокировка 2-го фронта — СРАЗУ ПОД стейком */}
                    <UnlockSecondFrontCard
                        provider={provider}
                        program={program}
                        dlanMint={dlanMint}
                        dlanHuman={dlanHuman}
                        claimsCount={userClaimsCount}
                        userAccess={userAccess}
                        onUnlocked={pullState}
                    />
                </div>
            </div>

            {/* Claim Details modal */}
            {showClaimModal && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-2xl">
                        <div className="flex items-center justify-between">
                            <div className="font-bold text-base">Детали</div>
                            <button
                                onClick={() => setShowClaimModal(false)}
                                className="rounded-full bg-neutral-100 px-3 py-1"
                            >
                                ×
                            </button>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <MiniStat
                                label="USDT/день"
                                value={`${Math.floor(
                                    claimStats.perDayDisplay
                                ).toLocaleString()} USDT`}
                            />
                            <MiniStat
                                label="Накоплено"
                                value={`${Math.floor(
                                    claimStats.accrued
                                ).toLocaleString()} USDT`}
                            />
                        </div>
                        <div className="mt-3">
                            <MiniStat
                                label="Доступно к выводу"
                                value={`${Math.floor(
                                    claimStats.withdrawable
                                ).toLocaleString()} USDT`}
                            />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <MiniStat
                                label="Вы вывели всего"
                                value={`${userWithdrawnWhole} USDT`}
                            />
                            <MiniStat
                                label="Ваших клеймов"
                                value={userClaimsCount.toLocaleString()}
                            />
                            <MiniStat
                                label="Глобально выплачено"
                                value={`${globalPaidWhole} USDT`}
                            />
                            <MiniStat
                                label="Глобальная комиссия"
                                value={`${globalFeeWhole} USDT`}
                            />
                        </div>

                        <div className="mt-4 flex justify-end">
                            <Btn
                                variant="secondary"
                                onClick={() => {
                                    setShowClaimModal(false);
                                    handleInvestClaim();
                                }}
                            >
                                Claim
                            </Btn>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
