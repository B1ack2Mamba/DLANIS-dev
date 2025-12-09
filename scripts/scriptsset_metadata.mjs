// scripts/set_metadata.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === НАСТРОЙКИ ===
const RPC =
    "https://frequent-thrumming-tent.solana-mainnet.quiknode.pro/50b053e4695fe25371395a9c52174462b48fb9a4/";
const PROGRAM_ID = new PublicKey("3hQsDEYknZmKKUBApAGtcGPy395ogJdiB8DCvMKh24K7");
const DLAN_MINT = new PublicKey("7yTrTBY1PZtknKAQTqzA3KriDc8y7yeMNa9nzTMseYa8");
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
    "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

// значения метаданных — ПОДСТАВЬ СВОЙ CID от metadata.json!
const NAME = "DLAN";                             // ≤32
const SYMBOL = "DLAN";                           // ≤10
const URI = "ipfs://bafkreigtp5abi4vw6mwvf3oaunlkpewqurzlsgysceeb5hmrzuw6hyaf7y";     // <-- замени на твой CID

// где лежит IDL
const IDL_PATH = path.resolve(
    __dirname,
    "../my-dapp/target/idl/dlan_stake.json"
);

// где лежит keypair
const KEYPAIR_PATH = path.resolve(
    process.env.HOME || process.env.USERPROFILE,
    ".config/solana/id.json"
);

function loadKeypair(p) {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const secret = Uint8Array.from(raw);
    return Keypair.fromSecretKey(secret);
}

async function main() {
    if (!fs.existsSync(IDL_PATH)) {
        throw new Error("IDL не найден: " + IDL_PATH);
    }
    if (!fs.existsSync(KEYPAIR_PATH)) {
        throw new Error("Keypair не найден: " + KEYPAIR_PATH);
    }
    if (!URI.startsWith("ipfs://")) {
        throw new Error("URI должен быть вида ipfs://<CID> (не http gateway)");
    }

    const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
    const kp = loadKeypair(KEYPAIR_PATH);

    const connection = new Connection(RPC, "confirmed");
    const wallet = new anchor.Wallet(kp);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const program = new anchor.Program(idl, PROGRAM_ID, provider);

    // PDA Metaplex Metadata: ["metadata", TMPL, mint]
    const [metadataPda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("metadata"),
            TOKEN_METADATA_PROGRAM_ID.toBuffer(),
            DLAN_MINT.toBuffer(),
        ],
        TOKEN_METADATA_PROGRAM_ID
    );

    // PDA mint-auth твоей программы
    const [mintAuthPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint-auth")],
        PROGRAM_ID
    );

    console.log("Authority (payer):", wallet.publicKey.toBase58());
    console.log("DLAN mint        :", DLAN_MINT.toBase58());
    console.log("Metadata PDA     :", metadataPda.toBase58());
    console.log("MintAuth PDA     :", mintAuthPda.toBase58());

    const sig = await program.methods
        .setMetadata(NAME, SYMBOL, URI)
        .accounts({
            authority: wallet.publicKey,         // payer + update authority
            mint: DLAN_MINT,
            metadata: metadataPda,
            mintAuthority: mintAuthPda,
            tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

    console.log("✅ set_metadata tx:", sig);
    console.log(
        "Explorer:",
        "https://solscan.io/tx/" + sig + "?cluster=mainnet"
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
