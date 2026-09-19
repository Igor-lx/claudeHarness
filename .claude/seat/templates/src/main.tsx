import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// StrictMode is on deliberately: it double-invokes renders, surfacing non-idempotent effects.
const root = document.getElementById("root");
if (root === null) throw new Error("mount point #root is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
