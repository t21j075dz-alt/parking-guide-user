/* =========================================================
   Supabase Edge Function: Gemini Live ephemeral token発行

   GEMINI_API_KEYはSupabase Secretとして保存し、GitHubへは書かない。
   ブラウザーへ返すのは短時間有効なephemeral tokenのみ。
   ========================================================= */

const GEMINI_TOKEN_URL = "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const MODEL = "models/gemini-3.8-live";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function isAllowedOrigin(origin: string | null) {
  if (!origin) return false;

  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && url.hostname === "t21j075dz-alt.github.io") {
      return true;
    }

    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      && (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: corsHeaders(origin),
    });
  }

  if (!isAllowedOrigin(origin)) {
    return new Response("Forbidden origin", {
      status: 403,
      headers: corsHeaders(origin),
    });
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response("GEMINI_API_KEY is not configured.", {
      status: 500,
      headers: corsHeaders(origin),
    });
  }

  const now = Date.now();
  const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

  const geminiResponse = await fetch(GEMINI_TOKEN_URL, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uses: 1,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: MODEL,
      },
    }),
  });

  const body = await geminiResponse.text();

  return new Response(body, {
    status: geminiResponse.status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": geminiResponse.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
});
