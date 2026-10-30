import OpenAI from "openai";

import { generateJson, isGeminiConfigured } from "../ai/gemini";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

/**
 * Zod Schema สำหรับรับ Structured Output จาก OpenAI
 */
export const ExtractedTransactionSchema = z.object({
  amount: z.number().positive().describe("จำนวนเงินในหน่วยบาท ต้องเป็นตัวเลขมากกว่า 0"),
  item: z.string().describe("ชื่อสิ่งของ บริการ หรือรายการธุรกรรม เช่น กาแฟ, ข้าวผัด, ค่าไฟ, น้ำมัน"),
  account: z
    .string()
    .nullable()
    .describe("บัญชีธนาคารหรือวิธีการชำระเงิน เช่น SCB, KBank, BBL, TrueMoney, PromptPay, บัตรเครดิต, เงินสด หากไม่ระบุให้เป็น null"),
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
    .describe("หมวดหมู่ของรายการ โดยเลือกที่เหมาะสมที่สุด"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("วันที่ของธุรกรรมในรูปแบบ YYYY-MM-DD (พ.ศ. หรือ ค.ศ. ให้แปลงเป็น ค.ศ. เท่านั้น)"),
  type: z
    .enum(["expense", "income"])
    .describe("ประเภทของรายการ ปกติเป็น expense ยกเว้นมีคำบอกชัดเจนว่าเป็นรายรับ/เงินเดือน/โอนเข้า"),
});

export type ExtractedTransaction = z.infer<typeof ExtractedTransactionSchema>;

/**
 * แปลงข้อความธรรมชาติจาก LINE แชทเป็น JSON ข้อมูลธุรกรรม
 * @param text ข้อความจากผู้ใช้ เช่น 'กาแฟ 60 ด้วย SCB', 'เติมน้ำมัน 500 บาท เมื่อวาน'
 * @param currentDate วันที่ปัจจุบันในรูปแบบ YYYY-MM-DD สำหรับใช้อ้างอิงบริบทของเวลา
 */
export async function parseTransactionFromText(
  text: string,
  currentDate: string = new Date().toISOString().split("T")[0]
): Promise<ExtractedTransaction | null> {
  try {
    const prompt = `คุณคือผู้ช่วยบันทึกการเงินส่วนบุคคลและครอบครัว
วิเคราะห์ข้อความภาษาไทยของผู้ใช้ต่อไปนี้ แล้วสกัดข้อมูลรายรับ-รายจ่าย:
ข้อความ: "${text}"

บริบทวันที่ปัจจุบัน: ${currentDate}
กฎการแปลง:
1. หากมีการระบุคำว่า "วันนี้", "เมื่อวาน", "เมื่อวานซืน" หรือระบุวันที่ ให้คำนวณเป็นวันที่ ค.ศ. YYYY-MM-DD
2. ถ้าระบุธนาคารหรือช่องทาง เช่น SCB, KBank, BBL, พร้อมเพย์, เงินสด ให้เก็บลงฟิลด์ account
3. หมวดหมู่ (category):
   - อาหาร/เครื่องดื่ม -> food
   - เดินทาง/น้ำมัน/bts -> transport
   - ช้อปปิ้ง/ของใช้ -> shopping
   - ค่าเช่า/บ้าน/คอนโด -> housing
   - ค่าน้ำ/ค่าไฟ/เน็ต/มือถือ -> utilities
   - เที่ยว/หนัง/เกม -> entertainment
   - ยา/หาหมอ -> health
   - รายรับ/เงินเดือน/ขายของได้ -> income
   - อื่นๆ -> other

ตอบเป็น JSON ตาม schema นี้เท่านั้น: {"amount": number, "item": string, "account": string|null, "category": "food"|"transport"|"shopping"|"housing"|"utilities"|"entertainment"|"health"|"income"|"other", "date": "YYYY-MM-DD", "type": "expense"|"income"}
`;

    // ใช้ Gemini ก่อนถ้าตั้งค่าไว้ (ไม่ต้องพึ่ง OpenAI)
    if (isGeminiConfigured()) {
      try {
        const raw = await generateJson({ prompt });
        const parsed = ExtractedTransactionSchema.safeParse(raw);
        if (parsed.success) {
          return parsed.data;
        }
        console.warn("⚠️ Gemini คืนค่าไม่ตรง schema:", parsed.error.flatten());
      } catch (geminiErr) {
        console.warn("⚠️ Gemini text parsing ขัดข้อง กำลังลอง OpenAI:", geminiErr);
      }
    }

    const completion = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "คุณคือ AI ผู้เชี่ยวชาญการแปลงข้อความบันทึกรายรับรายจ่ายเป็น Structured Data",
        },
        { role: "user", content: prompt },
      ],
      response_format: zodResponseFormat(
        ExtractedTransactionSchema,
        "extracted_transaction"
      ),
      temperature: 0.1,
    });

    const parsed = completion.choices[0]?.message?.parsed;
    return parsed ?? null;
  } catch (error) {
    console.error("❌ Error in parseTransactionFromText:", error);
    return null;
  }
}

