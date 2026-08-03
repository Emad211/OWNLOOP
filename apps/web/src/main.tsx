import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { AttentionApp } from "./AttentionApp.js";
import { AvalAiSetupApp } from "./AvalAiSetupApp.js";
import "./attention-evidence-snapshot.css";
import "./attention-reveal.css";
import "./attention-transition.css";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("OwnLoop root element was not found.");
}

const view = new URLSearchParams(window.location.search).get("view");
const persianView = view === "attention" || view === "avalai";
document.documentElement.lang = persianView ? "fa" : "en";
document.documentElement.dir = persianView ? "rtl" : "ltr";
document.title =
  view === "attention"
    ? "OwnLoop — حلقهٔ مالکیت"
    : view === "avalai"
      ? "OwnLoop — مغز AvalAI"
      : "OwnLoop";

createRoot(rootElement).render(
  <StrictMode>
    {view === "attention" ? <AttentionApp /> : view === "avalai" ? <AvalAiSetupApp /> : <App />}
  </StrictMode>,
);
