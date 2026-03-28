// Netlify Function: パンフレットDB AI チャット
// shirokuma-pamphlet-db.netlify.app 用

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `あなたは「しろくま電力」のEXPO/展示会パンフレットDBアシスタントです。
技術資料・パンフレットの検索・分析をサポートします。

## 重要ルール
- 回答はプレーンテキスト（Markdown可）で返す。HTMLタグは使わない。
- テーブルはMarkdown記法で書く。
- DBに無い情報は「DBに未登録」と明示する
- 推測は「推定」と明記する

## DB構造（pamphlets テーブル）
id, title(タイトル/品名), category(カテゴリ), manufacturer(メーカー),
filename(ファイル名), tags(タグ/キーワード), file_size(ファイルサイズ),
storage_url(ファイルURL), is_discontinued(廃止フラグ),
discontinued_reason(廃止理由), successor_product_id(後継品ID)

## 回答スタイル
- 最初に簡潔な要約（2-3行）
- 次にデータの詳細
- 必要に応じて関連パンフレットの提案
- 廃止品の場合は後継品情報も提示する

## おすすめパンフレットのマーキング
おすすめがある場合、回答末尾に: <<RECOMMEND:タイトル>>

## ツール使用の効率化
- 1回の回答に使うツール呼び出しは最大3回まで`;

const TOOLS = [
  { name: "search_pamphlets", description: "パンフレットを検索", input_schema: { type: "object", properties: { query: { type: "string" }, field: { type: "string", enum: ["title","category","manufacturer","tags","all"], default: "all" }, limit: { type: "integer", default: 30 }, include_discontinued: { type: "boolean", default: false } }, required: ["query"] } },
  { name: "get_pamphlet_by_id", description: "IDでパンフレット取得", input_schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } },
  { name: "get_category_list", description: "カテゴリ一覧と件数", input_schema: { type: "object", properties: {} } },
  { name: "get_pamphlets_by_category", description: "カテゴリ別パンフレット一覧", input_schema: { type: "object", properties: { category: { type: "string" }, limit: { type: "integer", default: 50 } }, required: ["category"] } },
  { name: "get_manufacturers", description: "メーカー一覧と件数", input_schema: { type: "object", properties: {} } },
  { name: "get_discontinued_pamphlets", description: "廃止パンフレット一覧", input_schema: { type: "object", properties: { limit: { type: "integer", default: 50 } } } }
];

async function sb(path) {
  const url = process.env.SUPABASE_URL + "/rest/v1/" + path;
  try {
    const res = await fetch(url, { headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + process.env.SUPABASE_ANON_KEY, "Content-Type": "application/json" } });
    if (!res.ok) { const txt = await res.text(); return { error: "HTTP " + res.status + ": " + txt.slice(0, 200) }; }
    return await res.json();
  } catch (e) { return { error: e.message }; }
}

const SEL = "select=id,title,category,manufacturer,filename,tags,file_size,storage_url,is_discontinued,discontinued_reason,successor_product_id";

async function searchPamphlets(query, field, limit, includeDiscontinued) {
  const q = encodeURIComponent(query);
  let filter = includeDiscontinued ? "" : "&or=(is_discontinued.is.null,is_discontinued.eq.false)";
  if (field === "all") return sb("pamphlets?" + SEL + "&or=(title.ilike.*" + q + "*,category.ilike.*" + q + "*,manufacturer.ilike.*" + q + "*,tags.ilike.*" + q + "*)" + filter + "&limit=" + limit + "&order=title.asc");
  return sb("pamphlets?" + SEL + "&" + field + "=ilike.*" + q + "*" + filter + "&limit=" + limit + "&order=title.asc");
}
async function getPamphletById(id) { return sb("pamphlets?id=eq." + id + "&select=*"); }
async function getCategoryList() {
  const data = await sb("pamphlets?select=category&or=(is_discontinued.is.null,is_discontinued.eq.false)&order=category");
  if (!Array.isArray(data)) return data;
  const cats = {}; data.forEach(r => { const c = r.category || "未分類"; cats[c] = (cats[c] || 0) + 1; });
  return Object.entries(cats).sort((a,b) => b[1]-a[1]).map(([k,v]) => ({category:k, count:v}));
}
async function getPamphletsByCategory(cat, limit) { return sb("pamphlets?" + SEL + "&category=ilike.*" + encodeURIComponent(cat) + "*&or=(is_discontinued.is.null,is_discontinued.eq.false)&order=title.asc&limit=" + limit); }
async function getManufacturers() {
  const data = await sb("pamphlets?select=manufacturer,category&or=(is_discontinued.is.null,is_discontinued.eq.false)&order=manufacturer");
  if (!Array.isArray(data)) return data;
  const m = {}; data.forEach(r => { const k = r.manufacturer||"不明"; if(!m[k]) m[k]={count:0,cats:{}}; m[k].count++; const c=r.category||"未分類"; m[k].cats[c]=(m[k].cats[c]||0)+1; });
  return Object.entries(m).sort((a,b)=>b[1].count-a[1].count).map(([n,i])=>({manufacturer:n,total:i.count,top_categories:Object.entries(i.cats).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>({category:c,count:n}))}));
}
async function getDiscontinuedPamphlets(limit) { return sb("pamphlets?select=id,title,category,manufacturer,discontinued_reason,successor_product_id&is_discontinued=eq.true&limit=" + limit + "&order=title.asc"); }

async function executeTool(name, input) {
  switch(name) {
    case "search_pamphlets": return searchPamphlets(input.query||"", input.field||"all", input.limit||30, input.include_discontinued||false);
    case "get_pamphlet_by_id": return getPamphletById(input.id||0);
    case "get_category_list": return getCategoryList();
    case "get_pamphlets_by_category": return getPamphletsByCategory(input.category||"", input.limit||50);
    case "get_manufacturers": return getManufacturers();
    case "get_discontinued_pamphlets": return getDiscontinuedPamphlets(input.limit||50);
    default: return {error:"Unknown tool: "+name};
  }
}

async function callClaude(messages, maxIter) {
  const collectedData = [];
  for (let i = 0; i < maxIter; i++) {
    const res = await fetch(ANTHROPIC_API_URL, { method: "POST", headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4096, system: SYSTEM_PROMPT, tools: TOOLS, messages }) });
    if (!res.ok) { const txt = await res.text(); return { error: "Claude API error " + res.status + ": " + txt.slice(0,500) }; }
    const result = await res.json(); const content = result.content || [];
    if (result.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content });
      const toolResults = [];
      for (const block of content) { if (block.type === "tool_use") { const output = await executeTool(block.name, block.input); if (Array.isArray(output)) collectedData.push(...output); toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output).slice(0,12000) }); } }
      messages.push({ role: "user", content: toolResults }); continue;
    }
    const text = content.filter(b => b.type === "text").map(b => b.text).join("\n");
    return { response: text, data: collectedData, usage: result.usage || {} };
  }
  return { error: "Max iterations exceeded" };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  try {
    const body = JSON.parse(event.body); const msg = body.message || ""; const hist = body.history || [];
    if (!msg) return { statusCode: 400, body: JSON.stringify({ error: "empty message" }) };
    const messages = hist.slice(-8).map(h => ({ role: h.role, content: h.content }));
    messages.push({ role: "user", content: msg });
    const result = await callClaude(messages, 10);
    if (result.error) return { statusCode: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: result.error }) };
    return { statusCode: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ response: result.response, data: result.data, usage: result.usage }) };
  } catch (e) { return { statusCode: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: e.message }) }; }
};
