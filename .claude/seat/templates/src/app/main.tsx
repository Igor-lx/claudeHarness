import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// StrictMode is on deliberately.
const root = document.getElementById("root");
// Stryker disable next-line all: seeded entry point, test it when first changed
if (root === null) throw new Error("mount point #root is missing");

// Stryker disable next-line all: seeded entry point, test it when first changed
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
