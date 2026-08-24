// Раз в неделю: спрашивает Claude (с поиском в интернете) о вероятности
// трёх событий за последние 7 дней и перезаписывает data.json.
//
// Нужна переменная окружения ANTHROPIC_API_KEY (см. README.md).

import { writeFile, readFile } from "node:fs/promises";

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.error("Не найден ANTHROPIC_API_KEY в переменных окружения.");
  process.exit(1);
}

const MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";

const TOPICS = {
  mob: {
    label: "Мобилизация",
    prompt:
      "новая волна военной мобилизации / призыва резервистов в России в обозримой перспективе (следующие несколько месяцев)",
  },
  def: {
    label: "Дефолт",
    prompt:
      "суверенный дефолт России или резкий финансовый кризис государственных обязательств в обозримой перспективе (следующие несколько месяцев)",
  },
  ret: {
    label: "Ротация",
    prompt:
      "окончание боевых действий и массовое возвращение российских военных, участвовавших в войне в Украине, к мирной жизни в обозримой перспективе (следующие несколько месяцев)",
  },
};

function buildPrompt() {
  return `Ты — аналитик, который раз в неделю оценивает вероятность трёх событий
на основе новостей за последние 7 дней. Используй поиск в интернете, чтобы
найти самые свежие публикации авторитетных СМИ.

Оцени вероятность (в процентах, целое число от 1 до 99) каждого из следующих
событий в обозримой перспективе (следующие несколько месяцев):

1. mob — ${TOPICS.mob.prompt}
2. def — ${TOPICS.def.prompt}
3. ret — ${TOPICS.ret.prompt}

Когда закончишь анализ, в самом последнем сообщении ответь СТРОГО в формате
JSON, без markdown-разметки, без пояснений вокруг, одной строкой:
{"mob": <число>, "def": <число>, "ret": <число>}`;
}

function extractJson(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[^{}]*\}/g);
  if (!match || match.length === 0) {
    throw new Error("В ответе модели не найден JSON: " + text);
  }
  // берём последний JSON-объект в тексте — это финальный ответ,
  // а не что-то попавшееся по пути в рассуждениях/поиске
  return JSON.parse(match[match.length - 1]);
}

function clampPercent(n, fallback) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(99, Math.max(1, Math.round(num)));
}

async function main() {
  const body = {
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: buildPrompt() }],
    tools: [{ type: "web_search_20250305", name: "web_search" }],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API вернул ошибку ${res.status}: ${errText}`);
  }

  const json = await res.json();

  // Ответ может содержать несколько text-блоков (между вызовами web_search).
  // Склеиваем все text-блоки — итоговый JSON будет в последнем.
  const text = (json.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n");

  const parsed = extractJson(text);

  // читаем текущий data.json, чтобы взять из него значения по умолчанию
  let current = { clocks: { mob: { p: 35 }, def: { p: 12 }, ret: { p: 15 } } };
  try {
    current = JSON.parse(await readFile(new URL("../data.json", import.meta.url), "utf8"));
  } catch {
    // файла ещё нет — используем дефолты выше
  }

  const today = new Date();
  const pad = n => String(n).padStart(2, "0");
  const updated = `${pad(today.getDate())}.${pad(today.getMonth() + 1)}.${today.getFullYear()}`;

  const result = {
    updated,
    clocks: {
      mob: { label: TOPICS.mob.label, p: clampPercent(parsed.mob, current.clocks.mob.p) },
      def: { label: TOPICS.def.label, p: clampPercent(parsed.def, current.clocks.def.p) },
      ret: { label: TOPICS.ret.label, p: clampPercent(parsed.ret, current.clocks.ret.p) },
    },
  };

  await writeFile(
    new URL("../data.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
    "utf8"
  );

  console.log("data.json обновлён:", result);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
