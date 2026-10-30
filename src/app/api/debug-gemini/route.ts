import { NextRequest, NextResponse } from "next/server";
import { generateJson } from "@/lib/ai/gemini";
import { parseSlipWithVision } from "@/lib/ocr/parse-slip";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET || "moneyfamily_cron_secret_2026";

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawKey = process.env.GEMINI_API_KEY || "";
  const key = rawKey.trim();

  const keyMeta = {
    configured: Boolean(key),
    length: key.length,
    prefix: key.length > 8 ? key.slice(0, 6) + "..." + key.slice(-4) : "empty",
  };

  console.log("🔍 [Debug Gemini] Checking KeyMeta:", keyMeta);

  if (!key) {
    return NextResponse.json({
      status: "error",
      message: "GEMINI_API_KEY is not set in environment variables",
      keyMeta,
    });
  }

  const results: Record<string, unknown> = { keyMeta };

  // 1. Test generateJson function directly
  try {
    console.log("🧪 Testing generateJson()...");
    const testJson = await generateJson({
      prompt: 'Respond ONLY with JSON: {"status": "ok", "service": "gemini"}',
    });
    console.log("✅ generateJson() Succeeded:", testJson);
    results.generateJsonTest = { success: true, data: testJson };
  } catch (err: any) {
    console.error("❌ generateJson() Failed:", err);
    results.generateJsonTest = { success: false, error: err?.message || String(err), code: err?.code };
  }

  return NextResponse.json(results);
}
