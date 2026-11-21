# ragforge website

The product site for [ragforge](https://www.npmjs.com/package/ragforge): a React client and an Express API. The API runs on the ragforge package itself, with no API key.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173, Express API and Vite hot reload in one process
```

```bash
npm run build    # builds the client into dist/
npm start        # http://localhost:8787, Express serves dist/ and the API
npm test         # API tests
```

Set `PORT` to change the port.

## Pages

| Route | What it shows |
|---|---|
| `/` | Landing page: the eval scoreboard from the README's real run, a live router, code samples, providers, the MCP server |
| `/docs` | The README as documentation, with a contents list and search |
| `/playground` | The router and the keyword search, both live |
| `/changelog` | `CHANGELOG.md` as a release list |

## API

| Endpoint | What it does |
|---|---|
| `GET /api/meta` | Package version, links and the router's default rules |
| `GET /api/docs` | README sections as Markdown |
| `GET /api/changelog` | Releases parsed from `CHANGELOG.md` |
| `GET /api/search?q=&k=` | Keyword search over the docs with ragforge's `createBM25Index` |
| `POST /api/route` | `{ "query": "..." }` through `rf.route()`; returns the category, technique and reason |
| `GET /api/health` | Liveness check |

Requests are limited to 120 a minute per address, and queries to 300 characters.

## Where the content comes from

Inside this repository the docs and changelog are read from the repo root, so the site follows `README.md` and `CHANGELOG.md` as they change. Deployed on its own, the server reads them from the installed `ragforge` package instead. Restart the server to pick up edits.

The scoreboard, code samples, provider table and questions on the landing page are in `src/data/site.js`.

## Deploy on Vercel

`vercel.json` serves the built client from `dist/` as static files and runs the API as one serverless function, `api/[...path].js`, which mounts the same Express routes. Before each build, `npm run sync-content` copies the repo's `README.md`, `CHANGELOG.md` and `package.json` into `content/`, which ships with the function. Commit `content/` so a deploy from the website folder alone still has the current docs.

Import the GitHub repo on vercel.com and set **Root Directory** to `website`; the framework (Vite), build command and output folder come from `vercel.json`. Or run `npx vercel --prod` from this folder.

The rate limit is kept in memory, so on Vercel it applies per function instance, not globally.

## Deploy on a Node host

Any Node host works (Render, Railway, Fly.io, a VPS). Use `website/` as the root directory, `npm install && npm run build` as the build command and `npm start` as the start command.

## Layout

```
server/   Express app: api.js (routes), content.js (README and changelog parsing, search index),
          app.js (static files, security headers), dev.mjs (dev server), api.test.js
src/      React client: pages/, components/, data/site.js, styles/
public/   logo.svg, mark.svg
```
