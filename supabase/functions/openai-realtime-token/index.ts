/* =========================================================
   Supabase Edge Function: OpenAI Realtime ephemeral key発行

   OPENAI_API_KEYはSupabase Secretとして保存し、GitHubへは書かない。
   ブラウザーへ返すのは短時間だけ有効なek_...トークンのみ。
   ========================================================= */

const OPENAI_CLIENT_SECRET_URL = "https://api.openai.com/v1/realtime/client_secrets";
const ALLOWED_VOICES = new Set(["marin", "cedar", "coral", "alloy"]);

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

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return new Response("OPENAI_API_KEY is not configured.", {
      status: 500,
      headers: corsHeaders(origin),
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const language = body.language === "en" ? "en" : "ja";
  const requestedVoice = typeof body.voice === "string" ? body.voice : "marin";
  const voice = ALLOWED_VOICES.has(requestedVoice) ? requestedVoice : "marin";

  const instructions = language === "en"
    ? "You are a clear parking guidance voice assistant. Speak in simple, easy English with short sentences. Never invent parking availability or routes."
    : "あなたは駐車場案内用の音声アシスタントです。日本語で短く、明瞭に、落ち着いて話してください。駐車区画の空き状況や経路を推測して作らないでください。";

  const openAIResponse = await fetch(OPENAI_CLIENT_SECRET_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: "gpt-realtime-2.1",
        output_modalities: ["audio"],
        instructions,
        max_output_tokens: 220,
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            transcription: {
              model: "gpt-4o-mini-transcribe",
              language,
            },
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice,
            speed: 0.92,
          },
        },
      },
    }),
  });

  const responseText = await openAIResponse.text();

  return new Response(responseText, {
    status: openAIResponse.status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": openAIResponse.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
});
