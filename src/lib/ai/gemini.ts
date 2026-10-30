/**
 * ตัวช่วยเรียก Gemini API (Google AI Studio) แบบ REST
 * ใช้สำหรับอ่านข้อความ/รูปสลิปเป็น JSON — ไม่ต้องติดตั้ง SDK เพิ่ม
 */

// โมเดลทางการของ Google Gemini ที่รองรับ Vision และ Text ได้รวดเร็วและแม่นยำ
// ป้องกันข้อผิดพลาดกรณีพิมพ์ typo เช่น "gemini-2.5-flash"
function resolveModelName(model?: string): string {
  if (!model || model.trim() === "" || model.includes("2.5")) {
    return "gemini-1.5-flash";
  }
  return model.trim();
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiErrorCode =
  | "missing_api_key"
  | "quota_exceeded"
  | "invalid_key"
  | "model_not_found"
  | "request_failed";

export class GeminiError extends Error {
  code: GeminiErrorCode;
  constructor(code: GeminiErrorCode, message?: string) {
    super(message || `gemini_${code}`);
    this.code = code;
  }
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim() && !key.includes("your_gemini"));
}

interface GenerateJsonParams {
  prompt: string;
  /** รูปภาพแบบ base64 (ทั้งแบบมีหรือไม่มี data:image/...;base64, prefix) */
  imageBase64?: string;
  mimeType?: string;
}

/**
 * ขอคำตอบเป็น JSON จาก Gemini แล้วคืน object ที่ parse แล้ว
 * มีระบบ Auto-fallback หากโมเดลหลักขัดข้อง (เช่น gemini-1.5-flash -> gemini-2.0-flash)
 */
export async function generateJson({
  prompt,
  imageBase64,
  mimeType = "image/jpeg",
}: GenerateJsonParams): Promise<unknown> {
  if (!isGeminiConfigured()) throw new GeminiError("missing_api_key");

  const apiKey = (process.env.GEMINI_API_KEY as string).trim();
  const configuredModel = resolveModelName(process.env.GEMINI_MODEL);

  // รายการโมเดลสำรองกรณีโมเดลใดโมเดลหนึ่ง 404 หรือมีปัญหาชั่วคราว
  const candidateModels = Array.from(
    new Set([configuredModel, "gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"])
  );

  // จัดเตรียม Part ตามมาตรฐาน Google Gemini v1beta API (ใช้ inlineData camelCase)
  const parts: any[] = [{ text: prompt }];

  if (imageBase64) {
    const cleanBase64 = imageBase64
      .replace(/^data:image\/[a-zA-Z+]+;base64,/, "")
      .replace(/\s+/g, "");

    // ตรวจสอบ MIME type จาก magic bytes ถ้าเป็นไปได้
    let detectedMime = mimeType;
    if (cleanBase64.startsWith("/9j/")) detectedMime = "image/jpeg";
    else if (cleanBase64.startsWith("iVBORw0KGgo")) detectedMime = "image/png";
    else if (cleanBase64.startsWith("UklGR")) detectedMime = "image/webp";

    parts.push({
      inlineData: {
        mimeType: detectedMime,
        data: cleanBase64,
      },
    });
  }

  const requestBody = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  let lastError: GeminiError | null = null;

  for (const model of candidateModels) {
    try {
      const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: requestBody,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`⚠️ Gemini API model ${model} returned HTTP ${res.status}:`, body.slice(0, 150));

        if (res.status === 404) {
          lastError = new GeminiError("model_not_found", `Model ${model} not found`);
          continue; // ลองโมเดลถัดไป
        }
        if (res.status === 429) {
          throw new GeminiError("quota_exceeded", body.slice(0, 300));
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          throw new GeminiError("invalid_key", body.slice(0, 300));
        }
        throw new GeminiError("request_failed", `${res.status} ${body.slice(0, 300)}`);
      }

      const payload = (await res.json().catch(() => null)) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
      } | null;

      const text = payload?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        throw new GeminiError("request_failed", "Empty response from Gemini");
      }

      // ดึงเฉพาะเนื้อหา JSON ออกมา ป้องกันกรณีโมเดลครอบด้วย ```json ... ```
      let jsonString = text;
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch) {
        jsonString = fenceMatch[1];
      } else {
        const objMatch = text.match(/\{[\s\S]*\}/);
        if (objMatch) {
          jsonString = objMatch[0];
        }
      }

      return JSON.parse(jsonString);
    } catch (err: any) {
      if (err instanceof GeminiError && (err.code === "invalid_key" || err.code === "quota_exceeded")) {
        throw err; // ปัญหาที่ Key ไม่ต้องลองโมเดลอื่น
      }
      lastError = err instanceof GeminiError ? err : new GeminiError("request_failed", err?.message);
    }
  }

  throw lastError || new GeminiError("request_failed", "All candidate Gemini models failed");
}
