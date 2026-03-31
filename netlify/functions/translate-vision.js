// netlify/functions/translate-vision.js
// Claude Vision APIを使ったフォーマット保持翻訳
const Anthropic = require("@anthropic-ai/sdk");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { image, pageNum, totalPages, targetLang } = JSON.parse(event.body);

    if (!image) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "image (base64) is required" }) };
    }

    const lang = targetLang || "ja";
    const langName = lang === "ja" ? "日本語" : lang === "en" ? "English" : lang === "zh" ? "中文" : lang;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: image,
              },
            },
            {
              type: "text",
              text: "このPDFページの画像を" + langName + "に翻訳して、HTMLで返してください。\n\n【重要ルール】\n1. テーブルは <table> タグで正確に再現すること（行数・列数・セル結合も忠実に）\n2. 見出しは <h2> <h3> <h4> で階層を保つこと\n3. 数値・単位・化学式・型番は翻訳せずそのまま保持すること\n4. 会社ロゴ・ヘッダー部分は <div class=\"doc-header\"> で囲むこと\n5. フッター（住所・ページ番号）は <div class=\"doc-footer\"> で囲むこと\n6. 空欄のセルは空のまま（原本通り）にすること\n7. CSSスタイルは含めないこと（HTMLタグのみ）\n8. <body>タグや<html>タグは含めないこと\n9. テーブルには class=\"doc-table\" を付けること\n10. 結論・注意事項などの重要テキストは <div class=\"doc-note\"> で囲むこと\n\n原文の言語が何であっても（英語・中国語・韓国語等）、すべて" + langName + "に翻訳してください。\nHTMLのみを返してください。説明文は不要です。",
            },
          ],
        },
      ],
    });

    const html = response.content[0].text;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        html,
        pageNum,
        totalPages,
      }),
    };
  } catch (error) {
    console.error("Translation error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || "Translation failed" }),
    };
  }
};
