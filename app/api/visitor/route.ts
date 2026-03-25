import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/server";

function hexFromBuf(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(input: string) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return hexFromBuf(buf);
}

type Body = { fingerprint: string };

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Body>;
  const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
  if (!fingerprint) return NextResponse.json({ error: "Missing fingerprint" }, { status: 400 });

  // Server-derived stable ids: don’t trust client-provided visitor id.
  const fingerprintHash = await sha256Hex(`fp:${fingerprint}`);
  const visitorId = (await sha256Hex(`vid:${fingerprintHash}`)).slice(0, 20);

  const supabase = supabaseAdmin();
  const { data: existing, error: selErr } = await supabase
    .from("users")
    .select("visitor_id, chip_balance")
    .eq("visitor_id", visitorId)
    .maybeSingle();

  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  if (existing) {
    return NextResponse.json({
      visitorId: existing.visitor_id,
      chipBalance: existing.chip_balance,
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

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    visitorId: inserted.visitor_id,
    chipBalance: inserted.chip_balance,
    isNew: true,
  });
}

