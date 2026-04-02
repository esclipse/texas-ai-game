import { supabaseBrowser } from "@/lib/supabase/client";

export type PvpSessionResult =
  | { ok: true; accessToken: string; userId: string }
  | { ok: false; error: string };

/**
 * PVP 不要求邮箱登录：无会话时用 Supabase Anonymous Sign-In 换 JWT。
 * 需在 Supabase Dashboard → Authentication → Providers → Anonymous 开启。
 */
export async function ensurePvpSupabaseSession(): Promise<PvpSessionResult> {
  try {
    const sb = supabaseBrowser();
    const { data: sessionData } = await sb.auth.getSession();
    const s = sessionData.session;
    if (s?.access_token && s.user?.id) {
      return { ok: true, accessToken: s.access_token, userId: s.user.id };
    }
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      return {
        ok: false,
        error:
          error.message ||
          "匿名登录失败：请在 Supabase 控制台开启 Authentication → Providers → Anonymous",
      };
    }
    if (!data.session?.access_token || !data.session.user?.id) {
      return { ok: false, error: "匿名登录未返回有效会话，请重试" };
    }
    return { ok: true, accessToken: data.session.access_token, userId: data.session.user.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Missing NEXT_PUBLIC_SUPABASE")) {
      return { ok: false, error: "未配置 Supabase 环境变量，无法创建房间" };
    }
    return { ok: false, error: msg || "无法建立会话" };
  }
}
