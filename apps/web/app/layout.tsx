import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasta | L'asta, senza caos",
  description: "Aste di Fantacalcio in tempo reale, semplici da gestire e veloci da giocare.",
};

export const viewport: Viewport = {
  themeColor: "#f3f7f4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it">
      <body>
        {children}
        <Toaster richColors position="top-center" closeButton />
      </body>
    </html>
  );
}
