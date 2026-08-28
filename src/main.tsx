import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register the service worker on every load (not just when push notifications
// are enabled). Browsers require an active SW with a fetch handler before
// they'll offer the "Install app" prompt, so this is what makes Kall Konnect
// installable as a real PWA instead of just a browser bookmark shortcut.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
