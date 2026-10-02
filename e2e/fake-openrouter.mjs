// A stand-in for OpenRouter, used by the end-to-end tests so they cost no free
// requests and give the same answers every time.
//   POST /api/v1/embeddings        vectors from hashed words, so texts that share words are close
//   POST /api/v1/chat/completions  a streamed answer that quotes the best matching passage and cites it
//   GET  /__stats                  how many calls each endpoint has had
//   GET  /__health
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_OPENROUTER_PORT ?? 4010);
const DIMENSIONS = 2048;
const stats = { embeddings: 0, chat: 0 };

const words = (text) => (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map((w) => w.replace(/s$/, "")).filter((w) => w.length > 2);

function hash(word) {
  let h = 2166136261;
  for (const ch of word) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % DIMENSIONS;
}

function embed(text) {
  const vector = new Array(DIMENSIONS).fill(0);
  for (const w of words(text)) vector[hash(w)] += 1;
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0)) || 1;
  return vector.map((x) => x / norm);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });
}

/** The passage that shares the most words with the question, and its best sentence. */
function pickAnswer(userMessage) {
  const question = /Question: ([\s\S]*)$/.exec(userMessage)?.[1] ?? "";
  const asked = new Set(words(question));
  let best = null;
  for (const match of userMessage.matchAll(/<passage n="(\d+)" source="([^"]*)">\n([\s\S]*?)\n<\/passage>/g)) {
    const score = words(match[3]).filter((w) => asked.has(w)).length;
    if (!best || score > best.score) best = { n: match[1], source: match[2], text: match[3], score };
  }
  if (!best) return "I could not find that in your documents.";
  const sentences = best.text.split(/(?<=[.!?])\s+/);
  const sentence = sentences.map((s) => ({ s, score: words(s).filter((w) => asked.has(w)).length })).sort((a, b) => b.score - a.score)[0].s;
  return `According to ${best.source}: ${sentence.trim()} [${best.n}].`;
}

createServer(async (req, res) => {
  const url = req.url ?? "";
  if (url === "/__health") return void res.writeHead(200).end("ok");
  if (url === "/__stats") return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stats));

  if (req.method === "POST" && url === "/api/v1/embeddings") {
    const body = await readBody(req);
    stats.embeddings += 1;
    const input = Array.isArray(body.input) ? body.input : [body.input];
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: embed(String(text)) })), usage: { cost: 0 } }));
  }

  if (req.method === "POST" && url === "/api/v1/chat/completions") {
    const body = await readBody(req);
    stats.chat += 1;
    const lastUser = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const answer = pickAnswer(lastUser);
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": OPENROUTER PROCESSING\n\n");
    const pieces = answer.match(/.{1,24}/gs) ?? [answer];
    for (const piece of pieces) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 15));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { cost: 0 } })}\n\n`);
    return void res.end("data: [DONE]\n\n");
  }

  res.writeHead(404).end();
}).listen(PORT, "127.0.0.1", () => console.log(`fake OpenRouter on ${PORT}`));
