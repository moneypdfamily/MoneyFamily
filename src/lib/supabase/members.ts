import { randomInt } from "node:crypto";

import { supabaseAdmin } from "./admin";
import type { LineIdentity } from "../liff/verify";

export interface AppUser {
  id: string;
  lineUserId: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface FamilyGroup {
  id: string;
  name: string;
  inviteCode: string;
  role: string | null;
}

export class GroupError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** รหัสเชิญ 6 ตัว (ตัดตัวที่อ่านสับสนออก เช่น O/0, I/1) */
export function generateInviteCode(length = 6): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

/**
 * หา user จาก LINE user id หรือสร้างใหม่ (ไม่พึ่ง unique constraint)
 */
export async function ensureUser(identity: LineIdentity): Promise<AppUser> {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from("users")
    .select("id, line_user_id, display_name, avatar_url")
    .eq("line_user_id", identity.lineUserId)
    .limit(1)
    .maybeSingle();

  if (selectError) throw new GroupError(`อ่านข้อมูลผู้ใช้ไม่สำเร็จ: ${selectError.message}`, 500);

  if (existing) {
    const needsUpdate =
      existing.display_name !== identity.displayName ||
      (identity.pictureUrl && existing.avatar_url !== identity.pictureUrl);

    if (needsUpdate) {
      await supabaseAdmin
        .from("users")
        .update({
          display_name: identity.displayName,
          avatar_url: identity.pictureUrl ?? existing.avatar_url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }

    return {
      id: existing.id,
      lineUserId: existing.line_user_id,
      displayName: identity.displayName,
      avatarUrl: identity.pictureUrl ?? existing.avatar_url,
    };
  }

  // users.id อ้าง FK ไปยัง auth.users จึงต้องสร้าง Supabase Auth user ก่อน
  const authId = await createAuthUserForLine(identity);

  const { data: created, error: insertError } = await supabaseAdmin
    .from("users")
    .insert({
      id: authId,
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      avatar_url: identity.pictureUrl ?? null,
    })
    .select("id, line_user_id, display_name, avatar_url")
    .single();

  if (insertError || !created) {
    throw new GroupError(`สร้างบัญชีผู้ใช้ไม่สำเร็จ: ${insertError?.message ?? "unknown"}`, 500);
  }

  return {
    id: created.id,
    lineUserId: created.line_user_id,
    displayName: created.display_name,
    avatarUrl: created.avatar_url,
  };
}

/**
 * สร้าง Supabase Auth user สำหรับผู้ใช้ LINE (ใช้อีเมลสังเคราะห์เพื่อกันซ้ำ)
 * ถ้ามีอยู่แล้วจะคืน id เดิม
 */
async function createAuthUserForLine(identity: LineIdentity): Promise<string> {
  const email = `${identity.lineUserId.toLowerCase()}@line.local`;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      line_user_id: identity.lineUserId,
      display_name: identity.displayName,
      picture_url: identity.pictureUrl ?? null,
    },
  });

  if (data?.user?.id) return data.user.id;

  // ผู้ใช้อาจถูกสร้างไปแล้ว (เช่น public.users insert ล้มเหลวรอบก่อน)
  const existingId = await findAuthUserIdByEmail(email);
  if (existingId) return existingId;

  throw new GroupError(
    `สร้างบัญชีผู้ใช้ไม่สำเร็จ: ${error?.message ?? "unknown"}`,
    500
  );
}

/** ค้นหา auth user จากอีเมล (จำกัดการค้นหาเพื่อไม่ให้ช้าเกินไป) */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  return null;
}

/**
 * กลุ่มแรกที่ผู้ใช้เป็นสมาชิก (ใช้เป็นกลุ่มหลักของแอป)
 */
export async function getMembership(userId: string): Promise<FamilyGroup | null> {
  const { data, error } = await supabaseAdmin
    .from("group_members")
    .select("role, joined_at, groups(id, name, invite_code)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new GroupError(`อ่านข้อมูลกลุ่มไม่สำเร็จ: ${error.message}`, 500);
  if (!data) return null;

  const group = Array.isArray(data.groups) ? data.groups[0] : data.groups;
  if (!group) return null;

  return {
    id: group.id,
    name: group.name,
    inviteCode: group.invite_code,
    role: data.role ?? null,
  };
}

export interface FamilyMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string | null;
  joinedAt: string | null;
}

/** รายชื่อสมาชิกทั้งหมดในครอบครัว พร้อมบทบาท */
export async function getGroupMembers(groupId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabaseAdmin
    .from("group_members")
    .select("role, joined_at, users:user_id (id, display_name, avatar_url)")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });

  if (error || !data) {
    console.error("❌ อ่านรายชื่อสมาชิกไม่สำเร็จ:", error);
    return [];
  }

  return data
    .map((row: any) => {
      const u = Array.isArray(row.users) ? row.users[0] : row.users;
      if (!u) return null;
      return {
        userId: u.id as string,
        displayName: (u.display_name as string) || "สมาชิก",
        avatarUrl: (u.avatar_url as string) ?? null,
        role: (row.role as string) ?? null,
        joinedAt: (row.joined_at as string) ?? null,
      };
    })
    .filter(Boolean) as FamilyMember[];
}

async function insertMember(groupId: string, userId: string, role?: string) {
  const row: Record<string, string> = { group_id: groupId, user_id: userId };
  if (role) row.role = role;

  const { error } = await supabaseAdmin.from("group_members").insert(row);
  if (!error) return true;

  // ถ้า enum member_role ไม่มีค่านี้ ให้ลองใหม่โดยใช้ค่า default ของคอลัมน์
  if (role && /invalid input value for enum/i.test(error.message)) {
    const { error: retryError } = await supabaseAdmin
      .from("group_members")
      .insert({ group_id: groupId, user_id: userId });
    if (!retryError) return true;
    throw new GroupError(`เพิ่มสมาชิกไม่สำเร็จ: ${retryError.message}`, 500);
  }

  throw new GroupError(`เพิ่มสมาชิกไม่สำเร็จ: ${error.message}`, 500);
}

async function uniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = generateInviteCode();
    const { data } = await supabaseAdmin
      .from("groups")
      .select("id")
      .eq("invite_code", code)
      .limit(1)
      .maybeSingle();
    if (!data) return code;
  }
  // fallback: ยาวขึ้นเพื่อลดโอกาสชน
  return generateInviteCode(10);
}

/** สร้างครอบครัวใหม่ แล้วให้ผู้สร้างเป็นสมาชิก (owner ถ้า enum รองรับ) */
export async function createFamilyGroup(params: {
  userId: string;
  name: string;
}): Promise<FamilyGroup> {
  const name = params.name.trim();
  if (name.length < 2) throw new GroupError("ชื่อครอบครัวต้องมีอย่างน้อย 2 ตัวอักษร");
  if (name.length > 60) throw new GroupError("ชื่อครอบครัวยาวเกิน 60 ตัวอักษร");

  const inviteCode = await uniqueInviteCode();

  const { data: group, error } = await supabaseAdmin
    .from("groups")
    .insert({
      name,
      invite_code: inviteCode,
      created_by: params.userId,
      currency: "THB",
    })
    .select("id, name, invite_code")
    .single();

  if (error || !group) {
    throw new GroupError(`สร้างครอบครัวไม่สำเร็จ: ${error?.message ?? "unknown"}`, 500);
  }

  await insertMember(group.id, params.userId, "owner");

  return { id: group.id, name: group.name, inviteCode: group.invite_code, role: "owner" };
}

/** เข้าร่วมกลุ่มด้วยรหัสเชิญ */
export async function joinFamilyGroup(params: {
  userId: string;
  code: string;
}): Promise<FamilyGroup> {
  const code = params.code.trim().toUpperCase();
  if (code.length < 4) throw new GroupError("รหัสเชิญไม่ถูกต้อง");

  const { data: group, error } = await supabaseAdmin
    .from("groups")
    .select("id, name, invite_code")
    .ilike("invite_code", code)
    .limit(1)
    .maybeSingle();

  if (error) throw new GroupError(`ค้นหากลุ่มไม่สำเร็จ: ${error.message}`, 500);
  if (!group) throw new GroupError("ไม่พบครอบครัวที่ใช้รหัสนี้", 404);

  const { data: existing, error: memberError } = await supabaseAdmin
    .from("group_members")
    .select("id")
    .eq("group_id", group.id)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();

  if (memberError) throw new GroupError(`ตรวจสอบสมาชิกไม่สำเร็จ: ${memberError.message}`, 500);

  if (!existing) {
    await insertMember(group.id, params.userId, "member");
  }

  return {
    id: group.id,
    name: group.name,
    inviteCode: group.invite_code,
    role: existing ? null : "member",
  };
}
