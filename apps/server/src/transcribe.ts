/**
 * Speech-to-text for the chat composer's microphone button.
 *
 * Audio goes to the OpenAI-compatible /audio/transcriptions endpoint (through Metis when
 * METIS_API_KEY is set, see metis.ts). Verified on Metis: whisper-1 accepts webm/ogg/wav from
 * browsers; gpt-4o-transcribe and MP4/M4A uploads are rejected by the gateway, so Safari's MP4
 * recordings go to Gemini's inline-audio transcription instead when a Google key is available.
 */
import { AppError } from "./errors.ts";

export const TRANSCRIBE_DEFAULT_MODEL = "whisper-1";
export const TRANSCRIBE_FALLBACK_MODEL = "gemini-2.5-flash";
export const TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024;

const extensions: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "video/mp4": "m4a",
  "audio/flac": "flac",
};
const mp4Like = new Set(["m4a"]);

export function transcriptionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TRANSCRIBE_ENABLED !== "false" && Boolean(env.OPENAI_API_KEY?.trim());
}

const failed = () =>
  new AppError("تبدیل صدا به متن انجام نشد. چند لحظهٔ دیگر دوباره تلاش کنید.", 502);

async function openaiTranscribe(
  audio: Blob,
  extension: string,
  env: NodeJS.ProcessEnv,
): Promise<{ ok: true; text: string } | { ok: false; status: number }> {
  const base = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const form = new FormData();
  form.append("model", env.TRANSCRIBE_MODEL?.trim() || TRANSCRIBE_DEFAULT_MODEL);
  form.append("language", "fa");
  form.append("response_format", "json");
  form.append("file", audio, `recording.${extension}`);
  const response = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY?.trim() ?? ""}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) return { ok: false, status: response.status };
  const payload = (await response.json().catch(() => ({}))) as { text?: unknown };
  if (typeof payload.text !== "string") return { ok: false, status: 502 };
  return { ok: true, text: payload.text };
}

async function geminiTranscribe(audio: Blob, type: string, env: NodeJS.ProcessEnv) {
  const base = (
    env.GOOGLE_GENERATIVE_AI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/, "");
  const data = Buffer.from(await audio.arrayBuffer()).toString("base64");
  const response = await fetch(`${base}/models/${TRANSCRIBE_FALLBACK_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GOOGLE_API_KEY?.trim() ?? "",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: "Transcribe this recording verbatim in the language spoken (usually Persian). Output only the transcript, with no commentary. If there is no speech, output nothing.",
            },
            { inline_data: { mime_type: type === "video/mp4" ? "audio/mp4" : type, data } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw failed();
  const payload = (await response.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
  };
  return (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

/** Validates the upload and returns trimmed transcript text. */
export async function transcribeAudio(
  audio: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (!transcriptionEnabled(env))
    throw new AppError("تبدیل صدا به متن روی این سرور فعال نیست.", 503);
  if (!(audio instanceof Blob) || audio.size === 0)
    throw new AppError("فایل صدا دریافت نشد. دوباره ضبط کنید.", 400);
  if (audio.size > TRANSCRIBE_MAX_BYTES)
    throw new AppError("صدای ضبط‌شده بیش از ۱۰ مگابایت است. پیام کوتاه‌تری ضبط کنید.", 413);
  const type = audio.type.split(";")[0].trim().toLowerCase();
  const extension = extensions[type];
  if (!extension)
    throw new AppError("این قالب صدا پشتیبانی نمی‌شود. با مرورگر دیگری دوباره ضبط کنید.", 415);
  const gemini = Boolean(env.GOOGLE_API_KEY?.trim());
  let text: string;
  try {
    if (mp4Like.has(extension) && gemini) text = await geminiTranscribe(audio, type, env);
    else {
      const result = await openaiTranscribe(audio, extension, env);
      if (result.ok) text = result.text;
      else if (result.status === 400 && gemini) text = await geminiTranscribe(audio, type, env);
      else throw failed();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw failed();
  }
  const clean = text.trim();
  if (!clean)
    throw new AppError("صدایی تشخیص داده نشد. نزدیک‌تر به میکروفون دوباره صحبت کنید.", 422);
  return clean;
}
