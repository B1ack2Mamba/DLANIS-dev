// hooks/useTierGuard.ts
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { useRouter } from "next/router";
import { useEffect, useMemo } from "react";
import { toast } from "react-toastify";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

// ===== IDL / Program ID — ТОЧНО КАК У ТЕБЯ В dlan.tsx ==============================
import idlJson from "@/idl/dlan_stake.json";

const ENV_PROGRAM_ID = process.env.NEXT_PUBLIC_DLAN_PROGRAM_ID;
const IDL_PROGRAM_ID = (idlJson as any)?.metadata?.address || (idlJson as any)?.address;
const FALLBACK_PROGRAM_ID = "3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7";
const PROGRAM_ID = new PublicKey(ENV_PROGRAM_ID || IDL_PROGRAM_ID || FALLBACK_PROGRAM_ID);

const idl: any = idlJson as any;
idl.metadata = idl.metadata ?? {};
idl.metadata.address = idl.metadata.address || idl.address || PROGRAM_ID.toBase58();

// DLAN mint
const DLAN_MINT = new PublicKey("9v2hp9qPW9wHodX1y6dDzR5jrU3n1ToAxAtcZArY71FR");

export const useTierGuard = (requiredTier: 2 | 3 = 2) => {
    const { connection } = useConnection();
    const { publicKey, wallet, connected } = useWallet(); // wallet нужен для signTransaction
    const router = useRouter();

    // ← ТОЧНО КАК У ТЕБЯ В dlan.tsx — wallet?.publicKey
    const provider = useMemo(
        () => publicKey ? new AnchorProvider(connection, wallet as any, { commitment: "confirmed" }) : null,
        [connection, wallet, publicKey]
    );
   

    useEffect(() => {
        if (!connected || !publicKey || !provider) {
            toast.error("Подключи кошелёк");
            router.replace("/app");
            return;
        }

        const check = async () => {
            try {
                const program = new Program(idl as any, provider);

                const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
                const [userStatsPda] = PublicKey.findProgramAddressSync(
                    [Buffer.from("ustats2"), publicKey.toBuffer()],
                    program.programId
                );

                const dlanAta = getAssociatedTokenAddressSync(DLAN_MINT, publicKey);

                await program.methods
                    .assertTier(requiredTier)
                    .accounts({
                        config: configPda,
                        user_stats: userStatsPda,
                        dlan_ata: dlanAta,
                        authority: publicKey,
                    })
                    .simulate();

                // Доступ есть — остаёмся
            } catch (err) {
                toast.error(
                    requiredTier === 2
                        ? "Доступ к элитному режиму закрыт: нужно ≥1000 DLAN и ≥60 клеймов"
                        : "Доступ к тир 3 закрыт: нужно ≥5000 DLAN и ≥300 клеймов"
                );
                router.replace("/app");
            }
        };

        check();
    }, [connected, publicKey, provider, router, requiredTier]);
};