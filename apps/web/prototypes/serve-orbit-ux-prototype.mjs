import { createReadStream, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, "orbit-ux-prototype.html");
const art = join(here, "../public/images/grounded-craft-hangar.png");
const allowedPages = new Set([
  "/",
  "/fleet",
  "/exchange",
  "/fleet/1204",
  "/explore",
]);

createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/refinements.css") {
    response.writeHead(200, {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(readFileSync(join(here, "orbit-ux-refinements.css")));
    return;
  }
  if (url.pathname === "/prototype.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(readFileSync(join(here, "orbit-ux-prototype.js")));
    return;
  }
  if (url.pathname === "/prototype-art/grounded-craft-hangar.png") {
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    });
    createReadStream(art).pipe(response);
    return;
  }
  if (
    !allowedPages.has(url.pathname) &&
    !/^\/fleet\/\d{1,4}$/.test(url.pathname)
  ) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Prototype route not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(readFileSync(htmlPath));
}).listen(3107, process.env.ORBIT_PROTOTYPE_HOST ?? "127.0.0.1", () => {
  console.log("ORBIT UX prototype on port 3107 (sample data only)");
});
