// File: pages/_app.tsx
import type { AppProps } from "next/app";
import { useMemo, useState, useEffect } from "react";

// Tailwind + глобальные стили
import "@/styles/globals.css";

// UI кошелька (кнопка Connect и модалка)
import "@solana/wallet-adapter-react-ui/styles.css";

// Провайдеры кошелька
import {
    ConnectionProvider,
    WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";

// Сеть и RPC
import { clusterApiUrl } from "@solana/web3.js";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";

// Адаптеры кошельков
import {
    PhantomWalletAdapter,
    SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";

/**
 * 🔐 Секретный Q&A для скрытого входа
 * Настраивается через .env.local:
 *  NEXT_PUBLIC_SECRET_QUESTION="Как на английском будет «Форма пуста — пустота есть форма»?"
 *  NEXT_PUBLIC_SECRET_ANSWER="Form is emptiness, emptiness is form"
 */
const SECRET_QUESTION =
    process.env.NEXT_PUBLIC_SECRET_QUESTION ||
    '«Форма пуста — пустота есть форма»';

const SECRET_ANSWER =
    (process.env.NEXT_PUBLIC_SECRET_ANSWER || "DAO").toLowerCase();

/**
 * Плавающая секретная кнопка + модалка с вопросом
 */
function SecretOverlay() {
    const [open, setOpen] = useState(false);
    const [answer, setAnswer] = useState("");
    const [status, setStatus] = useState<"idle" | "ok" | "error">("idle");

    // При монтировании проверяем, не был ли уже активирован секретный режим
    useEffect(() => {
        if (typeof window === "undefined") return;
        const flag = localStorage.getItem("dlan_secret_mode") === "1";
        if (flag) {
            setStatus("ok");
            (window as any).__DLAN_SECRET__ = true;
        }
    }, []);

    // При успешном ответе сохраняем флаг и глобальную метку
    useEffect(() => {
        if (status !== "ok") return;
        if (typeof window === "undefined") return;
        localStorage.setItem("dlan_secret_mode", "1");
        (window as any).__DLAN_SECRET__ = true;
    }, [status]);

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const val = answer.trim().toLowerCase();
        if (!val) return;
        if (val === SECRET_ANSWER) {
            setStatus("ok");
        } else {
            setStatus("error");
        }
    };

    return (
        <>
            {/* 🔘 Секретная плавающая кнопка в правом нижнем углу */}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="fixed bottom-3 right-3 z-40 h-8 w-8 rounded-full border border-indigo-400/60 bg-black/50 text-[10px] text-indigo-200 shadow-lg backdrop-blur-sm opacity-30 hover:opacity-100 transition flex items-center justify-center select-none"
                title=" "
            >
                ●
            </button>

            {/* Модалка с вопросом */}
            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="w-full max-w-md rounded-2xl border border-indigo-500/50 bg-[#050816] text-neutral-50 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.9)]">
                        <div className="flex items-center justify-between">
                            <div className="text-xs uppercase tracking-[0.2em] text-indigo-300">
                                DLAN SECRET ENTRY
                            </div>
                            <button
                                type="button"
                                className="text-sm text-neutral-400 hover:text-neutral-200"
                                onClick={() => setOpen(false)}
                            >
                                ×
                            </button>
                        </div>

                        <div className="mt-3 text-sm font-semibold">
                            Ответь на вопрос
                        </div>
                        <p className="mt-1 text-xs text-neutral-300">
                            {SECRET_QUESTION}
                        </p>

                        <form onSubmit={onSubmit} className="mt-3 space-y-3">
                            <input
                                type="text"
                                value={answer}
                                onChange={(e) => {
                                    setAnswer(e.target.value);
                                    if (status !== "idle") setStatus("idle");
                                }}
                                placeholder="Введите ответ…"
                                className="w-full rounded-xl border border-indigo-500/40 bg-black/40 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500/70"
                            />
                            {status === "error" && (
                                <div className="text-xs text-rose-400">
                                    Неверный ответ.
                                </div>
                            )}
                            {status === "ok" && (
                                <div className="text-xs text-emerald-400">
                                    Секретный режим активирован.
                                </div>
                            )}
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setOpen(false);
                                    }}
                                    className="rounded-xl border border-neutral-500/40 bg-transparent px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-800"
                                >
                                    Закрыть
                                </button>
                                <button
                                    type="submit"
                                    className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold"
                                >
                                    Подтвердить
                                </button>
                            </div>
                        </form>

                        <div className="mt-3 text-[10px] text-neutral-500">
                            Флаг секретного режима пишется в{" "}
                            <span className="font-mono">localStorage.dlan_secret_mode</span>{" "}
                            и в <span className="font-mono">window.__DLAN_SECRET__</span>.
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default function App({ Component, pageProps }: AppProps) {
    // Выбираем сеть (по умолчанию devnet). Можно задать в .env.local
    const network =
        (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork) ??
        WalletAdapterNetwork.Devnet;

    // Кастомный RPC через .env.local или стандартный clusterApiUrl
    const endpoint = process.env.NEXT_PUBLIC_RPC_URL ?? clusterApiUrl(network);

    const wallets = useMemo(
        () => [
            new PhantomWalletAdapter(),
            new SolflareWalletAdapter({ network }),
        ],
        [network]
    );

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    {/* ✅ Основной вход остаётся как есть */}
                    <Component {...pageProps} />

                    {/* 🔐 Секретное всплывающее окно поверх всего */}
                    <SecretOverlay />
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}
