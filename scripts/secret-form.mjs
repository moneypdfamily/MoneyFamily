#!/usr/bin/env node
/**
 * หน้าเว็บในเครื่องสำหรับวาง LINE Channel secret โดยไม่ต้องสร้างไฟล์เอง
 * และไม่ให้ค่า secret ผ่าน chat หรือ shell history
 *
 *   node scripts/secret-form.mjs
 *   เปิด http://127.0.0.1:4599
 *
 * เมื่อค่าวางแล้ว ระบบจะตรวจกับ Messaging API channel ของ bot ก่อน
 * ถ้าตรงจะเขียน .line-secret-candidate ให้ตัว apply-line-secret ทำงานต่อทันที
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseEnvFile } from "./lib/env-file.mjs";

const PORT = Number(process.env.SECRET_FORM_PORT || 4599);
const CANDIDATE = ".line-secret-candidate";
const LOG = ".line-apply-run.log";

const env = parseEnvFile(readFileSync(".env.local", "utf8"));
const token = env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
const sha = (v) => createHash("sha256").update(v).digest("hex").slice(0, 12);

function normalize(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .join("")
    .replace(/^LINE_CHANNEL_SECRET=/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

async function botChannelId() {
  const res = await fetch("https://api.line.me/v2/oauth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token }),
  });
  if (!res.ok) return "";
  return (await res.json()).client_id || "";
}

async function matches(secret, channelId) {
  const res = await fetch("https://api.line.me/v2/oauth/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: channelId,
      client_secret: secret,
    }),
  });
  return res.ok;
}

function page(message = "", tone = "") {
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>วาง LINE Channel secret</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 560px; margin: 32px auto; padding: 0 16px; line-height: 1.6; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  p.hint { color: #666; font-size: 14px; }
  label { display: block; font-weight: 600; margin: 20px 0 6px; font-size: 14px; }
  input { width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #bbb; border-radius: 8px; box-sizing: border-box; font-family: ui-monospace, monospace; }
  button { margin-top: 12px; width: 100%; padding: 11px; font-size: 15px; font-weight: 600; border: 0; border-radius: 8px; background: #1b2a4a; color: #fff; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  .msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 14px; white-space: pre-wrap; }
  .ok { background: #e6f7ec; color: #10643a; }
  .bad { background: #fdeaea; color: #8c1d1d; }
  .info { background: #eef2ff; color: #1f2f66; }
  pre { background: rgba(127,127,127,.12); padding: 12px; border-radius: 8px; font-size: 12px; overflow: auto; max-height: 180px; }
  .steps { font-size: 14px; background: rgba(127,127,127,.10); padding: 12px 16px; border-radius: 8px; }
  .steps a { color: inherit; }
</style></head>
<body>
  <h1>วาง LINE Channel secret</h1>
  <p class="hint">ค่านี้จะไม่ถูกแสดงในแชท ไม่ถูกเก็บใน shell history และไม่ถูก log</p>

  <div class="steps">
    เอามาจาก <a href="https://developers.line.biz/console/channel/2012284760/basics" target="_blank" rel="noreferrer">Channel <b>2012284760</b> → Basic settings → Channel secret</a>
    (ต้องเป็นแท็บที่หัวหน้าขึ้น Channel ID <b>2012284760</b>, ชื่อ MoneyFamily, Basic ID @848vebvr)
  </div>

  <form id="f">
    <label for="s">Channel secret (32 ตัว)</label>
    <input id="s" name="s" type="password" autocomplete="off" spellcheck="false" placeholder="วางที่นี่" autofocus>
    <button id="b" type="submit">ตรวจสอบและใช้งาน</button>
  </form>

  <div id="m" class="msg ${tone}">${message}</div>
  <h3 style="font-size:14px;margin-top:24px">สถานะล่าสุด</h3>
  <pre id="log">—</pre>

<script>
const f = document.getElementById('f'), s = document.getElementById('s'),
      b = document.getElementById('b'), m = document.getElementById('m'), lg = document.getElementById('log');

async function refreshLog() {
  try {
    const r = await fetch('/status');
    const t = await r.text();
    lg.textContent = t || '—';
  } catch {}
}
setInterval(refreshLog, 3000); refreshLog();

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  b.disabled = true;
  m.className = 'msg info'; m.textContent = 'กำลังตรวจกับ LINE …';
  try {
    const r = await fetch('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: s.value }) });
    const d = await r.json();
    m.className = 'msg ' + (d.ok ? 'ok' : 'bad');
    m.textContent = d.message;
    if (d.ok) { s.value = ''; refreshLog(); }
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

  if (req.method === "GET" && req.url === "/") return send(200, "text/html; charset=utf-8", page());
  if (req.method === "GET" && req.url === "/status") {
    if (!existsSync(LOG)) return send(200, "text/plain; charset=utf-8", "ยังไม่มี log");
    return send(200, "text/plain; charset=utf-8", readFileSync(LOG, "utf8").split("\n").filter(Boolean).slice(-12).join("\n"));
  }

  if (req.method === "POST" && req.url === "/save") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let secret = "";
    try {
      secret = normalize(JSON.parse(body).secret);
    } catch {
      return send(400, "application/json", JSON.stringify({ ok: false, message: "ข้อมูลไม่ถูกต้อง" }));
    }
    if (secret.length < 16) {
      return send(200, "application/json", JSON.stringify({ ok: false, message: `ค่ายาว ${secret.length} ตัว — ต้องเป็น 32 ตัว ลองคัดลอกใหม่` }));
    }

    const channelId = await botChannelId();
    if (!channelId) {
      return send(200, "application/json", JSON.stringify({ ok: false, message: "อ่าน channel ID ของบอทไม่ได้ — ตรวจ LINE_CHANNEL_ACCESS_TOKEN" }));
    }
    if (!(await matches(secret, channelId))) {
      return send(200, "application/json", JSON.stringify({
        ok: false,
        message: `ค่านี้ยังไม่ตรงกับ Messaging API channel ${channelId}\n(น่าจะเป็น secret ของ LINE Login channel — เปิดหน้า Basic settings ของ channel ${channelId} แล้วคัดลอกช่อง Channel secret)`,
      }));
    }

    writeFileSync(CANDIDATE, secret);
    return send(200, "application/json", JSON.stringify({
      ok: true,
      message: `ตรงกับ channel ${channelId} (sha ${sha(secret)}) — ระบบกำลังเขียน .env.local, อัปเดต Vercel และ redeploy ให้ ดูสถานะด้านล่าง`,
    }));
  }

  return send(404, "text/plain", "not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`secret form: http://127.0.0.1:${PORT}`);
});
