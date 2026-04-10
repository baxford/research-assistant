import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import Nav from "./Nav";

interface LayoutProps {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}

const pageTitles: Record<string, string> = {
  "/": "Researcher",
  "/saved": "Saved Pages",
  "/document": "Document",
  "/sections": "Projects",
};

export default function Layout({ title, children, actions }: LayoutProps) {
  const { pathname } = useLocation();
  const pageTitle = title ?? pageTitles[pathname] ?? "";

  return (
    <>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", padding: "0 0.5rem" }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>{pageTitle}</h1>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Nav />
          {actions && <div>{actions}</div>}
        </div>
      </header>
      {children}
    </>
  );
}
