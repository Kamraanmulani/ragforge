// Vercel serverless function: every /api/* request runs the same Express API as server/app.js.
// The React client is served by Vercel as static files from dist/ (see vercel.json).
const express = require("express");
const { createApi } = require("../server/api");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use("/api", createApi());

module.exports = app;
