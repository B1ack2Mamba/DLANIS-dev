// pages/index.tsx
import Head from "next/head";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";

const WalletMultiButton = dynamic(
    async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
    { ssr: false }
);

// ---------- Источники ----------
const INTRO_ANIM_IPFS =
    "https://harlequin-implicit-prawn-315.mypinata.cloud/ipfs/bafybeiczm6hrdzjgarfjb32w6bb7nda7pgub3vmvzbj3ng3q5rsba5om2a";
const INTRO_ANIM = `/api/ipfs-proxy?src=${encodeURIComponent(INTRO_ANIM_IPFS)}`;

const WING_IPFS =
    "https://harlequin-implicit-prawn-315.mypinata.cloud/ipfs/bafybeif2lqew53xoozmutsi742faspbp2l2hxrw4pd4ke6yjz22mq4hon4";
const WING_SRC = `/api/ipfs-proxy?src=${encodeURIComponent(WING_IPFS)}`;

// ---------- Геометрия видео ----------
const VIDEO_W = 1920;
const VIDEO_H = 1080;
const VIDEO_AR = VIDEO_W / VIDEO_H;

// ---------- Невидимая трапеция-кнопка (в координатах видео 1920×1080) ----------
const UNDER_BASE_POINTS: [number, number][] = [
    [520, 800],
    [1400, 800],
    [1360, 740],
    [560, 740],
];

// ---------- Крылья (как доли от размеров видео) ----------
const WINGS_WIDTH = 0.32;
const WINGS_HEIGHT = 0.86;
const WINGS_TOP = 0.12;
const WINGS_INNER_GAP = 0.42; // меньше — ближе к центру
const WINGS_OPACITY = 0.52;

/**
 * Возвращает реальный прямоугольник видео на экране.
 * ЛОГИКА СОВПАДАЕТ С CSS:
 * - в портретной ориентации используем COVER (заполняем, обрезаем по высоте);
 * - в ландшафте — CONTAIN (полностью видим всё видео).
 */
function useVideoRect() {
    const [rect, setRect] = useState({ left: 0, top: 0, width: 100, height: 100 });

    useEffect(() => {
        const calc = () => {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const ar = vw / vh;

            if (ar <= VIDEO_AR) {
                // ПОРТРЕТ (или узкий): CSS -> object-fit: cover
                const scale = Math.max(vw / VIDEO_W, vh / VIDEO_H);
                const width = Math.round(VIDEO_W * scale);
                const height = Math.round(VIDEO_H * scale);
                const left = Math.round((vw - width) / 2);
                const top = Math.round((vh - height) / 2);
                setRect({ left, top, width, height });
            } else {
                // ЛАНДШАФТ (шире): CSS -> object-fit: contain
                const height = vh;
                const width = Math.round(height * VIDEO_AR);
                const left = Math.round((vw - width) / 2);
                setRect({ left, top: 0, width, height });
            }
        };
        calc();
        addEventListener("resize", calc);
        return () => removeEventListener("resize", calc);
    }, []);

    return rect;
}

export default function Index() {
    const router = useRouter();
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [playing, setPlaying] = useState(false);

    const points = useMemo(
        () => UNDER_BASE_POINTS.map(([x, y]) => `${x},${y}`).join(" "),
        []
    );

    const videoRect = useVideoRect();

    // Переход после конца
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onEnded = () => router.push("/app");
        v.addEventListener("ended", onEnded);
        return () => v.removeEventListener("ended", onEnded);
    }, [router]);

    // Фейлсейф
    useEffect(() => {
        if (!playing) return;
        const t = setTimeout(() => router.push("/app"), 30000);
        return () => clearTimeout(t);
    }, [playing, router]);

    // Показ первого кадра
    useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const onCanPlay = () => {
            try {
                if (v.paused) {
                    v.currentTime = 0.001;
                    v.pause();
                }
            } catch { }
        };
        v.addEventListener("canplay", onCanPlay);
        try { v.load(); } catch { }
        return () => v.removeEventListener("canplay", onCanPlay);
    }, []);

    const start = () => {
        if (playing) return;
        setPlaying(true);
        const v = videoRef.current;
        if (!v) return;
        v.play().catch(() => { });
    };

    // CSS-переменные для крыльев
    const wingVars: React.CSSProperties = {
        ["--w" as any]: `${WINGS_WIDTH * 100}%`,
        ["--h" as any]: `${WINGS_HEIGHT * 100}%`,
        ["--top" as any]: `${WINGS_TOP * 100}%`,
        ["--gapHalf" as any]: `${(WINGS_INNER_GAP * 0.5) * 100}%`,
        ["--opacity" as any]: `${WINGS_OPACITY}`,
    };

    return (
        <>
            <Head>
                <title>DLANIS — вход</title>
                <meta
                    name="description"
                    content="Центральная анимация: портрет — cover (крупно), ландшафт — contain; крылья только на широких экранах."
                />
                <link rel="preload" as="video" href={INTRO_ANIM} />
                <link rel="preload" as="image" href={WING_SRC} />
            </Head>

            <main className="root">
                {/* Фон */}
                <div className="bg" />

                {/* Крылья: рисуем в тех же координатах, что и видео.
            Прячем на узких/портретных экранах. */}
                <div
                    className="wings"
                    style={{
                        left: videoRect.left,
                        top: videoRect.top,
                        width: videoRect.width,
                        height: videoRect.height,
                        ...wingVars,
                    }}
                    aria-hidden
                >
                    <img className="wing left" src={WING_SRC} alt="" />
                    <img className="wing right" src={WING_SRC} alt="" />
                </div>

                {/* Видео */}
                <video
                    ref={videoRef}
                    className="hero"
                    src={INTRO_ANIM}
                    muted
                    playsInline
                    preload="auto"
                />

                {/* Невидимая кнопка (поверх видео, одинаковое позиционирование) */}
                <svg
                    className="overlay"
                    viewBox={`0 0 ${VIDEO_W} ${VIDEO_H}`}
                    style={{
                        left: videoRect.left,
                        top: videoRect.top,
                        width: videoRect.width,
                        height: videoRect.height,
                    }}
                    aria-hidden
                >
                    <g
                        className="underBtn"
                        tabIndex={-1}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                            e.stopPropagation();
                            start();
                        }}
                    >
                        <polygon className="hit" points={points} />
                    </g>
                </svg>

                {/* Кошелёк */}
                <div className="wallet">
                    <WalletMultiButton />
                </div>

                <style jsx>{`
          .root {
            min-height: 100vh;
            position: relative;
            overflow: hidden;
          }
          .bg {
            position: fixed;
            inset: 0;
            background: #000;
            z-index: 1;
          }

          /* Видео: ландшафт — contain, портрет — cover */
          .hero {
            position: fixed;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;      /* по умолчанию */
            object-position: 50% 50%;
            background: transparent;
            z-index: 2;
            border: 0;
            outline: none;
          }
          @media (max-aspect-ratio: 16/9) {
            .hero {
              object-fit: cover;       /* портрет — крупно, без «маленького» видео */
              object-position: 50% 60%;
            }
          }

          /* Крылья — только на широких экранах */
          .wings {
            position: fixed;
            z-index: 3;
            pointer-events: none;
            display: none; /* скрыты по умолчанию */
          }
          @media (min-aspect-ratio: 16/10) {
            .wings { display: block; }
          }
          .wing {
            position: absolute;
            top: var(--top);
            height: var(--h);
            width: var(--w);
            object-fit: contain;
            opacity: var(--opacity);
            mix-blend-mode: screen;
            filter: saturate(1.05) brightness(0.92);
            -webkit-mask-image: radial-gradient(
              160% 120% at 50% 50%,
              rgba(0,0,0,1) 70%,
              rgba(0,0,0,0) 100%
            );
                    mask-image: radial-gradient(
              160% 120% at 50% 50%,
              rgba(0,0,0,1) 70%,
              rgba(0,0,0,0) 100%
            );
          }
          .wing.left {
            left: calc(50% - var(--gapHalf) - var(--w));
            transform: scaleX(-1);
          }
          .wing.right {
            left: calc(50% + var(--gapHalf));
          }

          /* Кнопка */
          .overlay {
            position: fixed;
            z-index: 6;
            pointer-events: none;
          }
          .underBtn {
            pointer-events: auto;
            cursor: pointer;
          }
          .underBtn .hit {
            fill: rgba(0,0,0,0.001);
            stroke: transparent;
            -webkit-tap-highlight-color: transparent;
          }

          .wallet {
            position: fixed;
            top: 16px;
            right: 16px;
            z-index: 10;
          }
        `}</style>

                <style jsx global>{`
          html, body, #__next { height: 100%; background: #000 !important; }
          body { margin: 0 !important; }
          * { box-sizing: border-box; -webkit-tap-highlight-color: rgba(0,0,0,0); }
          :focus { outline: none !important; }
          video, img { border: 0; outline: none; }
        `}</style>
            </main>
        </>
    );
}
