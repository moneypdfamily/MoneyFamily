/**
 * ตัวช่วยเรียก Gemini API (Google AI Studio) แบบ REST
 * ใช้สำหรับอ่านข้อความ/รูปสลิปเป็น JSON — ไม่ต้องติดตั้ง SDK เพิ่ม
 */

const BASE_URL = "https://generativelanguage.googleapis.com";

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

// แคชโมเดลที่ค้นพบว่าใช้งานได้จริงกับ API Key ปัจจุบัน
let cachedWorkingModel: { version: string; model: string } | null = null;

/**
 * ดึงรายชื่อโมเดลที่พร้อมใช้งานจริงจาก Google AI Studio สำหรับ API Key นี้
 */
async function discoverModelsFromGoogle(apiKey: string): Promise<Array<{ version: string; model: string }>> {
  if (cachedWorkingModel) {
    return [cachedWorkingModel];
  }

  const results: Array<{ version: string; model: string }> = [];

  for (const apiVersion of ["v1beta", "v1"]) {
    try {
      const res = await fetch(`${BASE_URL}/${apiVersion}/models?key=${encodeURIComponent(apiKey)}`, {
        headers: { "x-goog-api-key": apiKey },
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.warn(`⚠️ Gemini ${apiVersion}/models returned HTTP ${res.status}:`, errBody.slice(0, 300));
        continue;
      }

      const data = await res.json().catch(() => null);
      const models = data?.models || [];

      // กรองเฉพาะโมเดลที่รองรับ generateContent
      const supported = models
        .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
        .map((m: any) => String(m.name || "").replace(/^models\//, ""))
        .filter(Boolean);

      console.log(`📋 [Gemini ${apiVersion}] พบโมเดลที่พร้อมใช้งาน:`, supported);

      // เรียงลำดับความสำคัญ: 2.5-flash -> 2.0-flash -> 1.5-flash -> flash อื่นๆ -> pro
      const sorted = supported.sort((a: string, b: string) => {
        const score = (name: string) => {
          if (name.includes("2.5-flash")) return 12;
          if (name.includes("2.0-flash")) return 10;
          if (name.includes("1.5-flash")) return 8;
          if (name.includes("flash")) return 6;
          if (name.includes("pro")) return 4;
          return 1;
        };
        return score(b) - score(a);
      });

      for (const m of sorted) {
        results.push({ version: apiVersion, model: m });
      }

      if (results.length > 0) break;
    } catch (err) {
      console.warn(`⚠️ เกิดข้อผิดพลาดในการตรวจสอบ ${apiVersion}/models:`, err);
    }
  }

  return results;
}

/**
 * ขอคำตอบเป็น JSON จาก Gemini แล้วคืน object ที่ parse แล้ว
 */
export async function generateJson({
  prompt,
  imageBase64,
  mimeType = "image/jpeg",
}: GenerateJsonParams): Promise<unknown> {
  if (!isGeminiConfigured()) throw new GeminiError("missing_api_key");

  const apiKey = (process.env.GEMINI_API_KEY as string).trim();

  // จัดเตรียม Part ตามมาตรฐาน Google Gemini REST API (inlineData camelCase)
  const parts: any[] = [{ text: prompt }];

  if (imageBase64) {
    const cleanBase64 = imageBase64
      .replace(/^data:image\/[a-zA-Z+]+;base64,/, "")
      .replace(/\s+/g, "");

    // ตรวจสอบ MIME type จาก magic bytes
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

  // 1. ค้นหาโมเดลที่ใช้ได้จริงกับ API Key นี้ก่อน
  const discovered = await discoverModelsFromGoogle(apiKey);

  // 2. รายการ Fallback มาตรฐาน
  const fallbackList: Array<{ version: string; model: string }> = [];

  const configured = process.env.GEMINI_MODEL?.trim();
  if (configured) {
    fallbackList.push({ version: "v1beta", model: configured });
  }

  fallbackList.push(
    { version: "v1beta", model: "gemini-2.5-flash" },
    { version: "v1beta", model: "gemini-2.0-flash" },
    { version: "v1beta", model: "gemini-1.5-flash" },
    { version: "v1beta", model: "gemini-1.5-flash-latest" },
    { version: "v1beta", model: "gemini-2.0-flash-exp" },
    { version: "v1", model: "gemini-2.5-flash" },
    { version: "v1", model: "gemini-1.5-flash" },
    { version: "v1beta", model: "gemini-1.5-pro" },
    { version: "v1", model: "gemini-1.5-pro" }
  );

  // รวมรายการที่จะทดสอบ
  const candidateTargets: Array<{ version: string; model: string }> = [];
  const added = new Set<string>();

  for (const item of [...discovered, ...fallbackList]) {
    const key = `${item.version}/${item.model}`;
    if (!added.has(key)) {
      added.add(key);
      candidateTargets.push(item);
    }
  }

  let lastError: GeminiError | null = null;

  for (const target of candidateTargets) {
    const targetUrl = `${BASE_URL}/${target.version}/models/${target.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      console.log(`🤖 กำลังเรียก Gemini API [${target.version}/${target.model}]...`);

      const res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: requestBody,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`⚠️ Gemini [${target.version}/${target.model}] HTTP ${res.status}:`, body.slice(0, 300));

        if (res.status === 404) {
          lastError = new GeminiError("model_not_found", `Model ${target.model} not found: ${body.slice(0, 200)}`);
          continue; // ลองโมเดลถัดไป
        }
        if (res.status === 429) {
          throw new GeminiError("quota_exceeded", body.slice(0, 300));
        }
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          if (body.includes("API_KEY_INVALID") || body.includes("not valid")) {
            throw new GeminiError("invalid_key", body.slice(0, 300));
          }
          lastError = new GeminiError("request_failed", `${res.status} ${body.slice(0, 200)}`);
          continue;
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
        console.warn(`⚠️ Gemini [${target.model}] คืนค่าว่าง candidate finishReason:`, payload?.candidates?.[0]?.finishReason);
        continue;
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

      const parsedJson = JSON.parse(jsonString);

      // บันทึกโมเดลที่ทำงานได้สำเร็จไว้ในแคช
      cachedWorkingModel = target;
      console.log(`✅ Gemini [${target.version}/${target.model}] ตอบกลับ JSON สำเร็จ!`);

      return parsedJson;
    } catch (err: any) {
      if (err instanceof GeminiError && (err.code === "invalid_key" || err.code === "quota_exceeded")) {
        throw err;
      }
      lastError = err instanceof GeminiError ? err : new GeminiError("request_failed", err?.message);
    }
  }

  throw lastError || new GeminiError("request_failed", "All candidate Gemini models failed");
}
