/**
 * ESA ER 入口 —— 把 self-hosted-pages-mcp 从 EdgeOne 迁到阿里云 ESA。
 *
 * 前置：
 *   1. ESA 控制台 -> 边缘计算和 AI -> KV 存储，创建存储空间，名字为 pages
 *   2. 函数详情 -> 基本信息 -> 函数变量，添加 MCP_AUTH_TOKEN（加密存储）
 *   3. esa.jsonc 里 "entry": "./entry.mjs"，路由把全部路径指向本函数
 *
 * 函数入口约定：export default { async fetch(request) {} }
 * KV 用官方 EdgeKV：new EdgeKV({ namespace: "pages" })
 */

// ---------- 配置 ----------
const NAMESPACE = "pages";

// ---------- 响应头 ----------
const CORS = { "Access-Control-Allow-Origin": "*" };
const HTML_HEADERS = { "content-type": "text/html; charset=UTF-8", ...CORS };
const JSON_HEADERS = { "content-type": "application/json; charset=UTF-8", ...CORS };

// ---------- 小工具 ----------
const genKey = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "")
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function rpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: JSON_HEADERS });
}
function rpcError(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status: 500,
    headers: JSON_HEADERS,
  });
}

// ---------- 主处理 ----------
async function handleRequest(request, token) {
  const url = new URL(request.url);
  const { pathname } = url;

  // CORS 预检
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // 鉴权：仅写接口要求 token，share / 首页放行
  const isProtected = pathname.startsWith("/mcp-server") || pathname.startsWith("/kv");
  if (isProtected && request.headers.get("Authorization") !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }

  const edgeKV = new EdgeKV({ namespace: NAMESPACE });

  // ---- 读取分享页 /share/{key} ----
  if (pathname.startsWith("/share/")) {
    const key = pathname.split("/").pop();
    const value = await edgeKV.get(key, { type: "text" });
    if (value === undefined || value === null) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(value, { status: 200, headers: HTML_HEADERS });
  }

  // ---- 兼容原接口：POST /kv 写入 ----
  if (pathname.startsWith("/kv")) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const { value } = await request.json();
    if (typeof value !== "string") return new Response("Value must be string", { status: 400 });
    const key = genKey();
    await edgeKV.put(key, value);
    return new Response(JSON.stringify({ key, url: `${url.origin}/share/${key}` }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  }

  // ---- MCP JSON-RPC：/mcp-server ----
  if (pathname.startsWith("/mcp-server")) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    let body;
    try { body = await request.json(); } catch { return new Response("Invalid JSON", { status: 400 }); }
    const id = body.id ?? null;

    if (body.method === "initialize") {
      return rpc(id, {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "esa-pages-deploy-mcp-server", version: "1.0.0" },
        capabilities: { tools: {} },
      });
    }
    if (body.method === "tools/list") {
      return rpc(id, {
        tools: [{
          name: "deploy_html",
          description: "Deploy HTML content to ESA Pages, return a public URL",
          inputSchema: {
            type: "object",
            properties: { value: { type: "string", description: "Complete HTML content to publish" } },
            required: ["value"],
          },
        }],
      });
    }
    if (body.method === "tools/call" && body.params?.name === "deploy_html") {
      const value = body.params.arguments?.value;
      if (!value) return rpc(id, { content: [{ type: "text", text: "Error: missing value" }], isError: true });
      const key = genKey();
      await edgeKV.put(key, value);
      return rpc(id, { content: [{ type: "text", text: `${url.origin}/share/${key}` }] });
    }
    if (body.method === "resources/list" || body.method === "prompts/list") {
      const k = body.method.split("/")[0];
      return rpc(id, { [k]: [] });
    }
    if (body.method === "notifications/initialized") {
      // 客户端握手完成后发空通知，不需回复
      return new Response(null, { status: 200 });
    }
    return rpcError(id, -32601, "Method not found");
  }

  // 其它：静态资源由 assets 托管，这里兜底
  return new Response("Not Found", { status: 404 });
}

export default {
  async fetch(request, context, env) {
    return handleRequest(request, env.MCP_AUTH_TOKEN || "");
  },
};