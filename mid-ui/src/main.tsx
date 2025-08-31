import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// TEMP: prove React mounts even if other code breaks
function BootGuard() {
  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div>✅ React mounted. If you don't see this, the entry path or #root is wrong.</div>
      <hr />
      <App />
    </div>
  );
}

const container = document.getElementById("root");
if (!container) {
  // Helps detect wrong id="root" in index.html
  throw new Error("Root container #root not found in index.html");
}
createRoot(container).render(<BootGuard />);
