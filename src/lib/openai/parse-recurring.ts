import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { generateJson, isGeminiConfigured } from "../ai/gemini";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export const RecurringTransactionSchema = z.object({
  item: z.string().describe("ชื่อบริการหรือบิล เช่น Netflix, ค่าไฟ, ค่าเช่าห้อง, Spotify"),
  amount: z.number().positive().describe("จำนวนเงิน (บาท)"),
  frequency: z
    .enum(["daily", "weekly", "monthly", "yearly"])
    .describe("ความถี่ในการเกิดซ้ำ เช่น ทุกวัน (daily), ทุกสัปดาห์ (weekly), ทุกเดือน (monthly), ทุกปี (yearly)"),
  interval_count: z.number().int().positive().default(1).describe("ทุกๆ กี่ช่วง เช่น ทุกๆ 1 เดือน หรือ ทุกๆ 2 สัปดาห์"),
  category: z
    .enum([
      "food",
      "transport",
      "shopping",
      "housing",
      "utilities",
      "entertainment",
      "health",
      "income",
      "other",
    ])
    .describe("หมวดหมู่ค่าใช้จ่าย"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("วันที่เริ่มต้นบิล ค.ศ. YYYY-MM-DD"),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("วันที่ต้องจ่ายครั้งถัดไป ค.ศ. YYYY-MM-DD"),
  type: z.enum(["expense", "income"]).default("expense"),
});

export type ExtractedRecurring = z.infer<typeof RecurringTransactionSchema>;

/**
 * วิเคราะห์ข้อความตั้งรายการประจำ เช่น "Netflix 419 ทุกเดือน", "ค่าเช่าห้อง 8500 ทุกวันที่ 1"
 */
export async function parseRecurringFromText(
  text: string,
  currentDate: string = new Date().toISOString().split("T")[0]
): Promise<ExtractedRecurring | null> {
  try {
    const prompt = `วิเคราะห์ข้อความภาษาไทยของผู้ใช้ที่ต้องการตั้งบิล/รายรับรายจ่ายประจำ:
ข้อความ: "${text}"
วันที่ปัจจุบัน: ${currentDate}

คำสั่ง:
1. สกัด item (ชื่อบิล/บริการ), amount (ยอดเงิน)
2. วิเคราะห์ frequency (daily, weekly, monthly, yearly) และ interval_count
   - "ทุกเดือน", "รายเดือน" -> frequency: "monthly", interval_count: 1
   - "ทุก 2 สัปดาห์" -> frequency: "weekly", interval_count: 2
   - "ทุกปี" -> frequency: "yearly", interval_count: 1
3. คำนวณ next_run_date ในรูปแบบ YYYY-MM-DD
   - หากระบุ "ทุกวันที่ 1" ให้คำนวณวันถัดไปที่เป็นวันที่ 1
   - หากไม่ระบุ ให้ใช้วันนี้หรือเดือนถัดไปตามบริบท
4. เลือก category ที่ตรงที่สุด เช่น Netflix -> entertainment, ค่าเน็ต/ค่าไฟ -> utilities, ค่าเช่าคอนโด -> housing
5. type: ปกติเป็น "expense"

ตอบเป็น JSON ตามรูปแบบนี้เท่านั้น:
{"item": "...", "amount": 0, "frequency": "monthly", "interval_count": 1, "category": "entertainment", "start_date": "YYYY-MM-DD", "next_run_date": "YYYY-MM-DD", "type": "expense"}`;

    if (isGeminiConfigured()) {
      try {
        const raw = await generateJson({ prompt });
        const parsed = RecurringTransactionSchema.safeParse(raw);
        if (parsed.success) return parsed.data;
        console.warn("⚠️ Gemini คืนค่าไม่ตรง Recurring schema:", parsed.error.flatten());
      } catch (geminiErr) {
        console.warn("⚠️ Gemini recurring parsing ขัดข้อง กำลังลอง OpenAI:", geminiErr);
      }
    }

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes("your_openai")) {
      return null;
    }

    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "คุณคือ AI ผู้เชี่ยวชาญการตั้งค่าบิลประจำ (Recurring Bills & Subscriptions)",
        },
        { role: "user", content: prompt },
      ],
      response_format: zodResponseFormat(
        RecurringTransactionSchema,
        "recurring_transaction"
      ),
      temperature: 0.1,
    });

    return completion.choices[0]?.message?.parsed ?? null;
  } catch (error) {
    console.error("❌ Error parsing recurring transaction:", error);
    return null;
  }
}

