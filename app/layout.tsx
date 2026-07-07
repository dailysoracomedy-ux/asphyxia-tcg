import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASPHYXIA v0.2.1",
  description: "Local hotseat prototype of the ASPHYXIA trading card game.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased overflow-hidden">
      <body className="h-full max-h-full flex flex-col overflow-hidden">{children}</body>
    </html>
  );
}
