// Cloudflare Worker: proxy entre o Acumulei e a API da Gemini.
// - A chave (GEMINI_API_KEY) fica só aqui, como secret. Nunca vai para o navegador.
// - Só aceita requisições das origens em ALLOWED_ORIGINS e, se definido, com o header x-app-token = APP_TOKEN.
// - Repassa apenas os campos esperados (contents, systemInstruction, tools, generationConfig).

const MAX_BODY_BYTES = 200_000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const permitidas = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map(s => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);

    // Sem ALLOWED_ORIGINS configurado, aceita qualquer origem (use só para testar).
    const origemOk = permitidas.length === 0 || permitidas.includes(origin);

    const cors = {
      "Access-Control-Allow-Origin": permitidas.length === 0 ? "*" : (origemOk ? origin : "null"),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-app-token",
      "Access-Control-Expose-Headers": "x-ia-info",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: origemOk ? 204 : 403, headers: cors });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, servico: "acumulei-ia" });
    }

    if (request.method !== "POST" || url.pathname !== "/chat") {
      return json({ error: { message: "Rota não encontrada." } }, 404);
    }

    if (!origemOk) {
      return json({ error: { message: "Origem não autorizada." } }, 403);
    }

    if (env.APP_TOKEN && request.headers.get("x-app-token") !== env.APP_TOKEN) {
      return json({ error: { message: "Token inválido." } }, 401);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: { message: "GEMINI_API_KEY não configurada no Worker." } }, 500);
    }

    const texto = await request.text();
    if (texto.length > MAX_BODY_BYTES) {
      return json({ error: { message: "Requisição grande demais." } }, 413);
    }

    let entrada;
    try {
      entrada = JSON.parse(texto);
    } catch {
      return json({ error: { message: "JSON inválido." } }, 400);
    }

    if (!Array.isArray(entrada.contents) || entrada.contents.length === 0) {
      return json({ error: { message: "Campo 'contents' ausente." } }, 400);
    }

    const corpo = {
      contents: entrada.contents,
      ...(entrada.systemInstruction ? { systemInstruction: entrada.systemInstruction } : {}),
      ...(entrada.tools ? { tools: entrada.tools } : {}),
      ...(entrada.generationConfig ? { generationConfig: entrada.generationConfig } : {}),
    };

    const modelo = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

    // Nível de "raciocínio" do modelo: quanto menor, mais rápido. Padrão "minimal".
    // Defina GEMINI_THINKING_LEVEL = "" (vazio) para não enviar nada e usar o padrão do modelo.
    const nivel = env.GEMINI_THINKING_LEVEL === undefined ? "minimal" : String(env.GEMINI_THINKING_LEVEL).trim();
    const corpoSemThinking = corpo;
    const corpoComThinking = nivel
      ? {
          ...corpo,
          generationConfig: {
            ...(corpo.generationConfig || {}),
            thinkingConfig: { thinkingLevel: nivel },
          },
        }
      : corpo;
    let corpoEnviado = corpoComThinking;

    const chamar = (c) =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY,
        },
        body: JSON.stringify(c),
        // Nenhuma chamada fica pendurada por mais de 20 s.
        signal: AbortSignal.timeout(20000),
      });

    // Picos de demanda (503) costumam passar em segundos: tenta de novo algumas vezes.
    // Erros de limite (429) e de requisição (4xx) são repassados na hora.
    const ESPERAS_MS = [800, 1800, 3500];
    let upstream;
    let texto_resposta;
    let chamadasFeitas = 0;
    const inicio = Date.now();
    for (let tentativa = 0; ; tentativa++) {
      chamadasFeitas++;
      try {
        upstream = await chamar(corpoEnviado);
        texto_resposta = await upstream.text();
      } catch {
        return json({ error: { message: "A Gemini demorou demais para responder. Tente de novo." } }, 504);
      }

      // Se o modelo não aceitar o nível de raciocínio pedido, refaz sem ele (uma vez).
      if (
        upstream.status === 400 &&
        corpoEnviado !== corpoSemThinking &&
        /thinking/i.test(texto_resposta)
      ) {
        corpoEnviado = corpoSemThinking;
        continue;
      }

      const transitorio = upstream.status === 503 || upstream.status === 500 || upstream.status === 504;
      // Só insiste se ainda couber no orçamento de tempo (evita esperas de minutos).
      if (!transitorio || tentativa >= ESPERAS_MS.length || Date.now() - inicio > 12000) break;
      await new Promise(r => setTimeout(r, ESPERAS_MS[tentativa]));
    }

    // Informação de diagnóstico (o app mostra embaixo da resposta): onde o tempo foi gasto.
    const info =
      `gemini ${Date.now() - inicio}ms, ${chamadasFeitas}x, ${modelo}, ` +
      `raciocínio ${corpoEnviado === corpoSemThinking ? "padrão" : nivel}`;

    // Repassa status e corpo da Gemini (inclusive erros como 429 de limite).
    return new Response(texto_resposta, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "x-ia-info": info },
    });
  },
};