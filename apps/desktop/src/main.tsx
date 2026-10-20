import React from "react";
import ReactDOM from "react-dom/client";
import { initErrorReporting } from "@doer/core";
import "./index.css";
import App from "./App";

void initErrorReporting({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
