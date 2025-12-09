// File: pages/index.tsx
import Link from "next/link";
import Head from "next/head";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export default function Landing() {
    return (
        <>
            <Head>
                <title>DLANIS • Access</title>
            </Head>

            <div className="min-h-screen bg-gradient-to-b from-[#020617] via-black to-[#020617] text-neutral-50 flex items-center justify-center px-4">
                <div className="w-full max-w-3xl rounded-3xl border border-indigo-500/40 bg-black/40 backdrop-blur-xl p-6 md:p-8 shadow-[0_20px_80px_rgba(0,0,0,0.8)]">
                    {/* Верхняя строка */}
                    <div className="flex items-center gap-3">
                        <div>
                            <div className="text-xs uppercase tracking-[0.25em] text-indigo-300">
                                DLANIS
                            </div>
                            <h1 className="mt-1 text-2xl md:text-3xl font-extrabold">
                                Distributed Liquidity & Alignment Network
                            </h1>
                        </div>
                        <div className="ml-auto">
                            {/* Кнопка кошелька из wallet-adapter */}
                            <WalletMultiButton className="!h-9 !rounded-2xl !bg-indigo-600 hover:!bg-indigo-500 !text-xs !px-3" />
                        </div>
                    </div>

                    {/* Описание */}
                    <p className="mt-4 text-sm md:text-base text-neutral-300 max-w-2xl">
                        Это точка входа в экосистему DLAN: фонд, который работает на сеточных
                        ботах и ончейн-распределении дохода, социальный слой и
                        расширенные инструменты для тех, кто проходит дальше.
                    </p>

                    {/* Кнопки фронтов */}
                    <div className="mt-6 grid gap-3 md:grid-cols-3">
                        <Link
                            href="/app"
                            className="group rounded-2xl border border-emerald-500/60 bg-emerald-500/10 px-4 py-3 text-sm hover:bg-emerald-500/20 transition flex flex-col justify-between"
                        >
                            <div className="font-semibold text-emerald-200">
                                1-й фронт • Фонд
                            </div>
                            <div className="mt-1 text-xs text-emerald-100/80">
                                Стейк, клейм с фонда, базовая часть системы. Рекомендованный
                                вход для новых.
                            </div>
                        </Link>

                        <Link
                            href="/app2"
                            className="group rounded-2xl border border-indigo-500/60 bg-indigo-500/10 px-4 py-3 text-sm hover:bg-indigo-500/20 transition flex flex-col justify-between"
                        >
                            <div className="font-semibold text-indigo-200">
                                2-й фронт • Social
                            </div>
                            <div className="mt-1 text-xs text-indigo-100/80">
                                Профиль, друзья, личные сообщения, общий чат. Доступен после
                                условий Tier 2.
                            </div>
                        </Link>

                        <Link
                            href="/app3"
                            className="group rounded-2xl border border-fuchsia-500/60 bg-fuchsia-500/10 px-4 py-3 text-sm hover:bg-fuchsia-500/20 transition flex flex-col justify-between"
                        >
                            <div className="font-semibold text-fuchsia-200">
                                3-й фронт • Advanced
                            </div>
                            <div className="mt-1 text-xs text-fuchsia-100/80">
                                Расширенные режимы, эксперименты и закрытые функции
                                для доверенных.
                            </div>
                        </Link>
                    </div>

                    {/* Небольшая подсказка про секретный режим */}
                    <div className="mt-4 text-[10px] text-neutral-500 flex items-center justify-between">
                        <span>
                            Основной доступ через фронты выше. Секретный режим — через
                            скрытую кнопку в интерфейсе.
                        </span>
                    </div>
                </div>
            </div>
        </>
    );
}
