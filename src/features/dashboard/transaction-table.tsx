"use client";

import React from "react";
import { Users, Receipt, Calendar } from "lucide-react";

export interface TransactionItem {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: "expense" | "income" | "transfer";
  transaction_date: string;
  is_split: boolean;
  payer_name?: string;
}

interface TransactionTableProps {
  transactions: TransactionItem[];
  isLoading?: boolean;
}

const categoryIcons: Record<string, string> = {
  food: "🍔",
  transport: "🚗",
  shopping: "🛍️",
  housing: "🏠",
  utilities: "💡",
  entertainment: "🍿",
  health: "💊",
  income: "💰",
  other: "📝",
};

export function TransactionTable({ transactions, isLoading = false }: TransactionTableProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 animate-pulse space-y-4">
        <div className="h-5 bg-slate-200 rounded w-1/4"></div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 bg-slate-100 rounded-xl"></div>
          ))}
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 text-center">
        <Receipt className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <h3 className="text-sm font-bold text-slate-700">ยังไม่มีรายการธุรกรรม</h3>
        <p className="text-xs text-slate-400 mt-1">
          คุณสามารถส่งข้อความหรือส่งรูปสลิปใน LINE เพื่อเริ่มบันทึกเงินได้ทันที
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 md:p-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            🧾 รายการเดินบัญชีล่าสุด
          </h2>
          <p className="text-xs text-slate-500">
            ประวัติการใช้จ่ายของทุกคนในครอบครัว
          </p>
        </div>
        <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-medium">
          {transactions.length} รายการ
        </span>
      </div>

      {/* 1. Mobile View (Card List) */}
      <div className="divide-y divide-slate-100 block md:hidden">
        {transactions.map((tx) => {
          const isExpense = tx.type === "expense";
          const emoji = categoryIcons[tx.category] || "📝";

          return (
            <div key={tx.id} className="p-3.5 flex items-center justify-between hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-lg flex-shrink-0">
                  {emoji}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {tx.description}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> {tx.transaction_date}
                    </span>
                    {tx.is_split && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] bg-brand-yellow/30 text-amber-900 font-bold px-1.5 py-0.2 rounded-md">
                        <Users className="w-2.5 h-2.5" /> หารแล้ว
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <span
                  className={`text-sm font-bold ${
                    isExpense ? "text-slate-900" : "text-emerald-600"
                  }`}
                >
                  {isExpense ? "-" : "+"}฿{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
                {tx.payer_name && (
                  <p className="text-[11px] text-slate-400">โดย {tx.payer_name}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 2. Desktop View (Table) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-xs uppercase text-slate-400 font-medium">
            <tr>
              <th className="px-5 py-3">รายการ</th>
              <th className="px-5 py-3">หมวดหมู่</th>
              <th className="px-5 py-3">วันที่</th>
              <th className="px-5 py-3">ผู้จ่าย</th>
              <th className="px-5 py-3">การหารบิล</th>
              <th className="px-5 py-3 text-right">จำนวนเงิน</th>
              <th className="px-5 py-3">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {transactions.map((tx) => {
              const isExpense = tx.type === "expense";
              const emoji = categoryIcons[tx.category] || "📝";

              return (
                <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-900 flex items-center gap-2">
                    <span className="text-base">{emoji}</span>
                    <span>{tx.description}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="bg-slate-100 text-slate-700 text-xs px-2 py-0.5 rounded-md font-medium">
                      {tx.category}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">
                    {tx.transaction_date}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600 font-medium">
                    {tx.payer_name || "สมาชิก"}
                  </td>
                  <td className="px-5 py-3.5">
                    {tx.is_split ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-brand-orange border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                        <Users className="w-3 h-3" /> หารกับคนในบ้าน
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right font-bold">
                    <span className={isExpense ? "text-slate-900" : "text-emerald-600"}>
                      {isExpense ? "-" : "+"}฿{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </td><td className="px-5 py-3.5 text-right">
                    <button
                      className="text-xs text-red-600 hover:text-red-800 underline underline-offset-2 cursor-pointer"
                      onClick={(e) => {
                        if (window.confirm('ลบรายการนี้หรือไม่?')) {
                          fetch(`/api/liff/transactions/delete?txId=${tx.id}`, { method: 'POST' })
                            .then(() => window.location.reload())
                            .catch(() => alert('ลบไม่สำเร็จ'));
                        }
                      }}
                    >
                      🗑️ ลบ
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

