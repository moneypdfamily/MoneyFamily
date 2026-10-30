import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { GeminiError, generateJson, isGeminiConfigured } from "../ai/gemini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const VALID_CATEGORIES = [
  "food",
  "transport",
  "shopping",
  "housing",
  "utilities",
  "entertainment",
  "health",
  "income",
  "other",
] as const;

/**
 * Zod Schema ยืดหยุ่นสูง รองรับข้อมูลสลิปทุกรูปแบบ
 * ป้องกันไม่ให้ Slip ถูกปฏิเสธเพียงเพราะชนิดข้อมูลเล็กน้อย เช่น amount เป็น string หรือ category เป็นคำใกล้เคียง
 */
export const SlipDataSchema = z.object({
  amount: z.preprocess((val) => {
    if (typeof val === "string") {
      const clean = val.replace(/,/g, "").trim();
      const num = parseFloat(clean);
      return isNaN(num) ? 0 : num;
    }
    if (typeof val === "number") return val;
    return 0;
  }, z.number().positive().describe("ยอดเงินที่โอนหรือชำระจริง (บาท)")),

  merchant: z.preprocess((val) => {
    if (typeof val === "string" && val.trim()) return val.trim();
    return "ร้านค้า/ผู้รับเงิน";
  }, z.string().describe("ชื่อร้านค้า หรือชื่อ-นามสกุล/บัญชีของผู้รับโอน")),

  account: z.preprocess((val) => {
    if (!val || typeof val !== "string" || !val.trim()) return null;
    return val.trim();
  }, z.string().nullable().describe("ธนาคารหรือช่องทางต้นทาง เช่น SCB, KBank, BBL, KTB, TTB, PromptPay")),

  category: z.preprocess((val) => {
    if (typeof val === "string") {
      const lower = val.toLowerCase().trim();
      if ((VALID_CATEGORIES as readonly string[]).includes(lower)) {
        return lower;
      }
      // แปลงคำทั่วไปให้เข้าหมวดหมู่อย่างชาญฉลาด
      if (/shop|store|diy|retail|mall|market|7-eleven|supermarket|big c|lotus|makro/i.test(lower)) return "shopping";
      if (/food|cafe|coffee|restaurant|kitchen|din|noodle|eat/i.test(lower)) return "food";
      if (/fuel|gas|petrol|ptt|bcp|travel|transit|transport|bts|mrt/i.test(lower)) return "transport";
      if (/bill|water|electric|pea|mea|internet|ais|true|dtac|tel/i.test(lower)) return "utilities";
      if (/rent|condo|apartment|house|dorm/i.test(lower)) return "housing";
      if (/hospital|clinic|pharmacy|drug|health|medical/i.test(lower)) return "health";
      if (/game|cinema|movie|netflix|spotify|entertainment/i.test(lower)) return "entertainment";
    }
    return "shopping"; // ค่าเริ่มต้นสำหรับสลิปจ่ายบิล/ร้านค้า
  }, z.enum(VALID_CATEGORIES)),

  date: z.preprocess((val) => {
    const today = new Date().toISOString().split("T")[0];
    if (typeof val === "string") {
      // ค้นหารูปแบบ YYYY-MM-DD
      const ymd = val.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (ymd) {
        let y = parseInt(ymd[1], 10);
        if (y > 2500) y -= 543; // แปลงปี พ.ศ. เป็น ค.ศ.
        const m = ymd[2].padStart(2, "0");
        const d = ymd[3].padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
      // ค้นหารูปแบบ DD/MM/YYYY
      const dmy = val.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (dmy) {
        let y = parseInt(dmy[3], 10);
        if (y > 2500) y -= 543;
        const m = dmy[2].padStart(2, "0");
        const d = dmy[1].padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
    }
    return today;
  }, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),

  type: z.preprocess(() => "expense", z.literal("expense")),
});

export type SlipData = z.infer<typeof SlipDataSchema>;

export type SlipParseErrorCode = "missing_api_key" | "quota_exceeded" | "parse_failed";

export class SlipParseError extends Error {
  code: SlipParseErrorCode;
  constructor(code: SlipParseErrorCode) {
    super(`slip_parse_${code}`);
    this.code = code;
  }
}

const SLIP_PROMPT = `คุณคือ AI ผู้เชี่ยวชาญการอ่านสลิปธนาคารไทย (Krungthai, KBank, SCB, Bangkok Bank, PromptPay ฯลฯ)
จงวิเคราะห์ภาพสลิปนี้และสกัดข้อมูลออกมาเป็น JSON ตามรูปแบบนี้เท่านั้น:
{
  "amount": 14.00,
  "merchant": "MR.D.I.Y.",
  "account": "Krungthai",
  "category": "shopping",
  "date": "2026-10-29",
  "type": "expense"
}

แนวทางการสกัด:
1. amount: ดูยอดเงินจริงที่ชำระ (เช่น 14.00, 272.50) ห้ามใส่ลูกน้ำ
2. merchant: ชื่อร้านค้า หรือชื่อผู้รับเงิน (ดูหลังคำว่า "ไปยัง", "ถึง", "โอนให้", หรือชื่อผู้รับ/บิลเลอร์)
3. account: ธนาคารต้นทางของผู้โอน (ดูจากโลโก้หรือชื่อธนาคาร เช่น Krungthai, SCB, KBank, PromptPay)
4. date: วันที่ทำรายการ แปลง พ.ศ. เป็น ค.ศ. รูปแบบ YYYY-MM-DD
5. category: เลือกหมวดหมู่ที่เหมาะสมที่สุด (food, transport, shopping, housing, utilities, entertainment, health, income, other)`;

/**
 * สกัดข้อมูลสลิปธนาคารจาก Base64 Image
 * ลำดับการทำงาน:
 * 1. ใช้ Google Gemini Vision (รวดเร็วและแม่นยำสูงกับภาษาไทย)
 * 2. หาก Gemini ขัดข้อง ให้ Fallback ไปยัง OpenAI GPT-4o-mini Vision อัตโนมัติ
 */
export async function parseSlipWithVision(base64Image: string): Promise<SlipData | null> {
  let geminiError: unknown = null;

  // 1) ลองใช้ Google Gemini Vision ก่อน
  if (isGeminiConfigured()) {
    try {
      console.log("🔍 กำลังอ่านสลิปด้วย Google Gemini Vision...");
      const raw = await generateJson({ prompt: SLIP_PROMPT, imageBase64: base64Image });
      const parsed = SlipDataSchema.safeParse(raw);

      if (parsed.success && parsed.data.amount > 0) {
        console.log("✅ Google Gemini อ่านสลิปสำเร็จ:", parsed.data);
        return parsed.data;
      }
      console.warn("⚠️ Gemini คืนค่าไม่ตรง schema หรือยอดเงินไม่ถูกต้อง:", raw);
    } catch (error) {
      geminiError = error;
      console.error("⚠️ Gemini Vision OCR ขัดข้อง กำลังลองใช้ OpenAI Fallback:", error);
    }
  }

  // 2) Fallback ไปยัง OpenAI GPT-4o-mini Vision
  const hasOpenAiKey = Boolean(
    process.env.OPENAI_API_KEY &&
      process.env.OPENAI_API_KEY.trim() &&
      !process.env.OPENAI_API_KEY.includes("your_openai")
  );

  if (hasOpenAiKey) {
    try {
      console.log("🔄 Fallback: กำลังอ่านสลิปด้วย OpenAI GPT-4o-mini Vision...");
      const response = await openai.beta.chat.completions.parse({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: SLIP_PROMPT },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        response_format: zodResponseFormat(SlipDataSchema, "slip_data"),
        temperature: 0.1,
      });

      const parsed = response.choices[0]?.message?.parsed;
      if (parsed && parsed.amount > 0) {
        console.log("✅ OpenAI GPT-4o-mini อ่านสลิปสำเร็จ:", parsed);
        return parsed;
      }
    } catch (openAiError) {
      console.error("❌ OpenAI Vision OCR Error:", openAiError);
    }
  }

  // หากไม่มี API Key ของทั้งสองค่าย
  if (!isGeminiConfigured() && !hasOpenAiKey) {
    throw new SlipParseError("missing_api_key");
  }

  // หากเกิด quota exceeded
  const gCode = geminiError instanceof GeminiError ? geminiError.code : undefined;
  if (gCode === "quota_exceeded") {
    throw new SlipParseError("quota_exceeded");
  }

  throw new SlipParseError("parse_failed");
}
