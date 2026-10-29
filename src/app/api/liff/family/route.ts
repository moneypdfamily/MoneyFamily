import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureUser,
  getGroupMembers,
  getMembership,
  renameFamilyGroup,
} from "@/lib/supabase/members";
import { errorResponse, NO_STORE, readIdentity } from "@/lib/liff/server-auth";

export const dynamic = "force-dynamic";

interface WalletSummary {
  income: number;
  expense: number;
  balance: number;
  count: number;
}

export interface RecentTransaction {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: string;
  transaction_date: string;
  is_split: boolean;
  payerName: string;
}

async function getRecentTransactions(groupId: string): Promise<RecentTransaction[]> {
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select(
      "id, description, category, amount, type, transaction_date, is_split, payer:payer_id (display_name)"
    )
    .eq("group_id", groupId)
    .order("transaction_date", { ascending: false })
    .limit(30);

  if (error || !data) {
    console.error("❌ อ่านรายการล่าสุดไม่สำเร็จ:", error);
    return [];
  }

  return (data as any[]).map((row) => {
    const payer = Array.isArray(row.payer) ? row.payer[0] : row.payer;
    return {
      id: row.id as string,
      description: (row.description as string) || "รายการ",
      category: (row.category as string) || "other",
      amount: Number(row.amount ?? 0),
      type: (row.type as string) || "expense",
      transaction_date: (row.transaction_date as string) || "",
      is_split: Boolean(row.is_split),
      payerName: (payer?.display_name as string) || "สมาชิก",
    };
  });
}

async function getWalletSummary(groupId: string): Promise<WalletSummary> {
  const { data, error } = await supabaseAdmin
    .from("transactions")
    .select("type, amount")
    .eq("group_id", groupId);

  if (error || !data) return { income: 0, expense: 0, balance: 0, count: 0 };

  let income = 0;
  let expense = 0;
  for (const row of data as Array<{ type: string | null; amount: number | string | null }>) {
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (row.type === "income") income += amount;
    else if (row.type === "expense") expense += amount;
  }

  return { income, expense, balance: income - expense, count: data.length };
}

/**
 * POST /api/liff/family
 * body: { idToken }
 * คืนข้อมูลครอบครัว + สมาชิก + สรุปกระเป๋า สำหรับหน้าจัดการ
 */
export async function POST(req: NextRequest) {
  try {
    const { identity } = await readIdentity(req);
    const user = await ensureUser(identity);
    const group = await getMembership(user.id);

    if (!group) {
      return NextResponse.json(
      { group: null, members: [], wallet: null, transactions: [] },
      { headers: NO_STORE }
    );
    }

    const [members, wallet, transactions] = await Promise.all([
      getGroupMembers(group.id),
      getWalletSummary(group.id),
      getRecentTransactions(group.id),
    ]);

    return NextResponse.json(
      {
        group,
        me: { userId: user.id, displayName: user.displayName },
        members,
        wallet,
        transactions,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PATCH /api/liff/family
 * body: { idToken, name }
 * เปลี่ยนชื่อครอบครัว — เฉพาะเจ้าของ (owner)
 */
export async function PATCH(req: NextRequest) {
  try {
    const { body, identity } = await readIdentity(req);
    const user = await ensureUser(identity);
    const group = await getMembership(user.id);

    if (!group) {
      return NextResponse.json({ error: "no_group" }, { status: 409, headers: NO_STORE });
    }
    if (group.role !== "owner") {
      return NextResponse.json(
        { error: "forbidden", detail: "เฉพาะเจ้าของครอบครัวเท่านั้นที่เปลี่ยนชื่อได้" },
        { status: 403, headers: NO_STORE }
      );
    }

    const name = await renameFamilyGroup({ groupId: group.id, name: String(body.name ?? "") });
    return NextResponse.json({ group: { ...group, name } }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
