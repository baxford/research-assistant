import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import SearchPage from "./pages/SearchPage";
import SavedPage from "./pages/SavedPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <main style={{ padding: "2rem 1rem" }}>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/saved" element={<SavedPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  </StrictMode>
);
