import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { ExtractedTransaction } from "../openai/parse-transaction";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export const SlipDataSchema = z.object({
  amount: z.number().positive().describe("ยอดเงินที่โอนหรือชำระจริง (บาท)"),
  merchant: z.string().describe("ชื่อร้านค้า หรือชื่อ-นามสกุล/บัญชีของผู้รับโอน"),
  account: z
    .string()
    .nullable()
    .describe("ธนาคารหรือช่องทางต้นทาง เช่น SCB, KBank, BBL, KTB, TTB, PromptPay"),
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
    .describe("หมวดหมู่ค่าใช้จ่ายที่ประเมินจากชื่อร้านค้าหรือรายละเอียดในสลิป"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("วันที่โอนเงินในสลิป แปลงเป็นรูปแบบ ค.ศ. YYYY-MM-DD"),
  type: z.literal("expense").describe("สลิปโอนจ่ายทั่วไปถือเป็น expense"),
});

export type SlipData = z.infer<typeof SlipDataSchema>;

export type SlipParseErrorCode = "missing_api_key" | "quota_exceeded" | "parse_failed";

/** error ที่แยกได้ว่าอ่านสลิปไม่ได้เพราะอะไร (เพื่อตอบผู้ใช้ได้ตรงจุด) */
export class SlipParseError extends Error {
  code: SlipParseErrorCode;
  constructor(code: SlipParseErrorCode) {
    super(`slip_parse_${code}`);
    this.code = code;
  }
}

/**
 * สกัดข้อมูลสลิปธนาคารจาก Base64 Image
 * รองรับสลิปธนาคารไทยทุกแห่ง (KBank, SCB, Krungthai, PromptPay ฯลฯ)
 */
export async function parseSlipWithVision(
  base64Image: string
): Promise<SlipData | null> {
  // ไม่มี key = อ่านสลิปไม่ได้ (ไม่สร้างข้อมูลปลอม)
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes("your_openai")) {
    throw new SlipParseError("missing_api_key");
  }

  try {
    const prompt = `วิเคราะห์รูปภาพสลิปโอนเงินธนาคารไทยนี้ และดึงข้อมูลออกมาอย่างถูกต้อง:
1. amount: ตรวจสอบยอดเงินโอนสุทธิ (เช่น 120.00, 350.50)
2. merchant: ชื่อผู้รับเงิน หรือชื่อร้านค้า เช่น "บจก. ซีพี ออลล์", "ร้านป้าสมใจ", "นายสมชาย ใจดี"
3. account: ธนาคารต้นทาง เช่น SCB, KBank, Krungthai, PromptPay
4. date: วันที่ทำรายการ แปลงวันที่ พ.ศ. เป็น ค.ศ. ในรูปแบบ YYYY-MM-DD
5. category: เลือกหมวดหมู่อย่างเหมาะสม เช่น ร้านอาหาร/เครื่องดื่ม -> food, ซื้อของ -> shopping`;

    const response = await openai.beta.chat.completions.parse({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
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

    return response.choices[0]?.message?.parsed ?? null;
  } catch (error) {
    console.error("❌ OpenAI Vision OCR Error:", error);
    // ไม่แทนที่ด้วยข้อมูลปลอม — ส่งต่อ error ให้ผู้เรียกแจ้งผู้ใช้ตามจริง
    const message = error instanceof Error ? error.message : String(error);
    throw new SlipParseError(
      /insufficient_quota|429|no credits/i.test(message) ? "quota_exceeded" : "parse_failed"
    );
  }
}

