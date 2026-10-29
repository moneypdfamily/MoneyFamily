/**
 * ตัวช่วยเรียก Gemini API (Google AI Studio) แบบ REST
 * ใช้สำหรับอ่านข้อความ/รูปสลิปเป็น JSON — ไม่ต้องติดตั้ง SDK เพิ่ม
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiErrorCode = "missing_api_key" | "quota_exceeded" | "invalid_key" | "request_failed";

export class GeminiError extends Error {
  code: GeminiErrorCode;
  constructor(code: GeminiErrorCode, message?: string) {
    super(message || `gemini_${code}`);
    this.code = code;
  }
}

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface GenerateJsonParams {
  prompt: string;
  /** รูปภาพแบบ base64 (ไม่ต้องมี data: prefix) */
  imageBase64?: string;
  mimeType?: string;
}

/**
 * ขอคำตอบเป็น JSON จาก Gemini แล้วคืน object ที่ parse แล้ว (ยังไม่ validate schema)
 */
export async function generateJson({
  prompt,
  imageBase64,
  mimeType = "image/jpeg",
}: GenerateJsonParams): Promise<unknown> {
  if (!isGeminiConfigured()) throw new GeminiError("missing_api_key");

  const parts: GeminiPart[] = [{ text: prompt }];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mimeType, data: imageBase64 } });
  }

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${DEFAULT_MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY as string,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });
  } catch (error) {
    throw new GeminiError("request_failed", error instanceof Error ? error.message : undefined);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new GeminiError("quota_exceeded", body.slice(0, 300));
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new GeminiError("invalid_key", body.slice(0, 300));
    }
    throw new GeminiError("request_failed", `${res.status} ${body.slice(0, 300)}`);
  }

  const payload = (await res.json().catch(() => null)) as
    | {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
      }
    | null;

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) throw new GeminiError("request_failed", "empty response");

  try {
    return JSON.parse(text);
  } catch {
    // บางครั้งโมเดลห่อ JSON ด้วย ```json ... ```
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new GeminiError("request_failed", "response is not JSON");
    return JSON.parse(match[0]);
  }
}
