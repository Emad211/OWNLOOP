import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { AttentionApp } from "./AttentionApp.js";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("OwnLoop root element was not found.");
}

const attentionView = new URLSearchParams(window.location.search).get("view") === "attention";
document.documentElement.lang = attentionView ? "fa" : "en";
document.documentElement.dir = attentionView ? "rtl" : "ltr";
document.title = attentionView ? "OwnLoop — حلقهٔ مالکیت" : "OwnLoop";

createRoot(rootElement).render(
  <StrictMode>{attentionView ? <AttentionApp /> : <App />}</StrictMode>,
);
