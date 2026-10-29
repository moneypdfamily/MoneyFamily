"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, LogIn, Users } from "lucide-react";

import { useLiff } from "@/features/liff/liff-context";

interface Member {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string | null;
}

interface SplitResult {
  amount: number;
  share: number;
  splits: Array<{ userId: string; displayName: string; share: number }>;
}

const money = (value: number) =>
  `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SplitBillPage() {
  const { idToken, isReady, isLoggedIn, login, relogin } = useLiff();

  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SplitResult | null>(null);

  const loadMembers = useCallback(async () => {
    if (!idToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/liff/family", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = String(data?.detail || data?.error || "โหลดสมาชิกไม่สำเร็จ");
        if (res.status === 401 && /expired/i.test(detail)) {
          relogin();
          return;
        }
        throw new Error(detail);
      }
      const list: Member[] = Array.isArray(data.members) ? data.members : [];
      setMembers(list);
      setSelected(list.map((m) => m.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดสมาชิกไม่สำเร็จ");
    } finally {
      setIsLoading(false);
    }
  }, [idToken, relogin]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const toggle = (userId: string) => {
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
    setResult(null);
  };

  const amountValue = Number(amount.replace(/,/g, "")) || 0;
  const previewShare = selected.length ? amountValue / selected.length : 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!idToken || isSaving) return;
    if (amountValue <= 0) {
      setError("จำนวนเงินต้องมากกว่า 0");
      return;
    }
    if (selected.length === 0) {
      setError("เลือกสมาชิกอย่างน้อย 1 คน");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/liff/split", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idToken,
          description: description.trim() || "รายการหารบิล",
          amount: amountValue,
          memberIds: selected,
          date,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = String(data?.detail || data?.error || "บันทึกการหารบิลไม่สำเร็จ");
        if (res.status === 401 && /expired/i.test(detail)) {
          relogin();
          return;
        }
        throw new Error(detail);
      }
      setResult({
        amount: Number(data.amount ?? amountValue),
        share: Number(data.share ?? previewShare),
        splits: Array.isArray(data.splits) ? data.splits : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกการหารบิลไม่สำเร็จ");
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
            หารบิล
          </Link>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-5 space-y-4">
        {!isReady && (
          <div className="flex items-center justify-center gap-3 py-14 text-navy-900">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">กำลังเชื่อมต่อ LINE…</span>
          </div>
        )}

        {isReady && !idToken && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center space-y-3">
            <p className="text-sm font-bold text-navy-900">ต้องเข้าสู่ระบบ LINE ก่อน</p>
            <button
              onClick={isLoggedIn ? relogin : login}
              className="inline-flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-bold px-4 py-2 rounded-xl"
            >
              <LogIn className="w-3.5 h-3.5" />
              เข้าสู่ระบบด้วย LINE
            </button>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-900 rounded-2xl p-3.5 text-xs">
            {error}
          </div>
        )}

        {idToken && (
          <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-700">รายการ</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={120}
                placeholder="เช่น มื้อเย็นหมูกระทะ"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-navy-900 outline-none focus:border-brand-amber focus:ring-2 focus:ring-amber-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">ยอดรวม (บาท)</span>
                <input
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value.replace(/[^\d.]/g, ""));
                    setResult(null);
                  }}
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-lg font-black text-navy-900 outline-none focus:border-brand-amber focus:ring-2 focus:ring-amber-100"
                />
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

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> หารกับ ({selected.length}/{members.length})
                </span>
                <button
                  type="button"
                  onClick={() => setSelected(members.map((m) => m.userId))}
                  className="text-[11px] font-bold text-brand-orange underline"
                >
                  เลือกทั้งหมด
                </button>
              </div>

              {isLoading ? (
                <p className="mt-2 text-xs text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> กำลังโหลดสมาชิก…
                </p>
              ) : members.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">ยังไม่มีสมาชิกในครอบครัว</p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100">
                  {members.map((member) => {
                    const checked = selected.includes(member.userId);
                    return (
                      <li key={member.userId}>
                        <button
                          type="button"
                          onClick={() => toggle(member.userId)}
                          className="w-full flex items-center gap-3 py-2.5 text-left"
                        >
                          <span
                            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                              checked ? "bg-navy-900 border-navy-900 text-white" : "border-slate-300"
                            }`}
                          >
                            {checked && <Check className="w-3.5 h-3.5" />}
                          </span>
                          <span className="flex-1 text-sm font-semibold text-navy-900 truncate">
                            {member.displayName}
                          </span>
                          <span className="text-xs text-slate-500">
                            {checked ? money(previewShare) : "-"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button
              type="submit"
              disabled={isSaving || selected.length === 0 || amountValue <= 0}
              className="w-full flex items-center justify-center gap-1.5 bg-navy-900 hover:bg-navy-800 disabled:opacity-50 text-white text-sm font-bold py-3 rounded-xl transition-colors"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> กำลังบันทึก…
                </>
              ) : (
                <>บันทึกยอดหารบิล</>
              )}
            </button>
          </form>
        )}

        {result && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-5">
            <p className="text-sm font-bold text-emerald-800 flex items-center gap-1.5">
              <Check className="w-4 h-4" /> บันทึกการหารบิลแล้ว
            </p>
            <p className="mt-1 text-xs text-slate-600">
              ยอดรวม {money(result.amount)} · คนละ {money(result.share)}
            </p>
            <ul className="mt-3 divide-y divide-slate-100">
              {result.splits.map((item) => (
                <li key={item.userId} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-navy-900 font-semibold">{item.displayName}</span>
                  <span className="text-slate-700">{money(item.share)}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/"
              className="mt-4 inline-block text-xs font-bold text-brand-orange underline"
            >
              กลับหน้าหลัก
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
