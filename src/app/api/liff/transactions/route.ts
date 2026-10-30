import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureUser, getMembership, GroupError } from "@/lib/supabase/members";
import { errorResponse, NO_STORE, readIdentity } from "@/lib/liff/server-auth";

export const dynamic = "force-dynamic";

const CATEGORIES = [
  "food",
  "transport",
  "shopping",
  "housing",
  "utilities",
  "entertainment",
  "health",
  "income",
  "other",
];

/**
 * POST /api/liff/transactions
 * body: { idToken, description, amount, category, type, date }
 * บันทึกรายการจากหน้าเว็บ (จดรายจ่าย)
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

    const description = String(body.description ?? "").trim();
    const amount = Number(body.amount);
    const category = CATEGORIES.includes(String(body.category)) ? String(body.category) : "other";
    const type = body.type === "income" ? "income" : "expense";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date))
      ? String(body.date)
      : new Date().toISOString().split("T")[0];

    if (description.length < 1) throw new GroupError("ต้องระบุชื่อรายการ", 400);
    if (description.length > 120) throw new GroupError("ชื่อรายการยาวเกินไป", 400);
    if (!Number.isFinite(amount) || amount <= 0) throw new GroupError("จำนวนเงินต้องมากกว่า 0", 400);
    if (amount > 10_000_000) throw new GroupError("จำนวนเงินสูงเกินไป", 400);

    const { data, error } = await supabaseAdmin
      .from("transactions")
      .insert({
        group_id: group.id,
        payer_id: user.id,
        type,
        category,
        amount,
        description,
        transaction_date: date,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new GroupError(`บันทึกรายการไม่สำเร็จ: ${error?.message ?? "unknown"}`, 500);
    }

    return NextResponse.json({ ok: true, id: data.id }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/liff/transactions?txId=xxx
 * ลบรายการ transaction ออกจากฐานข้อมูล
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const txId = searchParams.get("txId");

    if (!txId) {
      return NextResponse.json(
        { error: "Missing txId parameter" },
        { status: 400 }
      );
    }

    const { identity } = await readIdentity(req);
    const user = await ensureUser(identity);
    const group = await getMembership(user.id);

    if (!group) {
      return NextResponse.json(
        { error: "no_group", detail: "ยังไม่มีครอบครัว" },
        { status: 409, headers: NO_STORE }
      );
    }

    const { error: deleteError } = await supabaseAdmin
      .from("transactions")
      .delete()
      .eq("id", txId)
      .eq("payer_id", user.id);

    if (deleteError) {
      console.error("❌ Failed to delete transaction:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete transaction", detail: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
