import type { ExecutionContext, KVNamespace } from "@cloudflare/workers-types";

// Env bindings must mirror wrangler.toml [[kv_namespaces]] + secrets set via
// `wrangler secret put ANTHROPIC_API_KEY_2`
export interface Env {
  DEMO_ASSETS: KVNamespace;
  ANTHROPIC_API_KEY_2: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigin = origin.endsWith(".myshopify.com") ? origin : "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/generate-demo-assets") {
        return await handleGenerate(request, env, corsHeaders);
      }

      if (request.method === "GET" && url.pathname === "/api/view-demo") {
        return await handleView(url, env, corsHeaders);
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

// --- Route Handlers ---

async function handleGenerate(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  try {
    const body = await request.json() as { projectDescription?: string };
    if (!body.projectDescription) {
      return new Response(JSON.stringify({ error: "Missing projectDescription" }), { status: 400, headers });
    }

    const demoId = crypto.randomUUID();

    const systemPrompt = `You are an expert frontend engineer. Output ONLY a single raw JSON object — no markdown fences, no prose, no comments.

Rules:
- All HTML/CSS must be SELF-CONTAINED (inline <style> blocks, no external URLs).
- Write COMPACT code: no blank lines, no code comments, minify CSS rules onto single lines.
- Each HTML string must stay UNDER 1800 characters. Prioritise visual impact over completeness.
- Ultra-premium aesthetic: dark backgrounds (#050505), accent colour from the project, clean sans-serif typography.

Required JSON schema (no extra keys):
{
  "tag_mock_html": "<style>…</style><div>…</div>",
  "lander_html": "<style>…</style><div>…</div>",
  "dashboard_preview_html": "<style>…</style><div>…</div>"
}

Begin your response with { and end with }. Nothing else.`;

    const anthropicPayload = {
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      system: systemPrompt,
      messages: [
        { role: "user", content: `Generate the demo assets for this project: ${body.projectDescription}` },
      ],
    };

    // Trim the key to guard against any whitespace/newline that survives secret injection
    const apiKey = env.ANTHROPIC_API_KEY_2.trim();

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(anthropicPayload),
    });

    if (!anthropicResponse.ok) {
      const err = await anthropicResponse.text();
      throw new Error(`Anthropic API Error (${anthropicResponse.status}): ${err}`);
    }

    const data = await anthropicResponse.json() as { content: Array<{ text: string }> };
    let rawJsonContent = data.content[0].text;

    // Strip markdown fences if the model ignores the "no markdown" instruction
    rawJsonContent = rawJsonContent.replace(/```json\n?|```/g, "").trim();

    const parsedAssets = JSON.parse(rawJsonContent);

    // Expires in 7 days
    await env.DEMO_ASSETS.put(demoId, JSON.stringify(parsedAssets), { expirationTtl: 604800 });

    return new Response(JSON.stringify({ demoId }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
}

async function handleView(url: URL, env: Env, headers: Record<string, string>): Promise<Response> {
  const demoId = url.searchParams.get("demoId");

  if (!demoId) {
    return new Response("Missing demoId parameter in the URL.", { status: 400, headers });
  }

  try {
    const assetData = await env.DEMO_ASSETS.get(demoId);

    if (!assetData) {
      return new Response("Demo environment not found or has expired.", { status: 404, headers });
    }

    const assets = JSON.parse(assetData) as {
      tag_mock_html?: string;
      lander_html?: string;
      dashboard_preview_html?: string;
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tap Maestro - Demo Environment</title>
  <style>
    :root {
      --bg-primary: #050505;
      --bg-secondary: #111111;
      --border-color: #222222;
      --text-primary: #f0f0f0;
      --text-muted: #888888;
    }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
    }
    .viewer-container {
      display: flex;
      flex-direction: column;
      gap: 3rem;
      padding: 3rem 2rem;
      max-width: 1400px;
      margin: 0 auto;
    }
    header {
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1.5rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-weight: 300;
      letter-spacing: -1px;
      margin: 0;
      font-size: 2rem;
    }
    .demo-id {
      font-family: monospace;
      color: var(--text-muted);
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }
    .section-title {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--text-muted);
      margin-bottom: 1rem;
    }
    .preview-box {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 2rem;
      overflow: auto;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .preview-box > * { all: revert; }
  </style>
</head>
<body>
  <div class="viewer-container">
    <header>
      <h1>Tap Maestro Demo Environment</h1>
      <div class="demo-id">ID: ${demoId}</div>
    </header>

    <section>
      <h2 class="section-title">Hardware Interaction Mockup</h2>
      <div class="preview-box">
        ${assets.tag_mock_html ?? "<p>Generation failed for this component.</p>"}
      </div>
    </section>

    <section>
      <h2 class="section-title">Personalized Auth Lander</h2>
      <div class="preview-box">
        ${assets.lander_html ?? "<p>Generation failed for this component.</p>"}
      </div>
    </section>

    <section>
      <h2 class="section-title">Asset Management Matrix</h2>
      <div class="preview-box">
        ${assets.dashboard_preview_html ?? "<p>Generation failed for this component.</p>"}
      </div>
    </section>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { ...headers, "Content-Type": "text/html" },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Error rendering viewer: ${message}`, { status: 500, headers });
  }
}
