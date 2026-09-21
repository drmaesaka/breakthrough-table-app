import type { Metadata, Viewport } from "next";
import "./globals.css";
import PushInit from "@/components/PushInit";

export const metadata: Metadata = {
  title: "Breakthrough Table",
  description: "Your habit accountability platform",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Breakthrough Table",
  },
};

// iPhone Safari zooms the page when a text box is focused unless the page
// says maximum-scale=1 — and it still honours pinch-to-zoom, so this only
// stops the jump, not accessibility. viewportFit covers the notch so the
// navy header runs edge to edge when installed to the Home Screen.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0f2044",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <PushInit />
        {children}
      </body>
    </html>
  );
}
