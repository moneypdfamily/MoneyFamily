#!/usr/bin/env node
/**
 * หน้าเว็บในเครื่องสำหรับเพิ่ม/เปลี่ยน Environment Variable
 * ตรวจค่ากับผู้ให้บริการจริงก่อน แล้วจึงเขียน .env.local → Vercel → redeploy
 *
 *   node scripts/env-form.mjs
 *   เปิด http://127.0.0.1:4600
 *
 * ไม่พิมพ์ค่า secret ออกมา และไม่เก็บลง log
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { parseEnvFile } from "./lib/env-file.mjs";

const PORT = Number(process.env.ENV_FORM_PORT || 4600);
const LOG = ".env-apply.log";
const NAME_RE = /^[A-Z][A-Z0-9_]{2,63}$/;

const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(LOG, `${line}\n`);
  console.log(msg);
};

function readEnvLocal() {
  return existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
}

function upsertEnvLocal(name, value) {
  const text = readEnvLocal();
  const re = new RegExp(`^${name}=.*$`, "m");
  const next = re.test(text)
    ? text.replace(re, `${name}=${value}`)
    : `${text.replace(/\s*$/, "")}\n${name}=${value}\n`;
  writeFileSync(".env.local", next);
}

async function verifyGemini(value) {
  const model = process.env.GEMINI_MODEL && !process.env.GEMINI_MODEL.includes("2.5")
    ? process.env.GEMINI_MODEL
    : "gemini-1.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": value },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ตอบ JSON {"ok":true}' }] }] }),
    }
  );
  const body = await res.text();
  if (res.ok) return { ok: true, message: "Gemini ใช้งานได้" };
  if (res.status === 429) return { ok: true, message: "key ใช้ได้ แต่ตอนนี้ติด rate limit (429) — ยังบันทึกได้" };
  return { ok: false, message: `Gemini ปฏิเสธ key (HTTP ${res.status}): ${body.slice(0, 160)}` };
}

async function verifyOpenAI(value) {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${value}` },
  });
  if (res.ok) return { ok: true, message: "OpenAI key ใช้งานได้" };
  return { ok: false, message: `OpenAI ปฏิเสธ key (HTTP ${res.status})` };
}

async function verifyLineSecret(value) {
  const env = parseEnvFile(readEnvLocal());
  const token = env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
  const v = await fetch("https://api.line.me/v2/oauth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token }),
  });
  if (!v.ok) return { ok: false, message: "อ่าน channel ID ของบอทไม่ได้" };
  const channelId = (await v.json()).client_id;
  const r = await fetch("https://api.line.me/v2/oauth/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: channelId, client_secret: value }),
  });
  return r.ok
    ? { ok: true, message: `ตรงกับ Messaging API channel ${channelId}` }
    : { ok: false, message: `ไม่ตรงกับ Messaging API channel ${channelId}` };
}

async function verify(name, value) {
  if (name === "GEMINI_API_KEY") return verifyGemini(value);
  if (name === "OPENAI_API_KEY") return verifyOpenAI(value);
  if (name === "LINE_CHANNEL_SECRET") return verifyLineSecret(value);
  return { ok: true, message: "ไม่มีตัวตรวจสำหรับ key นี้ — บันทึกตามที่กรอก" };
}

function run(cmd, args, input) {
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
  if (input !== undefined) child.stdin.write(input);
  child.stdin.end();

  let out = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (out += d.toString()));
  return new Promise((resolve) => child.on("close", (code) => resolve({ code, out })));
}

async function applyToVercel(name, value) {
  log(`⬆️  อัปเดต ${name} บน Vercel (Production)…`);
  await run("vercel", ["env", "rm", name, "production", "--yes"]);
  const add = await run("vercel", ["env", "add", name, "production"], `${value}\n`);
  if (add.code !== 0) {
    const safe = add.out.split("\n").filter((l) => l && !l.includes(value)).slice(0, 3).join(" | ");
    log(`⚠️  vercel env add ล้มเหลว: ${safe}`);
  } else {
    log(`✅ ตั้งค่า ${name} บน Vercel แล้ว`);
  }

  log("🚀 Deploy production…");
  const deploy = await run("vercel", ["--prod", "--yes", "--no-color"]);
  log(deploy.code === 0 ? "✅ deploy สำเร็จ" : `❌ deploy ล้มเหลว (exit ${deploy.code})`);
}

function page(message = "", tone = "") {
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ตั้งค่า Environment Variable</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 560px; margin: 32px auto; padding: 0 16px; line-height: 1.6; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p.hint { color: #666; font-size: 14px; }
  label { display: block; font-weight: 600; margin: 16px 0 6px; font-size: 14px; }
  input, select { width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #bbb; border-radius: 8px; box-sizing: border-box; }
  input { font-family: ui-monospace, monospace; }
  button { margin-top: 14px; width: 100%; padding: 11px; font-size: 15px; font-weight: 600; border: 0; border-radius: 8px; background: #1b2a4a; color: #fff; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  .msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 14px; white-space: pre-wrap; }
  .ok { background: #e6f7ec; color: #10643a; }
  .bad { background: #fdeaea; color: #8c1d1d; }
  .info { background: #eef2ff; color: #1f2f66; }
  pre { background: rgba(127,127,127,.12); padding: 12px; border-radius: 8px; font-size: 12px; overflow: auto; max-height: 200px; }
  .steps { font-size: 14px; background: rgba(127,127,127,.10); padding: 12px 16px; border-radius: 8px; }
  .steps a { color: inherit; }
</style></head>
<body>
  <h1>ตั้งค่า Environment Variable</h1>
  <p class="hint">ค่าจะไม่ถูกแสดงในแชท ไม่ลง shell history และไม่ถูก log</p>

  <div class="steps">
    ขอ Gemini key ฟรีได้ที่ <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>
    — เมื่อบันทึกแล้วระบบจะตรวจกับ Google, เขียนลง <code>.env.local</code>, อัปเดต Vercel และ redeploy ให้อัตโนมัติ
  </div>

  <form id="f">
    <label for="n">ชื่อตัวแปร</label>
    <input id="n" name="n" list="names" value="GEMINI_API_KEY" autocomplete="off" spellcheck="false">
    <datalist id="names">
      <option value="GEMINI_API_KEY"></option>
      <option value="OPENAI_API_KEY"></option>
      <option value="GEMINI_MODEL"></option>
      <option value="LINE_CHANNEL_SECRET"></option>
    </datalist>

    <label for="v">ค่า</label>
    <input id="v" name="v" type="password" autocomplete="off" spellcheck="false" placeholder="วางค่าที่นี่">

    <button id="b" type="submit">ตรวจสอบและใช้งาน</button>
  </form>

  <div id="m" class="msg ${tone}">${message}</div>
  <h3 style="font-size:14px;margin-top:24px">สถานะการ deploy</h3>
  <pre id="log">—</pre>

<script>
const f = document.getElementById('f'), n = document.getElementById('n'), v = document.getElementById('v'),
      b = document.getElementById('b'), m = document.getElementById('m'), lg = document.getElementById('log');

async function refreshLog() {
  try { lg.textContent = (await (await fetch('/status')).text()) || '—'; } catch {}
}
setInterval(refreshLog, 3000); refreshLog();

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  b.disabled = true;
  m.className = 'msg info'; m.textContent = 'กำลังตรวจสอบค่ากับผู้ให้บริการ…';
  try {
    const r = await fetch('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: n.value, value: v.value }) });
    const d = await r.json();
    m.className = 'msg ' + (d.ok ? 'ok' : 'bad');
    m.textContent = d.message;
    if (d.ok) { v.value = ''; refreshLog(); }
  } catch (err) {
    m.className = 'msg bad'; m.textContent = 'ติดต่อเซิร์ฟเวอร์ไม่ได้: ' + err;
  } finally { b.disabled = false; }
});
</script>
</body></html>`;
}

const server = createServer(async (req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  const json = (code, payload) => send(code, "application/json", JSON.stringify(payload));

  if (req.method === "GET" && req.url === "/") return send(200, "text/html; charset=utf-8", page());
  if (req.method === "GET" && req.url === "/status") {
    if (!existsSync(LOG)) return send(200, "text/plain; charset=utf-8", "ยังไม่มี log");
    return send(200, "text/plain; charset=utf-8", readFileSync(LOG, "utf8").split("\n").filter(Boolean).slice(-12).join("\n"));
  }

  if (req.method === "POST" && req.url === "/save") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let name = "";
    let value = "";
    try {
      const parsed = JSON.parse(raw);
      name = String(parsed.name || "").trim().toUpperCase();
      value = String(parsed.value || "").trim();
    } catch {
      return json(400, { ok: false, message: "ข้อมูลไม่ถูกต้อง" });
    }

    if (!NAME_RE.test(name)) return json(200, { ok: false, message: "ชื่อตัวแปรต้องเป็น A-Z, 0-9, _ และเริ่มด้วยตัวอักษร" });
    if (value.length < 6) return json(200, { ok: false, message: "ค่ายาวเกินไปสั้น — ตรวจการคัดลอกอีกครั้ง" });
    if (/\s/.test(value)) return json(200, { ok: false, message: "ค่ามีช่องว่าง/ขึ้นบรรทัดใหม่ — คัดลอกใหม่ให้ติดกัน" });

    const check = await verify(name, value);
    if (!check.ok) return json(200, { ok: false, message: check.message });

    upsertEnvLocal(name, value);
    log(`✅ ตรวจผ่าน: ${name} (${check.message}) → เขียน .env.local แล้ว`);
    void applyToVercel(name, value);

    return json(200, {
      ok: true,
      message: `${check.message}\nเขียนลง .env.local แล้ว — กำลังอัปเดต Vercel และ redeploy ให้ (ดูสถานะด้านล่าง ~1 นาที)`,
    });
  }

  return send(404, "text/plain", "not found");
});

server.listen(PORT, "127.0.0.1", () => console.log(`env form: http://127.0.0.1:${PORT}`));
