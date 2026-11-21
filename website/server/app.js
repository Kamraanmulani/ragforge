// The Express app: the JSON API, and in production the built React client
const fs = require("fs");
const path = require("path");
const express = require("express");
const { createApi } = require("./api");

const DIST = path.resolve(__dirname, "..", "dist");

function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  });
  next();
}

function createApp(options = {}) {
  const app = express();
  app.disable("x-powered-by");
  // One proxy hop (Render, Railway, Fly, nginx), so the rate limit sees the visitor's address
  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use("/api", createApi(options));

  const dist = options.dist ?? DIST;
  if (fs.existsSync(path.join(dist, "index.html"))) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.use("/assets", (req, res) => res.status(404).end());
    // Client-side routes: every other GET gets the app shell
    app.get(/.*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    app.get("/", (req, res) => {
      res.type("text").send("ragforge site API is running. Build the client with `npm run build`, or use `npm run dev`.");
    });
  }
  return app;
}

module.exports = { createApp };
