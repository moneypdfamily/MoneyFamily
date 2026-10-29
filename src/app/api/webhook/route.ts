import { NextRequest, NextResponse } from "next/server";
import { validateSignature, WebhookEvent } from "@line/bot-sdk";
import { waitUntil } from "@vercel/functions";

import { lineClient } from "@/lib/line/client";
import { downloadLineImageAsBuffer } from "@/lib/line/content";
import { parseTransactionFromText } from "@/lib/openai/parse-transaction";
import { parseTransactionLocally } from "@/lib/openai/parse-transaction-local";
import { parseSlipWithVision } from "@/lib/ocr/parse-slip";
import {
  getUserAndDefaultGroup,
  saveTransactionToSupabase,
  deleteTransactionFromSupabase,
} from "@/lib/supabase/admin";
import {
  getGroupMembersWithProfiles,
  saveTransactionSplits,
  getGroupDebtSummary,
} from "@/lib/supabase/splits";
import {
  createTransactionConfirmationMessage,
  createSlipConfirmationMessage,
} from "@/lib/line/flex";
import {
  createSplitBillFlexMessage,
  SplitMemberState,
} from "@/lib/line/split-flex";
import { createDebtSummaryFlexMessage } from "@/lib/line/debt-summary-flex";
import { parseRecurringFromText } from "@/lib/openai/parse-recurring";
import { createRecurringTransaction } from "@/lib/supabase/recurring";
import { LIFF_ENTRY_URL, APP_URL } from "@/lib/liff/config";

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";

/**
 * ฟังก์ชันประมวลผล Webhook Event ใน Background
 * (ไม่ทำให้ LINE Webhook เกิดปัญหา Timeout)
 */
async function processEventsInBackground(events: WebhookEvent[]) {
  for (const event of events) {
    try {
      const lineUserId = event.source.userId;
      if (!lineUserId) continue;

      // ======================================================================
      // 1. ตรวจสอบสิทธิ์ผู้ใช้และกลุ่ม (User & Group Context)
      // ======================================================================
      const context = await getUserAndDefaultGroup(lineUserId);

      if (!context) {
        // ลิงก์เปิดแอป LIFF (https://liff.line.me/<liffId>) ให้ผู้ใช้ลงทะเบียน/เข้ากลุ่ม
        const registerUrl = LIFF_ENTRY_URL || APP_URL || "#";

        await lineClient.pushMessage({
          to: lineUserId,
          messages: [
            {
              type: "text",
              text: `ยินดีต้อนรับสู่ MoneyFamily! 👋\nยังไม่พบข้อมูลครอบครัวของคุณ กรุณากดลิงก์ด้านล่างเพื่อเริ่มสร้างกลุ่มหรือเข้าร่วมกลุ่ม:\n${registerUrl}`,
            },
          ],
        });
        continue;
      }

      // ======================================================================
      // 2. กรณีผู้ใช้ส่งข้อความตัวอักษรเข้ามา (Text Message)
      // ======================================================================
      if (event.type === "message" && event.message.type === "text") {
        const userText = event.message.text.trim();

        // --------------------------------------------------------------------
        // คำสั่งพิเศษ: "สรุปหนี้" / "ใครติดใคร" / "สรุปยอด"
        // --------------------------------------------------------------------
        if (
          userText === "สรุปหนี้" ||
          userText === "สรุปยอด" ||
          userText === "หนี้" ||
          userText === "ใครติดใคร"
        ) {
          const debts = await getGroupDebtSummary(context.groupId);
          const summaryFlex = createDebtSummaryFlexMessage({
            groupName: context.groupName,
            debts,
          });

          await lineClient.pushMessage({
            to: lineUserId,
            messages: [summaryFlex],
          });
          continue;
        }

        // --------------------------------------------------------------------
        // คำสั่งตั้งรายการประจำ (เช่น "Netflix 419 ทุกเดือน")
        // --------------------------------------------------------------------
        if (
          userText.includes("ทุกเดือน") ||
          userText.includes("ทุกสัปดาห์") ||
          userText.includes("ทุกวัน") ||
          userText.includes("ทุกปี") ||
          userText.includes("รายเดือน")
        ) {
          const recurringExtracted = await parseRecurringFromText(userText);
          if (recurringExtracted) {
            const created = await createRecurringTransaction({
              groupId: context.groupId,
              payerId: context.userId,
              data: recurringExtracted,
            });

            await lineClient.pushMessage({
              to: lineUserId,
              messages: [
                {
                  type: "text",
                  text: `🔔 ตั้งค่าบิลประจำเรียบร้อยแล้ว!\n\n📌 รายการ: ${created.description}\n💰 จำนวนเงิน: ฿${Number(created.amount).toLocaleString()}\n🔄 รอบบิล: ${created.frequency}\n📅 รอบถัดไป: ${created.next_run_date}\n\nเมื่อถึงกำหนด ระบบจะส่งข้อความแจ้งเตือนและบันทึกยอดให้อัตโนมัติครับ ✨`,
                },
              ],
            });
            continue;
          }
        }

        // --------------------------------------------------------------------
        // ข้อความบันทึกรายรับ-รายจ่ายทั่วไป (เช่น "กาแฟ 60 ด้วย SCB")
        // --------------------------------------------------------------------
        let extracted = await parseTransactionFromText(userText);

        // AI ใช้งานไม่ได้ (เช่น credit หมด) -> ใช้ตัวแยกข้อความพื้นฐานแทน
        if (!extracted) {
          extracted = parseTransactionLocally(userText);
          if (extracted) {
            console.warn("⚠️ ใช้ตัวแยกข้อความพื้นฐานแทน AI:", extracted.item, extracted.amount);
          }
        }

        if (!extracted) {
          await lineClient.pushMessage({
            to: lineUserId,
            messages: [
              {
                type: "text",
                text: "ขออภัยครับ ไม่สามารถเข้าใจยอดเงินหรือรายการได้ กรุณาลองพิมพ์ เช่น 'กาแฟ 60 ด้วย SCB' หรือพิมพ์ 'สรุปหนี้' เพื่อดูยอดค้างจ่าย",
              },
            ],
          });
          continue;
        }

        // สร้าง Flex Message ยืนยัน พร้อมปุ่ม Quick Reply
        const flexMessage = createTransactionConfirmationMessage({
          transaction: extracted,
          groupName: context.groupName,
        });

        // ส่งการ์ดกลับหาผู้ใช้ด้วย pushMessage
        await lineClient.pushMessage({
          to: lineUserId,
          messages: [flexMessage],
        });
      }

      // ======================================================================
      // 3. กรณีผู้ใช้ส่งรูปสลิปเข้ามา (Image Message) -> Process and Purge
      // ======================================================================
      else if (event.type === "message" && event.message.type === "image") {
        const messageId = event.message.id;

        let imageBuffer: Buffer | null = null;
        let base64Image: string | null = null;

        try {
          console.log(`\n📥 [Image Received] เริ่มดาวน์โหลดรูปภาพ ID: ${messageId}`);

          // 3.1 ดาวน์โหลดรูปภาพเก็บใน RAM Buffer เท่านั้น
          imageBuffer = await downloadLineImageAsBuffer(messageId);
          console.log(
            `🧠 [Memory Allocated] ขนาดของรูปใน Buffer: ${(
              imageBuffer.length / 1024
            ).toFixed(2)} KB`
          );

          // 3.2 แปลงเป็น Base64 และส่งต่อให้ Vision OCR
          base64Image = imageBuffer.toString("base64");
          const slipData = await parseSlipWithVision(base64Image);

          // 3.3 🧹 PROCESS & PURGE: ล้างรูปภาพออกจาก RAM ทันที
          imageBuffer.fill(0);
          imageBuffer = null;
          base64Image = null;
          console.log("🧹 [Memory Purged] ล้าง Buffer และ Memory เรียบร้อย (No Storage Used)");

          if (!slipData) {
            await lineClient.pushMessage({
              to: lineUserId,
              messages: [
                {
                  type: "text",
                  text: "❌ ไม่สามารถอ่านข้อมูลสลิปได้ชัดเจน กรุณาส่งรูปที่เห็นยอดเงินและชื่อผู้รับชัดเจนอีกครั้งครับ",
                },
              ],
            });
            continue;
          }

          // 3.4 บันทึกข้อมูลลงตาราง transactions (Supabase)
          const savedTx = await saveTransactionToSupabase({
            groupId: context.groupId,
            payerId: context.userId,
            data: {
              amount: slipData.amount,
              item: slipData.merchant,
              category: slipData.category,
              account: slipData.account,
              date: slipData.date,
              type: "expense",
            },
          });

          // 3.5 สร้างการ์ด Flex Message และส่งกลับด้วย pushMessage
          const slipFlexMessage = createSlipConfirmationMessage({
            slip: slipData,
            transactionId: savedTx.id,
            groupName: context.groupName,
          });

          await lineClient.pushMessage({
            to: lineUserId,
            messages: [slipFlexMessage],
          });
        } catch (imageError) {
          console.error("❌ Error processing slip image:", imageError);
        } finally {
          if (imageBuffer) {
            imageBuffer.fill(0);
            imageBuffer = null;
          }
          base64Image = null;
        }
      }

      // ======================================================================
      // 4. กรณีผู้ใช้กดปุ่ม Quick Reply หรือ Postback Actions
      // ======================================================================
      else if (event.type === "postback") {
        const postbackData = new URLSearchParams(event.postback.data);
        const action = postbackData.get("action");
        const rawPayload = postbackData.get("payload");
        const txId = postbackData.get("txId");

        // --------------------------------------------------------------------
        // 4.1 กดยืนยันบันทึกจากข้อความทั่วไป
        // --------------------------------------------------------------------
        if (action === "confirm" && rawPayload) {
          const payload = JSON.parse(decodeURIComponent(rawPayload));

          await saveTransactionToSupabase({
            groupId: context.groupId,
            payerId: context.userId,
            data: {
              amount: payload.a,
              item: payload.i,
              category: payload.c,
              account: payload.acc,
              date: payload.d,
              type: payload.t || "expense",
            },
          });

          await lineClient.pushMessage({
            to: lineUserId,
            messages: [
              {
                type: "text",
                text: `✅ บันทึก "${payload.i}" ยอด ฿${payload.a.toLocaleString()} ลงในกลุ่ม "${context.groupName}" เรียบร้อยแล้วครับ!`,
              },
            ],
          });
        }

        // --------------------------------------------------------------------
        // 4.2 กดยกเลิก
        // --------------------------------------------------------------------
        else if (action === "cancel") {
          await lineClient.pushMessage({
            to: lineUserId,
            messages: [
              {
                type: "text",
                text: "❌ ยกเลิกรายการเรียบร้อยแล้ว ไม่มีการบันทึกข้อมูลครับ",
              },
            ],
          });
        }

        // --------------------------------------------------------------------
        // 4.3 กดยกเลิก/ลบรายการสลิปที่บันทึกไปแล้ว
        // --------------------------------------------------------------------
        else if (action === "delete_tx" && txId) {
          await deleteTransactionFromSupabase(txId);
          await lineClient.pushMessage({
            to: lineUserId,
            messages: [
              {
                type: "text",
                text: "🗑️ ลบรายการสลิปออกจากระบบเรียบร้อยแล้วครับ",
              },
            ],
          });
        }

        // --------------------------------------------------------------------
        // 4.4 กดปุ่ม "👨‍👩‍👧‍👦 หารกับคนในบ้าน" -> แสดงหน้าจอ Split Bill Flex Message
        // --------------------------------------------------------------------
        else if (action === "open_split") {
          let transactionId = txId;
          const amount = parseFloat(postbackData.get("amount") || "0");
          const item = postbackData.get("item") || "รายการหารบิล";

          // หากเป็นรายการจาก Text ที่ยังไม่ได้สร้าง Transaction ให้บันทึกก่อน
          if (!transactionId && rawPayload) {
            const payload = JSON.parse(decodeURIComponent(rawPayload));
            const saved = await saveTransactionToSupabase({
              groupId: context.groupId,
              payerId: context.userId,
              data: {
                amount: payload.a,
                item: payload.i,
                category: payload.c,
                account: payload.acc,
                date: payload.d,
                type: payload.t || "expense",
              },
            });
            transactionId = saved.id;
          }

          if (transactionId) {
            // ดึงรายชื่อสมาชิกในกลุ่มทุกคน
            const groupMembers = await getGroupMembersWithProfiles(context.groupId);
            const memberCount = Math.max(1, groupMembers.length);
            const equalPct = Math.round(100 / memberCount);
            const equalAmt = Math.round((amount / memberCount) * 100) / 100;

            const splitStates: SplitMemberState[] = groupMembers.map((m) => ({
              userId: m.userId,
              displayName: m.displayName,
              isSelected: true,
              percentage: equalPct,
              amount: equalAmt,
            }));

            // สร้าง Split Bill Flex Message พร้อม Checkbox, 50/50, Slider
            const splitFlex = createSplitBillFlexMessage({
              transactionId,
              item,
              totalAmount: amount,
              members: splitStates,
              isEqualMode: true,
            });

            await lineClient.pushMessage({
              to: lineUserId,
              messages: [splitFlex],
            });
          }
        }

        // --------------------------------------------------------------------
        // 4.5 กดยืนยันบันทึกยอดหารบิลลงตาราง transaction_splits ใน Supabase
        // --------------------------------------------------------------------
        else if (action === "submit_split" && txId) {
          const rawSplits = postbackData.get("splits");
          if (rawSplits) {
            const parsedSplits = JSON.parse(decodeURIComponent(rawSplits));
            const formattedSplits = parsedSplits.map((s: any) => ({
              userId: s.u,
              amount: Number(s.a),
              percentage: Number(s.p),
            }));

            // บันทึกลงตาราง transaction_splits ใน Supabase
            await saveTransactionSplits({
              transactionId: txId,
              splits: formattedSplits,
            });

            await lineClient.pushMessage({
              to: lineUserId,
              messages: [
                {
                  type: "text",
                  text: `✅ บันทึกยอดหารบิลลงตาราง transaction_splits เรียบร้อยแล้วครับ!\n\n💡 สมาชิกสามารถพิมพ์ 'สรุปหนี้' ได้ทุกเมื่อ เพื่อดูยอดที่ต้องโอนคืนกันพร้อม QR Code พร้อมเพย์`,
                },
              ],
            });
          }
        }

        // --------------------------------------------------------------------
        // 4.6 ปรับสัดส่วนหรือเลือกโหมด 50/50 บน Split Bill Screen
        // --------------------------------------------------------------------
        else if (action === "set_mode" && txId) {
          const groupMembers = await getGroupMembersWithProfiles(context.groupId);
          // ส่งข้อความแนะนำหรืออัปเดตหน้าจอหารเท่ากัน
          await lineClient.pushMessage({
            to: lineUserId,
            messages: [
              {
                type: "text",
                text: "⚖️ ตั้งค่าสัดส่วนเป็นโหมด 50/50 (หารเท่ากันทุกคน) แล้วครับ คุณสามารถกด '💾 ยืนยันบันทึกยอดหารบิล' เพื่อบันทึกได้เลย",
              },
            ],
          });
        }
      }
    } catch (err) {
      console.error("❌ Background Event Processing Error:", err);
    }
  }
}

/**
 * Route Handler: POST /api/webhook
 */
export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-line-signature");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing x-line-signature header" },
        { status: 401 }
      );
    }

    const rawBody = await req.text();
    const isValid = validateSignature(
      rawBody,
      LINE_CHANNEL_SECRET,
      signature
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 403 }
      );
    }

    const body = JSON.parse(rawBody);
    const events: WebhookEvent[] = body.events || [];

    if (typeof waitUntil === "function") {
      waitUntil(processEventsInBackground(events));
    } else {
      void processEventsInBackground(events);
    }

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("❌ Webhook Fatal Error:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
