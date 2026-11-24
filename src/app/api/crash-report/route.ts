/* Crash reports from the ys-app (2.0.41): the app POSTs the last crash
 * at the next start; this forwards it to the owner's mailbox via Resend.
 * The payload is sealed end-to-end on the phone (AES-256-GCM + the
 * owner's RSA-2048 public key); this route only ever sees the
 * ciphertext and forwards it as-is — it cannot read the report.
 * One crash arrives as two mails: the stack trace (`crash`) and the
 * 30s of log before it (`pre30`), paired by the same crashId. Developer
 * options can also send a simulated crash (`simulated: true`) and a
 * manual 30s log upload (`manual30`); both are labelled as such.
 * No secret lives in the app or in this file: the Resend key and the
 * recipient come from Vercel environment variables. Without the key the
 * route answers 503 and the app keeps the report for the next start.
 * Plaintext is never accepted: a body without the `encrypted` field
 * is refused, so no code path can leak a log in the clear.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const RESEND_URL = 'https://api.resend.com/emails';
const MAX_BODY_CHARS = 128 * 1024; // sealed 32KB report base64-wraps to ~59KB
/** Two reports per crash at most, per IP per minute: the recipient is
 * fixed, so the worst abuse is emailing the owner, and this keeps even
 * that to a trickle. */
const sentAtByIp = new Map<string, number[]>();

const KINDS = ['crash', 'pre30', 'manual30'] as const;
type Kind = (typeof KINDS)[number];

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
  const kind: Kind =
    typeof data.kind === 'string' && (KINDS as readonly string[]).includes(data.kind)
      ? (data.kind as Kind)
      : 'crash';
  if (data.app !== 'ys' || typeof data.encrypted !== 'string' || data.encrypted.length === 0) {
    return NextResponse.json({ ok: false, error: 'bad report' }, { status: 400 });
  }
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CRASH_REPORT_TO || 'jinping2003@gmail.com';
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'mail not configured' }, { status: 503 });
  }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const recent = (sentAtByIp.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 2) {
    return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429 });
  }
  const version = typeof data.version === 'string' ? data.version : '?';
  const device = typeof data.device === 'string' ? data.device : '?';
  const crashId = typeof data.crashId === 'string' && data.crashId.length > 0 ? data.crashId : '?';
  const simulated = data.simulated === true;
  // Sealed on the phone; forwarded as-is. Only the owner's private key
  // can open it — this server, Resend and the mailbox only see ciphertext.
  const sealed = data.encrypted as string;
  const label =
    kind === 'pre30' ? '崩溃·前30秒日志' : kind === 'manual30' ? '日志·手动上传最近30秒' : '崩溃';
  const subject = `[ys-app ${label}]${simulated ? '[测试]' : ''}[加密] v${version} ${device}`;
  const note =
    kind === 'pre30'
      ? '这是崩溃前 30 秒的日志，与崩溃堆栈是同一编号的两封邮件之一。'
      : kind === 'manual30'
        ? '手动上传：用户在开发者选项里点的「上传最近30秒日志」，不是崩溃自动上报。'
        : simulated
          ? '模拟崩溃上传测试：开发者选项里点的测试，不是真的闪退。'
          : '这是崩溃堆栈。';
  const text =
    '此崩溃日志已在手机上加密，服务端、邮件服务商均无法读取内容。\n' +
    `编号：${crashId}\n${note}\n` +
    '用离线解密页 + 私钥打开下面的密文查看。\n\n' +
    sealed;
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
        text,
      }),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'mail send failed' }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: 'mail rejected' }, { status: 502 });
  }
  recent.push(now);
  sentAtByIp.set(ip, recent);
  return NextResponse.json({ ok: true });
}
