import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FeedbackHost } from "./features/feedback/FeedbackHost";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <>
      <App />
      <FeedbackHost />
    </>
  </React.StrictMode>
);
