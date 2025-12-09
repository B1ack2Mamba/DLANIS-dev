// File: pages/dlan.tsx
// Compact 2-column layout. Left: KPIs, Stake + Claim (1 кнопка Claim).
// Right: Global Feed / My Posts / GPT. DM notifications (polling). News wallet highlighted.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    getMint,
} from "@solana/spl-token";
import { Toaster, toast } from "sonner";
import { Buffer } from "buffer";
import {
    RefreshCw,
    Send,
    Check,
    Ban,
    Eye,
    EyeOff,
    MessageSquareText,
    Plus,
    Reply,
} from "lucide-react";

// Polyfill Buffer for Anchor vec<u8>
// @ts-ignore
(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;

// ===== IDL / Program ID =====================================================
import idlJson from "../idl/dlan_stake.json";
const ENV_PROGRAM_ID = process.env.NEXT_PUBLIC_DLAN_PROGRAM_ID;
const IDL_PROGRAM_ID = (idlJson as any)?.metadata?.address || (idlJson as any)?.address;
const FALLBACK_PROGRAM_ID = "3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7";
const PROGRAM_ID = new PublicKey(ENV_PROGRAM_ID || IDL_PROGRAM_ID || FALLBACK_PROGRAM_ID);
const idl: any = idlJson as any;
idl.metadata = idl.metadata ?? {};
idl.metadata.address = idl.metadata.address || idl.address || PROGRAM_ID.toBase58();

// ===== Utils / Const ========================================================
const MAX_NAME = 32,
    MAX_BIO = 128,
    MAX_PLACE = 64,
    MAX_POST_BYTES = 280,
    MAX_LEVEL = 7,
    MAX_DM_BYTES = 512;
const USTATS_SEED = "ustats2";
const UACCESS_SEED = "user-access";
const USDT_DECIMALS = 6;
const SECS_PER_DAY = 86_400;

// Dev fallback quote for preview
const FIXED_USD_PER_SOL = 200;

const DEFAULT_DLAN_MINT = new PublicKey("9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR");
const USDT_MINT = new PublicKey("3pqJ783gQtGVvEwRYSzEx78FTDP6cAfMB9xZ2qBscpxS");
const ADMIN_SOL_WALLET = new PublicKey("Gxovarj3kNDd6ks54KNXknRh1GP5ETaUdYGr1xgqeVNh");

// ДОЛЖЕН совпадать с fee_owner в программе!
const FEE_WALLET = new PublicKey("F5rP2d1tGcy2zv5bv3qdfj11GZNiC9ZVxMBFy7aaetzS");

// Главный кошелёк для «Новостей»
const NEWS_WALLET = new PublicKey("F37yZcrqkne6EMM9hhTRgr7SWULk1MMPnbJ7mhrq4YFP");

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
function clampToBytes(s: string, maxBytes: number): Uint8Array {
    const enc = new TextEncoder().encode(s);
    if (enc.length <= maxBytes) return enc;
    let lo = 0,
        hi = s.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        const b = new TextEncoder().encode(s.slice(0, mid));
        if (b.length <= maxBytes) lo = mid;
        else hi = mid - 1;
    }
    return new TextEncoder().encode(s.slice(0, lo));
}
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
function sortAB(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
    return a.toBuffer().compare(b.toBuffer()) < 0 ? [a, b] : [b, a];
}
function anchorErrorToText(err: any): string {
    const raw = String(err?.error?.errorMessage || err?.message || err);
    const m = raw.toLowerCase();
    if (m.includes("name too long")) return "Имя слишком длинное (макс 32 байта).";
    if (m.includes("bio too long")) return "Био слишком длинное (макс 128 байт).";
    if (m.includes("place too long")) return "Место рождения слишком длинное (макс 64 байта).";
    if (m.includes("invalid gender")) return "Пол должен быть 0..3.";
    if (m.includes("wrong mint")) return "Неверный mint.";
    if (m.includes("profile mismatch")) return "Профиль принадлежит другому владельцу.";
    if (m.includes("invalid level")) return "Неверный уровень/диапазон.";
    if (m.includes("post too long")) return "Пост слишком длинный (макс 280 байт).";
    if (m.includes("dm body is too long")) return "Сообщение слишком длинное (макс 512 байт).";
    if (m.includes("accounts must be passed as a<b>")) return "Порядок ключей в DM должен быть a<b>.";
    if (m.includes("not participant")) return "Вы не участник этого треда.";
    if (m.includes("already been processed")) return "Транзакция уже обработана (повтор).";
    if (m.includes("investment exceeds limit")) return "Превышен лимит инвестиций по поинтам.";
    return raw;
}

// ===== Formatting (integers only) =========================================
const fmtUnitsInt = (n: anchor.BN, decimals: number) => {
    const denom = 10 ** decimals;
    const whole = Math.floor(Number(n.toString()) / denom);
    return Number.isFinite(whole) ? whole.toLocaleString() : "0";
};
const fmtUSDTInt = (usdtUnits: number | bigint) => {
    const n = typeof usdtUnits === "bigint" ? Number(usdtUnits) : Number(usdtUnits);
    const whole = Math.floor(n / 10 ** USDT_DECIMALS);
    return Number.isFinite(whole) ? whole.toLocaleString() : "0";
};

// ===== Small UI kit (compact Tailwind) =====================================
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
    <div className={`rounded-2xl border border-neutral-200 bg-white text-neutral-900 shadow-[0_10px_30px_rgba(36,0,255,0.06)] ${className}`}>
        {children}
    </div>
);
const CardHeader = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`p-4 pb-2 ${className}`}>{children}</div>
);
const CardTitle = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <h3 className={`text-base font-bold tracking-tight ${className}`}>{children}</h3>
);
const CardContent = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <div className={`p-4 pt-0 space-y-3 ${className}`}>{children}</div>
);
const MiniStat = ({ label, value }: { label: string; value: string }) => (
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
const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea
        {...props}
        className={`w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 outline-none ring-indigo-500 focus:ring-2 placeholder-neutral-400 ${props.className || ""
            }`}
    />
);

// ===== Stake + Claim (left-column) =========================================
type StakeAutoProps = {
    provider: anchor.AnchorProvider | null;
    program: anchor.Program<Idl> | null;
    dlanMintFromConfig: PublicKey | null;
    aprWithFee: string;
    onOpenDetails: () => void;
    onManualClaim: (payoutBase58?: string) => void;
};

function StakeAutoCard(props: StakeAutoProps) {
    const { provider, program, dlanMintFromConfig, aprWithFee, onOpenDetails, onManualClaim } = props;

    const dlanMintUse = dlanMintFromConfig || DEFAULT_DLAN_MINT;
    const [stakeSol, setStakeSol] = useState<string>("1.000001");
    const [previewUsd, setPreviewUsd] = useState<number>(0);
    const [busyStake, setBusyStake] = useState(false);

    // payout для РУЧНОГО клейма (перевод 2/3 на другой адрес)
    const [payout, setPayout] = useState<string>("");

    useEffect(() => {
        const sol = Math.max(0, Number(stakeSol || "0"));
        setPreviewUsd(sol * FIXED_USD_PER_SOL);
    }, [stakeSol]);

    const handleStakeFixed = useCallback(async () => {
        if (!provider || !program) return toast.error("Подключите кошелёк");
        try {
            setBusyStake(true);
            const me = provider.wallet.publicKey!;
            const [mintAuth] = PublicKey.findProgramAddressSync([Buffer.from("mint-auth")], program.programId);
            const toOwner = me;
            const userDlanAta = await getAssociatedTokenAddress(dlanMintUse, toOwner);

            const solNum = Math.max(0, Number(stakeSol || "0"));
            if (!solNum) return toast.error("Введите количество SOL");
            const lamports = Math.floor(solNum * 1e9);

            const usdtUnits = Math.floor(solNum * FIXED_USD_PER_SOL * 10 ** USDT_DECIMALS);
            const mintInfo = await getMint(provider.connection, dlanMintUse);
            const d = mintInfo.decimals;
            const dlanUnits =
                d >= USDT_DECIMALS ? usdtUnits * 10 ** (d - USDT_DECIMALS) : Math.floor(usdtUnits / 10 ** (USDT_DECIMALS - d));
            if (dlanUnits <= 0) return toast.error("Слишком маленькая сумма");

            const userStats = PublicKey.findProgramAddressSync([Buffer.from(USTATS_SEED), me.toBuffer()], program.programId)[0];

            // ⬇️ Новый Anchor: без config, остальное как было
            await (program.methods as any)
                .stakeAndMintPriced(new anchor.BN(lamports), new anchor.BN(dlanUnits))
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

            toast.success(`Stake: ${solNum} SOL → ~${(solNum * FIXED_USD_PER_SOL).toFixed(0)} USDT, DLAN начислены`);
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
                <Btn onClick={handleStakeFixed} disabled={!provider || busyStake} className={`${BTN_W} h-10`}>
                    {busyStake ? "…" : "Stake"}
                </Btn>
            </div>
            <div className="mt-1 text-sm">
                ~{Number.isFinite(previewUsd) ? previewUsd.toFixed(0) : "0"} USDT • APR ≈ {aprWithFee}
            </div>

            {/* Manual claim to payout */}
            <div className="mt-4 rounded-xl border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                    <div className="font-semibold">Клейм на адрес</div>
                    <button onClick={onOpenDetails} className="text-sm text-indigo-700 hover:underline">
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
                            2/3 уйдут на payout, 1/3 — комиссия. Если поле пустое — 2/3 придут на ваш USDT ATA.
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 items-stretch">
                        <Btn variant="secondary" onClick={() => onManualClaim(payout || undefined)} className={`${BTN_W}`}>
                            Claim
                        </Btn>
                    </div>
                </div>
            </div>
        </Card>
    );
}

// ===== GPT Pane =============================================================
type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

type Quote = {
    authorPk: string;
    authorName: string;
    createdTs: number;
    text: string;
};

function GptPane() {
    const [chat, setChat] = useState<ChatMsg[]>([
        { role: "assistant", content: "Привет! Я в профиле и готов помочь." },
    ]);
    const [input, setInput] = useState("");
    const [sending, setSending] = useState(false);
    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || sending) return;
        setSending(true);
        const userMsg: ChatMsg = { role: "user", content: text };
        setInput("");
        setChat((p) => [...p, userMsg]);
        try {
            const r = await fetch("/api/gpt-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: [...chat, userMsg] }),
            });
            const data = await r.json();
            setChat((p) => [
                ...p,
                { role: "assistant", content: String(data?.content || data?.error || "…") },
            ]);
        } catch (e: any) {
            setChat((p) => [
                ...p,
                { role: "assistant", content: `Ошибка сети: ${e?.message || String(e)}` },
            ]);
        } finally {
            setSending(false);
        }
    }, [chat, input, sending]);
    return (
        <div className="space-y-3">
            <div className="max-h-72 overflow-auto space-y-2 text-sm pr-1">
                {chat.map((m, i) => (
                    <div
                        key={i}
                        className={`rounded-xl px-3 py-2 ${m.role === "user"
                            ? "bg-indigo-50 text-indigo-900 border border-indigo-200"
                            : "bg-neutral-50 border border-neutral-200"
                            }`}
                    >
                        <div className="text-[10px] uppercase opacity-60">{m.role}</div>
                        <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                ))}
            </div>
            <div className="flex gap-2">
                <Input
                    placeholder="Спросить у GPT…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                />
                <Btn onClick={send} disabled={sending || !input.trim()}>
                    {sending ? "…" : "Отправить"}
                </Btn>
            </div>
        </div>
    );
}

// ===== Main page ============================================================
export default function DlanPage() {
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
    const [configPda, setConfigPda] = useState<PublicKey | null>(null);
    const [profilePda, setProfilePda] = useState<PublicKey | null>(null);
    const [extraPda, setExtraPda] = useState<PublicKey | null>(null);
    const [userStatsPda, setUserStatsPda] = useState<PublicKey | null>(null);
    const [globalStatsPda, setGlobalStatsPda] = useState<PublicKey | null>(null);

    // NEW: treasury PDAs (динамически)
    const [vaultAuth, setVaultAuth] = useState<PublicKey | null>(null);
    const [vaultAta, setVaultAta] = useState<PublicKey | null>(null);

    useEffect(() => {
        if (!wallet.publicKey) {
            setConfigPda(null);
            setProfilePda(null);
            setExtraPda(null);
            setUserStatsPda(null);
            setGlobalStatsPda(null);
        } else {
            setConfigPda(PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0]);
            setProfilePda(
                PublicKey.findProgramAddressSync(
                    [Buffer.from("profile"), wallet.publicKey.toBuffer()],
                    PROGRAM_ID,
                )[0],
            );
            setExtraPda(
                PublicKey.findProgramAddressSync(
                    [Buffer.from("profile2"), wallet.publicKey.toBuffer()],
                    PROGRAM_ID,
                )[0],
            );
            setUserStatsPda(
                PublicKey.findProgramAddressSync(
                    [Buffer.from(USTATS_SEED), wallet.publicKey.toBuffer()],

                    PROGRAM_ID,
                )[0],
            );
            setGlobalStatsPda(
                PublicKey.findProgramAddressSync([Buffer.from("gstats")], PROGRAM_ID)[0],
            );
        }
    }, [wallet.publicKey]);

    // derive vault-auth + its USDT ATA from PROGRAM_ID
    useEffect(() => {
        (async () => {
            if (!program) {
                setVaultAuth(null);
                setVaultAta(null);
                return;
            }
            const [va] = PublicKey.findProgramAddressSync([Buffer.from("vault-auth")], PROGRAM_ID);
            setVaultAuth(va);
            try {
                const ata = await getAssociatedTokenAddress(USDT_MINT, va, true);
                setVaultAta(ata);
            } catch {
                setVaultAta(null);
            }
        })();
    }, [program]);

    // Chain data
    const [profile, setProfile] = useState<any | null>(null);
    const [extra, setExtra] = useState<any | null>(null);
    const [userStats, setUserStats] = useState<any | null>(null);
    const [globalStats, setGlobalStats] = useState<any | null>(null);
    const [dlanMint, setDlanMint] = useState<PublicKey | null>(null);

    const tryFetch = useCallback(async (ns: any, pda: PublicKey) => {
        try {
            if (typeof ns.fetchNullable === "function") return await ns.fetchNullable(pda);
            return await ns.fetch(pda);
        } catch {
            return null;
        }
    }, []);

    const [refreshing, setRefreshing] = useState(false);
    const pullState = useCallback(async () => {
        if (!program || !wallet.publicKey || !configPda || !profilePda || !extraPda) return;
        setRefreshing(true);
        try {
            const acc = program.account as any;
            const cfg = await tryFetch(acc.socialConfig, configPda);
            setDlanMint(cfg ? new PublicKey(cfg.dlanMint) : DEFAULT_DLAN_MINT);
            const p = await tryFetch(acc.profile, profilePda);
            setProfile(p);
            const e = await tryFetch(acc.profileExtra, extraPda);
            setExtra(e);
            if (userStatsPda) setUserStats(await tryFetch(acc.userStats, userStatsPda));
            if (globalStatsPda) setGlobalStats(await tryFetch(acc.globalStats, globalStatsPda));
        } finally {
            setRefreshing(false);
        }
    }, [
        program,
        wallet.publicKey,
        configPda,
        profilePda,
        extraPda,
        userStatsPda,
        globalStatsPda,
        tryFetch,
    ]);
    useEffect(() => {
        pullState();
    }, [pullState]);

    // KPIs
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
                }
            } catch { }
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

    // === NEW: UserAccess / tier =============================================
    const [userAccess, setUserAccess] = useState<any | null>(null);
    const [userAccessLoading, setUserAccessLoading] = useState(false);

    useEffect(() => {
        (async () => {
            if (!program || !wallet.publicKey) {
                setUserAccess(null);
                return;
            }
            setUserAccessLoading(true);
            try {
                const [uaPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from(UACCESS_SEED), wallet.publicKey.toBuffer()],
                    PROGRAM_ID,
                );
                const acc = program.account as any;
                if (!acc.userAccess) {
                    setUserAccess(null);
                } else if (typeof acc.userAccess.fetchNullable === "function") {
                    const ua = await acc.userAccess.fetchNullable(uaPda);
                    setUserAccess(ua);
                } else {
                    const ua = await acc.userAccess.fetch(uaPda);
                    setUserAccess(ua);
                }
            } catch {
                setUserAccess(null);
            } finally {
                setUserAccessLoading(false);
            }
        })();
    }, [program, wallet.publicKey]);

    const tier = useMemo(() => {
        const ua: any = userAccess;
        if (!ua) return 1;
        const t = ua.tier;
        if (typeof t === "number") return t;
        if (typeof t === "string") {
            const n = Number(t);
            return Number.isFinite(n) ? n : 1;
        }
        if (t && typeof (t as any).toNumber === "function") {
            try {
                return (t as any).toNumber();
            } catch {
                return 1;
            }
        }
        return 1;
    }, [userAccess]);

    // Invest timers / reserve, APR and Claim All
    const [investDays, setInvestDays] = useState<number>(0);
    const [reserveUnits, setReserveUnits] = useState<number>(0);
    const [showClaimModal, setShowClaimModal] = useState(false);

    const denom = 120;
    const dlanHuman = useMemo(
        () => dlanUserUnits.toNumber() / 10 ** dlanDecimals,
        [dlanUserUnits, dlanDecimals],
    );
    const perDayGross = useMemo(
        () => (denom > 0 ? dlanHuman / denom : 0),
        [dlanHuman, denom],
    );
    const perDay = useMemo(() => perDayGross * (2 / 3), [perDayGross]);

    const aprWithFee = useMemo(() => {
        const grossApr = (365 / (denom || 120)) * 100;
        return `${(grossApr * (2 / 3)).toFixed(2)}%`;
    }, [denom]);

    const unitsGrossPerDay = useMemo(
        () => Math.floor(perDayGross * 10 ** USDT_DECIMALS),
        [perDayGross],
    );
    const claimStats = useMemo(() => {
        const maxDays = unitsGrossPerDay > 0 ? Math.floor(reserveUnits / unitsGrossPerDay) : 0;
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
        [userStats],
    );
    const globalPaidWhole = useMemo(
        () => fmtUSDTInt(Number(globalStats?.totalUserPaidUsdt ?? 0)),
        [globalStats],
    );
    const globalFeeWhole = useMemo(
        () => fmtUSDTInt(Number(globalStats?.totalFeePaidUsdt ?? 0)),
        [globalStats],
    );
    const userClaimsCount = useMemo(
        () => Number(userStats?.claimsCount ?? 0),
        [userStats],
    );

    const reloadTimersAndReserve = useCallback(async () => {
        if (!provider || !program || !provider.wallet?.publicKey) return;
        const me = provider.wallet.publicKey;
        const now = Math.floor(Date.now() / 1000);
        try {
            const [userState] = PublicKey.findProgramAddressSync(
                [Buffer.from("user"), me.toBuffer()],
                program.programId,
            );
            let last = 0;
            try {
                const st: any = await (program.account as any).userState.fetch(userState);
                last = Number(st.lastInvestTs ?? st.last_invest_ts ?? 0);
            } catch { }
            const baseline = last === 0 ? now - SECS_PER_DAY : last;
            const elapsed = now > baseline ? Math.floor((now - baseline) / SECS_PER_DAY) : 0;
            setInvestDays(elapsed);
        } catch {
            setInvestDays(0);
        }
        try {
            if (!vaultAta) {
                setReserveUnits(0);
                return;
            }
            const reserveInfo = await provider.connection.getTokenAccountBalance(vaultAta);
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
            if (!provider || !program) return toast.error("Нет соединения");
            if (!vaultAuth || !vaultAta) return toast.error("Vault не найден");
            try {
                const me = provider.wallet.publicKey!;
                let days = investDays;
                if (days <= 0) return toast.error("Нет накопленных дней");
                const unitsPerDay = Math.floor(perDayGross * 10 ** USDT_DECIMALS);

                // Проверяем резерв
                const reserveInfo = await provider.connection.getTokenAccountBalance(vaultAta);
                let reserveUnitsLocal = Number(reserveInfo.value.amount);
                if (reserveUnitsLocal <= 0) return toast.error("В хранилище пусто");
                const totalWanted = unitsPerDay * days;
                if (reserveUnitsLocal < totalWanted) {
                    const md = Math.floor(reserveUnitsLocal / unitsPerDay);
                    if (md <= 0) return toast.error("Недостаточно USDT в хранилище");
                    days = Math.min(days, md);
                }

                const totalGross = unitsPerDay * days;
                const fee = Math.floor(totalGross / 3);
                const user = totalGross - fee;
                const feeOwner = FEE_WALLET;

                const payoutPk = payoutBase58 ? tryPubkey(payoutBase58) : null;
                const userStats = PublicKey.findProgramAddressSync(
                    [Buffer.from(USTATS_SEED), me.toBuffer()],
                    program.programId,
                )[0];
                const globalStats = PublicKey.findProgramAddressSync(
                    [Buffer.from("gstats")],
                    program.programId,
                )[0];
                const [userState] = PublicKey.findProgramAddressSync(
                    [Buffer.from("user"), me.toBuffer()],
                    program.programId,
                );
                const feeAta = await getAssociatedTokenAddress(USDT_MINT, feeOwner);

                if (payoutPk && !payoutPk.equals(me)) {
                    // ➜ Клейм на другой кошелёк (новый Anchor вызов)
                    const payoutOwner = payoutPk;
                    const userUsdtAta = await getAssociatedTokenAddress(USDT_MINT, payoutOwner);
                    await (program.methods as any)
                        .investClaimSplitTo(new anchor.BN(user), new anchor.BN(fee), new anchor.BN(days))
                        .accounts({
                            authority: me,
                            userState,
                            payoutOwner, // <-- новое поле
                            userToken: userUsdtAta, // ATA payoutOwner
                            vaultToken: vaultAta,
                            vaultAuthority: vaultAuth,
                            feeOwner,
                            feeToken: feeAta,
                            usdtMint: USDT_MINT,
                            userStats,
                            globalStats,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                            rent: (SYSVAR_RENT_PUBKEY as any) ?? SYSVAR_RENT_PUBKEY, // совместимость
                        })
                        .rpc();
                    toast.success(
                        `Claim: ${fmtUSDTInt(user)} USDT за ${days} дн. → ${shortPk(payoutOwner)}`,
                    );
                } else {
                    // ➜ Обычный клейм себе
                    const userUsdtAta = await getAssociatedTokenAddress(USDT_MINT, me);
                    await (program.methods as any)
                        .investClaimSplit(new anchor.BN(user), new anchor.BN(fee), new anchor.BN(days))
                        .accounts({
                            authority: me,
                            userState,
                            userToken: userUsdtAta,
                            vaultToken: vaultAta,
                            vaultAuthority: vaultAuth,
                            feeOwner,
                            feeToken: feeAta,
                            usdtMint: USDT_MINT,
                            userStats,
                            globalStats,
                            tokenProgram: TOKEN_PROGRAM_ID,
                            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                            systemProgram: SystemProgram.programId,
                            rent: (SYSVAR_RENT_PUBKEY as any) ?? SYSVAR_RENT_PUBKEY,
                        })
                        .rpc();
                    toast.success(`Claim: ${fmtUSDTInt(user)} USDT за ${days} дн. → ваш ATA`);
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
        ],
    );

    const clusterLabel = useMemo(() => {
        const ep = (connection as any)?._rpcEndpoint || "";
        if (ep.includes("devnet")) return "Devnet";
        if (ep.includes("testnet")) return "Testnet";
        return "Mainnet";
    }, [connection]);

    const profileNameCache = useRef<Map<string, string>>(new Map());
    const getProfileName = useCallback(
        async (pk: PublicKey): Promise<string> => {
            const key = pk.toBase58();
            const cached = profileNameCache.current.get(key);
            if (cached) return cached;
            if (!program) return shortPk(pk);
            try {
                const pda = PublicKey.findProgramAddressSync(
                    [Buffer.from("profile"), pk.toBuffer()],
                    PROGRAM_ID,
                )[0];
                const acc = await (program.account as any).profile.fetch(pda);
                const name = u8ToString(acc.displayName) || shortPk(pk);
                profileNameCache.current.set(key, name);
                return name;
            } catch {
                const s = shortPk(pk);
                profileNameCache.current.set(key, s);
                return s;
            }
        },
        [program],
    );

    const myLevel = Number(profile?.level ?? 0);
    const profileName = u8ToString(profile?.displayName) || "DLAN";

    const locked = !!wallet.publicKey && (userAccessLoading || tier < 2);

    if (locked) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-[#faf7ff] to-[#f4f7ff] text-neutral-900">
                <Toaster position="bottom-right" richColors closeButton />

                <div className="mx-auto max-w-4xl px-4 pt-4 pb-10">
                    <div className="flex items-center gap-3">
                        <div className="text-2xl font-extrabold">DLAN — Tier 2</div>
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
                            <div className="text-sm font-semibold">
                                Доступ к социальному фронту (Tier 2) закрыт
                            </div>
                            <div className="mt-2 text-xs text-neutral-700 space-y-1">
                                <p>
                                    Чтобы пользоваться страницей с друзьями, личными сообщениями и общим чатом,
                                    нужен <b>Tier 2</b>.
                                </p>
                                <p>
                                    Условия открытия Tier 2:
                                </p>
                                <ul className="list-disc pl-4">
                                    <li>минимум <b>100 DLAN</b> на кошельке</li>
                                    <li>минимум <b>60 клеймов</b> с фонда</li>
                                </ul>
                                <p className="mt-1">
                                    Открыть доступ можно на 1-м фронте (финансовый) через кнопку
                                    разблокировки.
                                </p>
                                {!userAccessLoading && (
                                    <p className="mt-1 text-neutral-500">
                                        Текущий tier по ончейну: <b>{tier}</b>
                                    </p>
                                )}
                                {userAccessLoading && (
                                    <p className="mt-1 text-neutral-500">
                                        Проверяем доступ к Tier 2…
                                    </p>
                                )}
                            </div>

                            <div className="mt-4 flex gap-2">
                                <Btn
                                    onClick={() => {
                                        window.location.href = "/app";
                                    }}
                                >
                                    Перейти на 1-й фронт
                                </Btn>
                            </div>
                        </Card>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-[#faf7ff] to-[#f4f7ff] text-neutral-900">
            <Toaster position="bottom-right" richColors closeButton />

            <div className="mx-auto max-w-6xl px-4 pt-4 pb-10">
                <div className="flex items-center gap-3">
                    <div className="text-2xl font-extrabold">{profileName}</div>
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

                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {/* LEFT */}
                    <div className="space-y-4">
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

                        <StakeAutoCard
                            provider={provider}
                            program={program as any}
                            dlanMintFromConfig={dlanMint}
                            aprWithFee={aprWithFee}
                            onOpenDetails={() => setShowClaimModal(true)}
                            onManualClaim={handleInvestClaim}
                        />

                        <ProfileFriendsDm
                            program={program as any}
                            wallet={wallet}
                            getProfileName={getProfileName}
                            configPda={configPda}
                            dlanMint={dlanMint || DEFAULT_DLAN_MINT}
                        />
                    </div>

                    {/* RIGHT */}
                    <RightSocialPanel
                        program={program as any}
                        wallet={wallet}
                        myLevel={myLevel}
                        profilePda={profilePda}
                        configPda={configPda}
                        profile={profile}
                        getProfileName={getProfileName}
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
                                value={`${Math.floor(claimStats.perDayDisplay).toLocaleString()} USDT`}
                            />
                            <MiniStat
                                label="Накоплено"
                                value={`${Math.floor(claimStats.accrued).toLocaleString()} USDT`}
                            />
                        </div>
                        <div className="mt-3">
                            <MiniStat
                                label="Доступно к выводу"
                                value={`${Math.floor(claimStats.withdrawable).toLocaleString()} USDT`}
                            />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <MiniStat label="Вы вывели всего" value={`${userWithdrawnWhole} USDT`} />
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

// ===== Left panel: Profile + Friends + inline DM + Create/Edit (modal + notifications)
function ProfileFriendsDm({
    program,
    wallet,
    getProfileName,
    configPda,
    dlanMint,
}: {
    program: any;
    wallet: any;
    getProfileName: (pk: PublicKey) => Promise<string>;
    configPda: PublicKey | null;
    dlanMint: PublicKey;
}) {
    type ContactAcc = { publicKey: PublicKey; account: any };
    const [profile, setProfile] = useState<any | null>(null);
    const [extra, setExtra] = useState<any | null>(null);
    const [friends, setFriends] = useState<ContactAcc[]>([]);
    const [inbound, setInbound] = useState<ContactAcc[]>([]);
    const [outbound, setOutbound] = useState<ContactAcc[]>([]);

    // Create/Edit profile MODAL
    const [showCreate, setShowCreate] = useState(false);
    const [showEdit, setShowEdit] = useState(false);
    const [pName, setPName] = useState("");
    const [pBio, setPBio] = useState("");
    const [pBirth, setPBirth] = useState(""); // yyyy-mm-dd
    const [pPlace, setPPlace] = useState("");
    const [pGender, setPGender] = useState(0);
    const resetForm = () => {
        setPName("");
        setPBio("");
        setPBirth("");
        setPPlace("");
        setPGender(0);
    };

    // DM state
    const [activePeer, setActivePeer] = useState<PublicKey | null>(null);
    const [threadPda, setThreadPda] = useState<PublicKey | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [dmBody, setDmBody] = useState("");
    const [showAddrs, setShowAddrs] = useState(false);
    const [loading, setLoading] = useState(false);

    // NEW: непрочитанные по тредам и суммарный бейдж
    const [unreadByThread, setUnreadByThread] = useState<Record<string, number>>({});
    const totalUnread = useMemo(
        () => Object.values(unreadByThread).reduce((a, b) => a + b, 0),
        [unreadByThread],
    );

    // Браузерные уведомления (по возможности)
    useEffect(() => {
        if (typeof window !== "undefined" && "Notification" in window) {
            if (Notification.permission === "default") {
                Notification.requestPermission().catch(() => { });
            }
        }
    }, []);
    const notifyBrowser = (title: string, body: string) => {
        if (typeof window === "undefined" || !("Notification" in window)) return;
        if (Notification.permission === "granted") {
            try {
                new Notification(title, { body });
            } catch { }
        }
    };

    const pullProfile = useCallback(async () => {
        if (!program || !wallet.publicKey) return;
        try {
            const pda = PublicKey.findProgramAddressSync(
                [Buffer.from("profile"), wallet.publicKey.toBuffer()],
                PROGRAM_ID,
            )[0];
            const ePda = PublicKey.findProgramAddressSync(
                [Buffer.from("profile2"), wallet.publicKey.toBuffer()],
                PROGRAM_ID,
            )[0];
            const acc = program.account as any;
            const p =
                (await acc.profile.fetchNullable?.(pda)) ??
                (await acc.profile.fetch(pda).catch(() => null));
            const e =
                (await acc.profileExtra.fetchNullable?.(ePda)) ??
                (await acc.profileExtra.fetch(ePda).catch(() => null));
            setProfile(p);
            setExtra(e);
        } catch { }
    }, [program, wallet.publicKey]);

    const pullContacts = useCallback(async () => {
        if (!program || !wallet.publicKey) return;
        const acc = program.account as any;
        try {
            const me = wallet.publicKey.toBase58();
            const initiatorList = await acc.contact.all([
                { memcmp: { offset: 8, bytes: me } },
            ]);
            const targetList = await acc.contact.all([
                { memcmp: { offset: 8 + 32, bytes: me } },
            ]);
            const both = [...initiatorList, ...targetList];
            const uniq = new Map<string, ContactAcc>();
            for (const it of both) uniq.set(it.publicKey.toBase58(), it);
            const inbound: ContactAcc[] = [],
                outbound: ContactAcc[] = [],
                fr: ContactAcc[] = [];
            for (const it of uniq.values()) {
                const a = it.account as any;
                const status = Number(a.status || 0);
                const initiator = new PublicKey(a.initiator);
                const target = new PublicKey(a.target);
                if (status === 1) fr.push(it);
                else if (status === 0) {
                    if (target.equals(wallet.publicKey)) inbound.push(it);
                    else if (initiator.equals(wallet.publicKey)) outbound.push(it);
                }
            }
            const byTs = (x: ContactAcc, y: ContactAcc) =>
                Number((y.account?.createdTs ?? 0) - (x.account?.createdTs ?? 0));
            inbound.sort(byTs);
            outbound.sort(byTs);
            fr.sort(byTs);
            setInbound(inbound);
            setOutbound(outbound);
            setFriends(fr);
        } catch { }
    }, [program, wallet.publicKey]);

    useEffect(() => {
        pullProfile();
        pullContacts();
    }, [pullProfile, pullContacts]);

    const openCreate = () => {
        resetForm();
        setShowEdit(false);
        setShowCreate(true);
    };
    const openEdit = () => {
        const name = u8ToString(profile?.displayName) || "";
        const bio = u8ToString(profile?.bio) || "";
        setPName(name);
        setPBio(bio);
        if (extra?.birthTs && Number(extra.birthTs) > 0) {
            const d = new Date(Number(extra.birthTs) * 1000);
            const yyyy = d.getUTCFullYear(),
                mm = String(d.getUTCMonth() + 1).padStart(2, "0"),
                dd = String(d.getUTCDate()).padStart(2, "0");
            setPBirth(`${yyyy}-${mm}-${dd}`);
        } else setPBirth("");
        setPPlace(extra ? u8ToString(extra.birthPlace) : "");
        setPGender(Number(extra?.gender) || 0);
        setShowCreate(false);
        setShowEdit(true);
    };

    const createProfile = useCallback(async () => {
        if (!program || !wallet.publicKey || !configPda) return toast.error("Нет соединения");
        const name = pName.trim(),
            bio = pBio.trim();
        if (!name || !bio) return toast.error("Заполните имя и био");
        try {
            const authority = wallet.publicKey;
            const profilePda = PublicKey.findProgramAddressSync(
                [Buffer.from("profile"), authority.toBuffer()],
                PROGRAM_ID,
            )[0];
            const extraPda = PublicKey.findProgramAddressSync(
                [Buffer.from("profile2"), authority.toBuffer()],
                PROGRAM_ID,
            )[0];
            const userStats = PublicKey.findProgramAddressSync(
                [Buffer.from(USTATS_SEED), authority.toBuffer()],
                PROGRAM_ID,
            )[0];
            const dlanAta = await getAssociatedTokenAddress(dlanMint, authority);

            await program.methods
                .initProfile(name, bio)
                .accounts({
                    authority,
                    config: configPda,
                    dlanAta,
                    profile: profilePda,
                    userStats,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            const birthTs = pBirth
                ? Math.floor(Date.parse(pBirth + "T00:00:00Z") / 1000)
                : -1;
            await program.methods
                .upsertProfileExtra(new anchor.BN(birthTs), pPlace || "", pGender)
                .accounts({
                    authority,
                    profile: profilePda,
                    extra: extraPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            toast.success("Профиль создан");
            setShowCreate(false);
            pullProfile();
        } catch (e: any) {
            toast.error(anchorErrorToText(e));
        }
    }, [
        program,
        wallet.publicKey,
        configPda,
        dlanMint,
        pName,
        pBio,
        pBirth,
        pPlace,
        pGender,
        pullProfile,
    ]);

    const updateProfile = useCallback(async () => {
        if (!program || !wallet.publicKey) return toast.error("Нет соединения");
        const name = pName.trim(),
            bio = pBio.trim();
        if (!name || !bio) return toast.error("Заполните имя и био");
        try {
            const authority = wallet.publicKey;
            const profilePda = PublicKey.findProgramAddressSync(
                [Buffer.from("profile"), authority.toBuffer()],
                PROGRAM_ID,
            )[0];
            const extraPda = PublicKey.findProgramAddressSync(
                [Buffer.from("profile2"), authority.toBuffer()],
                PROGRAM_ID,
            )[0];

            await program.methods
                .updateProfile(name, bio)
                .accounts({
                    authority,
                    profile: profilePda,
                    userStats: PublicKey.findProgramAddressSync(
                        [Buffer.from(USTATS_SEED), authority.toBuffer()],
                        PROGRAM_ID,
                    )[0],
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            const birthTs = pBirth
                ? Math.floor(Date.parse(pBirth + "T00:00:00Z") / 1000)
                : -1;
            await program.methods
                .upsertProfileExtra(new anchor.BN(birthTs), pPlace || "", pGender)
                .accounts({
                    authority,
                    profile: profilePda,
                    extra: extraPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            toast.success("Профиль обновлён");
            setShowEdit(false);
            pullProfile();
        } catch (e: any) {
            toast.error(anchorErrorToText(e));
        }
    }, [program, wallet.publicKey, pName, pBio, pBirth, pPlace, pGender, pullProfile]);

    // ===== DM helpers =========================================================
    const dmThreadPda = useCallback(
        (a: PublicKey, b: PublicKey) =>
            PublicKey.findProgramAddressSync(
                [Buffer.from("dm/thread"), a.toBuffer(), b.toBuffer()],
                PROGRAM_ID,
            )[0],
        [],
    );
    const dmMessagePda = useCallback((thread: PublicKey, index: number) => {
        const ix = new anchor.BN(index).toArrayLike(Buffer, "le", 8);
        return PublicKey.findProgramAddressSync(
            [Buffer.from("dm/msg"), thread.toBuffer(), ix],
            PROGRAM_ID,
        )[0];
    }, []);

    const openDmWith = useCallback(
        async (peer: PublicKey) => {
            if (!program || !wallet.publicKey) return;
            const [a, b] = sortAB(wallet.publicKey, peer);
            const t = dmThreadPda(a, b);
            setLoading(true);
            try {
                const acc = program.account as any;
                const existing =
                    (await acc.dmThread.fetchNullable?.(t)) ??
                    (await acc.dmThread.fetch(t).catch(() => null));
                if (!existing) {
                    await program.methods
                        .dmOpenThread()
                        .accounts({
                            initiator: wallet.publicKey,
                            a,
                            b,
                            thread: t,
                            systemProgram: SystemProgram.programId,
                        })
                        .rpc();
                }
                setActivePeer(peer);
                setThreadPda(t);
                const list = await acc.dmMessage.all([
                    { memcmp: { offset: 8, bytes: t.toBase58() } },
                ]);
                list.sort(
                    (x: any, y: any) =>
                        Number(x.account.index) - Number(y.account.index),
                );
                setMessages(
                    list.map((x: any) => ({ ...x.account, _pda: x.publicKey })),
                );
                if (list.length > 0) {
                    const lastIx = Number(list[list.length - 1].account.index);
                    localStorage.setItem(`dlan_dm_seen_${t.toBase58()}`, String(lastIx));
                    setUnreadByThread((m) => ({ ...m, [t.toBase58()]: 0 }));
                }
            } catch (e) {
                toast.error(anchorErrorToText(e));
            } finally {
                setLoading(false);
            }
        },
        [program, wallet.publicKey, dmThreadPda],
    );

    const sendDm = useCallback(async () => {
        if (!program || !wallet.publicKey || !threadPda || !activePeer) return;
        const bodyBytes = clampToBytes(dmBody.trim(), MAX_DM_BYTES);
        if (bodyBytes.length === 0) return;
        setLoading(true);
        try {
            const acc = program.account as any;
            const threadAcc = await acc.dmThread.fetch(threadPda);
            const a = new PublicKey(threadAcc.a);
            const b = new PublicKey(threadAcc.b);
            const idx = Number(threadAcc.msgCount || 0);
            const msgPda = dmMessagePda(threadPda, idx);
            const ustatsA = PublicKey.findProgramAddressSync(
                [Buffer.from(USTATS_SEED), a.toBuffer()],
                PROGRAM_ID,
            )[0];
            const ustatsB = PublicKey.findProgramAddressSync(
                [Buffer.from(USTATS_SEED), b.toBuffer()],
                PROGRAM_ID,
            )[0];
            await program.methods
                .dmSend(Buffer.from(bodyBytes))
                .accounts({
                    author: wallet.publicKey,
                    a,
                    b,
                    thread: threadPda,
                    message: msgPda,
                    ustatsA,
                    ustatsB,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            setDmBody("");
            const list = await acc.dmMessage.all([
                { memcmp: { offset: 8, bytes: threadPda.toBase58() } },
            ]);
            list.sort(
                (x: any, y: any) =>
                    Number(x.account.index) - Number(y.account.index),
            );
            setMessages(
                list.map((x: any) => ({ ...x.account, _pda: x.publicKey })),
            );
            if (list.length > 0) {
                const lastIx = Number(list[list.length - 1].account.index);
                localStorage.setItem(
                    `dlan_dm_seen_${threadPda.toBase58()}`,
                    String(lastIx),
                );
                setUnreadByThread((m) => ({ ...m, [threadPda.toBase58()]: 0 }));
            }
        } catch (e: any) {
            const s = String(e?.message || e || "").toLowerCase();
            if (!s.includes("already been processed")) toast.error(anchorErrorToText(e));
            setDmBody("");
        } finally {
            setLoading(false);
        }
    }, [program, wallet.publicKey, threadPda, activePeer, dmBody, dmMessagePda]);

    // NEW: notifications & +N — опрос каждые 15с
    useEffect(() => {
        if (!program || !wallet.publicKey || friends.length === 0) return;
        let stop = false;
        let prev: Record<string, number> = {};

        const tick = async () => {
            if (stop) return;
            try {
                const acc = program.account as any;
                const next: Record<string, number> = {};

                for (const f of friends) {
                    const other = new PublicKey(f.account.initiator).equals(
                        wallet.publicKey,
                    )
                        ? new PublicKey(f.account.target)
                        : new PublicKey(f.account.initiator);
                    const [a, b] = sortAB(wallet.publicKey, other);
                    const t = dmThreadPda(a, b);
                    const tb58 = t.toBase58();

                    const thread = await acc.dmThread.fetchNullable?.(t);
                    if (!thread) {
                        next[tb58] = 0;
                        continue;
                    }

                    const list = await acc.dmMessage.all([
                        { memcmp: { offset: 8, bytes: tb58 } },
                    ]);
                    if (list.length === 0) {
                        next[tb58] = 0;
                        continue;
                    }
                    list.sort(
                        (x: any, y: any) =>
                            Number(x.account.index) - Number(y.account.index),
                    );

                    const seenKey = `dlan_dm_seen_${tb58}`;
                    const seenIx = Number(localStorage.getItem(seenKey) || -1);

                    let cnt = 0;
                    for (const m of list) {
                        const ix = Number(m.account.index);
                        const author = new PublicKey(m.account.author).toBase58();
                        if (
                            ix > seenIx &&
                            author !== wallet.publicKey?.toBase58()
                        )
                            cnt += 1;
                    }
                    next[tb58] = cnt;

                    if ((prev[tb58] || 0) < cnt && cnt > 0) {
                        const name = await getProfileName(other).catch(() => shortPk(other));
                        toast.info(`Новое личное сообщение от ${name}`);
                        notifyBrowser("Новое сообщение", `От ${name}`);
                    }
                }

                prev = next;
                setUnreadByThread(next);
            } catch { }
            setTimeout(tick, 15_000);
        };

        tick();
        return () => {
            stop = true;
        };
    }, [program, wallet.publicKey, friends, dmThreadPda, getProfileName]);

    const nameOnly = u8ToString(profile?.displayName) || "—";

    return (
        <Card>
            <CardHeader className="flex items-center justify-between">
                <div>
                    <CardTitle>Профиль и друзья — {nameOnly}</CardTitle>
                </div>
                <div className="flex gap-2">
                    {profile ? (
                        <Btn variant="ghost" onClick={openEdit}>
                            Редактировать
                        </Btn>
                    ) : (
                        <Btn onClick={openCreate}>Создать профиль</Btn>
                    )}
                </div>
            </CardHeader>

            {/* Модалки профиля */}
            {(showCreate || showEdit) && (
                <div className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4">
                    <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl">
                        <div className="flex items-center justify-between">
                            <div className="font-bold text-base">
                                {showCreate ? "Создать профиль" : "Редактировать профиль"}
                            </div>
                            <button
                                onClick={() => {
                                    setShowCreate(false);
                                    setShowEdit(false);
                                }}
                                className="rounded-full bg-neutral-100 px-3 py-1"
                            >
                                ×
                            </button>
                        </div>

                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                            <Input
                                placeholder="Имя (до 32 байт)"
                                value={pName}
                                onChange={(e) => setPName(e.target.value)}
                            />
                            <Input
                                type="date"
                                value={pBirth}
                                onChange={(e) => setPBirth(e.target.value)}
                            />
                            <Input
                                placeholder="Место рождения"
                                value={pPlace}
                                onChange={(e) => setPPlace(e.target.value)}
                            />
                            <select
                                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5"
                                value={pGender}
                                onChange={(e) => setPGender(Number(e.target.value) || 0)}
                            >
                                <option value={0}>Пол: не указан</option>
                                <option value={1}>Мужской</option>
                                <option value={2}>Женский</option>
                                <option value={3}>Другое</option>
                            </select>
                        </div>
                        <div className="mt-2">
                            <Textarea
                                rows={3}
                                placeholder="Био (до 128 байт)"
                                value={pBio}
                                onChange={(e) => setPBio(e.target.value)}
                            />
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                            <Btn
                                variant="ghost"
                                onClick={() => {
                                    setShowCreate(false);
                                    setShowEdit(false);
                                }}
                            >
                                Отмена
                            </Btn>
                            {showCreate ? (
                                <Btn onClick={createProfile}>Создать</Btn>
                            ) : (
                                <Btn onClick={updateProfile}>Сохранить</Btn>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <CardContent className="space-y-3">
                {/* Friends list */}
                <div className="pt-1">
                    <div className="font-semibold mb-2">Друзья</div>
                    {friends.length === 0 ? (
                        <div className="text-sm text-neutral-500">Ещё нет друзей</div>
                    ) : (
                        <div className="space-y-2">
                            {friends.map((r) => {
                                const initiator = new PublicKey(r.account.initiator);
                                const target = new PublicKey(r.account.target);
                                const other =
                                    wallet.publicKey && initiator.equals(wallet.publicKey)
                                        ? target
                                        : initiator;
                                const [a, b] = wallet.publicKey
                                    ? sortAB(wallet.publicKey, other)
                                    : [other, other];
                                const t = dmThreadPda(a, b).toBase58();
                                const unread = unreadByThread[t] || 0;

                                return (
                                    <FriendRow
                                        key={r.publicKey.toBase58()}
                                        me={wallet.publicKey ?? null}
                                        contact={r}
                                        getProfileName={getProfileName}
                                        onWrite={(pk) => openDmWith(pk)}
                                        unread={unread}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {/* Requests */}
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <div className="font-semibold">Входящие</div>
                            {inbound.length === 0 ? (
                                <div className="text-neutral-500">Нет</div>
                            ) : (
                                inbound.map((r) => (
                                    <div
                                        key={r.publicKey.toBase58()}
                                        className="mt-1 flex items-center justify-between gap-2 rounded-xl border border-neutral-200 p-2"
                                    >
                                        <span>{shortPk(r.account.initiator)}</span>
                                        <div className="flex gap-1">
                                            <Btn
                                                variant="secondary"
                                                onClick={async () => {
                                                    try {
                                                        await program.methods
                                                            .respondContact(true)
                                                            .accounts({
                                                                target: wallet.publicKey,
                                                                contact: r.publicKey,
                                                            })
                                                            .rpc();
                                                        pullContacts();
                                                    } catch (e) {
                                                        toast.error(anchorErrorToText(e));
                                                    }
                                                }}
                                            >
                                                <Check className="h-4 w-4" />
                                            </Btn>
                                            <Btn
                                                variant="ghost"
                                                onClick={async () => {
                                                    try {
                                                        await program.methods
                                                            .respondContact(false)
                                                            .accounts({
                                                                target: wallet.publicKey,
                                                                contact: r.publicKey,
                                                            })
                                                            .rpc();
                                                        pullContacts();
                                                    } catch (e) {
                                                        toast.error(anchorErrorToText(e));
                                                    }
                                                }}
                                            >
                                                <Ban className="h-4 w-4" />
                                            </Btn>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div>
                            <div className="font-semibold">Исходящие</div>
                            {outbound.length === 0 ? (
                                <div className="text-neutral-500">Нет</div>
                            ) : (
                                outbound.map((r) => (
                                    <div
                                        key={r.publicKey.toBase58()}
                                        className="mt-1 rounded-2xl border border-neutral-200 p-2"
                                    >
                                        к {shortPk(r.account.target)} — ожидание
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Inline DM area */}
                <div className="mt-4 rounded-2xl border border-neutral-200 p-3">
                    <div className="flex items-center justify-between">
                        <div className="font-semibold flex items-center gap-2">
                            <MessageSquareText className="h-4 w-4" /> Личные сообщения
                            {totalUnread > 0 && (
                                <span className="ml-2 rounded-full bg-rose-100 text-rose-700 text-[10px] px-2 py-0.5 font-bold">
                                    +{totalUnread}
                                </span>
                            )}
                        </div>
                        <button
                            className="text-xs inline-flex items-center gap-1 text-indigo-600"
                            onClick={() => setShowAddrs((v) => !v)}
                        >
                            {showAddrs ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            {showAddrs ? "Скрыть адреса" : "Показать адреса"}
                        </button>
                    </div>
                    {!threadPda ? (
                        <div className="mt-2 text-sm text-neutral-500">
                            Выберите друга и нажмите «Написать».
                        </div>
                    ) : (
                        <>
                            <div className="mt-2 max-h-64 overflow-auto space-y-2">
                                {messages.length === 0 ? (
                                    <div className="text-sm text-neutral-500">
                                        Пока пусто.
                                    </div>
                                ) : (
                                    messages.map((m, i) => (
                                        <DmMessageItem
                                            key={i}
                                            m={m}
                                            me={wallet.publicKey ?? null}
                                            showAddrs={showAddrs}
                                        />
                                    ))
                                )}
                            </div>
                            <div className="mt-3 flex gap-2">
                                <Textarea
                                    rows={3}
                                    value={dmBody}
                                    onChange={(e) => setDmBody(e.target.value)}
                                    placeholder="Написать сообщение…"
                                />
                                <Btn
                                    onClick={sendDm}
                                    disabled={loading || dmBody.trim().length === 0}
                                >
                                    <Send className="h-4 w-4" /> Отправить
                                </Btn>
                            </div>
                        </>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function FriendRow({
    me,
    contact,
    getProfileName,
    onWrite,
    unread,
}: {
    me: PublicKey | null | undefined;
    contact: { publicKey: PublicKey; account: any };
    getProfileName: (pk: PublicKey) => Promise<string>;
    onWrite: (pk: PublicKey) => void;
    unread: number;
}) {
    const a = contact.account;
    const initiator = new PublicKey(a.initiator);
    const target = new PublicKey(a.target);
    const other = me && initiator.equals(me) ? target : initiator;

    const [name, setName] = useState<string>(shortPk(other));
    const [show, setShow] = useState(false);
    useEffect(() => {
        getProfileName(other).then(setName).catch(() => { });
    }, [other, getProfileName]);

    return (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-neutral-200 p-3">
            <div>
                <div className="font-semibold flex items-center gap-2">
                    {name}
                    {unread > 0 && (
                        <span className="rounded-full bg-rose-100 text-rose-700 text-[10px] px-1.5 py-0.5 font-bold">
                            +{unread}
                        </span>
                    )}
                </div>
                {show ? (
                    <div className="text-xs text-neutral-500 break-all">
                        {other.toBase58()}
                    </div>
                ) : null}
                <button
                    onClick={() => setShow((v) => !v)}
                    className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600"
                >
                    {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {show ? "Скрыть адрес" : "Показать адрес"}
                </button>
            </div>
            <Btn variant="secondary" onClick={() => onWrite(other)}>
                <MessageSquareText className="h-4 w-4" /> Написать
            </Btn>
        </div>
    );
}

function DmMessageItem({
    m,
    me,
    showAddrs,
}: {
    m: any;
    me: PublicKey | null | undefined;
    showAddrs: boolean;
}) {
    const author = new PublicKey(m.author);
    const isMine = !!me && author.equals(me);
    return (
        <div
            className={`rounded-2xl px-3 py-2 text-sm ${isMine
                ? "bg-indigo-50 border border-indigo-200"
                : "bg-neutral-50 border border-neutral-200"
                }`}
        >
            <div className="flex items-center justify-between text-[11px] opacity-70">
                <span className="font-semibold">{shortPk(author)}</span>
                <span>{new Date(Number(m.ts) * 1000).toLocaleString()}</span>
            </div>
            {showAddrs ? (
                <div className="text-[10px] text-neutral-500">
                    {author.toBase58()}
                </div>
            ) : null}
            <div className="mt-1 whitespace-pre-wrap break-words">
                {(() => {
                    try {
                        return new TextDecoder().decode(new Uint8Array(m.body ?? []));
                    } catch {
                        return "<invalid utf8>";
                    }
                })()}
            </div>
        </div>
    );
}

// ===== Right big window: Feed / My posts / GPT ==============================
function RightSocialPanel({
    program,
    wallet,
    myLevel,
    profilePda,
    configPda,
    profile,
    getProfileName,
}: {
    program: any;
    wallet: any;
    myLevel: number;
    profilePda: PublicKey | null;
    configPda: PublicKey | null;
    profile: any;
    getProfileName: (pk: PublicKey) => Promise<string>;
}) {
    const [tab, setTab] = useState<"feed" | "mine" | "gpt">("feed");
    const [quote, setQuote] = useState<Quote | null>(null);

    const handleQuote = useCallback((q: Quote) => {
        setQuote(q);
        setTab("mine");
    }, []);

    const clearQuote = useCallback(() => setQuote(null), []);

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex gap-1 rounded-xl bg-neutral-100 p-1">
                        {(["feed", "mine", "gpt"] as const).map((t) => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === t
                                    ? "bg-white border border-neutral-200 shadow-sm"
                                    : "text-neutral-600"
                                    }`}
                            >
                                {t === "feed"
                                    ? "Общий чат"
                                    : t === "mine"
                                        ? "Мои посты"
                                        : "GPT"}
                            </button>
                        ))}
                    </div>
                    <Btn variant="ghost" onClick={() => setTab("feed")}>
                        <RefreshCw className="h-4 w-4" /> Обновить
                    </Btn>
                </div>
            </CardHeader>
            <CardContent>
                {tab === "feed" && (
                    <GlobalFeed
                        program={program}
                        wallet={wallet}
                        myLevel={myLevel}
                        getProfileName={getProfileName}
                        highlightNews
                        onQuote={handleQuote}
                    />
                )}
                {tab === "mine" && (
                    <MyPosts
                        program={program}
                        wallet={wallet}
                        profilePda={profilePda}
                        configPda={configPda}
                        profile={profile}
                        quote={quote}
                        clearQuote={clearQuote}
                    />
                )}
                {tab === "gpt" && <GptPane />}
            </CardContent>
        </Card>
    );
}

function GlobalFeed({
    program,
    wallet,
    myLevel,
    getProfileName,
    highlightNews = false,
    onQuote,
}: {
    program: any;
    wallet: any;
    myLevel: number;
    getProfileName: (pk: PublicKey) => Promise<string>;
    highlightNews?: boolean;
    onQuote?: (quote: Quote) => void;
}) {
    const [posts, setPosts] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [showAddrs, setShowAddrs] = useState(false);

    const pullFeed = useCallback(async () => {
        if (!program) return;
        setLoading(true);
        try {
            const acc = program.account as any;
            const list = await acc.post.all();
            const ok = list.filter((it: any) => {
                const p = it.account;
                const min = Number(p.minLevel || 0);
                const max = Number(p.maxLevel || MAX_LEVEL);
                return myLevel >= min && myLevel <= max;
            });
            ok.sort(
                (a: any, b: any) =>
                    Number(b.account.createdTs) - Number(a.account.createdTs),
            );
            setPosts(ok);
        } catch {
            setPosts([]);
        } finally {
            setLoading(false);
        }
    }, [program, myLevel]);
    useEffect(() => {
        pullFeed();
    }, [pullFeed]);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Общий чат</div>
                <button
                    className="text-xs inline-flex items-center gap-1 text-indigo-600"
                    onClick={() => setShowAddrs((v) => !v)}
                >
                    {showAddrs ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    {showAddrs ? "Скрыть адреса" : "Показать адреса"}
                </button>
            </div>
            {loading ? (
                <div className="text-sm text-neutral-500">Загрузка…</div>
            ) : posts.length === 0 ? (
                <div className="text-sm text-neutral-500">Пока нет постов.</div>
            ) : (
                posts.map(({ publicKey, account }: any) => (
                    <PostItem
                        key={publicKey.toBase58()}
                        account={account}
                        showAddrs={showAddrs}
                        program={program}
                        wallet={wallet}
                        getProfileName={getProfileName}
                        highlightNews={highlightNews}
                        onQuote={onQuote}
                    />
                ))
            )}
        </div>
    );
}

function PostItem({
    account,
    showAddrs,
    getProfileName,
    program,
    wallet,
    highlightNews = false,
    onQuote,
}: {
    account: any;
    showAddrs: boolean;
    getProfileName: (pk: PublicKey) => Promise<string>;
    program: any;
    wallet: any;
    highlightNews?: boolean;
    onQuote?: (quote: Quote) => void;
}) {
    const author = new PublicKey(account.author);
    const [name, setName] = useState<string>(shortPk(author));
    const [sending, setSending] = useState(false);
    useEffect(() => {
        getProfileName(author).then(setName).catch(() => { });
    }, [author, getProfileName]);
    const text = (() => {
        try {
            return u8ToString(account.content, Number(account.contentLen));
        } catch {
            return "<invalid utf8>";
        }
    })();

    const createdTs = Number(account.createdTs ?? account.created_ts ?? 0);

    const sendFriendRequest = useCallback(
        async (pk: PublicKey): Promise<void> => {
            if (!program || !wallet?.publicKey) {
                toast.error("Подключите кошелёк");
                return;
            }
            if (wallet.publicKey.equals(pk)) {
                toast.error("Нельзя добавить себя");
                return;
            }
            try {
                setSending(true);
                const initiator = wallet.publicKey;
                const initiatorProfile = PublicKey.findProgramAddressSync(
                    [Buffer.from("profile"), initiator.toBuffer()],
                    PROGRAM_ID,
                )[0];
                const targetProfile = PublicKey.findProgramAddressSync(
                    [Buffer.from("profile"), pk.toBuffer()],
                    PROGRAM_ID,
                )[0];
                const contact = PublicKey.findProgramAddressSync(
                    [Buffer.from("contact"), initiator.toBuffer(), pk.toBuffer()],
                    PROGRAM_ID,
                )[0];
                await program.methods
                    .requestContact()
                    .accounts({
                        initiator,
                        initiatorProfile,
                        targetProfile,
                        contact,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                toast.success("Запрос на контакт отправлен");
            } catch (e: any) {
                const msg = anchorErrorToText(e);
                if (
                    /already in use|custom program error: 0x0|address.*in use/i.test(msg)
                )
                    toast.info("Запрос уже существует");
                else toast.error(msg);
            } finally {
                setSending(false);
            }
        },
        [program, wallet?.publicKey],
    );

    const canAdd = !!wallet?.publicKey && !wallet.publicKey?.equals(author);
    const isNews = highlightNews && author.equals(NEWS_WALLET);

    return (
        <div
            className={`rounded-2xl border p-3 ${isNews ? "bg-yellow-50 border-yellow-300" : "border-neutral-200"
                }`}
        >
            <div className="flex items-center justify-between text-xs text-neutral-500">
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-800">{name}</span>
                    {isNews && (
                        <span className="rounded-full bg-yellow-200 text-yellow-800 text-[10px] px-2 py-0.5 font-bold">
                            Новости
                        </span>
                    )}
                    {showAddrs ? (
                        <span className="ml-1">{author.toBase58()}</span>
                    ) : null}
                    {canAdd && (
                        <button
                            onClick={() => sendFriendRequest(author)}
                            disabled={sending}
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
                            title="Добавить в друзья"
                        >
                            <Plus className="h-3 w-3" /> Друзья
                        </button>
                    )}
                    {onQuote && (
                        <button
                            onClick={() =>
                                onQuote({
                                    authorPk: author.toBase58(),
                                    authorName: name,
                                    createdTs,
                                    text,
                                })
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                            title="Ответить с цитированием"
                        >
                            <Reply className="h-3 w-3" /> Ответить
                        </button>
                    )}
                </div>
                <div>
                    lvl {Number(account.minLevel)}–{Number(account.maxLevel)}
                </div>
            </div>
            <div className="mt-2 whitespace-pre-wrap">{text}</div>
        </div>
    );
}

function MyPosts({
    program,
    wallet,
    profilePda,
    configPda,
    profile,
    quote,
    clearQuote,
}: {
    program: any;
    wallet: any;
    profilePda: PublicKey | null;
    configPda: PublicKey | null;
    profile: any;
    quote: Quote | null;
    clearQuote: () => void;
}) {
    const [postContent, setPostContent] = useState("");
    const [creatingPost, setCreatingPost] = useState(false);
    const [minLevel, setMinLevel] = useState(0);
    const [maxLevel, setMaxLevel] = useState(MAX_LEVEL);
    const [myPosts, setMyPosts] = useState<any[]>([]);

    const fullBody = useMemo(() => {
        if (!quote) return postContent;

        const tsStr =
            quote.createdTs && quote.createdTs > 0
                ? new Date(quote.createdTs * 1000).toLocaleString()
                : "";

        const header =
            `↩ Ответ на ${quote.authorName} (${shortPk(quote.authorPk)})` +
            (tsStr ? ` • ${tsStr}` : "") +
            "\n";

        const quoted =
            quote.text
                .split("\n")
                .map((l) => `> ${l}`)
                .join("\n") + "\n\n";

        return header + quoted + postContent;
    }, [postContent, quote]);

    const usedBytes = new TextEncoder().encode(fullBody).length;
    const usedPct = Math.min(100, Math.round((usedBytes / MAX_POST_BYTES) * 100));

    const postPdaByIndex = useCallback((author: PublicKey, index: number) => {
        const ixBuf = new anchor.BN(index).toArrayLike(Buffer, "le", 8);
        return PublicKey.findProgramAddressSync(
            [Buffer.from("post"), author.toBuffer(), ixBuf],
            PROGRAM_ID,
        )[0];
    }, []);

    const pullMine = useCallback(async () => {
        if (!program || !wallet.publicKey) return;
        try {
            const acc = program.account as any;
            const list = await acc.post.all([
                { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
            ]);
            list.sort(
                (a: any, b: any) =>
                    Number(b.account.createdTs) - Number(a.account.createdTs),
            );
            setMyPosts(list);
        } catch {
            setMyPosts([]);
        }
    }, [program, wallet.publicKey]);
    useEffect(() => {
        pullMine();
    }, [pullMine]);

    const onCreatePost = useCallback(async () => {
        if (!program || !wallet.publicKey || !profile || !configPda || !profilePda)
            return;
        if (minLevel < 0 || maxLevel > MAX_LEVEL || minLevel > maxLevel) {
            toast.error("Диапазон 0..7, min ≤ max.");
            return;
        }

        const composed = fullBody.trim();
        const body = clampToBytes(composed, MAX_POST_BYTES);
        if (body.length === 0) {
            toast.error("Пост пуст");
            return;
        }
        setCreatingPost(true);
        try {
            const indexNow = Number(profile.postsCount || 0);
            const postPda = postPdaByIndex(wallet.publicKey, indexNow);
            await program.methods
                .createPost(Buffer.from(body), minLevel, maxLevel)
                .accounts({
                    authority: wallet.publicKey,
                    config: configPda,
                    authorProfile: profilePda,
                    post: postPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            setPostContent("");
            clearQuote();
            toast.success("Пост опубликован");
            pullMine();
        } catch (e: any) {
            const msg = String(e?.message || e || "").toLowerCase();
            if (msg.includes("already been processed")) {
                toast.success("Пост опубликован (повтор)");
                pullMine();
            } else {
                toast.error(anchorErrorToText(e));
            }
        } finally {
            setCreatingPost(false);
        }
    }, [
        program,
        wallet.publicKey,
        profile,
        configPda,
        profilePda,
        minLevel,
        maxLevel,
        fullBody,
        postPdaByIndex,
        pullMine,
        clearQuote,
    ]);

    const canCreatePost = !!wallet.publicKey && !!profile;

    return (
        <div className="space-y-4">
            <div className="text-sm font-semibold">Мои посты</div>

            {quote && (
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-2 text-xs">
                    <div className="flex items-center justify-between">
                        <div className="font-semibold">
                            Ответ на {quote.authorName} ({shortPk(quote.authorPk)})
                        </div>
                        <button
                            onClick={clearQuote}
                            className="text-[10px] text-indigo-700 hover:underline"
                        >
                            Сбросить цитату
                        </button>
                    </div>
                    <div className="mt-1 max-h-20 overflow-hidden whitespace-pre-wrap text-[11px] text-neutral-700">
                        {quote.text}
                    </div>
                </div>
            )}

            <Textarea
                rows={4}
                value={postContent}
                onChange={(e) => setPostContent(e.target.value)}
                placeholder="Что нового?.."
            />
            <div className="mt-2 flex items-center gap-2 text-xs">
                <div className="h-1 w-40 rounded bg-neutral-200">
                    <div
                        className="h-1 rounded bg-indigo-500"
                        style={{ width: `${usedPct}%` }}
                    />
                </div>
            </div>
            <span
                className={
                    usedBytes > MAX_POST_BYTES
                        ? "text-rose-600"
                        : "text-neutral-500"
                }
            >
                {usedBytes}/{MAX_POST_BYTES} байт
            </span>
            <div className="grid grid-cols-2 gap-3">
                <Input
                    type="number"
                    min={0}
                    max={MAX_LEVEL}
                    value={minLevel}
                    onChange={(e) =>
                        setMinLevel(
                            Math.max(
                                0,
                                Math.min(MAX_LEVEL, Number(e.target.value) || 0),
                            ),
                        )
                    }
                    placeholder="Мин. уровень"
                />
                <Input
                    type="number"
                    min={0}
                    max={MAX_LEVEL}
                    value={maxLevel}
                    onChange={(e) =>
                        setMaxLevel(
                            Math.max(
                                0,
                                Math.min(MAX_LEVEL, Number(e.target.value) || 0),
                            ),
                        )
                    }
                    placeholder="Макс. уровень"
                />
            </div>
            <div className="flex justify-end">
                <Btn
                    onClick={onCreatePost}
                    disabled={!canCreatePost || creatingPost}
                >
                    {creatingPost ? "…" : "Опубликовать"}
                </Btn>
            </div>

            <div className="pt-2 border-t border-neutral-200" />
            {myPosts.length === 0 ? (
                <div className="text-sm text-neutral-500">Постов пока нет.</div>
            ) : (
                <div className="space-y-3">
                    {myPosts.map(({ publicKey, account }: any) => (
                        <div
                            key={publicKey.toBase58()}
                            className="rounded-2xl border border-neutral-200 p-3"
                        >
                            <div className="flex items-center justify-between text-xs text-neutral-500">
                                <div>
                                    lvl {Number(account.minLevel)}–
                                    {Number(account.maxLevel)}
                                </div>
                                <div>
                                    {new Date(
                                        Number(account.createdTs) * 1000,
                                    ).toLocaleString()}
                                </div>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap">
                                {(() => {
                                    try {
                                        return u8ToString(
                                            account.content,
                                            Number(account.contentLen),
                                        );
                                    } catch {
                                        return "<invalid utf8>";
                                    }
                                })()}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
