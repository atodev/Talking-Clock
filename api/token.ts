// Server-side endpoint: GET /api/token
//
// Creates a short-lived Gemini Live token so the real API key never reaches
// the browser. Runs as a Vercel Function in production, and inside the Vite
// dev server locally (see vite.config.ts).
import { GoogleGenAI, Modality } from '@google/genai';
import { createHash, timingSafeEqual } from 'node:crypto';

export const LIVE_MODEL = 'gemini-3.8-live';
const VOICE = 'Fenrir';

// Chronos's instructions, built on the server because a locked token ignores
// instructions sent from the browser. Uses the visitor's time zone for the time.
function buildSystemInstruction(timeZone: string) {
  const now = new Date();
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(now);
  const date = fmt({ dateStyle: 'full' });
  const time = fmt({ timeStyle: 'short' });
  const monthDay = fmt({ month: 'long', day: 'numeric' });

  return `
    You are Chronos, a dignified and knowledgeable Talking Clock and Historian.
    Current Session Date: ${date}.
    Current Session Time: ${time}.

    Your instructions:
    1. When the session starts, immediately greet the user warmly with the time.
    2. Example greeting: "Greetings. The time is [Current Time]."
    3. Immediately follow the time with a fascinating, brief historical event that happened on this day (${monthDay}) in history.
    4. Engage in conversation if the user asks questions about the event or time.
    5. If asked for the time again, recite it.
    6. Keep your tone elegant, slightly archaic but accessible, like a museum curator.
    7. Keep responses concise suitable for spoken conversation.
  `;
}

// Only accept real IANA time zone names (e.g. "Europe/London"); fall back to UTC
function safeTimeZone(tz: string | null) {
  if (!tz || tz.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export async function createLiveToken(apiKey: string, timeZone = 'UTC') {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
  const now = Date.now();

  const token = await ai.authTokens.create({
    config: {
      uses: 1, // one session per token
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(), // session can last 30 min
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(), // must connect within 1 min
      // Lock the token to this app's model and voice so it can't be reused for anything else
      liveConnectConstraints: {
        model: LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
          systemInstruction: buildSystemInstruction(timeZone),
        },
      },
    },
  });

  return { token: token.name, model: LIVE_MODEL };
}

// Accept the key under the names people commonly use in .env files
export function readApiKey(env: Record<string, string | undefined>) {
  return env.GEMINI_API_KEY || env.API_KEY || env.REACT_APP_API_KEY || env.VITE_API_KEY || env.NEXT_PUBLIC_API_KEY;
}

// Compare passcodes without leaking how many characters matched
function passcodeMatches(given: string, expected: string) {
  const hash = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(hash(given), hash(expected));
}

export type TokenRequestOptions = {
  apiKey: string | undefined;
  url: string;
  passcode: string | null; // from the x-app-passcode request header
  expectedPasscode: string | undefined; // APP_PASSCODE env var
  requirePasscode: boolean; // true on Vercel, so a missing APP_PASSCODE doesn't leave the site open
};

export async function handleTokenRequest(opts: TokenRequestOptions): Promise<Response> {
  const { apiKey, url, passcode, expectedPasscode, requirePasscode } = opts;
  const headers = { 'Cache-Control': 'no-store' };

  // Only people with the passcode can start a session (and use up the free Gemini allowance)
  if (expectedPasscode) {
    if (!passcode || !passcodeMatches(passcode, expectedPasscode)) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
      return Response.json(
        { error: passcode ? 'That passcode is not correct.' : 'Enter the passcode to connect.', passcodeRequired: true },
        { status: 401, headers },
      );
    }
  } else if (requirePasscode) {
    return Response.json(
      { error: 'APP_PASSCODE is not set on the server, so sessions are turned off.' },
      { status: 500, headers },
    );
  }

  if (!apiKey) {
    return Response.json(
      { error: 'GEMINI_API_KEY is not set on the server.' },
      { status: 500, headers },
    );
  }
  try {
    const timeZone = safeTimeZone(new URL(url, 'http://localhost').searchParams.get('tz'));
    return Response.json(await createLiveToken(apiKey, timeZone), { headers });
  } catch (err: any) {
    console.error('Failed to create Live token', err);
    return Response.json(
      { error: `Could not create a Gemini session token: ${err?.message || err}` },
      { status: 502, headers },
    );
  }
}

// Vercel Function entry point
export function GET(request: Request) {
  return handleTokenRequest({
    apiKey: readApiKey(process.env),
    url: request.url,
    passcode: request.headers.get('x-app-passcode'),
    expectedPasscode: process.env.APP_PASSCODE,
    requirePasscode: Boolean(process.env.VERCEL),
  });
}
