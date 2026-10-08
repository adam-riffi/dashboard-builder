import type { ReactNode } from "react";
// The builder's grid (DESIGN.md §7: hosts import its stylesheet).
import "react-grid-layout/css/styles.css";
import "./globals.css";

export const metadata = { title: "Acme Shop dashboards" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
