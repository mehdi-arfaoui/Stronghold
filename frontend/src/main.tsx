import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import "./App.css";
import App from "./App.tsx";
import { DiscoveryProvider } from "./context/DiscoveryContext";
import { getStoredDiscoveryCompleted } from "./utils/preferences";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DiscoveryProvider initialCompleted={getStoredDiscoveryCompleted()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DiscoveryProvider>
  </StrictMode>
);
