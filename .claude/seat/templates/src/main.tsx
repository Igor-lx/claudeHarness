import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./globals.scss";
import { App } from "./App";

// Mount point of the application.
//
// StrictMode is on deliberately: it double-invokes renders and effects in
// development, which surfaces effects that are not idempotent. An effect that
// breaks under it breaks under concurrent rendering too, just less visibly.
//
// `globals.scss` is imported here and nowhere else: it declares the order of
// the cascade layers, and that declaration has to be evaluated before any sheet
// that fills a layer. The entry point is the one place that is always first.
const root = document.getElementById("root");
if (root === null) throw new Error("mount point #root is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
