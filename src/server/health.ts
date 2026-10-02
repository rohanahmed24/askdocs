import { createServer, type Server } from "node:http";

/**
 * A tiny HTTP server for the worker. Hosts that only run web services (and
 * sleep them when idle) need something to answer, and a request to `/health`
 * is what wakes a sleeping worker. Resolves once it is listening.
 */
export function startHealthServer(port: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url?.split("?")[0] === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}
