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
      return NextResponse.json({ group: null, members: [], wallet: null }, { headers: NO_STORE });
    }

    const [members, wallet] = await Promise.all([
      getGroupMembers(group.id),
      getWalletSummary(group.id),
    ]);

    return NextResponse.json(
      {
        group,
        me: { userId: user.id, displayName: user.displayName },
        members,
        wallet,
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
