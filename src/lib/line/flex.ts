import { messagingApi } from "@line/bot-sdk";
import { ExtractedTransaction } from "../openai/parse-transaction";
import { SlipData } from "../ocr/parse-slip";

type FlexMessage = messagingApi.FlexMessage;
type FlexBubble = messagingApi.FlexBubble;

const categoryEmojiMap: Record<string, string> = {
  food: "🍔 อาหารและเครื่องดื่ม",
  transport: "🚗 การเดินทาง/น้ำมัน",
  shopping: "🛍️ ช้อปปิ้ง/ของใช้",
  housing: "🏠 ค่าที่พัก/บ้าน",
  utilities: "💡 ค่าน้ำ/ค่าไฟ/เน็ต",
  entertainment: "🍿 บันเทิง/สตรีมมิ่ง",
  health: "💊 สุขภาพ/ยา",
  income: "💰 รายรับ/เงินเข้า",
  other: "📝 อื่นๆ",
};

/**
 * สร้าง Flex Message ยืนยันสำหรับข้อความทั่วไป (Text Message)
 */
export function createTransactionConfirmationMessage(params: {
  transaction: ExtractedTransaction;
  groupName: string;
  liffId?: string;
  transactionId?: string;
}): FlexMessage {
  const { transaction, groupName, liffId = process.env.NEXT_PUBLIC_LIFF_ID || "", transactionId } = params;

  const formattedAmount = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(transaction.amount);

  const categoryLabel = categoryEmojiMap[transaction.category] || "📝 ทั่วไป";

  const compactPayload = JSON.stringify({
    a: transaction.amount,
    i: transaction.item,
    c: transaction.category,
    acc: transaction.account,
    d: transaction.date,
    t: transaction.type,
    txId: transactionId,
  });

  const bubbleContents: FlexBubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#059669",
      paddingAll: "18px",
      contents: [
        {
          type: "text",
          text: "MoneyFamily • ยืนยันรายการ",
          color: "#D1FAE5",
          size: "xs",
          weight: "bold",
        },
        {
          type: "text",
          text: transaction.item,
          color: "#FFFFFF",
          size: "xl",
          weight: "bold",
          margin: "sm",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        {
          type: "box",
          layout: "baseline",
          contents: [
            { type: "text", text: "฿", size: "xl", color: "#059669", weight: "bold", flex: 0 },
            {
              type: "text",
              text: ` ${formattedAmount}`,
              size: "3xl",
              color: "#111827",
              weight: "bold",
              margin: "xs",
            },
          ],
        },
        { type: "separator", margin: "lg" },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "หมวดหมู่", color: "#6B7280", size: "sm", flex: 3 },
                { type: "text", text: categoryLabel, color: "#1F2937", size: "sm", flex: 6, weight: "bold", align: "end" },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "จ่ายด้วย", color: "#6B7280", size: "sm", flex: 3 },
                { type: "text", text: transaction.account || "เงินสด / ไม่ระบุ", color: "#1F2937", size: "sm", flex: 6, align: "end" },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "วันที่", color: "#6B7280", size: "sm", flex: 3 },
                { type: "text", text: transaction.date, color: "#1F2937", size: "sm", flex: 6, align: "end" },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "กลุ่ม", color: "#6B7280", size: "sm", flex: 3 },
                { type: "text", text: groupName, color: "#059669", size: "sm", flex: 6, weight: "bold", align: "end" },
              ],
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        {
          type: "text",
          text: "แตะปุ่มลัดด้านล่างเพื่อดำเนินการทันที 👇",
          color: "#9CA3AF",
          size: "xs",
          align: "center",
        },
      ],
    },
  };

  const liffSplitUrl = liffId
    ? `https://liff.line.me/${liffId}/transactions/split?amount=${transaction.amount}&item=${encodeURIComponent(
        transaction.item
      )}`
    : `https://line.me`;

  return {
    type: "flex",
    altText: `💸 บันทึก ${transaction.item} ยอด ${formattedAmount} บาท`,
    contents: bubbleContents,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "✅ บันทึก",
            data: `action=confirm&payload=${encodeURIComponent(compactPayload)}`,
            displayText: "✅ ยืนยันบันทึกรายจ่ายนี้",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "❌ ยกเลิก",
            data: `action=cancel&payload=${encodeURIComponent(compactPayload)}`,
            displayText: "❌ ขอยกเลิกรายการนี้",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "👨‍👩‍👧‍👦 หารกับคนในบ้าน",
            data: `action=open_split&amount=${transaction.amount}&payload=${encodeURIComponent(compactPayload)}`,
            displayText: "👨‍👩‍👧‍👦 ขอหารค่าใช้จ่ายรายการนี้กับคนในบ้าน",
          },
        },
      ],
    },
  };
}

/**
 * สร้าง Flex Message สำหรับกรณีสแกนสลิปโอนเงิน (Image Slip OCR)
 * พร้อมแสดงสถานะการบันทึกลงฐานข้อมูลแล้ว และมี Quick Reply ให้จัดการต่อ
 */
export function createSlipConfirmationMessage(params: {
  slip: SlipData;
  transactionId: string;
  groupName: string;
  liffId?: string;
}): FlexMessage {
  const { slip, transactionId, groupName, liffId = process.env.NEXT_PUBLIC_LIFF_ID || "" } = params;

  const formattedAmount = new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(slip.amount);

  const categoryLabel = categoryEmojiMap[slip.category] || "📝 ทั่วไป";

  const bubbleContents: FlexBubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#1E3A8A", // Deep Navy Blue สำหรับสลิปธนาคาร
      paddingAll: "18px",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          contents: [
            {
              type: "text",
              text: "🧾 สแกนสลิปสำเร็จ (บันทึกแล้ว)",
              color: "#93C5FD",
              size: "xs",
              weight: "bold",
              flex: 1,
            },
            {
              type: "text",
              text: "AUTO-SAVED",
              color: "#34D399",
              size: "xxs",
              weight: "bold",
              align: "end",
            },
          ],
        },
        {
          type: "text",
          text: slip.merchant,
          color: "#FFFFFF",
          size: "lg",
          weight: "bold",
          margin: "sm",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "20px",
      contents: [
        {
          type: "box",
          layout: "baseline",
          contents: [
            { type: "text", text: "฿", size: "xl", color: "#2563EB", weight: "bold", flex: 0 },
            {
              type: "text",
              text: ` ${formattedAmount}`,
              size: "3xl",
              color: "#111827",
              weight: "bold",
              margin: "xs",
            },
          ],
        },
        { type: "separator", margin: "lg" },
        {
          type: "box",
          layout: "vertical",
          margin: "lg",
          spacing: "sm",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "ร้านค้า/ผู้รับ", color: "#6B7280", size: "sm", flex: 4 },
                { type: "text", text: slip.merchant, color: "#1F2937", size: "sm", flex: 6, weight: "bold", align: "end", wrap: true },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "หมวดหมู่", color: "#6B7280", size: "sm", flex: 4 },
                { type: "text", text: categoryLabel, color: "#1F2937", size: "sm", flex: 6, align: "end" },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "ธนาคาร/ต้นทาง", color: "#6B7280", size: "sm", flex: 4 },
                { type: "text", text: slip.account || "ไม่ระบุ", color: "#1F2937", size: "sm", flex: 6, align: "end" },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "วันที่โอน", color: "#6B7280", size: "sm", flex: 4 },
                { type: "text", text: slip.date, color: "#1F2937", size: "sm", flex: 6, align: "end" },
              ],
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "กลุ่ม", color: "#6B7280", size: "sm", flex: 4 },
                { type: "text", text: groupName, color: "#2563EB", size: "sm", flex: 6, weight: "bold", align: "end" },
              ],
            },
          ],
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "xs",
      contents: [
        {
          type: "text",
          text: "🔒 ข้อมูลสลิปถูกประมวลผลและลบจากหน่วยความจำเรียบร้อย (No Storage)",
          color: "#9CA3AF",
          size: "xxs",
          align: "center",
        },
      ],
    },
  };

  const liffSplitUrl = liffId
    ? `https://liff.line.me/${liffId}/transactions/split?txId=${transactionId}&amount=${slip.amount}&item=${encodeURIComponent(
        slip.merchant
      )}`
    : `https://line.me`;

  const slipPayload = JSON.stringify({
    txId: transactionId,
    amount: slip.amount,
    item: slip.merchant,
  });

  return {
    type: "flex",
    altText: `🧾 สแกนสลิป ${slip.merchant} ยอด ฿${formattedAmount} บันทึกเรียบร้อย`,
    contents: bubbleContents,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "postback",
            label: "✅ บันทึกแล้ว",
            data: `action=acknowledged&txId=${transactionId}`,
            displayText: "✅ บันทึกสลิปนี้เรียบร้อย",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "❌ ยกเลิก",
            data: `action=delete_tx&txId=${transactionId}`,
            displayText: "❌ ขอยกเลิกและลบรายการสลิปนี้",
          },
        },
        {
          type: "action",
          action: {
            type: "postback",
            label: "👨‍👩‍👧‍👦 หารกับคนในบ้าน",
            data: `action=open_split&txId=${transactionId}&amount=${slip.amount}`,
            displayText: "👨‍👩‍👧‍👦 ขอหารค่าใช้จ่ายรายการนี้กับคนในบ้าน",
          },
        },
      ],
    },
  };
}
