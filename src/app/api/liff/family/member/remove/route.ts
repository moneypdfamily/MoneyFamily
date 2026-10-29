import { NextRequest, NextResponse } from "next/server";

import { ensureUser, getMembership, removeGroupMember } from "@/lib/supabase/members";
import { errorResponse, NO_STORE, readIdentity } from "@/lib/liff/server-auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/liff/family/member/remove
 * body: { idToken, userId }
 * ลบสมาชิกออกจากครอบครัว — เฉพาะเจ้าของ (owner) และลบตัวเองไม่ได้
 */
export async function POST(req: NextRequest) {
  try {
    const { body, identity } = await readIdentity(req);
    const user = await ensureUser(identity);
    const group = await getMembership(user.id);

    if (!group) {
      return NextResponse.json({ error: "no_group" }, { status: 409, headers: NO_STORE });
    }
    if (group.role !== "owner") {
      return NextResponse.json(
        { error: "forbidden", detail: "เฉพาะเจ้าของครอบครัวเท่านั้นที่ลบสมาชิกได้" },
        { status: 403, headers: NO_STORE }
      );
    }

    const targetUserId = String(body.userId ?? "");
    if (!targetUserId) {
      return NextResponse.json(
        { error: "invalid_request", detail: "ต้องระบุ userId ของสมาชิก" },
        { status: 400, headers: NO_STORE }
      );
    }
    if (targetUserId === user.id) {
      return NextResponse.json(
        { error: "invalid_request", detail: "ลบตัวเองออกจากครอบครัวไม่ได้" },
        { status: 400, headers: NO_STORE }
      );
    }

    await removeGroupMember({ groupId: group.id, userId: targetUserId });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
