"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, LogIn, Save } from "lucide-react";

import { useLiff } from "@/features/liff/liff-context";

const CATEGORIES = [
  { value: "food", label: "อาหาร/เครื่องดื่ม" },
  { value: "transport", label: "เดินทาง" },
  { value: "shopping", label: "ช้อปปิ้ง/ของใช้" },
  { value: "housing", label: "บ้าน/ค่าเช่า" },
  { value: "utilities", label: "ค่าน้ำ/ค่าไฟ/เน็ต" },
  { value: "entertainment", label: "บันเทิง" },
  { value: "health", label: "สุขภาพ" },
  { value: "income", label: "รายรับ" },
  { value: "other", label: "อื่น ๆ" },
];

export default function AddExpensePage() {
  const router = useRouter();
  const { idToken, isReady, isLoggedIn, login, relogin } = useLiff();

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState("food");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!idToken || isSaving) return;

    const value = Number(amount.replace(/,/g, ""));
    if (!description.trim()) {
      setError("กรุณาระบุชื่อรายการ");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      setError("จำนวนเงินต้องมากกว่า 0");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/liff/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idToken,
          description: description.trim(),
          amount: value,
          category,
          type: type === "income" ? "income" : "expense",
          date,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail = String(data?.detail || data?.error || "บันทึกไม่สำเร็จ");
        if (res.status === 401 && /expired/i.test(detail)) {
          relogin();
          return;
        }
        throw new Error(detail);
      }

      setSaved(true);
      setTimeout(() => router.push("/"), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-16">
      <header className="bg-navy-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-xl mx-auto px-4 py-3.5 flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2 text-sm font-bold">
            <ArrowLeft className="w-4 h-4" />
            จดรายจ่าย
          </Link>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-5">
        {!isReady && (
          <div className="flex items-center justify-center gap-3 py-14 text-navy-900">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">กำลังเชื่อมต่อ LINE…</span>
          </div>
        )}

        {isReady && !idToken && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center space-y-3">
            <p className="text-sm font-bold text-navy-900">ต้องเข้าสู่ระบบ LINE ก่อน</p>
            <p className="text-xs text-slate-600">เพื่อบันทึกลงครอบครัวของคุณ</p>
            <button
              onClick={isLoggedIn ? relogin : login}
              className="inline-flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-bold px-4 py-2 rounded-xl"
            >
              <LogIn className="w-3.5 h-3.5" />
              เข้าสู่ระบบด้วย LINE
            </button>
          </div>
        )}

        {idToken && (
          <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-700">ประเภทรายการ</label>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 bg-slate-100 p-1 rounded-xl">
                {(["expense", "income"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setType(option);
                      setCategory(option === "income" ? "income" : "food");
                    }}
                    className={`text-xs font-bold py-2 rounded-lg transition-colors ${
                      type === option ? "bg-white text-navy-900 shadow-sm" : "text-slate-500"
                    }`}
                  >
                    {option === "expense" ? "รายจ่าย" : "รายรับ"}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-slate-700">ชื่อรายการ</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={120}
                required
                placeholder="เช่น กาแฟ, ข้าวผัด, ค่าไฟ"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-navy-900 outline-none focus:border-brand-amber focus:ring-2 focus:ring-amber-100"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-700">จำนวนเงิน (บาท)</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                required
                placeholder="0.00"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-lg font-black text-navy-900 outline-none focus:border-brand-amber focus:ring-2 focus:ring-amber-100"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">หมวดหมู่</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-navy-900 bg-white outline-none focus:border-brand-amber focus:ring-2 focus:ring-amber-100"
                >
                  {CATEGORIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-slate-700">วันที่</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-navy-900 outline-none focus:border-brand-amber focus:ring-2 focus:ring-amber-100"
                />
              </label>
            </div>

            {error && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            {saved && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> บันทึกแล้ว กำลังกลับหน้าหลัก…
              </p>
            )}

            <button
              type="submit"
              disabled={isSaving || saved}
              className="w-full flex items-center justify-center gap-1.5 bg-navy-900 hover:bg-navy-800 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition-colors"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก…
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" /> บันทึกรายการ
                </>
              )}
            </button>

            <p className="text-[11px] text-slate-500 text-center">
              บันทึกแล้วทุกคนในครอบครัวเห็นรายการนี้ทันที
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
