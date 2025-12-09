// pages/social.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import * as anchor from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Toaster, toast } from "sonner";
import {
  Edit3,
  RefreshCw,
  Save,
  Trash2,
  User,
  Wallet,
  X,
  Send,
  UserPlus,
  Check,
  Ban,
  MessageSquareText,
} from "lucide-react";

// ---------- Buffer polyfill (Vec<u8> args need Buffer) ----------
import { Buffer } from "buffer";
// @ts-ignore
(globalThis as any).Buffer = (globalThis as any).Buffer || Buffer;

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

// Нормализуем IDL (Anchor любит адрес внутри metadata)
const idl: any = idlJson as any;
idl.metadata = idl.metadata ?? {};
idl.metadata.address =
  idl.metadata.address || idl.address || PROGRAM_ID.toBase58();

// ===== Утилиты & константы ====================================================
const MAX_NAME = 32;
const MAX_BIO = 128;
const MAX_PLACE = 64;

const MAX_POST_BYTES = 280;
const MAX_LEVEL = 7;

// DM
const MAX_DM_BYTES = 512;

// NEW: сиды для UserStats с поинтами
const USTATS_SEED = "ustats2";

function u8ToString(
  arr?: number[] | Uint8Array | null,
  len?: number
): string {
  if (!arr) return "";
  const u8 = Array.isArray(arr) ? Uint8Array.from(arr) : arr;
  const view =
    typeof len === "number" && len >= 0 ? u8.subarray(0, len) : u8.subarray(0);
  try {
    return new TextDecoder().decode(view).replace(/\0+$/g, "");
  } catch {
    return "";
  }
}

function clampLen(s: string, maxBytes: number): string {
  const enc = new TextEncoder().encode(s);
  if (enc.length <= maxBytes) return s;
  let lo = 0,
    hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const slice = s.slice(0, mid);
    const b = new TextEncoder().encode(slice);
    if (b.length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo);
}

function clampToBytes(s: string, maxBytes: number): Uint8Array {
  const enc = new TextEncoder().encode(s);
  if (enc.length <= maxBytes) return enc;
  let lo = 0,
    hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const slice = s.slice(0, mid);
    const b = new TextEncoder().encode(slice);
    if (b.length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return new TextEncoder().encode(s.slice(0, lo));
}

function dateToUnixSeconds(d: string | null): anchor.BN {
  if (!d) return new anchor.BN(-1);
  const ms = Date.parse(d);
  if (Number.isNaN(ms)) return new anchor.BN(-1);
  return new anchor.BN(Math.floor(ms / 1000));
}

function unixToDateInput(v?: anchor.BN | number | null): string {
  if (v === undefined || v === null) return "";
  const n = (anchor.BN.isBN as any)?.(v)
    ? (v as anchor.BN).toNumber()
    : Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateToYear(d: string): string {
  if (!d) return "";
  const y = Number(d.slice(0, 4));
  return Number.isFinite(y) ? String(y) : "";
}

const genderTextMap: Record<number, string> = {
  0: "Не указан",
  1: "Мужской",
  2: "Женский",
  3: "Другое",
};

function anchorErrorToText(err: any): string {
  const raw = String(err?.error?.errorMessage || err?.message || err);
  const m = raw.toLowerCase();
  if (m.includes("name too long")) return "Имя слишком длинное (макс 32 байта).";
  if (m.includes("bio too long")) return "Био слишком длинное (макс 128 байт).";
  if (m.includes("place too long")) return "Место рождения слишком длинное (макс 64 байта).";
  if (m.includes("invalid gender")) return "Пол должен быть 0..3.";
  if (m.includes("wrong mint")) return "Не совпадает mint DLAN для ATA.";
  if (m.includes("profile mismatch")) return "Профиль принадлежит другому владельцу.";
  if (m.includes("invalid level")) return "Неверный уровень/диапазон.";
  if (m.includes("post too long")) return "Пост слишком длинный (макс 280 байт).";
  if (m.includes("dm body is too long")) return "Сообщение слишком длинное (макс 512 байт).";
  if (m.includes("accounts must be passed as a<b>")) return "Порядок ключей в DM должен быть a<b>.";
  if (m.includes("not participant")) return "Вы не участник этого треда.";
  if (m.includes("already been processed")) return "Транзакция уже обработана (повторная отправка) — пробую обновить состояние.";
  if (m.includes("buffer as src")) return "Нужно передавать Buffer (например, Buffer.from(bytes)) вместо массива.";
  if (m.includes("unauthorized")) return "Недостаточно прав для операции.";
  if (m.includes("investment exceeds limit")) return "Превышен лимит инвестиций по текущим поинтам.";
  return raw;
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

// ===== Мини-UI (Tailwind-only) ================================================
const Spinner = ({ className = "h-4 w-4" }: { className?: string }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24">
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
      fill="none"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
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
    "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const pal: Record<string, string> = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-500",
    secondary: "bg-neutral-700 text-white hover:bg-neutral-600",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
    ghost: "text-neutral-200 hover:bg-neutral-800",
  };
  const state = disabled || loading ? "opacity-50 pointer-events-none" : "";
  return (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${pal[variant]} ${state} ${className || ""}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`rounded-2xl border border-neutral-800 bg-neutral-900 text-neutral-100 shadow-sm ${className}`}
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
}) => <div className={`p-6 pb-3 ${className}`}>{children}</div>;
const CardTitle = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <h3 className={`text-lg font-semibold tracking-tight ${className}`}>{children}</h3>
);
const CardDesc = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => <p className={`text-sm text-neutral-400 ${className}`}>{children}</p>;
const CardContent = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={`p-6 pt-0 space-y-4 ${className}`}>{children}</div>;
const CardFooter = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={`p-6 pt-0 ${className}`}>{children}</div>;

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2 ${
      props.className || ""
    }`}
  />
);

const Textarea = (
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>
) => (
  <textarea
    {...props}
    className={`w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2 ${
      props.className || ""
    }`}
  />
);

// ===== GPT-чат (правый столбец) ===============================================
type ChatMsg = { role: "user" | "assistant" | "system"; content: string };

function GptChat() {
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
    setChat((prev) => [...prev, userMsg]);

    try {
      const r = await fetch("/api/gpt-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...chat, userMsg] }),
      });
      const data = await r.json();
      setChat((prev) => [
        ...prev,
        {
          role: "assistant",
          content: String(data?.content || data?.error || "…"),
        },
      ]);
    } catch (e: any) {
      setChat((prev) => [
        ...prev,
        { role: "assistant", content: `Ошибка сети: ${e?.message || String(e)}` },
      ]);
    } finally {
      setSending(false);
    }
  }, [chat, input, sending]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPT чат</CardTitle>
        <CardDesc>Диалог в рамках профиля</CardDesc>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-80 overflow-auto space-y-2 text-sm pr-1">
          {chat.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl px-3 py-2 ${
                m.role === "user"
                  ? "bg-indigo-500/10 text-indigo-100"
                  : "bg-neutral-800"
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
          <Button onClick={send} disabled={sending || !input.trim()} loading={sending}>
            Отправить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== Страница ===============================================================
export default function SocialPage() {
  const { connection } = useConnection();
  const wallet = useWallet();

  // Provider
  const provider = useMemo(() => {
    if (!wallet || !wallet.publicKey) return null;
    return new anchor.AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
  }, [connection, wallet]);

  // Program
  const program = useMemo(() => {
    if (!provider) return null;
    try {
      return new anchor.Program(idl as Idl, provider) as any;
    } catch (e) {
      console.error("Program init failed:", e);
      return null;
    }
  }, [provider]);

  // PDA
  const [configPda, setConfigPda] = useState<PublicKey | null>(null);
  const [profilePda, setProfilePda] = useState<PublicKey | null>(null);
  const [extraPda, setExtraPda] = useState<PublicKey | null>(null);
  const [userStatsPda, setUserStatsPda] = useState<PublicKey | null>(null); // NEW

  useEffect(() => {
    if (!wallet.publicKey) {
      setConfigPda(null);
      setProfilePda(null);
      setExtraPda(null);
      setUserStatsPda(null);
      return;
    }
    setConfigPda(
      PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0]
    );
    setProfilePda(
      PublicKey.findProgramAddressSync(
        [Buffer.from("profile"), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      )[0]
    );
    setExtraPda(
      PublicKey.findProgramAddressSync(
        [Buffer.from("profile2"), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      )[0]
    );
    // NEW: ustats2
    setUserStatsPda(
      PublicKey.findProgramAddressSync(
        [Buffer.from(USTATS_SEED), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      )[0]
    );
  }, [wallet.publicKey]);

  // Данные
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<any | null>(null);
  const [extra, setExtra] = useState<any | null>(null);
  const [userStats, setUserStats] = useState<any | null>(null); // NEW
  const [dlanMint, setDlanMint] = useState<PublicKey | null>(null);
  const [dlanAta, setDlanAta] = useState<PublicKey | null>(null);

  // Формы
  const [editing, setEditing] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [birthDate, setBirthDate] = useState<string>("");
  const [birthPlace, setBirthPlace] = useState("");
  const [gender, setGender] = useState<string>("0");

  // ====== Посты ===============================================================
  const [postContent, setPostContent] = useState("");
  const [minLevel, setMinLevel] = useState(0);
  const [maxLevel, setMaxLevel] = useState(MAX_LEVEL);
  const [creatingPost, setCreatingPost] = useState(false);
  const [posts, setPosts] = useState<any[]>([]);

  // ====== Контакты ============================================================
  type ContactAcc = {
    publicKey: PublicKey;
    account: any;
  };
  const [myFriends, setMyFriends] = useState<ContactAcc[]>([]);
  const [inboundReqs, setInboundReqs] = useState<ContactAcc[]>([]);
  const [outboundReqs, setOutboundReqs] = useState<ContactAcc[]>([]);
  const [friendTarget, setFriendTarget] = useState("");
  const [contactBusy, setContactBusy] = useState(false);

  // ====== DM =================================================================
  const [peer, setPeer] = useState("");
  const [threadPda, setThreadPda] = useState<PublicKey | null>(null);
  const [dmLoading, setDmLoading] = useState(false);
  const [dmBody, setDmBody] = useState("");
  const [dmMessages, setDmMessages] = useState<any[]>([]);

  // ATA
  const computeAta = useCallback(
    (mint: PublicKey, owner: PublicKey) =>
      getAssociatedTokenAddressSync(
        mint,
        owner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      ),
    []
  );

  const tryFetch = useCallback(async (ns: any, pda: PublicKey) => {
    try {
      if (typeof ns.fetchNullable === "function") return await ns.fetchNullable(pda);
      return await ns.fetch(pda);
    } catch {
      return null;
    }
  }, []);

  const postPdaByIndex = useCallback((author: PublicKey, index: number) => {
    const ixBuf = new anchor.BN(index).toArrayLike(Buffer, "le", 8);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("post"), author.toBuffer(), ixBuf],
      PROGRAM_ID
    )[0];
  }, []);

  const dmThreadPda = useCallback((a: PublicKey, b: PublicKey) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("dm/thread"), a.toBuffer(), b.toBuffer()],
      PROGRAM_ID
    )[0];
  }, []);

  const dmMessagePda = useCallback((thread: PublicKey, index: number) => {
    const ix = new anchor.BN(index).toArrayLike(Buffer, "le", 8);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("dm/msg"), thread.toBuffer(), ix],
      PROGRAM_ID
    )[0];
  }, []);

  // ЖЕЛЕЗОБЕТОННЫЙ сбор постов: индексный скан + .all(memcmp author)
  const pullPosts = useCallback(
    async (pAcc: any) => {
      if (!program || !wallet.publicKey) return;

      const acc = program.account as any;
      const merged: Record<string, any> = {};

      // A) Индексы 0..postsCount-1
      try {
        const total = Number(pAcc?.postsCount || 0);
        for (let i = 0; i < total; i++) {
          const pda = postPdaByIndex(wallet.publicKey, i);
          try {
            const postAcc = await tryFetch(acc.post, pda);
            if (postAcc) {
              const key = pda.toBase58();
              merged[key] = {
                ...postAcc,
                _pda: pda,
                _index: Number(postAcc.index ?? i),
              };
            }
          } catch {}
        }
      } catch {}

      // B) .all + memcmp по author (offset 8 = после discriminator)
      try {
        const listAll = await acc.post.all([
          { memcmp: { offset: 8, bytes: wallet.publicKey.toBase58() } },
        ]);
        for (const { account, publicKey } of listAll) {
          const key = publicKey.toBase58();
          if (!merged[key]) {
            merged[key] = {
              ...account,
              _pda: publicKey,
              _index: Number(account.index ?? 0),
            };
          }
        }
      } catch (e) {
        console.debug("post.all filter fallback failed:", e);
      }

      const arr = Object.values(merged) as any[];
      arr.sort((a, b) => {
        const ta = Number(a.createdTs ?? 0);
        const tb = Number(b.createdTs ?? 0);
        if (tb !== ta) return tb - ta;
        return Number(b._index ?? 0) - Number(a._index ?? 0);
      });

      setPosts(arr);
    },
    [program, wallet.publicKey, tryFetch, postPdaByIndex]
  );

  const pullContacts = useCallback(async () => {
    if (!program || !wallet.publicKey) return;
    const acc = program.account as any;
    try {
      const me = wallet.publicKey.toBase58();
      const initiatorList = await acc.contact.all([
        { memcmp: { offset: 8, bytes: me } }, // initiator at 8
      ]);
      const targetList = await acc.contact.all([
        { memcmp: { offset: 8 + 32, bytes: me } }, // target at 8+32
      ]);

      const both = [...initiatorList, ...targetList];
      const uniq = new Map<string, ContactAcc>();
      for (const it of both) uniq.set(it.publicKey.toBase58(), it);

      const inbound: ContactAcc[] = [];
      const outbound: ContactAcc[] = [];
      const friends: ContactAcc[] = [];

      for (const it of uniq.values()) {
        const a = it.account as any;
        const status = Number(a.status || 0); // 0=pending,1=accepted,2=rejected
        const initiator = new PublicKey(a.initiator);
        const target = new PublicKey(a.target);
        if (status === 1) {
          friends.push(it);
        } else if (status === 0) {
          if (target.equals(wallet.publicKey)) inbound.push(it);
          else if (initiator.equals(wallet.publicKey)) outbound.push(it);
        }
      }

      // сортировки для стабильности
      const byTs = (x: ContactAcc, y: ContactAcc) =>
        Number((y.account?.createdTs ?? 0) - (x.account?.createdTs ?? 0));
      inbound.sort(byTs);
      outbound.sort(byTs);
      friends.sort(byTs);

      setInboundReqs(inbound);
      setOutboundReqs(outbound);
      setMyFriends(friends);
    } catch (e) {
      console.debug("pullContacts error", e);
    }
  }, [program, wallet.publicKey]);

  const pullThreadMessages = useCallback(
    async (threadKey: PublicKey | null) => {
      if (!program || !threadKey) return;
      const acc = program.account as any;
      try {
        const list = await acc.dmMessage.all([
          { memcmp: { offset: 8, bytes: threadKey.toBase58() } }, // thread field at 8
        ]);
        // сортировка по index
        list.sort((a: any, b: any) => Number(a.account.index) - Number(b.account.index));
        setDmMessages(list.map((x: any) => ({ ...x.account, _pda: x.publicKey })));
      } catch (e) {
        console.debug("pullThreadMessages error", e);
        setDmMessages([]);
      }
    },
    [program]
  );

  const pullState = useCallback(async () => {
    if (!program || !wallet.publicKey || !configPda || !profilePda || !extraPda)
      return;
    setRefreshing(true);
    try {
      const acc = program.account as any;
      const cfg = await tryFetch(acc.socialConfig, configPda);
      if (cfg) {
        const mintPk = new PublicKey(cfg.dlanMint);
        setDlanMint(mintPk);
        setDlanAta(computeAta(mintPk, wallet.publicKey));
      } else {
        setDlanMint(null);
        setDlanAta(null);
      }

      const p = await tryFetch(acc.profile, profilePda);
      setProfile(p);
      const e = await tryFetch(acc.profileExtra, extraPda);
      setExtra(e);

      // NEW: user stats (поинты и т.п.)
      if (userStatsPda) {
        const us = await tryFetch(acc.userStats, userStatsPda);
        setUserStats(us);
      } else {
        setUserStats(null);
      }

      if (p) {
        setDisplayName(u8ToString(p.displayName));
        setBio(u8ToString(p.bio));
      }
      if (e) {
        setBirthDate(unixToDateInput(e.birthTs));
        setBirthPlace(u8ToString(e.birthPlace));
        setGender(String(e.gender ?? 0));
      }

      await pullPosts(p);
      await pullContacts();
      if (threadPda) await pullThreadMessages(threadPda);
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
    computeAta,
    tryFetch,
    pullPosts,
    pullContacts,
    pullThreadMessages,
    threadPda,
  ]);

  useEffect(() => {
    pullState();
  }, [pullState]);

  // начальные значения для dirty
  const initialName = profile ? u8ToString(profile?.displayName) : "";
  const initialBio = profile ? u8ToString(profile?.bio) : "";
  const initialDt = extra ? unixToDateInput(extra?.birthTs) : "";
  const initialPlace = extra ? u8ToString(extra?.birthPlace) : "";
  const initialGend = String(extra?.gender ?? 0);

  const dirtyProfile =
    (!!profile && (displayName !== initialName || bio !== initialBio)) ||
    (!profile && (displayName || bio));
  const dirtyExtra =
    (!!extra &&
      (birthDate !== initialDt ||
        birthPlace !== initialPlace ||
        gender !== initialGend)) ||
    (!extra && (birthDate || birthPlace || Number(gender) !== 0));

  // Экшены on-chain — профиль
  const onInitProfile = useCallback(async () => {
    if (!program || !wallet.publicKey || !configPda || !profilePda) return;
    if (!dlanMint || !dlanAta) {
      toast.error("IDL/Config", {
        description: "Не найден SocialConfig/DLAN ATA. Инициализируй конфиг.",
      });
      return;
    }
    if (!userStatsPda) {
      toast.error("USTATS", { description: "Не удалось вычислить PDA ustats2." });
      return;
    }
    const name = clampLen(displayName.trim(), MAX_NAME);
    const bioClamped = clampLen(bio.trim(), MAX_BIO);
    setLoading(true);
    try {
      await program.methods
        .initProfile(name, bioClamped)
        .accounts({
          authority: wallet.publicKey,
          config: configPda,
          dlanAta: dlanAta,
          profile: profilePda,
          userStats: userStatsPda, // NEW
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await pullState();
      toast.success("Профиль создан");
    } catch (e) {
      toast.error("Ошибка", { description: anchorErrorToText(e) });
    } finally {
      setLoading(false);
    }
  }, [
    program,
    wallet.publicKey,
    configPda,
    profilePda,
    dlanMint,
    dlanAta,
    userStatsPda,
    displayName,
    bio,
    pullState,
  ]);

  const onUpdateProfile = useCallback(async () => {
    if (!program || !wallet.publicKey || !profilePda) return;
    if (!userStatsPda) {
      toast.error("USTATS", { description: "Не удалось вычислить PDA ustats2." });
      return;
    }
    const name = clampLen(displayName.trim(), MAX_NAME);
    const bioClamped = clampLen(bio.trim(), MAX_BIO);
    setLoading(true);
    try {
      await program.methods
        .updateProfile(name, bioClamped)
        .accounts({
          authority: wallet.publicKey,
          profile: profilePda,
          userStats: userStatsPda, // NEW
          systemProgram: SystemProgram.programId, // NEW (payer for init_if_needed)
        })
        .rpc();
      await pullState();
      toast.success("Профиль обновлён");
    } catch (e) {
      toast.error("Ошибка", { description: anchorErrorToText(e) });
    } finally {
      setLoading(false);
    }
  }, [program, wallet.publicKey, profilePda, userStatsPda, displayName, bio, pullState]);

  const onUpsertExtra = useCallback(async () => {
    if (!program || !wallet.publicKey || !profilePda || !extraPda) return;
    const birthTs = dateToUnixSeconds(birthDate || null);
    const place = clampLen(birthPlace.trim(), MAX_PLACE);
    const genderU8 = Number(gender) as 0 | 1 | 2 | 3;
    setLoading(true);
    try {
      await program.methods
        .upsertProfileExtra(birthTs, place, genderU8)
        .accounts({
          authority: wallet.publicKey,
          profile: profilePda,
          extra: extraPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      await pullState();
      toast.success("Доп. данные сохранены");
    } catch (e) {
      toast.error("Ошибка", { description: anchorErrorToText(e) });
    } finally {
      setLoading(false);
    }
  }, [
    program,
    wallet.publicKey,
    profilePda,
    extraPda,
    birthDate,
    birthPlace,
    gender,
    pullState,
  ]);

  const onSaveAll = useCallback(async () => {
    try {
      if (!profile) {
        await onInitProfile();
        if (birthDate || birthPlace || Number(gender) !== 0) await onUpsertExtra();
        setEditing(false);
        return;
      }
      if (dirtyProfile) await onUpdateProfile();
      if (dirtyExtra) await onUpsertExtra();
      setEditing(false);
    } catch {}
  }, [
    profile,
    dirtyProfile,
    dirtyExtra,
    onInitProfile,
    onUpdateProfile,
    onUpsertExtra,
    birthDate,
    birthPlace,
    gender,
  ]);

  const onRecomputeLevel = useCallback(async () => {
    if (!program || !wallet.publicKey || !configPda || !profilePda || !dlanAta)
      return;
    setLoading(true);
    try {
      await program.methods
        .recomputeLevel()
        .accounts({
          authority: wallet.publicKey,
          config: configPda,
          dlanAta: dlanAta,
          profile: profilePda,
        })
        .rpc();
      await pullState();
      toast.success("Уровень пересчитан");
    } catch (e) {
      toast.error("Ошибка", { description: anchorErrorToText(e) });
    } finally {
      setLoading(false);
    }
  }, [program, wallet.publicKey, configPda, profilePda, dlanAta, pullState]);

  const onCloseProfile = useCallback(async () => {
    if (!program || !wallet.publicKey || !profilePda) return;
    if (!confirm("Удалить профиль? PDA будет закрыт, а рент вернётся владельцу."))
      return;
    setLoading(true);
    try {
      await program.methods
        .closeProfile()
        .accounts({
          authority: wallet.publicKey,
          profile: profilePda,
        })
        .rpc();
      setProfile(null);
      setPosts([]);
      toast.success("Профиль удалён");
      setEditing(false);
    } catch (e) {
      toast.error("Ошибка", { description: anchorErrorToText(e) });
    } finally {
      setLoading(false);
    }
  }, [program, wallet.publicKey, profilePda]);

  // Создание поста (СПРАВА, под GPT)
  const onCreatePost = useCallback(async () => {
    if (!program || !wallet.publicKey || !profile || !configPda || !profilePda)
      return;

    if (minLevel < 0 || maxLevel > MAX_LEVEL || minLevel > maxLevel) {
      toast.error("Уровни", { description: "Диапазон должен быть 0..7 и min ≤ max." });
      return;
    }

    const body = clampToBytes(postContent.trim(), MAX_POST_BYTES);
    if (body.length === 0) {
      toast.error("Пост пуст", { description: "Введите текст." });
      return;
    }

    setCreatingPost(true);
    try {
      // индекс — текущий postsCount
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
      toast.success("Пост опубликован");
      await pullState();
    } catch (e: any) {
      // если это «already processed», считаем успехом и просто обновим
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("already been processed")) {
        await pullState();
        toast.success("Пост опубликован (повторная отправка).");
      } else {
        toast.error("Ошибка публикации", { description: anchorErrorToText(e) });
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
    postContent,
    postPdaByIndex,
    pullState,
  ]);

  // ===== Контакты (add / list / accept/decline) ================================
  const onRequestContact = useCallback(async () => {
    if (!program || !wallet.publicKey) return;
    const targetPk = tryPubkey(friendTarget);
    if (!targetPk) {
      toast.error("Паблик ключ", { description: "Неверный формат адреса." });
      return;
    }
    if (targetPk.equals(wallet.publicKey)) {
      toast.error("Контакт", { description: "Нельзя добавить самого себя." });
      return;
    }

    const initiatorProfile = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), wallet.publicKey.toBuffer()],
      PROGRAM_ID
    )[0];
    const targetProfile = PublicKey.findProgramAddressSync(
      [Buffer.from("profile"), targetPk.toBuffer()],
      PROGRAM_ID
    )[0];
    const contactPda = PublicKey.findProgramAddressSync(
      [Buffer.from("contact"), wallet.publicKey.toBuffer(), targetPk.toBuffer()],
      PROGRAM_ID
    )[0];

    setContactBusy(true);
    try {
      await program.methods
        .requestContact()
        .accounts({
          initiator: wallet.publicKey,
          initiatorProfile,
          targetProfile,
          contact: contactPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      toast.success("Запрос отправлен");
      setFriendTarget("");
      await pullContacts();
    } catch (e) {
      toast.error("Ошибка", { description: anchorErrorToText(e) });
    } finally {
      setContactBusy(false);
    }
  }, [program, wallet.publicKey, friendTarget, pullContacts]);

  const onRespondContact = useCallback(
    async (contactKey: PublicKey, accept: boolean) => {
      if (!program || !wallet.publicKey) return;
      setContactBusy(true);
      try {
        await program.methods
          .respondContact(accept)
          .accounts({
            target: wallet.publicKey,
            contact: contactKey,
          })
          .rpc();
        toast.success(accept ? "Запрос принят" : "Запрос отклонён");
        await pullContacts();
      } catch (e) {
        toast.error("Ошибка", { description: anchorErrorToText(e) });
      } finally {
        setContactBusy(false);
      }
    },
    [program, wallet.publicKey, pullContacts]
  );

  // ===== DM (open thread / send / pull) ========================================
  const onOpenThread = useCallback(async () => {
    if (!program || !wallet.publicKey) return;
    const peerPk = tryPubkey(peer);
    if (!peerPk) {
      toast.error("Паблик ключ", { description: "Неверный формат адреса." });
      return;
    }
    if (peerPk.equals(wallet.publicKey)) {
      toast.error("DM", { description: "Нельзя открыть диалог с собой." });
      return;
    }

    const [a, b] = sortAB(wallet.publicKey, peerPk);
    const thread = dmThreadPda(a, b);

    setDmLoading(true);
    try {
      // Сначала попробуем прочитать, если нет — создадим
      const acc = program.account as any;
      const existing = await tryFetch(acc.dmThread, thread);
      if (!existing) {
        await program.methods
          .dmOpenThread()
          .accounts({
            initiator: wallet.publicKey,
            a,
            b,
            thread,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }
      setThreadPda(thread);
      await pullThreadMessages(thread);
      toast.success("Диалог готов");
    } catch (e) {
      toast.error("Ошибка DM", { description: anchorErrorToText(e) });
    } finally {
      setDmLoading(false);
    }
  }, [program, wallet.publicKey, peer, dmThreadPda, tryFetch, pullThreadMessages]);

  const onSendDm = useCallback(async () => {
    if (!program || !wallet.publicKey || !threadPda) return;
    const bodyBytes = clampToBytes(dmBody.trim(), MAX_DM_BYTES);
    if (bodyBytes.length === 0) return;

    setDmLoading(true);
    try {
      const acc = program.account as any;
      const threadAcc = await acc.dmThread.fetch(threadPda);
      const a = new PublicKey(threadAcc.a);
      const b = new PublicKey(threadAcc.b);
      const msgIndex = Number(threadAcc.msgCount || 0);
      const messagePda = dmMessagePda(threadPda, msgIndex);

      // NEW: UStats для A/B (сид "ustats2")
      const ustatsA = PublicKey.findProgramAddressSync(
        [Buffer.from(USTATS_SEED), a.toBuffer()],
        PROGRAM_ID
      )[0];
      const ustatsB = PublicKey.findProgramAddressSync(
        [Buffer.from(USTATS_SEED), b.toBuffer()],
        PROGRAM_ID
      )[0];

      await program.methods
        .dmSend(Buffer.from(bodyBytes))
        .accounts({
          author: wallet.publicKey,
          a,
          b,
          thread: threadPda,
          message: messagePda,
          ustatsA, // NEW
          ustatsB, // NEW
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      setDmBody("");
      await pullThreadMessages(threadPda);
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (msg.toLowerCase().includes("already been processed")) {
        await pullThreadMessages(threadPda);
        setDmBody("");
        toast.success("Сообщение доставлено (повторная отправка).");
      } else {
        toast.error("Ошибка отправки", { description: anchorErrorToText(e) });
      }
    } finally {
      setDmLoading(false);
    }
  }, [program, wallet.publicKey, threadPda, dmBody, dmMessagePda, pullThreadMessages]);

  const connected = !!wallet.publicKey;
  const busy = loading || !program || !connected;
  const canCreatePost = connected && !!profile;

  const usedBytes = new TextEncoder().encode(postContent).length;
  const usedPct = Math.min(100, Math.round((usedBytes / MAX_POST_BYTES) * 100));

  const dmUsedBytes = new TextEncoder().encode(dmBody).length;
  const dmUsedPct = Math.min(100, Math.round((dmUsedBytes / MAX_DM_BYTES) * 100));

  // ==== UI =====================================================================
  const year = dateToYear(birthDate);
  const genderText =
    genderTextMap[Number(gender) || 0] ||
    (extra ? genderTextMap[Number(extra?.gender) || 0] : "—");
  const placeShown = birthPlace || (extra ? u8ToString(extra.birthPlace) : "") || "—";

  const points = userStats ? Number(userStats.points ?? 0) : 0; // NEW

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <Toaster position="bottom-right" richColors closeButton />
      <header className="border-b border-neutral-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-neutral-300">
            <span className="font-semibold">DLAN Social</span>
            <span className="text-neutral-600">•</span>
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-4 w-4" />
              {connected ? "wallet connected" : "no wallet"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => pullState()} loading={refreshing}>
              <RefreshCw className="h-4 w-4" /> Обновить
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* ЛЕВАЯ КОЛОНКА — Профиль + Список постов */}
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  <CardTitle>Профиль</CardTitle>
                </div>
                {!editing ? (
                  <Button
                    variant="secondary"
                    onClick={() => setEditing(true)}
                    disabled={!connected}
                  >
                    <Edit3 className="h-4 w-4" /> Изменить профиль
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      onClick={onSaveAll}
                      disabled={busy || (!dirtyProfile && !dirtyExtra)}
                      loading={loading}
                    >
                      <Save className="h-4 w-4" /> Сохранить
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditing(false);
                        pullState();
                      }}
                    >
                      <X className="h-4 w-4" /> Отмена
                    </Button>
                  </div>
                )}
              </CardHeader>

              {/* READ-ONLY */}
              {!editing && (
                <CardContent className="space-y-6">
                  {!profile ? (
                    <div className="rounded-xl border border-neutral-800 p-4 text-sm text-neutral-300">
                      Профиль ещё не создан.
                      <div className="mt-3">
                        <Button onClick={() => setEditing(true)} disabled={!connected}>
                          <Save className="h-4 w-4" /> Создать профиль
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <div className="text-neutral-400 text-sm">Имя</div>
                        <div className="text-lg font-medium">
                          {u8ToString(profile.displayName) || "—"}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-neutral-400 text-sm">Био</div>
                        <div className="whitespace-pre-wrap">
                          {u8ToString(profile.bio) || "—"}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <div className="text-neutral-400 text-sm">Год рождения</div>
                          <div className="text-base">
                            {year ||
                              (extra ? dateToYear(unixToDateInput(extra.birthTs)) : "") ||
                              "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-neutral-400 text-sm">Пол</div>
                          <div className="text-base">{genderText || "—"}</div>
                        </div>
                        <div className="md:col-span-1">
                          <div className="text-neutral-400 text-sm">Место рождения</div>
                          <div className="text-base break-words">{placeShown}</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-3 text-sm text-neutral-400">
                        <span>
                          Уровень:{" "}
                          <span className="text-neutral-100">
                            {Number(profile.level)}
                          </span>
                        </span>
                        <span>
                          Постов:{" "}
                          <span className="text-neutral-100">
                            {Number(profile.postsCount)}
                          </span>
                        </span>
                        <span>
                          Поинты:{" "}
                          <span className="text-neutral-100">
                            {points}
                          </span>
                        </span>
                      </div>
                    </>
                  )}
                </CardContent>
              )}

              {/* EDIT */}
              {editing && (
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <div className="text-sm font-medium mb-2">Отображаемое имя</div>
                      <Input
                        value={displayName}
                        onChange={(e) =>
                          setDisplayName(clampLen(e.target.value, MAX_NAME))
                        }
                        placeholder="Alexander / D-LANIS"
                        disabled={!connected}
                      />
                      <div className="mt-1 text-xs text-neutral-400">
                        Максимум 32 байта UTF-8
                      </div>
                    </div>

                    <div>
                      <div className="text-sm font-medium mb-2">Био</div>
                      <Textarea
                        rows={4}
                        value={bio}
                        onChange={(e) => setBio(clampLen(e.target.value, MAX_BIO))}
                        placeholder="О себе, миссия, интересы…"
                        disabled={!connected}
                      />
                      <div className="mt-1 text-xs text-neutral-400">
                        Максимум 128 байт UTF-8
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div>
                        <div className="text-sm font-medium mb-2">Дата рождения</div>
                        <Input
                          type="date"
                          value={birthDate}
                          onChange={(e) => setBirthDate(e.target.value)}
                          disabled={!connected}
                        />
                      </div>

                      <div>
                        <div className="text-sm font-medium mb-2">Пол</div>
                        <div className="flex items-center gap-3">
                          {[
                            ["0", "Не указан"],
                            ["1", "Мужской"],
                            ["2", "Женский"],
                            ["3", "Другое"],
                          ].map(([val, label]) => (
                            <label
                              key={val}
                              className="inline-flex items-center gap-2 text-sm"
                            >
                              <input
                                type="radio"
                                name="gender"
                                value={val}
                                checked={gender === val}
                                onChange={(e) => setGender(e.target.value)}
                                disabled={!connected}
                                className="accent-indigo-500"
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-medium mb-2">Место рождения</div>
                        <Input
                          value={birthPlace}
                          onChange={(e) =>
                            setBirthPlace(clampLen(e.target.value, MAX_PLACE))
                          }
                          placeholder="Город, страна"
                          disabled={!connected}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!profile ? (
                      <Button onClick={onSaveAll} disabled={!connected} loading={loading}>
                        <Save className="h-4 w-4" /> Создать
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={onSaveAll}
                          disabled={busy || (!dirtyProfile && !dirtyExtra)}
                          loading={loading}
                        >
                          <Save className="h-4 w-4" /> Сохранить изменения
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditing(false);
                            pullState();
                          }}
                        >
                          <X className="h-4 w-4" /> Отмена
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={onRecomputeLevel}
                          disabled={busy}
                        >
                          <RefreshCw className="h-4 w-4" /> Пересчитать уровень
                        </Button>
                        <Button variant="danger" onClick={onCloseProfile} disabled={busy}>
                          <Trash2 className="h-4 w-4" /> Удалить профиль
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* ===== ВАШИ ПОСТЫ (ЛЕВО) ===== */}
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
                      <div
                        key={String(p._pda)}
                        className="rounded-xl border border-neutral-800 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
                          <span>
                            index: <span className="text-neutral-200">{Number(p.index)}</span>
                          </span>
                          <span>
                            min: <span className="text-neutral-200">{Number(p.minLevel)}</span>
                          </span>
                          <span>
                            max: <span className="text-neutral-200">{Number(p.maxLevel)}</span>
                          </span>
                          <span>
                            ts: <span className="text-neutral-200">{Number(p.createdTs)}</span>
                          </span>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm">{text}</div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* ПРАВАЯ КОЛОНКА — GPT ЧАТ + СОЗДАНИЕ ПОСТА + КОНТАКТЫ + DM */}
          <div className="space-y-6 md:sticky md:top-6 h-fit">
            <GptChat />

            {/* ===== НОВЫЙ ПОСТ (СПРАВА) ===== */}
            <Card>
              <CardHeader>
                <CardTitle>Новый пост</CardTitle>
                <CardDesc>До {MAX_POST_BYTES} байт. Доступ по уровню 0..{MAX_LEVEL}.</CardDesc>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Textarea
                    rows={4}
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    placeholder="Что нового?.."
                    disabled={!canCreatePost || creatingPost}
                  />
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <div className="h-1 w-40 rounded bg-neutral-800">
                      <div
                        className="h-1 rounded bg-indigo-500"
                        style={{ width: `${usedPct}%` }}
                      />
                    </div>
                    <span
                      className={
                        usedBytes > MAX_POST_BYTES ? "text-rose-400" : "text-neutral-400"
                      }
                    >
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
                      onChange={(e) =>
                        setMinLevel(
                          Math.max(0, Math.min(MAX_LEVEL, Number(e.target.value) || 0))
                        )
                      }
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2"
                      disabled={!canCreatePost || creatingPost}
                    />
                  </div>
                  <div>
                    <div className="text-sm font-medium mb-1">Макс. уровень</div>
                    <input
                      type="number"
                      min={0}
                      max={MAX_LEVEL}
                      value={maxLevel}
                      onChange={(e) =>
                        setMaxLevel(
                          Math.max(0, Math.min(MAX_LEVEL, Number(e.target.value) || 0))
                        )
                      }
                      className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none ring-indigo-500 focus:ring-2"
                      disabled={!canCreatePost || creatingPost}
                    />
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex gap-2">
                <Button onClick={onCreatePost} disabled={!canCreatePost || creatingPost} loading={creatingPost}>
                  <Send className="h-4 w-4" /> Опубликовать
                </Button>
              </CardFooter>
            </Card>

            {/* ===== КОНТАКТЫ (друзья) ===== */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5"/>Контакты</CardTitle>
                <CardDesc>Запросы в друзья и список друзей</CardDesc>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-medium mb-2">Добавить по адресу</div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Паблик ключ пользователя"
                      value={friendTarget}
                      onChange={(e) => setFriendTarget(e.target.value)}
                      disabled={!connected || contactBusy}
                    />
                    <Button onClick={onRequestContact} disabled={!connected || contactBusy || !friendTarget.trim()} loading={contactBusy}>
                      Отправить
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold mb-2">Входящие запросы</div>
                    {inboundReqs.length === 0 ? (
                      <div className="text-xs text-neutral-400">Нет</div>
                    ) : (
                      <div className="space-y-2">
                        {inboundReqs.map((r) => {
                          const a = r.account;
                          return (
                            <div key={r.publicKey.toBase58()} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-800 p-3 text-sm">
                              <div>
                                от <span className="text-neutral-200">{shortPk(a.initiator)}</span>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="secondary" onClick={() => onRespondContact(r.publicKey, true)} disabled={contactBusy}>
                                  <Check className="h-4 w-4"/> Принять
                                </Button>
                                <Button variant="ghost" onClick={() => onRespondContact(r.publicKey, false)} disabled={contactBusy}>
                                  <Ban className="h-4 w-4"/> Отклонить
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-semibold mb-2">Исходящие запросы</div>
                    {outboundReqs.length === 0 ? (
                      <div className="text-xs text-neutral-400">Нет</div>
                    ) : (
                      <div className="space-y-2">
                        {outboundReqs.map((r) => (
                          <div key={r.publicKey.toBase58()} className="rounded-xl border border-neutral-800 p-3 text-sm">
                            к <span className="text-neutral-200">{shortPk(r.account.target)}</span> — ожидание
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm font-semibold mb-2">Друзья</div>
                    {myFriends.length === 0 ? (
                      <div className="text-xs text-neutral-400">Ещё нет друзей</div>
                    ) : (
                      <div className="space-y-2">
                        {myFriends.map((r) => {
                          const a = r.account;
                          const other = new PublicKey(a.initiator).equals(wallet.publicKey!)
                            ? new PublicKey(a.target)
                            : new PublicKey(a.initiator);
                          return (
                            <div key={r.publicKey.toBase58()} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-800 p-3 text-sm">
                              <div className="flex items-center gap-2">
                                <MessageSquareText className="h-4 w-4"/>
                                <span>{shortPk(other)}</span>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    setPeer(other.toBase58());
                                  }}
                                >
                                  Открыть DM
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ===== DM (личные сообщения) ===== */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5"/>Личные сообщения</CardTitle>
                <CardDesc>Откройте/создайте диалог и переписывайтесь</CardDesc>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Паблик ключ собеседника"
                    value={peer}
                    onChange={(e) => setPeer(e.target.value)}
                    disabled={!connected || dmLoading}
                  />
                  <Button onClick={onOpenThread} disabled={!connected || dmLoading || !peer.trim()} loading={dmLoading}>
                    Открыть
                  </Button>
                </div>

                {threadPda ? (
                  <div className="rounded-xl border border-neutral-800">
                    <div className="flex items-center justify-between p-3 text-xs text-neutral-400">
                      <div>Тред: <span className="text-neutral-200">{shortPk(threadPda)}</span></div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={() => pullThreadMessages(threadPda)} disabled={dmLoading}>
                          <RefreshCw className="h-4 w-4"/> Обновить
                        </Button>
                      </div>
                    </div>
                    <div className="max-h-80 overflow-auto p-3 space-y-2">
                      {dmMessages.length === 0 ? (
                        <div className="text-xs text-neutral-400">Сообщений пока нет.</div>
                      ) : (
                        dmMessages.map((m, i) => (
                          <div key={i} className={`rounded-xl px-3 py-2 text-sm ${new PublicKey(m.author).equals(wallet.publicKey!) ? "bg-indigo-500/10 text-indigo-100" : "bg-neutral-800"}`}>
                            <div className="flex items-center justify-between text-[10px] uppercase opacity-60">
                              <span>{shortPk(m.author)}</span>
                              <span>{new Date(Number(m.ts) * 1000).toLocaleString()}</span>
                            </div>
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
                        ))
                      )}
                    </div>
                    <div className="border-t border-neutral-800 p-3 space-y-2">
                      <Textarea
                        rows={3}
                        value={dmBody}
                        onChange={(e) => setDmBody(e.target.value)}
                        placeholder="Написать сообщение…"
                        disabled={!connected || dmLoading}
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs">
                          <div className="h-1 w-40 rounded bg-neutral-800">
                            <div className="h-1 rounded bg-indigo-500" style={{ width: `${dmUsedPct}%` }} />
                          </div>
                          <span className={dmUsedBytes > MAX_DM_BYTES ? "text-rose-400" : "text-neutral-400"}>
                            {dmUsedBytes}/{MAX_DM_BYTES} байт
                          </span>
                        </div>
                        <Button onClick={onSendDm} disabled={!connected || dmLoading || dmBody.trim().length === 0} loading={dmLoading}>
                          <Send className="h-4 w-4"/> Отправить
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-neutral-400">Укажите адрес и нажмите «Открыть», чтобы создать/загрузить DM.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
