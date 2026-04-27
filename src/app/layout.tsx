import type { Metadata, Viewport } from "next";
import "./globals.css";
import ErrorBoundary from "@/components/error-boundary";

export const metadata: Metadata = {
  title: "MBG - Airdrop Task Manager",
  description: "Windows 95 themed airdrop task manager",
  icons: {
    icon: "/logo.svg",
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
