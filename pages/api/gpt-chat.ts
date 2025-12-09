import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

const client = new OpenAI({
  apiKey, // не хардкодим, берём из .env.local
});

type InMsg = { role: "user" | "assistant"; content: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!apiKey) {
    res.status(500).json({ error: "OPENAI_API_KEY не задан в .env.local" });
    return;
  }

  try {
    const {
      messages,
      profile,
    }: {
      messages: InMsg[];
      profile?: { birthDate?: string; birthPlace?: string; gender?: number };
    } = req.body || {};

    const genderLabel: Record<number, string> = {
      0: "Не указан",
      1: "Мужской",
      2: "Женский",
      3: "Другое",
    };

    const system = [
      {
        role: "system" as const,
        content:
          "Ты дружелюбный помощник внутри профиля DLAN. Отвечай кратко и по делу на русском. " +
          "Если просят натальную карту — дай мягкий, нестрогий мини-разбор по дате/месту/полу (beta), " +
          "и уточни, что точные астропостроения появятся позже.",
      },
      {
        role: "system" as const,
        content:
          `Данные профиля пользователя:\n` +
          `- Дата рождения: ${profile?.birthDate || "не указана"}\n` +
          `- Место рождения: ${profile?.birthPlace || "не указано"}\n` +
          `- Пол: ${genderLabel[Number.isFinite(profile?.gender as any) ? (profile?.gender as number) : 0]}\n`,
      },
    ];

    // Модель можно переопределить через .env.local (OPENAI_MODEL)
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const completion = await client.chat.completions.create({
      model,
      messages: [...system, ...(Array.isArray(messages) ? messages : [])] as any,
      temperature: 0.5,
    });

    const content =
      completion.choices?.[0]?.message?.content?.trim() || "";

    if (!content) {
      // вернём понятное сообщение, чтобы фронт не показывал «Ответ пуст.»
      res.status(200).json({ content: "Не удалось получить ответ модели." });
      return;
    }

    res.status(200).json({ content });
  } catch (e: any) {
    // Пробрасываем текст ошибки на фронт
    res.status(500).json({ error: e?.message || String(e) });
  }
}
