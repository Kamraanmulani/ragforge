// Development server: the Express API and Vite (hot reload) in one process on one port.
// Production uses server/index.js, which serves the built client from dist/.
import { createRequire } from "node:module";
import { createServer as createViteServer } from "vite";

const require = createRequire(import.meta.url);
const express = require("express");
const { createApi } = require("./api");

const port = Number(process.env.PORT) || 5173;
const app = express();
app.disable("x-powered-by");
app.use("/api", createApi());

const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
app.use(vite.middlewares);

app.listen(port, () => {
  console.log(`[ragforge site] dev server on http://localhost:${port}`);
});
