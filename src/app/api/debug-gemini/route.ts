import { NextRequest, NextResponse } from "next/server";

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

  if (!key) {
    return NextResponse.json({
      status: "error",
      message: "GEMINI_API_KEY is not set in environment variables",
      keyMeta,
    });
  }

  const results: Record<string, unknown> = { keyMeta };

  // 1. Test GET /v1beta/models?key=...
  for (const apiVersion of ["v1beta", "v1"]) {
    try {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        headers: { "x-goog-api-key": key },
      });
      const body = await res.json().catch((e) => ({ parse_err: String(e) }));
      results[`models_${apiVersion}`] = {
        status: res.status,
        statusText: res.statusText,
        body,
      };
    } catch (err: any) {
      results[`models_${apiVersion}`] = { error: err?.message || String(err) };
    }
  }

  // 2. Test generateContent on several candidate models
  const testModels = [
    { version: "v1beta", model: "gemini-1.5-flash" },
    { version: "v1beta", model: "gemini-2.0-flash" },
    { version: "v1beta", model: "gemini-2.5-flash" },
    { version: "v1beta", model: "gemini-1.5-pro" },
    { version: "v1", model: "gemini-1.5-flash" },
  ];

  const generateTests: Record<string, unknown> = {};

  for (const t of testModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/${t.version}/models/${t.model}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Respond ONLY with JSON: {\"status\": \"ok\"}" }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      });

      const body = await res.json().catch((e) => ({ parse_err: String(e) }));
      generateTests[`${t.version}/${t.model}`] = {
        status: res.status,
        statusText: res.statusText,
        body,
      };
    } catch (err: any) {
      generateTests[`${t.version}/${t.model}`] = { error: err?.message || String(err) };
    }
  }

  results.generateTests = generateTests;

  return NextResponse.json(results);
}
