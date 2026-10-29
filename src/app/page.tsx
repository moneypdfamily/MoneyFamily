"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  LogIn,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Users,
  X,
} from "lucide-react";

import { useLiff } from "@/features/liff/liff-context";
import { SummaryCards } from "@/features/dashboard/summary-cards";
import { ExpenseChart, MonthlyChartData } from "@/features/dashboard/expense-chart";
import { TransactionTable, TransactionItem } from "@/features/dashboard/transaction-table";
import { LiffOnboarding, type OnboardingGroup } from "@/features/liff/onboarding";

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function buildChartData(transactions: TransactionItem[]): MonthlyChartData[] {
  const buckets = new Map<string, { income: number; expense: number }>();

  for (const tx of transactions) {
    const key = (tx.transaction_date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const bucket = buckets.get(key) ?? { income: 0, expense: 0 };
    if (tx.type === "income") bucket.income += tx.amount;
    else bucket.expense += tx.amount;
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-4)
    .map(([key, value]) => ({
      month: THAI_MONTHS[Number(key.slice(5, 7)) - 1] ?? key,
      income: value.income,
      expense: value.expense,
    }));
}

export default function DashboardPage() {
  const {
    profile,
    isLoggedIn,
    isReady,
    isInClient,
    idToken,
    error: liffError,
    liffEntryUrl,
    login,
    refreshToken,
    relogin,
    closeWindow,
  } = useLiff();

  const [isErrorDismissed, setIsErrorDismissed] = useState(false);
  const [group, setGroup] = useState<OnboardingGroup | null>(null);
  const [sessionStatus, setSessionStatus] = useState<
    "idle" | "loading" | "ready" | "needs-group" | "error"
  >("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [incomeTotal, setIncomeTotal] = useState(0);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  /** โหลดข้อมูลครอบครัว + รายการจริงจาก API (ไม่มีข้อมูลตัวอย่างแล้ว) */
  const loadDashboardData = useCallback(async () => {
    if (!idToken) {
      setTransactions([]);
      setIncomeTotal(0);
      setExpenseTotal(0);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch("/api/liff/family", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail = String(data?.detail || data?.error || "ไม่ทราบสาเหตุ");
        if (res.status === 401 && /expired/i.test(detail)) {
          refreshToken();
          return;
        }
        console.error("❌ โหลดข้อมูลครอบครัวไม่สำเร็จ:", detail);
        setTransactions([]);
        return;
      }

      const rows: TransactionItem[] = (data.transactions ?? []).map((row: any) => ({
        id: String(row.id),
        description: String(row.description ?? "รายการ"),
        category: String(row.category ?? "other"),
        amount: Number(row.amount ?? 0),
        type: row.type === "income" ? "income" : "expense",
        transaction_date: String(row.transaction_date ?? ""),
        is_split: Boolean(row.is_split),
        payer_name: String(row.payerName ?? "สมาชิก"),
      }));

      setTransactions(rows);
      setIncomeTotal(Number(data.wallet?.income ?? 0));
      setExpenseTotal(Number(data.wallet?.expense ?? 0));

      if (data.group) {
        setGroup({
          id: data.group.id,
          name: data.group.name,
          inviteCode: data.group.inviteCode,
          role: data.group.role ?? null,
        });
      }
    } catch (err) {
      console.error("❌ โหลดข้อมูลไม่สำเร็จ:", err);
      setTransactions([]);
    } finally {
      setIsLoading(false);
    }
  }, [idToken, refreshToken]);

  // ตรวจว่าผู้ใช้ LINE คนนี้ลงทะเบียนและมีครอบครัวแล้วหรือยัง
  useEffect(() => {
    if (!idToken) {
      setSessionStatus("ready");
      return;
    }

    let cancelled = false;
    setSessionStatus("loading");

    (async () => {
      try {
        const res = await fetch("/api/liff/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          const detail = String(data?.detail || data?.error || "ไม่ทราบสาเหตุ");
          if (res.status === 401 && /expired/i.test(detail) && refreshToken()) {
            return;
          }
          setSessionError(`HTTP ${res.status} — ${detail}`);
          setSessionStatus("error");
          return;
        }

        setSessionError(null);
        if (data.group) {
          setGroup(data.group as OnboardingGroup);
          setSessionStatus("ready");
        } else {
          setSessionStatus("needs-group");
        }
      } catch (err) {
        console.error("❌ Failed to load LIFF session:", err);
        if (!cancelled) {
          setSessionError(err instanceof Error ? err.message : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
          setSessionStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idToken, refreshToken]);

  // โหลดรายการจริงเมื่อพร้อม
  useEffect(() => {
    if (sessionStatus === "ready") loadDashboardData();
  }, [sessionStatus, loadDashboardData]);

  if (sessionStatus === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3 text-navy-900">
          <div className="w-10 h-10 rounded-full border-2 border-brand-amber border-t-transparent animate-spin" />
          <p className="text-xs font-medium text-slate-600">กำลังเชื่อมต่อบัญชี LINE…</p>
        </div>
      </main>
    );
  }

  if (sessionStatus === "needs-group" && idToken) {
    return (
      <LiffOnboarding
        idToken={idToken}
        displayName={profile?.displayName || "สมาชิก"}
        onReady={(created) => {
          setGroup(created);
          setSessionStatus("ready");
        }}
      />
    );
  }

  const chartData = buildChartData(transactions);

  return (
    <main className="min-h-screen pb-24 md:pb-12 bg-slate-50">
      {/* 1. Header */}
      <header className="bg-navy-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-amber to-brand-yellow flex items-center justify-center shadow-md shadow-amber-500/20 text-navy-950 font-black text-lg">
              M
            </div>
            <div>
              <h1 className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                MoneyFamily
                <span className="text-[10px] bg-brand-orange text-white px-1.5 py-0.2 rounded font-semibold">
                  PWA
                </span>
              </h1>
              <p className="text-[11px] text-navy-300">กระเป๋าเงินครอบครัว</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isReady && isLoggedIn && profile ? (
              <div className="flex items-center gap-2">
                {profile.pictureUrl ? (
                  <img
                    src={profile.pictureUrl}
                    alt={profile.displayName}
                    className="w-8 h-8 rounded-full border-2 border-brand-amber object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-brand-amber/30 text-brand-yellow flex items-center justify-center text-xs font-bold">
                    {profile.displayName.slice(0, 1)}
                  </div>
                )}
                <span className="text-xs font-medium text-slate-200 hidden sm:inline">
                  {profile.displayName}
                </span>
              </div>
            ) : (
              <button
                onClick={login}
                className="flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors shadow-sm"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>เข้าสู่ระบบด้วย LINE</span>
              </button>
            )}

            <Link
              href="/settings"
              title="จัดการกระเป๋าและสมาชิก"
              className="w-8 h-8 rounded-lg bg-navy-800 hover:bg-navy-700 text-navy-200 flex items-center justify-center transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Link>

            <button
              onClick={loadDashboardData}
              title="รีเฟรชข้อมูล"
              className="w-8 h-8 rounded-lg bg-navy-800 hover:bg-navy-700 text-navy-200 flex items-center justify-center transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>

            {isInClient && (
              <button
                onClick={closeWindow}
                title="ปิดหน้าต่าง"
                className="w-8 h-8 rounded-lg bg-navy-800 hover:bg-navy-700 text-navy-200 flex items-center justify-center transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-4 md:py-6 space-y-4 md:space-y-6">
        {liffError && !isErrorDismissed && (
          <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-900 p-3.5 rounded-2xl">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed flex-1">
              <p className="font-bold mb-0.5">เชื่อมต่อ LINE LIFF ไม่สำเร็จ</p>
              <p className="text-rose-700 break-words">{liffError}</p>
              {liffEntryUrl && (
                <a
                  href={liffEntryUrl}
                  className="inline-flex items-center gap-1 mt-2 font-bold text-rose-800 underline"
                >
                  เปิดใหม่ผ่าน LINE <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <button
              onClick={() => setIsErrorDismissed(true)}
              aria-label="ปิดข้อความแจ้งเตือน"
              className="w-6 h-6 rounded-md hover:bg-rose-100 flex items-center justify-center shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ใน LINE แต่ไม่ได้ ID token */}
        {isReady && !liffError && isInClient && isLoggedIn && !idToken && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-300 text-amber-900 p-3.5 rounded-2xl">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <p className="font-bold mb-0.5">ไม่ได้รับ ID token จาก LINE</p>
              <p>
                เปิดสิทธิ์ <b>openid</b> ให้ LIFF app (LINE Login channel → LIFF → Scopes) แล้วปิด–เปิดหน้าต่างนี้ใหม่
              </p>
            </div>
          </div>
        )}

        {/* ตรวจสอบสิทธิ์กับเซิร์ฟเวอร์ไม่สำเร็จ */}
        {sessionStatus === "error" && (
          <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-900 p-3.5 rounded-2xl">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <p className="font-bold mb-0.5">ตรวจสอบบัญชีกับเซิร์ฟเวอร์ไม่สำเร็จ</p>
              <p className="text-rose-700 break-words">{sessionError || "ไม่ทราบสาเหตุ"}</p>
              {/expired/i.test(sessionError || "") && (
                <button
                  onClick={relogin}
                  className="mt-2 inline-flex items-center gap-1.5 bg-rose-800 hover:bg-rose-900 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg"
                >
                  เข้าสู่ระบบ LINE ใหม่
                </button>
              )}
            </div>
          </div>
        )}

        {/* เปิดนอก LINE และยังไม่ login */}
        {isReady && !liffError && !isLoggedIn && !isInClient && liffEntryUrl && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-navy-900 text-white p-3.5 rounded-2xl">
            <p className="text-xs text-navy-100">
              เปิดแอปผ่าน LINE เพื่อเข้าสู่ระบบอัตโนมัติด้วยบัญชี LINE ของคุณ
            </p>
            <a
              href={liffEntryUrl}
              className="inline-flex items-center justify-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors"
            >
              เปิดใน LINE <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {/* Banner ยินดีต้อนรับ */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60 p-4 rounded-2xl">
          <div>
            <h2 className="text-sm md:text-base font-bold text-navy-900">
              สวัสดีครับ 👋 {profile?.displayName || "ครอบครัว MoneyFamily"}
            </h2>
            {group?.name && (
              <p className="text-[11px] text-slate-600 mt-1">
                ครอบครัว: <span className="font-bold text-navy-900">{group.name}</span>
                {group.inviteCode && (
                  <>
                    {" · "}รหัสเชิญ:{" "}
                    <span className="font-black tracking-[0.2em] text-navy-900">{group.inviteCode}</span>
                  </>
                )}
              </p>
            )}
            <p className="text-xs text-slate-600 mt-0.5">
              พิมพ์บอกบอทหรือส่งสลิปในห้องแชท LINE รายการจะซิงค์มาที่นี่อัตโนมัติ
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs bg-white text-navy-900 px-3 py-1.5 rounded-xl border border-slate-200 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              ซิงค์สดจาก LINE
            </span>
          </div>
        </div>

        <SummaryCards income={incomeTotal} expense={expenseTotal} />

        {transactions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
            <p className="text-sm font-bold text-navy-900">ยังไม่มีรายการ</p>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              เริ่มบันทึกได้ 2 ทาง — พิมพ์ในแชท LINE เช่น “กาแฟ 60”
              <br />
              หรือกดปุ่ม “จดรายจ่าย” ด้านล่าง
            </p>
            <Link
              href="/add"
              className="mt-3 inline-flex items-center gap-1.5 bg-navy-900 hover:bg-navy-800 text-white text-xs font-bold px-4 py-2 rounded-xl"
            >
              <Plus className="w-3.5 h-3.5" />
              จดรายจ่าย
            </Link>
          </div>
        ) : (
          <>
            <ExpenseChart data={chartData} />
            <TransactionTable transactions={transactions} isLoading={isLoading} />
          </>
        )}
      </div>

      {/* Bottom navigation (ใช้งานได้จริงทุกเมนู) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200 px-2 py-2 grid grid-cols-4 gap-1 z-40 shadow-lg">
        <Link href="/" className="flex flex-col items-center gap-0.5 text-navy-900 text-[11px] font-bold">
          <div className="w-9 h-9 rounded-full bg-navy-900 text-white flex items-center justify-center">
            <span className="text-sm font-black">M</span>
          </div>
          หน้าแรก
        </Link>

        <Link href="/add" className="flex flex-col items-center gap-0.5 text-slate-600 text-[11px] font-medium">
          <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
            <Plus className="w-4 h-4 text-navy-900" />
          </div>
          จดรายจ่าย
        </Link>

        <Link href="/split" className="flex flex-col items-center gap-0.5 text-slate-600 text-[11px] font-medium">
          <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
            <Users className="w-4 h-4 text-navy-900" />
          </div>
          หารบิล
        </Link>

        <Link href="/settings" className="flex flex-col items-center gap-0.5 text-slate-600 text-[11px] font-medium">
          <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center">
            <Settings2 className="w-4 h-4 text-navy-900" />
          </div>
          จัดการ
        </Link>
      </nav>
    </main>
  );
}
