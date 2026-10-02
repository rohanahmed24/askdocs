// Tries the free OpenRouter embedding models once and prints what each returns:
// vector size, speed, cost, and whether English and Bengali sentences with the
// same meaning land close together. Uses 1 request per model, out of the 50 a
// day that free models allow on accounts with under 10 credits purchased.
//
//   node --env-file=.env scripts/probe-embeddings.mts                      all free models
//   node --env-file=.env scripts/probe-embeddings.mts <model> --batch 100  one model, 100 texts at once
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("Set OPENROUTER_API_KEY in .env first");

const args = process.argv.slice(2);
const batchAt = args.indexOf("--batch");
const batch = batchAt >= 0 ? Number(args[batchAt + 1]) : 0;
const requested = args.filter((a, i) => !a.startsWith("--") && i !== batchAt + 1);

const FREE_MODELS = ["nvidia/nemotron-3-embed-1b:free", "liquid/lfm-2.5-embedding-350m:free", "nvidia/llama-nemotron-embed-vl-1b-v2:free"];
const models = requested.length ? requested : FREE_MODELS;
for (const m of models) if (!m.endsWith(":free")) throw new Error(`Refusing to probe a paid model: ${m}`);

const english = "The invoice is due in thirty days.";
const bengali = "চালানটি ত্রিশ দিনের মধ্যে পরিশোধ করতে হবে।";
const unrelated = "The cat sat quietly on the warm windowsill.";
const long = (i: number) => `Section ${i}. ` + "The customer must pay the invoice within thirty days of receiving it, otherwise a late fee applies. ".repeat(8);

function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb);
}

for (const model of models) {
  const input = batch ? Array.from({ length: batch }, (_, i) => long(i)) : [english, bengali, unrelated];
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-title": "AskDocs probe" },
    body: JSON.stringify({ model, input, encoding_format: "float" }),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    console.log(`${model}\n  FAILED ${res.status}: ${(await res.text()).slice(0, 200)}\n`);
    continue;
  }
  const body = (await res.json()) as { data: { embedding: number[] }[]; usage?: { cost?: number; prompt_tokens?: number } };
  const v = body.data.map((d) => d.embedding);
  console.log(model);
  console.log(`  vectors: ${v.length}, dimensions: ${v[0]?.length}, time: ${ms} ms, cost: ${body.usage?.cost ?? "not reported"}, tokens: ${body.usage?.prompt_tokens ?? "?"}`);
  if (!batch) console.log(`  English vs Bengali (same meaning): ${cosine(v[0], v[1]).toFixed(3)}   English vs unrelated: ${cosine(v[0], v[2]).toFixed(3)}`);
  console.log("");
}
