import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { api, useApi } from "./lib/api.js";
import Nav from "./components/Nav.jsx";
import Footer from "./components/Footer.jsx";
import Home from "./pages/Home.jsx";
import Docs from "./pages/Docs.jsx";
import Playground from "./pages/Playground.jsx";
import Changelog from "./pages/Changelog.jsx";
import NotFound from "./pages/NotFound.jsx";

const TITLES = {
  "/": "ragforge: know which RAG technique earns its cost",
  "/docs": "Docs | ragforge",
  "/playground": "Playground | ragforge",
  "/changelog": "Changelog | ragforge",
};

// A new page starts at the top. A link with a #hash is left to the page that owns the anchor.
function usePageChange() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    document.title = TITLES[pathname] ?? "Not found | ragforge";
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
}

export default function App() {
  usePageChange();
  const meta = useApi(api.meta, []);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Nav />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/playground" element={<Playground />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer version={meta.data?.version} />
    </>
  );
}
