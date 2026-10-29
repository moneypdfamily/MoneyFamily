"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Liff } from "@line/liff";
import { APP_URL, LIFF_ID, LIFF_ENTRY_URL, isLiffConfigured } from "@/lib/liff/config";

/** กัน login วนซ้ำเมื่อ token ยังหมดอายุหลังขอใหม่แล้วหนึ่งครั้ง */
const RELOGIN_KEY = "liff:relogin";

export interface LineProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
}

interface LiffContextType {
  liff: Liff | null;
  isReady: boolean;
  /** เปิดอยู่ภายใน LINE In-App Browser หรือไม่ */
  isInClient: boolean;
  isLoggedIn: boolean;
  profile: LineProfile | null;
  /** ID Token (ใช้ยืนยันตัวตนกับ API ฝั่ง Server ได้) */
  idToken: string | null;
  error: string | null;
  /** ลิงก์เปิดแอปผ่าน LINE (https://liff.line.me/<liffId>) */
  liffEntryUrl: string;
  login: () => void;
  logout: () => void;
  /** ปิดหน้าต่าง LIFF กลับไปที่แชท (ใช้ได้เฉพาะใน LINE) */
  closeWindow: () => void;
}

const LiffContext = createContext<LiffContextType>({
  liff: null,
  isReady: false,
  isInClient: false,
  isLoggedIn: false,
  profile: null,
  idToken: null,
  error: null,
  liffEntryUrl: LIFF_ENTRY_URL,
  login: () => {},
  logout: () => {},
  closeWindow: () => {},
});

export const useLiff = () => useContext(LiffContext);

/**
 * แปลง error ของ LIFF SDK เป็นข้อความภาษาไทยที่แก้ไขได้จริง
 */
function describeLiffError(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message)
        : "ไม่ทราบสาเหตุ";

  if (/endpoint|redirect/i.test(raw)) {
    return `${raw} — ตรวจสอบ LIFF Endpoint URL ใน LINE Developers Console ให้ตรงกับ ${APP_URL || "โดเมนที่ deploy"} และต้องเป็น https`;
  }
  if (/liffId|invalid.*id|INVALID_ARGUMENT/i.test(raw)) {
    return `${raw} — ตรวจสอบค่า NEXT_PUBLIC_LIFF_ID (${LIFF_ID || "ยังไม่ได้ตั้งค่า"})`;
  }
  return raw;
}

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const [liffObject, setLiffObject] = useState<Liff | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isInClient, setIsInClient] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState<LineProfile | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const redirectingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function initLiff() {
      // กรณียังไม่ได้ใส่ LIFF ID จริง -> โหมด demo สำหรับพัฒนา UI
      if (!isLiffConfigured) {
        console.warn("⚠️ No NEXT_PUBLIC_LIFF_ID found. Using demo mode.");
        if (isMounted) {
          setIsReady(true);
          setIsLoggedIn(true);
          setProfile({
            userId: "U_DEMO_USER_LINE_001",
            displayName: "พ่อบ้านใจกล้า (Demo)",
            pictureUrl:
              "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
          });
        }
        return;
      }

      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: LIFF_ID });

        if (!isMounted) return;

        setLiffObject(liff);
        setIsInClient(liff.isInClient());

        if (liff.isLoggedIn()) {
          setIsLoggedIn(true);
          const [userProfile, token] = await Promise.all([
            liff.getProfile(),
            Promise.resolve(safeGetIdToken(liff)),
          ]);
          if (!isMounted) return;

          // LIFF อาจคืน ID token ที่หมดอายุแล้ว (เช่น เปิดแอปค้างไว้นาน)
          // ใน LINE ให้ login ใหม่เงียบ ๆ หนึ่งครั้งเพื่อขอ token ใหม่
          const expiresAt = token ? idTokenExpiresAt(token) : null;
          const isStale = !token || (expiresAt !== null && expiresAt - Date.now() < 60_000);
          if (isStale && liff.isInClient()) {
            const attempted = sessionStorage.getItem(RELOGIN_KEY);
            if (!attempted) {
              sessionStorage.setItem(RELOGIN_KEY, "1");
              redirectingRef.current = true;
              liff.login({ redirectUri: window.location.href });
              return;
            }
          } else if (token) {
            sessionStorage.removeItem(RELOGIN_KEY);
          }
          setProfile({
            userId: userProfile.userId,
            displayName: userProfile.displayName,
            pictureUrl: userProfile.pictureUrl,
            statusMessage: userProfile.statusMessage,
          });
          setIdToken(token);
          setIsReady(true);
        } else if (liff.isInClient()) {
          // เปิดจากแชท LINE แล้วยังไม่ login -> auto-login กลับมาที่หน้าเดิม
          redirectingRef.current = true;
          liff.login({ redirectUri: window.location.href });
        } else {
          // เปิดในเบราว์เซอร์ปกติ: ให้ผู้ใช้กดปุ่ม "เข้าสู่ระบบด้วย LINE" เอง
          setIsReady(true);
        }
      } catch (err) {
        console.error("❌ LIFF Init Error:", err);
        if (isMounted) {
          setError(describeLiffError(err));
          setIsReady(true);
        }
      }
    }

    initLiff();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = () => {
    if (!liffObject) {
      // ยัง init ไม่เสร็จ หรือ init ล้มเหลว: เปิด LIFF URL ให้ LINE จัดการ login
      if (LIFF_ENTRY_URL) window.location.href = LIFF_ENTRY_URL;
      return;
    }
    if (!liffObject.isLoggedIn()) {
      liffObject.login({ redirectUri: window.location.href });
    }
  };

  const logout = () => {
    if (!liffObject) return;
    liffObject.logout();
    setIsLoggedIn(false);
    setProfile(null);
    setIdToken(null);
  };

  const closeWindow = () => {
    if (liffObject?.isInClient()) {
      liffObject.closeWindow();
    }
  };

  return (
    <LiffContext.Provider
      value={{
        liff: liffObject,
        isReady,
        isInClient,
        isLoggedIn,
        profile,
        idToken,
        error,
        liffEntryUrl: LIFF_ENTRY_URL,
        login,
        logout,
        closeWindow,
      }}
    >
      {children}
    </LiffContext.Provider>
  );
}

function safeGetIdToken(liff: Liff): string | null {
  try {
    return liff.getIDToken();
  } catch {
    return null;
  }
}

/** อ่านเวลาหมดอายุ (exp) จาก ID token โดยไม่ต้องตรวจ signature ฝั่ง client */
function idTokenExpiresAt(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    ) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}
