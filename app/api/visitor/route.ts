import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";
import { debugLog } from "@/lib/debug-log";

function hexFromBuf(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function normalizeChipBalance(value: unknown) {
  const num = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(num)) return 200;
  return Math.max(0, Math.floor(num));
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return hexFromBuf(buf);
}

type Body = { fingerprint: string };

export async function POST(req: Request) {
  debugLog("info", "visitor", "start");
  const body = (await req.json()) as Partial<Body>;
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
  if (!fingerprint) return NextResponse.json({ error: "Missing fingerprint" }, { status: 400 });

  // Server-derived stable ids: don’t trust client-provided visitor id.
  const fingerprintHash = await sha256Hex(`fp:${fingerprint}`);
  const visitorId = (await sha256Hex(`vid:${fingerprintHash}`)).slice(0, 20);
  debugLog("info", "visitor", "derived visitorId", { visitorId });

  const supabase = supabaseAdmin();
  const { data: existing, error: selErr } = await supabase
    .from("users")
    .select("visitor_id, chip_balance")
    .eq("visitor_id", visitorId)
    .maybeSingle();

  if (selErr) {
    debugLog("error", "visitor", "select failed", { message: selErr.message });
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  if (existing) {
    const chipBalance = normalizeChipBalance(existing.chip_balance);
    debugLog("info", "visitor", "existing", { chipBalance });
    return NextResponse.json({
      visitorId: existing.visitor_id,
      chipBalance,
      isNew: false,
    });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("users")
    .insert({
      visitor_id: visitorId,
      fingerprint_hash: fingerprintHash,
      chip_balance: 200,
    })
    .select("visitor_id, chip_balance")
    .single();

  if (insErr) {
    debugLog("error", "visitor", "insert failed", { message: insErr.message });
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  const chipBalance = normalizeChipBalance(inserted.chip_balance);
  debugLog("info", "visitor", "inserted", { chipBalance });
  return NextResponse.json({
    visitorId: inserted.visitor_id,
    chipBalance,
    isNew: true,
  });
}

