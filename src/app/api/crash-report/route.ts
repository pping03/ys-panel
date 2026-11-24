/* Crash reports from the ys-app (2.0.41): the app POSTs the last crash
 * at the next start; this forwards it to the owner's mailbox via Resend.
 * No secret lives in the app or in this file: the Resend key and the
 * recipient come from Vercel environment variables. Without the key the
 * route answers 503 and the app keeps the report for the next start.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const RESEND_URL = 'https://api.resend.com/emails';
const MAX_REPORT_CHARS = 32 * 1024;
const MAX_BODY_CHARS = 64 * 1024;
/** One report per IP per minute: the recipient is fixed, so the worst
 * abuse is emailing the owner, and this keeps even that to a trickle. */
const lastSentByIp = new Map<string, number>();

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) {
      return NextResponse.json({ ok: false, error: 'body too large' }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }
  const data = body as Record<string, unknown>;
  if (data.app !== 'ys' || typeof data.report !== 'string' || data.report.length === 0) {
    return NextResponse.json({ ok: false, error: 'bad report' }, { status: 400 });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CRASH_REPORT_TO || 'jinping2003@gmail.com';
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'mail not configured' }, { status: 503 });
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const last = lastSentByIp.get(ip) || 0;
  if (now - last < 60_000) {
    return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 });
  }
  const version = typeof data.version === 'string' ? data.version : '?';
  const device = typeof data.device === 'string' ? data.device : '?';
  const report = (data.report as string).slice(0, MAX_REPORT_CHARS);
  const subject = `[ys-app 崩溃] v${version} ${device}`;
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'YS 崩溃上报 <onboarding@resend.dev>',
        to: [to],
        subject,
        text: report,
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'mail send failed' }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'mail rejected' }, { status: 502 });
  }
  lastSentByIp.set(ip, now);
  return NextResponse.json({ ok: true });
}
