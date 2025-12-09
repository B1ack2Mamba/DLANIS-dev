import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Toaster, toast } from "sonner";
import { RefreshCw, Save, Send, User, Wallet } from "lucide-react";

// ===== IDL ====================================================================
import idlJson from "../idl/dlan_stake.json";

// Program ID (двухфакторная модель: ENV → IDL → FALLBACK)
const ENV_PROGRAM_ID = process.env.NEXT_PUBLIC_DLAN_PROGRAM_ID;
const IDL_PROGRAM_ID =
    // @ts-ignore (поддержка старого формата IDL)
    (idlJson as any)?.metadata?.address || (idlJson as any)?.address;
const FALLBACK_PROGRAM_ID = "3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7";

const PROGRAM_ID = new PublicKey(
    ENV_PROGRAM_ID || IDL_PROGRAM_ID || FALLBACK_PROGRAM_ID
);

// Нормализуем IDL
const idl: any = idlJson as any;
idl.metadata = idl.metadata ?? {};
idl.metadata.address =
    idl.metadata.address || idl.address || PROGRAM_ID.toBase58();

// ===== Константы и утилиты ====================================================
const MAX_POST_BYTES = 280;
const MAX_LEVEL = 7;

function u8ToString(arr?: number[] | Uint8Array | null, len?: number): string {
    if (!arr) return "";
    const u8 = Array.isArray(arr) ? Uint8Array.from(arr) : arr;
    const view = (typeof len === "number" && len >= 0) ? u8.subarray(0, len) : u8;
    try { return new TextDecoder().decode(view).replace(/\0+$/g, ""); } catch { return ""; }
}

function stringToBytesClamped(s: string, maxBytes: number): Uint8Array {
    const enc = new TextEncoder().encode(s);
    if (enc.length <= maxBytes) return enc;
    // бинарный поиск по длине символов, чтобы по байтам <= maxBytes
    let lo = 0, hi = s.length;
    while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        const slice = s.slice(0, mid);
        const b = new TextEncoder().encode(slice);
        if (b.length <= maxBytes) lo = mid; else hi = mid - 1;
    }
    return new TextEncoder().encode(s.slice(0, lo));
}

function anchorErrorToText(err: any): string {
    const raw = String(err?.error?.errorMessage || err?.message || err);
    const m = raw.toLowerCase();
    if (m.includes("post too long")) return "Пост слишком длинный (макс 280 байт).";
    if (m.includes("invalid level") || m.includes("invalid level or range")) return "Неверный диапазон уровней.";
    if (m.includes("profile mismatch")) return "Профиль принадлежит другому владельцу.";
    if (m.includes("unauthorized")) return "Недостаточно прав.";
    return raw;
}

// ===== Мини-UI ================================================================
const Spinner = ({ className = "h-4 w-4" }: { className?: string }) => (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
);

function Button(props: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
    variant?: "primary" | "secondary" | "danger" | "ghost";
    disabled?: boolean;
    loading?: boolean;
    className?: string;
}) {
    const { children, onClick, type, variant = "primary", disabled, loading, className } = props;
    const base = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500";
    const pal: Record<string, string> = {
        primary: "bg-indigo-600 text-white hover:bg-indigo-500",
        secondary: "bg-neutral-700 text-white hover:bg-neutral-600",
        danger: "bg-rose-600 text-white hover:bg-rose-500",
        ghost: "text-neutral-200 hover:bg-neutral-800"
    };
    const state = (disabled || loading) ? "opacity-50 pointer-events-none" : "";
    return (
        <button type={type || "button"} onClick={onClick} disabled={disabled || loading} className={`${base} ${pal[variant]} ${state} ${className || ""}`}>
            {loading ? <Spinner /> : null}
            {children}
        </button>
    );
}

const Card = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`rounded-2xl border border-neutral-800 bg-neutral-900 text-neutral-100 shadow-sm ${className}`}>{children}</div>;
const CardHeader = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`p-6 pb-3 ${className}`}>{children}</div>;
const CardTitle = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <h3 className={`text-lg font-semibold tracking-tight ${className}`}>{children}</h3>;
const CardDesc = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <p className={`text-sm text-neutral-400 ${className}`}>{children}</p>;
const CardContent = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`p-6 pt-0 space-y-4 ${className}`}>{children}</div>;
const CardFooter = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <div className={`p-6 pt-0 ${className}`}>{children}</div>;
const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2 ${props.className || ""}`} />;
const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} className={`w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2 ${props.className || ""}`} />;

// ===== Страница постов ========================================================
export default function PostsPage() {
    const { connection } = useConnection();
    const wallet = useWallet();

    // Provider & Program
    const provider = useMemo(() => {
        if (!wallet || !wallet.publicKey) return null;
        return new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
    }, [connection, wallet]);

    const program = useMemo(() => {
        if (!provider) return null;
        try { return new anchor.Program(idl as Idl, provider) as any; }
        catch (e) { console.error("Program init failed:", e); return null; }
    }, [provider]);

    // PDA для профиля и конфига
    const [configPda, setConfigPda] = useState<PublicKey | null>(null);
    const [profilePda, setProfilePda] = useState<PublicKey | null>(null);

    useEffect(() => {
        if (!wallet.publicKey) { setConfigPda(null); setProfilePda(null); return; }
        setConfigPda(PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0]);
        setProfilePda(PublicKey.findProgramAddressSync([Buffer.from("profile"), wallet.publicKey.toBuffer()], PROGRAM_ID)[0]);
    }, [wallet.publicKey]);

    // Данные
    const [refreshing, setRefreshing] = useState(false);
    const [creating, setCreating] = useState(false);
    const [profile, setProfile] = useState<any | null>(null);
    const [posts, setPosts] = useState<any[]>([]);

    // Поля формы
    const [content, setContent] = useState("");
    const [minLevel, setMinLevel] = useState(0);
    const [maxLevel, setMaxLevel] = useState(MAX_LEVEL);

    const tryFetch = useCallback(async (ns: any, pda: PublicKey) => {
        try { if (typeof ns.fetchNullable === "function") return await ns.fetchNullable(pda); return await ns.fetch(pda); }
        catch { return null; }
    }, []);

    // Вычисляем PDA поста по индексу
    const postPdaByIndex = useCallback((author: PublicKey, index: number) => {
        const ixBuf = new anchor.BN(index).toArrayLike(Buffer, "le", 8);
        return PublicKey.findProgramAddressSync(
            [Buffer.from("post"), author.toBuffer(), ixBuf],
            PROGRAM_ID
        )[0];
    }, []);

    // Тянем профиль и посты
    const pull = useCallback(async () => {
        if (!program || !wallet.publicKey || !profilePda) return;
        setRefreshing(true);
        try {
            const acc = program.account as any;
            const p = await tryFetch(acc.profile, profilePda);
            setProfile(p);

            const list: any[] = [];
            const total = Number(p?.postsCount || 0);
            for (let i = 0; i < total; i++) {
                const pda = postPdaByIndex(wallet.publicKey, i);
                const postAcc = await tryFetch(acc.post, pda);
                if (postAcc) list.push({ ...postAcc, _pda: pda, _index: i });
            }
            // по убыванию индекса (новые сверху)
            list.sort((a, b) => Number(b._index) - Number(a._index));
            setPosts(list);
        } finally {
            setRefreshing(false);
        }
    }, [program, wallet.publicKey, profilePda, tryFetch, postPdaByIndex]);

    useEffect(() => { pull(); }, [pull]);

    const connected = !!wallet.publicKey;
    const canCreate = connected && !!profile;

    // Создание поста
    const onCreate = useCallback(async () => {
        if (!program || !wallet.publicKey || !profile) return;
        // Валидации уровня
        if (minLevel < 0 || maxLevel > MAX_LEVEL || minLevel > maxLevel) {
            toast.error("Уровни", { description: "Проверьте диапазон уровней 0..7." });
            return;
        }
        // Контент → байты, с обрезкой до 280
        const body = stringToBytesClamped(content.trim(), MAX_POST_BYTES);
        if (body.length === 0) {
            toast.error("Пост пуст", { description: "Введите текст." });
            return;
        }
        setCreating(true);
        try {
            // Post PDA: используется текущий postsCount как индекс (ончейн инкрементирует после)
            const indexNow = Number(profile.postsCount || 0);
            const postPda = postPdaByIndex(wallet.publicKey, indexNow);

            await program.methods.createPost([...body], minLevel, maxLevel).accounts({
                authority: wallet.publicKey,
                config: configPda!,                 // в on-chain он используется для MAX_LEVEL и т.п.
                authorProfile: profilePda!,         // ваш профиль
                post: postPda,
                systemProgram: SystemProgram.programId,
            }).rpc();

            setContent("");
            toast.success("Пост опубликован");
            await pull();
        } catch (e: any) {
            toast.error("Ошибка публикации", { description: anchorErrorToText(e) });
        } finally {
            setCreating(false);
        }
    }, [program, wallet.publicKey, profile, minLevel, maxLevel, content, postPdaByIndex, configPda, profilePda, pull]);

    // Байтовый счётчик
    const usedBytes = new TextEncoder().encode(content).length;
    const pct = Math.min(100, Math.round((usedBytes / MAX_POST_BYTES) * 100));

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100">
            <Toaster position="bottom-right" richColors closeButton />

            <header className="border-b border-neutral-900">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-neutral-300">
                        <span className="font-semibold">DLAN Social — Посты</span>
                        <span className="text-neutral-600">•</span>
                        <span className="inline-flex items-center gap-1">
                            <Wallet className="h-4 w-4" />
                            {connected ? "wallet connected" : "no wallet"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => pull()} loading={refreshing}>
                            <RefreshCw className="h-4 w-4" /> Обновить
                        </Button>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-4 py-6 md:py-8 space-y-6">
                {/* Инфо о профиле */}
                <Card>
                    <CardHeader className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <User className="h-5 w-5" />
                            <CardTitle>Ваш профиль</CardTitle>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {!profile ? (
                            <div className="text-sm text-neutral-400">
                                Профиль ещё не создан. Откройте страницу <code className="px-1 rounded bg-neutral-800">/social</code> и создайте профиль.
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-sm">
                                <div>
                                    <div className="text-neutral-400">Имя</div>
                                    <div className="text-neutral-100">{u8ToString(profile.displayName) || "—"}</div>
                                </div>
                                <div>
                                    <div className="text-neutral-400">Уровень</div>
                                    <div className="text-neutral-100">{Number(profile.level)}</div>
                                </div>
                                <div>
                                    <div className="text-neutral-400">Постов</div>
                                    <div className="text-neutral-100">{Number(profile.postsCount)}</div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Создание поста */}
                <Card>
                    <CardHeader>
                        <CardTitle>Новый пост</CardTitle>
                        <CardDesc>Контент ≤ {MAX_POST_BYTES} байт. Диапазон доступа по уровням 0..{MAX_LEVEL}.</CardDesc>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Textarea
                                rows={4}
                                value={content}
                                onChange={(e) => setContent(e.target.value)}
                                placeholder="Что нового?.."
                                disabled={!canCreate || creating}
                            />
                            <div className="mt-2 flex items-center gap-2 text-xs">
                                <div className="h-1 w-40 rounded bg-neutral-800">
                                    <div className="h-1 rounded bg-indigo-500" style={{ width: `${pct}%` }} />
                                </div>
                                <span className={usedBytes > MAX_POST_BYTES ? "text-rose-400" : "text-neutral-400"}>
                                    {usedBytes}/{MAX_POST_BYTES} байт
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div>
                                <div className="text-sm font-medium mb-1">Мин. уровень</div>
                                <input
                                    type="number"
                                    min={0}
                                    max={MAX_LEVEL}
                                    value={minLevel}
                                    onChange={(e) => setMinLevel(Math.max(0, Math.min(MAX_LEVEL, Number(e.target.value) || 0)))}
                                    className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2"
                                    disabled={!canCreate || creating}
                                />
                            </div>
                            <div>
                                <div className="text-sm font-medium mb-1">Макс. уровень</div>
                                <input
                                    type="number"
                                    min={0}
                                    max={MAX_LEVEL}
                                    value={maxLevel}
                                    onChange={(e) => setMaxLevel(Math.max(0, Math.min(MAX_LEVEL, Number(e.target.value) || 0)))}
                                    className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2"
                                    disabled={!canCreate || creating}
                                />
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="flex gap-2">
                        <Button onClick={onCreate} disabled={!canCreate || creating} loading={creating}>
                            <Send className="h-4 w-4" /> Опубликовать
                        </Button>
                    </CardFooter>
                </Card>

                {/* Список постов */}
                <Card>
                    <CardHeader>
                        <CardTitle>Ваши посты</CardTitle>
                        <CardDesc>Новые сверху</CardDesc>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {posts.length === 0 ? (
                            <div className="text-sm text-neutral-400">Постов пока нет.</div>
                        ) : (
                            posts.map((p) => {
                                const text = u8ToString(p.content as number[], Number(p.contentLen));
                                return (
                                    <div key={String(p._pda)} className="rounded-xl border border-neutral-800 p-4">
                                        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                                            <span>index: <span className="text-neutral-200">{Number(p.index)}</span></span>
                                            <span>min: <span className="text-neutral-200">{Number(p.minLevel)}</span></span>
                                            <span>max: <span className="text-neutral-200">{Number(p.maxLevel)}</span></span>
                                            <span>ts: <span className="text-neutral-200">{Number(p.createdTs)}</span></span>
                                        </div>
                                        <div className="mt-2 whitespace-pre-wrap text-sm">{text}</div>
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>
            </main>
        </div>
    );
}
