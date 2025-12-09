// pages/api/natal.ts
import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Body = {
  birthTs: number;     // unix seconds, UTC
  birthPlace?: string; // "Город, страна"
  gender?: "male" | "female" | "other" | "unknown";
  lat?: number;
  lon?: number;
};

// ---- ШАГ 1: здесь будет реальный расчёт (подключишь позже) --------------------
// Пример подключения "astronomy-engine":
// import * as Astro from "astronomy-engine"; // npm i astronomy-engine
// async function computeWithAstronomyEngine(ts:number, lat:number, lon:number) { ... }

async function computeNatalChartUTC(input: {
  ts: number; lat: number; lon: number;
}) {
  // TODO: заменить на точный расчёт (Swiss Ephemeris / astronomy-engine).
  // Ниже — безопасная "заглушка" с минимальными данными, чтобы протестировать поток.
  return {
    datetime_utc: new Date(input.ts * 1000).toISOString(),
    location: { lat: input.lat, lon: input.lon },
    // Пример структуры — на неё будет ориентироваться GPT
    planets: [
      { name: "Sun",   sign: "Pisces",  deg: 21.3, retro: false },
      { name: "Moon",  sign: "Cancer",  deg: 3.7,  retro: false },
      { name: "Mercury", sign: "Aquarius", deg: 28.5, retro: true },
      { name: "Venus", sign: "Aries",   deg: 2.4,  retro: false },
      { name: "Mars",  sign: "Capricorn", deg: 14.2, retro: false },
      { name: "Jupiter", sign: "Gemini", deg: 7.0,  retro: false },
      { name: "Saturn", sign: "Pisces", deg: 5.1,  retro: false },
      { name: "Uranus", sign: "Taurus", deg: 23.0, retro: false },
      { name: "Neptune", sign: "Pisces", deg: 29.9, retro: false },
      { name: "Pluto", sign: "Aquarius", deg: 1.2, retro: true },
    ],
    houses: [],   // заполнишь, когда прикрутишь домовую систему
    aspects: [],  // можно считать на бэке или попросить GPT на основе longitudes
  };
}

// геокодинг (заглушка). Лучше подключить OpenCage/Mapbox на сервере.
async function geocode(place?: string): Promise<{ lat: number; lon: number }> {
  return { lat: 0, lon: 0 }; // TODO
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { birthTs, birthPlace, gender, lat, lon } = req.body as Body;
    if (!birthTs) return res.status(400).json({ error: "birthTs required" });

    const loc = (lat != null && lon != null) ? { lat, lon } : await geocode(birthPlace);

    // (1) расчёт карты
    const chart = await computeNatalChartUTC({ ts: birthTs, lat: loc.lat, lon: loc.lon });

    // (2) GPT-интерпретация + выбор таро-архетипов
    const tarotMap = {
      Sun: "XIX The Sun",
      Moon: "XVIII The Moon",
      Mercury: "I The Magician",
      Venus: "III The Empress",
      Mars: "XVI The Tower",
      Jupiter: "X Wheel of Fortune",
      Saturn: "XXI The World",
      Uranus: "0 The Fool",
      Neptune: "XII The Hanged Man",
      Pluto: "XX Judgement",
    };

    const system = `Ты астролог-аналитик. Сначала дай ясную структуру:
1) Личность/ядро (Солнце, Асцендент, при его отсутствии — признак Солнца).
2) Эмоции (Луна).
3) Коммуникации (Меркурий).
4) Любовь/ценности (Венера).
5) Энергия/воля (Марс).
6) Карьера/развитие (Юпитер/Сатурн).
7) Трансформация/подсознание (Уран/Нептун/Плутон).
Затем выведи 3–5 конкретных тезисов-резюме. Избегай медицинских/финсоветов.
Опирайся на переданные позиции и аспекты (если есть).
В конце предложи 1–3 доминирующих планетных архетипа и их таро-соответствия.`;

    const user = {
      gender: gender ?? "unknown",
      birthPlace: birthPlace ?? "",
      tarotMap,
      chart
    };

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // используй подходящую в твоём аккаунте модель
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    });

    const interpretation = completion.choices[0]?.message?.content ?? "";

    return res.status(200).json({ chart, interpretation });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
