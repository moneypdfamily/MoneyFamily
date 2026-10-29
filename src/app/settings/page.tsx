"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Loader2,
  LogIn,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";

import { useLiff } from "@/features/liff/liff-context";

interface FamilyMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string | null;
}

interface FamilyGroup {
  id: string;
  name: string;
  inviteCode: string;
  role: string | null;
}

interface WalletSummary {
  income: number;
  expense: number;
  balance: number;
  count: number;
}

const money = (value: number) =>
  `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FamilySettingsPage() {
  const { idToken, isReady, isLoggedIn, login, relogin, error: liffError } = useLiff();

  const [group, setGroup] = useState<FamilyGroup | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadFamily = useCallback(async () => {
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
        const detail = String(data?.detail || data?.error || "ไม่ทราบสาเหตุ");
        if (res.status === 401 && /expired/i.test(detail)) {
          relogin();
          return;
        }
        throw new Error(`HTTP ${res.status} — ${detail}`);
      }

      setGroup(data.group ?? null);
      setMembers(Array.isArray(data.members) ? data.members : []);
      setWallet(data.wallet ?? null);
      setMyUserId(data.me?.userId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setIsLoading(false);
    }
  }, [idToken, relogin]);

  useEffect(() => {
    loadFamily();
  }, [loadFamily]);

  // ฉันเป็นเจ้าของครอบครัวหรือไม่ (คนละตัวกับ member.role ด้านล่าง)
  const amOwner = group?.role === "owner";

  const saveName = async () => {
    if (!idToken || !group) return;
    const nextName = nameDraft.trim();
    if (nextName.length < 2) {
      setError("ชื่อครอบครัวต้องมีอย่างน้อย 2 ตัวอักษร");
      return;
    }
    setSavingName(true);
    setError(null);
    try {
      const res = await fetch("/api/liff/family", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken, name: nextName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || data?.error || "เปลี่ยนชื่อไม่สำเร็จ");
      setGroup((prev) => (prev ? { ...prev, name: data.group?.name ?? nextName } : prev));
      setIsEditingName(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปลี่ยนชื่อไม่สำเร็จ");
    } finally {
      setSavingName(false);
    }
  };

  const removeMember = async (member: FamilyMember) => {
    if (!idToken) return;
    if (!window.confirm(`ลบ ${member.displayName} ออกจากครอบครัว?`)) return;

    setRemovingId(member.userId);
    setError(null);
    try {
      const res = await fetch("/api/liff/family/member/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken, userId: member.userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || data?.error || "ลบสมาชิกไม่สำเร็จ");
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลบสมาชิกไม่สำเร็จ");
    } finally {
      setRemovingId(null);
    }
  };

  const copyInviteCode = async () => {
    if (!group?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(group.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("คัดลอกอัตโนมัติไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกเอง");
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 pb-12">
      <header className="bg-navy-900 text-white sticky top-0 z-30 shadow-md">
        <div className="max-w-3xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-bold">
            <ArrowLeft className="w-4 h-4" />
            จัดการกระเป๋าและสมาชิก
          </Link>
          <button
            onClick={loadFamily}
            disabled={isLoading || !idToken}
            className="w-8 h-8 rounded-lg bg-navy-800 hover:bg-navy-700 text-navy-200 flex items-center justify-center disabled:opacity-50"
            title="รีเฟรช"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-5 space-y-4">
        {!isReady && (
          <div className="flex items-center justify-center gap-3 py-14 text-navy-900">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">กำลังเชื่อมต่อ LINE…</span>
          </div>
        )}

        {isReady && !idToken && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center space-y-3">
            <p className="text-sm font-bold text-navy-900">ต้องเข้าสู่ระบบ LINE ก่อน</p>
            <p className="text-xs text-slate-600">
              {liffError || "หน้าจัดการต้องยืนยันตัวตนกับ LINE เพื่อดูข้อมูลครอบครัวของคุณ"}
            </p>
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

        {idToken && !group && !isLoading && !error && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center space-y-2">
            <p className="text-sm font-bold text-navy-900">ยังไม่มีครอบครัว</p>
            <p className="text-xs text-slate-600">กลับไปหน้าหลักเพื่อสร้างครอบครัวหรือเข้าร่วมด้วยรหัสเชิญ</p>
            <Link href="/" className="inline-block text-xs font-bold text-brand-orange underline">
              ไปหน้าหลัก
            </Link>
          </div>
        )}

        {group && (
          <>
            {/* ครอบครัว + รหัสเชิญ */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-slate-500">ครอบครัว</p>
                  {isEditingName ? (
                    <div className="mt-1 flex items-center gap-1.5">
                      <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        maxLength={60}
                        autoFocus
                        className="w-full min-w-0 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm font-bold text-navy-900 outline-none focus:border-brand-amber focus:ring-2 focus:ring-amber-100"
                      />
                      <button
                        onClick={saveName}
                        disabled={savingName}
                        title="บันทึก"
                        className="w-8 h-8 shrink-0 rounded-lg bg-navy-900 text-white flex items-center justify-center disabled:opacity-50"
                      >
                        {savingName ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => setIsEditingName(false)}
                        title="ยกเลิก"
                        className="w-8 h-8 shrink-0 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h1 className="text-lg font-black text-navy-900 truncate">{group.name}</h1>
                      {amOwner && (
                        <button
                          onClick={() => {
                            setNameDraft(group.name);
                            setIsEditingName(true);
                          }}
                          title="เปลี่ยนชื่อครอบครัว"
                          className="w-7 h-7 shrink-0 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[11px] bg-amber-100 text-amber-900 px-2 py-1 rounded-lg font-bold">
                  {members.length} สมาชิก
                </span>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-slate-500">รหัสเชิญสำหรับสมาชิกใหม่</p>
                  <p className="text-xl font-black tracking-[0.3em] text-navy-900">{group.inviteCode}</p>
                </div>
                <button
                  onClick={copyInviteCode}
                  className="inline-flex items-center gap-1.5 bg-navy-900 hover:bg-navy-800 text-white text-xs font-bold px-3 py-2 rounded-xl"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "คัดลอกแล้ว" : "คัดลอก"}
                </button>
              </div>
            </section>

            {/* กระเป๋าเงิน */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-navy-900">
                <Wallet className="w-4 h-4 text-brand-orange" />
                กระเป๋าครอบครัว
              </h2>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-emerald-50 p-3">
                  <p className="text-[10px] text-emerald-700 font-semibold">รายรับ</p>
                  <p className="text-sm font-black text-emerald-800 mt-0.5">{money(wallet?.income ?? 0)}</p>
                </div>
                <div className="rounded-xl bg-rose-50 p-3">
                  <p className="text-[10px] text-rose-700 font-semibold">รายจ่าย</p>
                  <p className="text-sm font-black text-rose-800 mt-0.5">{money(wallet?.expense ?? 0)}</p>
                </div>
                <div className="rounded-xl bg-navy-900 p-3">
                  <p className="text-[10px] text-navy-200 font-semibold">คงเหลือ</p>
                  <p className="text-sm font-black text-white mt-0.5">{money(wallet?.balance ?? 0)}</p>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                จากรายการทั้งหมด {wallet?.count ?? 0} รายการ
              </p>
            </section>

            {/* สมาชิก */}
            <section className="bg-white border border-slate-200 rounded-2xl p-5">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-navy-900">
                <Users className="w-4 h-4 text-brand-orange" />
                สมาชิกในครอบครัว
              </h2>

              {members.length === 0 ? (
                <p className="mt-3 text-xs text-slate-500">ยังไม่มีข้อมูลสมาชิก</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {members.map((member) => {
                    const isOwner = member.role === "owner";
                    const isMe = member.userId === myUserId;
                    return (
                      <li key={member.userId} className="flex items-center gap-3 py-2.5">
                        {member.avatarUrl ? (
                          <img
                            src={member.avatarUrl}
                            alt={member.displayName}
                            className="w-9 h-9 rounded-full object-cover border border-slate-200"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-slate-100 text-navy-900 text-xs font-bold flex items-center justify-center">
                            {member.displayName.slice(0, 1)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-navy-900 truncate">
                            {member.displayName}
                            {isMe && <span className="ml-1.5 text-[10px] text-slate-500">(คุณ)</span>}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {isOwner ? "เจ้าของครอบครัว" : "สมาชิก"}
                          </p>
                        </div>
                        {isOwner ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-100 text-amber-900 px-2 py-1 rounded-lg">
                            <Crown className="w-3 h-3" />
                            OWNER
                          </span>
                        ) : (
                          amOwner &&
                          !isMe && (
                            <button
                              onClick={() => removeMember(member)}
                              disabled={removingId === member.userId}
                              title="ลบสมาชิกคนนี้"
                              className="w-8 h-8 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 flex items-center justify-center disabled:opacity-50"
                            >
                              {removingId === member.userId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="mt-3 text-[11px] text-slate-500">
                ให้สมาชิกใหม่เปิดลิงก์ LIFF แล้วเลือก &quot;เข้าร่วมด้วยรหัส&quot; โดยใช้รหัส{" "}
                <span className="font-bold text-navy-900">{group.inviteCode}</span>
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
