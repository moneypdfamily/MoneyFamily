import type { ExtractedTransaction } from "@/lib/openai/parse-transaction";

/**
 * แยกข้อความบันทึกรายจ่ายแบบพื้นฐาน โดยไม่เรียก AI
 * ใช้เป็น fallback เมื่อ OpenAI ใช้งานไม่ได้ (เช่น credit หมด/เน็ตขัดข้อง)
 * รองรับรูปแบบที่พบบ่อย เช่น "กาแฟ 60", "ข้าวผัด 45 บาท ด้วย SCB", "เงินเดือน 30000"
 */
export function parseTransactionLocally(
  text: string,
  currentDate: string = new Date().toISOString().split("T")[0]
): ExtractedTransaction | null {
  const raw = text.trim();
  if (!raw) return null;

  // แปลงเลขไทยเป็นเลขอารบิก แล้วตัด comma ในตัวเลข
  const normalized = raw
    .replace(/[๐-๙]/g, (d) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(d)))
    .replace(/(\d),(?=\d{3})/g, "$1");

  const amount = extractAmount(normalized);
  if (!amount || amount.value <= 0) return null;

  const account = matchAccount(normalized);
  const item = extractItem(normalized, amount.rawToken, account);
  if (!item) return null;

  return {
    amount: amount.value,
    item,
    account,
    category: matchCategory(normalized),
    date: matchDate(normalized, currentDate),
    type: /เงินเดือน|รายรับ|โอนเข้า|ได้รับเงิน|ขายได้|เงินเข้า/.test(normalized)
      ? "income"
      : "expense",
  };
}

/** หาจำนวนเงิน: เลือกตัวเลขที่ตามด้วยหน่วยบาท/฿ ก่อน ถ้าไม่มีให้ใช้ตัวเลขสุดท้าย */
function extractAmount(text: string): { value: number; rawToken: string } | null {
  const withUnit = text.match(/(-?\d+(?:\.\d+)?)\s*(?:บาท|฿|thb|บ\.)/i);
  if (withUnit) {
    const value = Number(withUnit[1]);
    if (Number.isFinite(value) && value > 0) {
      return { value, rawToken: withUnit[0] };
    }
  }

  const all = [...text.matchAll(/\d+(?:\.\d+)?/g)].filter((m) => {
    const start = m.index ?? 0;
    const nextChar = text.slice(start + m[0].length).trimStart()[0] ?? "";
    // ข้ามตัวเลขที่เป็นวันที่ (เช่น 2026-10-30) หรือเวลาที่มี ":"
    return nextChar !== ":" && nextChar !== "-" && nextChar !== "/";
  });

  const last = all[all.length - 1];
  if (!last) return null;
  const value = Number(last[0]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, rawToken: last[0] };
}

/** เอาเฉพาะชื่อรายการ โดยตัดจำนวนเงิน บัญชี และคำบอกเวลา/คำเชื่อมออก */
function extractItem(text: string, amountToken: string, account: string | null): string {
  let item = text.replace(amountToken, " ");
  if (account) {
    item = item.replace(new RegExp(escapeRegex(account), "i"), " ");
  }
  item = item
    .replace(/(?:บาท|฿|thb|บ\.)/gi, " ")
    .replace(/เมื่อวานซืน|เมื่อวานนี้|เมื่อวาน|วันนี้|วันก่อน/g, " ")
    .replace(/(?:ด้วย|ผ่าน)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!item) return "";
  return item.length > 60 ? item.slice(0, 60).trim() : item;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchAccount(text: string): string | null {
  const map: Array<[RegExp, string]> = [
    [/scb|ไทยพาณิชย์/i, "SCB"],
    [/kbank|กสิกร/i, "KBank"],
    [/bbl|กรุงเทพ/i, "BBL"],
    [/ktb|krungthai|กรุงไทย/i, "Krungthai"],
    [/ttb|ทหารไทย|ธนชาต/i, "TTB"],
    [/bay|กรุงศรี/i, "Krungsri"],
    [/promptpay|พร้อมเพย์/i, "PromptPay"],
    [/truemoney|ทรูมันนี่/i, "TrueMoney"],
    [/บัตรเครดิต|credit/i, "บัตรเครดิต"],
    [/เงินสด|cash/i, "เงินสด"],
  ];
  const found = map.find(([re]) => re.test(text));
  return found ? found[1] : null;
}

function matchCategory(text: string): ExtractedTransaction["category"] {
  const rules: Array<[RegExp, ExtractedTransaction["category"]]> = [
    [/เงินเดือน|รายรับ|โอนเข้า|ได้รับเงิน|ขายได้/, "income"],
    [/น้ำมัน|bts|mrt|แท็กซี่|รถ|วิน|ค่าโดยสาร|ที่จอด/, "transport"],
    [/กาแฟ|ข้าว|อาหาร|ชา|ขนม|ร้าน|คาเฟ่|หมูกระทะ|บุฟเฟ่ต์|ส้มตำ|ก๋วยเตี๋ยว|น้ำดื่ม|น้ำเปล่า|เครื่องดื่ม/, "food"],
    [/ช้อปปิ้ง|ของใช้|เสื้อผ้า|ซื้อของ|บิ๊กซี|โลตัส|เซเว่น|7-11/, "shopping"],
    [/ค่าเช่า|บ้าน|คอนโด|ผ่อนบ้าน/, "housing"],
    [/ค่าน้ำ|ค่าไฟ|เน็ต|มือถือ|โทรศัพท์|แอร์/, "utilities"],
    [/หนัง|เกม|เที่ยว|คอนเสิร์ต|ทริป/, "entertainment"],
    [/ยา|หมอ|โรงพยาบาล|คลินิก|สุขภาพ/, "health"],
  ];
  const found = rules.find(([re]) => re.test(text));
  return found ? found[1] : "other";
}

function matchDate(text: string, currentDate: string): string {
  const base = new Date(`${currentDate}T00:00:00Z`);
  const shift = (days: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().split("T")[0];
  };
  if (/เมื่อวานซืน/.test(text)) return shift(2);
  if (/เมื่อวาน/.test(text)) return shift(1);
  return currentDate;
}
