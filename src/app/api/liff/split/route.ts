import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureUser, getGroupMembers, getMembership, GroupError } from "@/lib/supabase/members";
import { errorResponse, NO_STORE, readIdentity } from "@/lib/liff/server-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/liff/split
 * body: { idToken, description, amount, memberIds?: string[], date? }
 * สร้างรายการหารบิลและแบ่งยอดเท่ากันให้สมาชิกที่เลือก
 */
export async function POST(req: NextRequest) {
  try {
    const { body, identity } = await readIdentity(req);
    const user = await ensureUser(identity);
    const group = await getMembership(user.id);

    if (!group) {
      return NextResponse.json(
        { error: "no_group", detail: "ยังไม่มีครอบครัว กรุณาสร้างหรือเข้าร่วมก่อน" },
        { status: 409, headers: NO_STORE }
      );
    }

    const description = String(body.description ?? "").trim() || "รายการหารบิล";
    const amount = Number(body.amount);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date))
      ? String(body.date)
      : new Date().toISOString().split("T")[0];

    if (!Number.isFinite(amount) || amount <= 0) throw new GroupError("จำนวนเงินต้องมากกว่า 0", 400);
    if (amount > 10_000_000) throw new GroupError("จำนวนเงินสูงเกินไป", 400);

    const allMembers = await getGroupMembers(group.id);
    if (allMembers.length === 0) throw new GroupError("ยังไม่มีสมาชิกในครอบครัว", 400);

    const requested = Array.isArray(body.memberIds) ? body.memberIds.map(String) : [];
    const selected = requested.length
      ? allMembers.filter((m) => requested.includes(m.userId))
      : allMembers;

    if (selected.length === 0) throw new GroupError("ต้องเลือกสมาชิกอย่างน้อย 1 คน", 400);

    const { data: tx, error: txError } = await supabaseAdmin
      .from("transactions")
      .insert({
        group_id: group.id,
        payer_id: user.id,
        type: "expense",
        category: String(body.category ?? "food"),
        amount,
        description,
        transaction_date: date,
        is_split: true,
      })
      .select("id")
      .single();

    if (txError || !tx) {
      throw new GroupError(`สร้างรายการหารบิลไม่สำเร็จ: ${txError?.message ?? "unknown"}`, 500);
    }

    const share = Number((amount / selected.length).toFixed(2));
    const percentage = Number((100 / selected.length).toFixed(2));

    const { error: splitError } = await supabaseAdmin.from("transaction_splits").insert(
      selected.map((member) => ({
        transaction_id: tx.id,
        user_id: member.userId,
        split_amount: share,
        split_percentage: percentage,
      }))
    );

    if (splitError) {
      // ย้อนกลับรายการที่สร้างไปแล้วเพื่อไม่ให้ข้อมูลค้างครึ่ง ๆ กลาง ๆ
      await supabaseAdmin.from("transactions").delete().eq("id", tx.id);
      throw new GroupError(`บันทึกการหารบิลไม่สำเร็จ: ${splitError.message}`, 500);
    }

    return NextResponse.json(
      {
        ok: true,
        transactionId: tx.id,
        amount,
        share,
        splits: selected.map((m) => ({ userId: m.userId, displayName: m.displayName, share })),
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
