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
    <html lang="en" className="h-full antialiased overflow-x-hidden overflow-y-visible">
      <body
        className="h-full max-h-full flex flex-col overflow-x-hidden overflow-y-visible"
        style={{
          backgroundImage: 'linear-gradient(rgba(5,5,10,0.8), rgba(5,5,10,0.88)), url(/bg-cityscape.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundAttachment: 'fixed',
        }}
      >
        {children}
      </body>
    </html>
  );
}
