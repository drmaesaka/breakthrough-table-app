import type { Metadata } from "next";
import "./globals.css";
import OneSignalInit from "@/components/OneSignalInit";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <OneSignalInit />
        {children}
      </body>
    </html>
  );
}
