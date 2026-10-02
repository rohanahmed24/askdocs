// Asks you for a secret in a form on your own machine and writes it straight to
// .env. The value never goes through a chat, a log or the terminal.
//
//   node scripts/set-secret.mts OPENROUTER_API_KEY [--file .env]
//
// It serves one page on 127.0.0.1 behind a random one-time address, accepts one
// submission, then exits. It exits without saving after 10 minutes.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { SETTABLE_SECRETS, checkSecretValue, setEnvValue, type SecretName } from "../src/lib/env-file.ts";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--")) as SecretName | undefined;
if (!name || !(name in SETTABLE_SECRETS)) {
  console.error(`Usage: node scripts/set-secret.mts <${Object.keys(SETTABLE_SECRETS).join("|")}> [--file .env]`);
  process.exit(1);
}
const fileAt = args.indexOf("--file");
const envFile = fileAt >= 0 ? args[fileAt + 1] : ".env";
const { label } = SETTABLE_SECRETS[name];

const token = randomBytes(24).toString("hex");
const page = (message = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set ${name}</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#121212;color:#f2f2f2;margin:0;padding:24px}
main{max-width:30rem;margin:8vh auto}
h1{font-size:1.4rem;margin:0 0 .5rem}
p{color:#b9b9b9}
label{display:block;margin:1.25rem 0 .4rem}
input{width:100%;box-sizing:border-box;padding:.7rem .8rem;font:inherit;background:#1d1d1d;color:inherit;border:2px solid #555;border-radius:4px}
input:focus-visible{outline:2px solid #ecd06f;outline-offset:2px}
button{margin-top:1rem;padding:.7rem 1.2rem;font:inherit;font-weight:600;background:#ecd06f;color:#1a1a1a;border:0;border-radius:4px;cursor:pointer}
.error{color:#ff9a8f;margin-top:.75rem}
</style></head><body><main>
<h1>${label}</h1>
<p>Paste the key here. It is saved to <code>${envFile}</code> on this computer and goes nowhere else. This page works once.</p>
<form method="post" action="/${token}">
<label for="secret">${label}</label>
<input id="secret" name="secret" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required autofocus>
<button type="submit">Save key</button>
${message ? `<p class="error" role="alert">${message}</p>` : ""}
</form></main></body></html>`;

const headers = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};

const server = createServer((req, res) => {
  const hostOk = req.headers.host === `127.0.0.1:${(server.address() as { port: number }).port}`; // blocks DNS rebinding
  const pathOk = req.url === `/${token}`;
  if (!hostOk || !pathOk) {
    res.writeHead(404).end();
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, headers).end(page());
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 2000) req.destroy();
  });
  req.on("end", () => {
    const value = (new URLSearchParams(body).get("secret") ?? "").trim();
    const problem = checkSecretValue(name, value);
    if (problem) {
      res.writeHead(400, headers).end(page(problem));
      return;
    }
    const current = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    const temp = `${envFile}.tmp-${process.pid}`;
    writeFileSync(temp, setEnvValue(current, name, value), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, envFile);
    res.writeHead(200, headers).end(`<!doctype html><meta charset="utf-8"><title>Saved</title><body style="font:16px system-ui;background:#121212;color:#f2f2f2;padding:24px"><h1>Saved</h1><p>${name} is now in ${envFile}. You can close this tab.</p>`);
    console.log(`Saved ${name} (${value.length} characters) to ${envFile}.`);
    server.close(() => process.exit(0));
  });
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address() as { port: number };
  console.log(`Open this address in your browser and paste the key:\nhttp://127.0.0.1:${port}/${token}\n(One use. Expires in 10 minutes.)`);
});
setTimeout(() => {
  console.log("Timed out. Nothing was saved.");
  process.exit(2);
}, 10 * 60 * 1000).unref();
