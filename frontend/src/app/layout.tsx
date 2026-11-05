import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Casebook — Legal research",
  description: "Research your indexed judgments with grounded answers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
