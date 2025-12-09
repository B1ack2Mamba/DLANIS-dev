import { PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Program, AnchorProvider } from "@coral-xyz/anchor";
import idl from "../idl/dlan_stake.json";

// Надёжно берём адрес: из idl.metadata.address, либо idl.address (новые Anchor),
// либо из ENV-переменной NEXT_PUBLIC_DLAN_PROGRAM_ID
const RAW_ADDR =
    (idl as any).metadata?.address ??
    (idl as any).address ??
    process.env.NEXT_PUBLIC_DLAN_PROGRAM_ID;

if (!RAW_ADDR) {
    throw new Error(
        "Program address not found. Set idl.metadata.address or idl.address in IDL, or NEXT_PUBLIC_DLAN_PROGRAM_ID env."
    );
}

export const PROGRAM_ID = new PublicKey(RAW_ADDR);

// Если хочешь — забери тип через typeof idl
export type DlanStakeIdl = typeof idl;

// Создаём Program c валидным AnchorProvider
export const getProgram = (provider: any) => new Program(idl as any, provider);
export const makeProgram = getProgram;
export const pda = {
    config: () =>
        PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0],
    profile: (owner: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from("profile"), owner.toBuffer()],
            PROGRAM_ID
        )[0],
    post: (author: PublicKey, index: BN) =>
        PublicKey.findProgramAddressSync(
            [
                Buffer.from("post"),
                author.toBuffer(),
                Buffer.from(index.toArray("le", 8)),
            ],
            PROGRAM_ID
        )[0],
    contact: (a: PublicKey, b: PublicKey) =>
        PublicKey.findProgramAddressSync(
            [Buffer.from("contact"), a.toBuffer(), b.toBuffer()],
            PROGRAM_ID
        )[0],
};

export async function initSocialConfig(
    program: Program,
    authority: PublicKey,
    dlanMint: PublicKey,
    dlanDecimals: number
) {
    const config = pda.config();
    await (program as any).methods
        .initSocialConfig(dlanDecimals)
        .accounts({
            authority,
            dlanMint,
            config,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
    return config;
}

export async function initProfile(
    program: Program,
    authority: PublicKey,
    dlanAta: PublicKey,
    displayName: string,
    bio: string
) {
    const profile = pda.profile(authority);
    await (program as any).methods
        .initProfile(displayName, bio)
        .accounts({
            authority,
            config: pda.config(),
            dlanAta,
            profile,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
    return profile;
}

export async function recomputeLevel(
    program: Program,
    authority: PublicKey,
    dlanAta: PublicKey
) {
    await (program as any).methods
        .recomputeLevel()
        .accounts({
            authority,
            config: pda.config(),
            dlanAta,
            profile: pda.profile(authority),
        })
        .rpc();
}

export async function createPost(
    program: Program,
    authority: PublicKey,
    content: string,
    minLevel: number,
    maxLevel: number
) {
    const authorProfilePk = pda.profile(authority);
    const authorProfile = await (program as any).account.profile.fetch(
        authorProfilePk
    );
    const index = new BN(authorProfile.postsCount as any);
    const postPk = pda.post(authority, index);

    await (program as any).methods
        .createPost(new TextEncoder().encode(content), minLevel, maxLevel)
        .accounts({
            authority,
            config: pda.config(),
            authorProfile: authorProfilePk,
            post: postPk,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
    return postPk;
}

export async function requestContact(
    program: Program,
    initiator: PublicKey,
    targetOwner: PublicKey
) {
    const contactPk = pda.contact(initiator, targetOwner);
    await (program as any).methods
        .requestContact()
        .accounts({
            initiator,
            initiatorProfile: pda.profile(initiator),
            targetProfile: pda.profile(targetOwner),
            contact: contactPk,
            systemProgram: SystemProgram.programId,
        })
        .rpc();
    return contactPk;
}

export async function respondContact(
    program: Program,
    target: PublicKey,
    contactPk: PublicKey,
    accept: boolean
) {
    await (program as any).methods
        .respondContact(accept)
        .accounts({ target, contact: contactPk })
        .rpc();
}
