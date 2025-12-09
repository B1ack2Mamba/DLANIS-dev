import { useState, useCallback, useEffect, useMemo } from "react";
import { AnchorProvider, Program, Idl, BN } from "@coral-xyz/anchor";
import {
    Connection,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
    getAssociatedTokenAddress,
    getMint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// Mobile Wallet Adapter (опционально, без жёстких типов)
import {
    SolanaMobileWalletAdapter,
    createDefaultAuthorizationResultCache,
    createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";

import idlJson from "../target/idl/dlan_stake.json";

/* =================== Константы сети/контрактов =================== */

const IDL = idlJson as unknown as Idl;
const PROGRAM_ID = new PublicKey("3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7");

// mainnet RPC
const RPC_ENDPOINT =
    "https://api.devnet.solana.com";

// ваши адреса (mainnet)
const DLAN_MINT = new PublicKey("9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR");
const USDT_MINT = new PublicKey("3pqJ783gQtGVvEwRYSzEx78FTDP6cAfMB9xZ2qBscpxS");
const ADMIN_SOL_WALLET = new PublicKey("Gxovarj3kNDd6ks54KNXknRh1GP5ETaUdYGr1xgqeVNh");

// Vault (USDT)
const VAULT_AUTHORITY_PDA = new PublicKey("ByG2RboeJD4hTxZ8MGHMfmsdWbyvVFNh1jrPL27suoyc");
const VAULT_USDT_ATA = new PublicKey("AGmj155vzd5VcVRWkUzQJaParPArvtyShtyYozRWCWn7");

// Jupiter mints для котировки
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const USDT_DECIMALS = 6;

/* =================== Типы VIP =================== */
type VipTier = { wallet: string; buttons: number[]; fee_recipient?: string };
type VipConfig = {
    invest_usd_per_dlan_rule: { dlan_per_usd_per_day: number };
    invest_fee_recipient: string;
    tiers: VipTier[];
};

/* =================== Компонент =================== */
export default function HomeUI() {
    const [wallet, setWallet] = useState<string>("");
    const [provider, setProvider] = useState<AnchorProvider>();
    const [program, setProgram] = useState<Program<Idl>>();

    const [vip, setVip] = useState<VipConfig | null>(null);

    const [dlanDecimals, setDlanDecimals] = useState<number>(9);
    const [dlanTotalUnits, setDlanTotalUnits] = useState<BN>(new BN(1));
    const [dlanUserUnits, setDlanUserUnits] = useState<BN>(new BN(0));

    const [stakeSol, setStakeSol] = useState<string>("1");
    const [usdcPreview, setUsdcPreview] = useState<number | null>(null);

    /* ====== Mobile Wallet Adapter (в резерве, с мягкой типизацией) ====== */
    // Это нужно только если позже захочешь deep-link на Android;
    // сейчас Phantom в браузере — основной путь.
    let mobileWallet: any;
    try {
        mobileWallet = new SolanaMobileWalletAdapter({
            appIdentity: { name: "DLAN", uri: "https://dlanis.sol", icon: "/favicon.ico" },
            authorizationResultCache: createDefaultAuthorizationResultCache(),
            onWalletNotFound: createDefaultWalletNotFoundHandler(),
            cluster: "devnet",
            // без AddressSelector типов, чтобы не конфликтовать с версией пакета
            addressSelector: async (addresses: any) => addresses[0],
        } as any);
    } catch {
        // если версия пакета и сигнатуры отличаются — просто игнорим, нам не критично
    }

    /* =================== KPI/утилиты =================== */

    const fmtUnits = useCallback((n: BN, decimals: number) => {
        const denom = 10 ** decimals;
        return (n.toNumber() / denom).toLocaleString(undefined, {
            maximumFractionDigits: Math.min(decimals, 6),
        });
    }, []);

    const dlanPct = useMemo(() => {
        if (dlanTotalUnits.isZero()) return "0.00%";
        const p = (dlanUserUnits.toNumber() / Number(dlanTotalUnits.toString())) * 100;
        return `${p.toFixed(2)}%`;
    }, [dlanUserUnits, dlanTotalUnits]);

    const aprGuess = useMemo(() => {
        const denom = vip?.invest_usd_per_dlan_rule?.dlan_per_usd_per_day ?? 120;
        const apr = (365 / denom) * 100;
        return `${apr.toFixed(2)}%`;
    }, [vip]);

    /* =================== vip.json =================== */

    const reloadVip = useCallback(async () => {
        try {
            const res = await fetch("vip.json?" + Date.now(), { cache: "no-store" });
            if (!res.ok) throw new Error("vip.json missing");
            const data: VipConfig = await res.json();
            setVip(data);
        } catch {
            setVip({
                invest_usd_per_dlan_rule: { dlan_per_usd_per_day: 120 },
                invest_fee_recipient: ADMIN_SOL_WALLET.toBase58(),
                tiers: [],
            });
        }
    }, []);

    useEffect(() => {
        reloadVip();
    }, [reloadVip]);

    /* =================== Подключение =================== */

    const handleConnect = useCallback(async () => {
        const sol = (window as any).solana;

        // 1) Phantom (браузерный)
        if (sol?.isPhantom) {
            const res = await sol.connect();
            setWallet(res.publicKey.toBase58());

            const conn = new Connection(RPC_ENDPOINT, "processed");

            // адаптер, совместимый с Anchor
            const anchorWallet = {
                publicKey: sol.publicKey,
                signTransaction: sol.signTransaction,
                signAllTransactions: sol.signAllTransactions,
            } as any;

            const ap = new AnchorProvider(conn, anchorWallet, { commitment: "processed" });
            setProvider(ap);

            // двухарг. конструктор (IDL, provider)
            const prog = new Program(IDL, ap);
            setProgram(prog);
            return;
        }

        // 2) На будущее: можно вызвать mobileWallet.authorize() и завернуть в AnchorWallet
        alert("Установите Phantom или откройте сайт в поддерживаемом мобильном кошельке.");
    }, []);

    /* =================== Балансы DLAN =================== */

    useEffect(() => {
        if (!provider) return;
        (async () => {
            try {
                const mintInfo = await getMint(provider.connection, DLAN_MINT);
                setDlanDecimals(mintInfo.decimals);
                setDlanTotalUnits(new BN(mintInfo.supply.toString()));

                if (provider.wallet?.publicKey) {
                    const ata = await getAssociatedTokenAddress(DLAN_MINT, provider.wallet.publicKey);
                    const bal = await provider.connection.getTokenAccountBalance(ata).catch(() => null);
                    setDlanUserUnits(bal?.value?.amount ? new BN(bal.value.amount) : new BN(0));
                }
            } catch (e) {
                console.warn(e);
            }
        })();
    }, [provider]);

    /* =================== Котировка Jupiter =================== */

    const fetchQuoteUsdcOut = useCallback(async (lamports: number) => {
        try {
            const url = new URL("https://quote-api.jup.ag/v6/quote");
            url.searchParams.set("inputMint", WSOL);
            url.searchParams.set("outputMint", USDC);
            url.searchParams.set("amount", String(lamports));
            url.searchParams.set("slippageBps", "10");
            const r = await fetch(url.toString(), { cache: "no-store" });
            const j = await r.json();
            const out = j?.outAmount;
            const n = Number(out);
            return Number.isFinite(n) && n > 0 ? n : null;
        } catch {
            return null;
        }
    }, []);

    useEffect(() => {
        (async () => {
            if (!provider || !program) return;
            const solNum = Math.max(0, Number(stakeSol || "0"));
            if (!solNum) {
                setUsdcPreview(null);
                return;
            }
            const lamports = Math.floor(solNum * 1e9);
            const out = await fetchQuoteUsdcOut(lamports);
            setUsdcPreview(out ? out / 10 ** USDT_DECIMALS : null);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stakeSol, provider, program]);

    /* =================== Stake =================== */

    const handleStakeViaQuote = useCallback(async () => {
        if (!provider || !program) return alert("Сначала подключитесь");
        try {
            const me = provider.wallet.publicKey!;

            const [mintAuth] = PublicKey.findProgramAddressSync(
                [Buffer.from("mint-auth")],
                program.programId
            );

            const userDlanAta = await getAssociatedTokenAddress(DLAN_MINT, me);

            const solNum = Math.max(0, Number(stakeSol || "0"));
            if (!solNum) return alert("Введите количество SOL");
            const lamports = Math.floor(solNum * 1e9);

            const usdcOutUnits = await fetchQuoteUsdcOut(lamports);
            if (usdcOutUnits == null) return alert("Не удалось получить котировку Jupiter");

            let mintUnits: number;
            if (dlanDecimals >= USDT_DECIMALS) {
                mintUnits = usdcOutUnits * 10 ** (dlanDecimals - USDT_DECIMALS);
            } else {
                mintUnits = Math.floor(usdcOutUnits / 10 ** (USDT_DECIMALS - dlanDecimals));
            }
            if (mintUnits <= 0) return alert("Слишком маленькая сумма");

            const sig = await (program.methods as any)
                .stakeAndMintPriced(new BN(lamports), new BN(mintUnits))
                .accounts({
                    authority: me,
                    admin: ADMIN_SOL_WALLET,
                    mint: DLAN_MINT,
                    userToken: userDlanAta,
                    mintAuthority: mintAuth,
                    systemProgram: SystemProgram.programId,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .rpc();

            console.log("stake via quote sig:", sig);

            const bal = await provider.connection.getTokenAccountBalance(userDlanAta);
            setDlanUserUnits(new BN(bal.value.amount));

            const usdcFloat = usdcOutUnits / 10 ** USDT_DECIMALS;
            const dlanFloat = mintUnits / 10 ** dlanDecimals;
            alert(
                `Застейкано ${solNum} SOL. Курс Jupiter ≈ ${usdcFloat.toFixed(
                    6
                )} USDC → начислено ${dlanFloat.toFixed(6)} DLAN.`
            );
        } catch (err: any) {
            console.error(err);
            alert("Ошибка stake:\n" + (err?.message || String(err)));
        }
    }, [provider, program, stakeSol, dlanDecimals, fetchQuoteUsdcOut]);

    /* =================== Invest claim =================== */

    const handleInvestClaim = useCallback(async () => {
        if (!provider || !program || !vip) return alert("Нет соединения");
        try {
            const me = provider.wallet.publicKey!;

            const denom = vip.invest_usd_per_dlan_rule?.dlan_per_usd_per_day ?? 120;
            const dlanHuman = dlanUserUnits.toNumber() / 10 ** dlanDecimals;
            const oneDayUsd = dlanHuman / denom;
            if (oneDayUsd <= 0) return alert("Недостаточно DLAN для начисления");

            const reserveInfo = await provider.connection.getTokenAccountBalance(VAULT_USDT_ATA);
            const reserveUsd = Number(reserveInfo.value.amount) / 10 ** USDT_DECIMALS;
            if (reserveUsd <= 0) return alert("В хранилище USDT нет средств");

            const payoutUsd = Math.min(oneDayUsd, reserveUsd);
            const total = Math.floor(payoutUsd * 10 ** USDT_DECIMALS);

            const feeOwner = new PublicKey(vip.invest_fee_recipient);
            const userUsdtAta = await getAssociatedTokenAddress(USDT_MINT, me);
            const feeAta = await getAssociatedTokenAddress(USDT_MINT, feeOwner);

            const fee = Math.floor(total / 3);
            const user = total - fee;

            const [userState] = PublicKey.findProgramAddressSync(
                [Buffer.from("user"), me.toBuffer()],
                program.programId
            );

            const sig = await (program.methods as any)
                .investClaimSplit(new BN(user), new BN(fee), new BN(1))
                .accounts({
                    authority: me,
                    userState,
                    userToken: userUsdtAta,
                    vaultToken: VAULT_USDT_ATA,
                    vaultAuthority: VAULT_AUTHORITY_PDA,
                    feeOwner,
                    feeToken: feeAta,
                    usdtMint: USDT_MINT,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                    rent: SYSVAR_RENT_PUBKEY,
                })
                .rpc();

            console.log("invest claim (timed) sig:", sig);
            alert(`Claim profit: ${payoutUsd.toFixed(6)} USDT (2/3 вам, 1/3 — fee).`);
        } catch (err: any) {
            console.error(err);
            alert("Ошибка Invest claim:\n" + (err?.message || String(err)));
        }
    }, [provider, program, vip, dlanUserUnits, dlanDecimals]);

    /* =================== VIP =================== */

    const myVipButtons = useMemo(() => {
        if (!wallet || !vip) return [];
        const tier = vip.tiers.find((t) => t.wallet === wallet);
        return tier ? tier.buttons : [];
    }, [wallet, vip]);

    const handleVipClaim = useCallback(
        async (usd: number) => {
            if (!provider || !program || !vip) return alert("Нет соединения");
            try {
                const me = provider.wallet.publicKey!;
                const units = Math.floor(usd * 10 ** USDT_DECIMALS);

                const tier = vip.tiers.find((t) => t.wallet === wallet);
                const feeRecipientStr =
                    tier?.fee_recipient && tier.fee_recipient.length > 0
                        ? tier.fee_recipient
                        : vip.invest_fee_recipient;
                const feeOwner = new PublicKey(feeRecipientStr);

                const reserveInfo = await provider.connection.getTokenAccountBalance(VAULT_USDT_ATA);
                const reserve = Number(reserveInfo.value.amount);
                if (reserve < units) return alert("В хранилище недостаточно USDT");

                const fee = Math.floor(units / 3);
                const user = units - fee;

                const userUsdtAta = await getAssociatedTokenAddress(USDT_MINT, me);
                const feeAta = await getAssociatedTokenAddress(USDT_MINT, feeOwner);

                const [vipState] = PublicKey.findProgramAddressSync(
                    [Buffer.from("vip"), me.toBuffer()],
                    program.programId
                );

                const sig = await (program.methods as any)
                    .vipClaimSplitTimed(new BN(user), new BN(fee), new BN(1))
                    .accounts({
                        authority: me,
                        vipState,
                        userToken: userUsdtAta,
                        vaultToken: VAULT_USDT_ATA,
                        vaultAuthority: VAULT_AUTHORITY_PDA,
                        feeOwner,
                        feeToken: feeAta,
                        usdtMint: USDT_MINT,
                        tokenProgram: TOKEN_PROGRAM_ID,
                        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                        rent: SYSVAR_RENT_PUBKEY,
                    })
                    .rpc();

                console.log("vip claim (timed) sig:", sig);
                alert(`VIP claim ${usd} USDT выполнен (таймер 1 день).`);
            } catch (err: any) {
                console.error(err);
                alert("Ошибка VIP claim:\n" + (err?.message || String(err)));
            }
        },
        [provider, program, vip, wallet]
    );

    /* =================== UI =================== */

    return (
        <div
            style={{
                minHeight: "100vh",
                background: "linear-gradient(180deg,#faf7ff,#f4f7ff)",
                padding: 24,
                fontFamily: "Inter, system-ui, sans-serif",
            }}
        >
            {/* Верхняя панель */}
            <header
                style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 18,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                        style={{
                            width: 52,
                            height: 52,
                            borderRadius: 14,
                            background: "linear-gradient(135deg,#6a5cff,#4cd6ff)",
                        }}
                    />
                    <div style={{ fontSize: 28, fontWeight: 800 }}>DLAN</div>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {!wallet ? (
                        <button onClick={handleConnect} style={btnWhiteBig}>
                            Подключить Phantom
                        </button>
                    ) : (
                        <>
                            <div style={pill}>Кошелёк: {wallet.slice(0, 4)}…{wallet.slice(-4)}</div>
                            <button onClick={reloadVip} style={btnGhost}>
                                Обновить
                            </button>
                        </>
                    )}
                </div>
            </header>

            {/* KPI */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18, marginBottom: 22 }}>
                <KPI title="Ваш DLAN" value={fmtUnits(dlanUserUnits, dlanDecimals)} />
                <KPI title="Всего DLAN" value={fmtUnits(dlanTotalUnits, dlanDecimals)} />
                <KPI title="Ваша доля" value={dlanPct} />
            </div>

            {/* Основные блоки */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
                {/* Stake */}
                <Card>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h2 style={{ margin: 0 }}>Stake</h2>
                        <span style={{ ...pill, background: "#eef1ff", color: "#4a4a4a" }}>Курс: Jupiter</span>
                    </div>
                    <p style={{ color: "#666", marginTop: 12 }}>
                        Внесите SOL, получите DLAN для получения ежедневных дивидендов.
                    </p>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                        <input
                            type="number"
                            min="0"
                            step="0.000001"
                            value={stakeSol}
                            onChange={(e) => setStakeSol(e.target.value)}
                            placeholder="Сколько SOL"
                            style={input}
                        />
                        <button style={btnPrimary} onClick={handleStakeViaQuote}>
                            Stake & Mint
                        </button>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 14, color: "#666" }}>
                        Оценочно получите: <b>~{usdcPreview ? usdcPreview.toFixed(6) : "0.000000"} DLAN</b>
                    </div>
                </Card>

                {/* Invest claim */}
                <Card>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <h2 style={{ margin: 0 }}>Claim profit</h2>
                        <span style={{ ...pillInfo }}>APR ≈ {aprGuess}</span>
                    </div>
                    <p style={{ color: "#666", marginTop: 12 }}>
                        Накопление происходит каждые сутки. Вывод доступен ежедневно.
                    </p>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button style={btnClaim} onClick={handleInvestClaim}>
                            Claim
                        </button>
                    </div>
                </Card>
            </div>

            {/* VIP */}
            <Card style={{ marginTop: 18 }}>
                <h2 style={{ margin: 0 }}>☥</h2>
                {myVipButtons.length ? (
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
                        {myVipButtons.map((usd) => (
                            <button key={usd} style={btnVip} onClick={() => handleVipClaim(usd)}>
                                Claim {usd} USDT
                            </button>
                        ))}
                    </div>
                ) : (
                    <div style={{ marginTop: 8, color: "#666" }}>
                        Дополнительные привилегии на данный момент не доступны
                    </div>
                )}
            </Card>
        </div>
    );
}

/* ------------------- Маленькие UI-компоненты ------------------- */

function KPI({ title, value }: { title: string; value: string }) {
    return (
        <div style={{ padding: 18, borderRadius: 22, background: "white", boxShadow: "0 8px 28px rgba(36,0,255,0.06)" }}>
            <div style={{ color: "#72748a", fontSize: 15, fontWeight: 600 }}>{title}</div>
            <div style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>{value}</div>
        </div>
    );
}

function Card({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) {
    return (
        <div
            style={{
                padding: 18,
                borderRadius: 22,
                background: "white",
                boxShadow: "0 8px 28px rgba(36,0,255,0.06)",
                ...style,
            }}
        >
            {children}
        </div>
    );
}

/* ------------------- Стили ------------------- */

const btnPrimary: React.CSSProperties = {
    padding: "14px 22px",
    borderRadius: 16,
    background: "linear-gradient(135deg,#6a5cff,#8d6bff)",
    color: "white",
    border: "none",
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(90,70,255,0.25)",
};

const btnClaim: React.CSSProperties = {
    padding: "14px 22px",
    borderRadius: 16,
    background: "linear-gradient(135deg,#45c4e6,#4895ef)",
    color: "white",
    border: "none",
    fontWeight: 700,
    fontSize: 16,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(56,132,255,0.22)",
};

const btnWhiteBig: React.CSSProperties = {
    padding: "12px 18px",
    borderRadius: 16,
    background: "white",
    color: "#4a4a4a",
    border: "1px solid #e6e6f0",
    fontWeight: 700,
    cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 16,
    background: "#f3f5ff",
    color: "#4a4a4a",
    border: "none",
    fontWeight: 700,
    cursor: "pointer",
};

const btnVip: React.CSSProperties = {
    padding: "12px 18px",
    borderRadius: 18,
    background: "linear-gradient(135deg,#ffb347,#ffd56a)",
    color: "#4a2a00",
    border: "none",
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 10px 24px rgba(255,170,44,0.25)",
};

const pill: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 999,
    background: "white",
    border: "1px solid #eee",
    fontSize: 14,
    fontWeight: 700,
};

const pillInfo: React.CSSProperties = {
    ...pill,
    background: "#eefcff",
    color: "#0c6a7a",
    border: "1px solid #c7f0f7",
};

const input: React.CSSProperties = {
    padding: "14px 16px",
    borderRadius: 16,
    border: "1px solid #e7e8f1",
    background: "#fafbff",
    outline: "none",
    fontSize: 16,
};
