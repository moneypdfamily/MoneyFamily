import { NextRequest, NextResponse } from "next/server";

import { LineAuthError, verifyLineIdToken, type LineIdentity } from "./verify";

/** อ่าน JSON body แล้วยืนยัน LINE ID token ที่แนบมาในฟิลด์ idToken */
export async function readIdentity(
  req: NextRequest
): Promise<{ body: Record<string, unknown>; identity: LineIdentity }> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new LineAuthError("invalid JSON body");

  const identity = await verifyLineIdToken(String(body.idToken ?? ""));
  return { body, identity };
}

/** แปลง error เป็น response มาตรฐาน (ห้าม cache เพราะเป็นข้อมูลส่วนตัว) */
export function errorResponse(error: unknown) {
  if (error instanceof LineAuthError) {
    // log เหตุผลไว้เพื่อวินิจฉัยจาก Vercel logs (ไม่ log ตัว token)
    console.error("❌ LIFF auth rejected:", error.message);
    return NextResponse.json({ error: "unauthorized", detail: error.message }, { status: 401 });
  }

  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status?: number }).status) || 500
      : 500;
  const message =
    error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่คาดคิด";

  console.error("❌ LIFF API error:", message);
  return NextResponse.json({ error: "request_failed", detail: message }, { status });
}

export const NO_STORE = { "Cache-Control": "no-store, max-age=0" };
