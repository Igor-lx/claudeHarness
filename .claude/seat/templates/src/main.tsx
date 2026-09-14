import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// Mount point of the application.
//
// StrictMode is on deliberately: it double-invokes renders and effects in
// development, which surfaces effects that are not idempotent. An effect that
// breaks under it breaks under concurrent rendering too, just less visibly.
const root = document.getElementById("root");
if (root === null) throw new Error("mount point #root is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
