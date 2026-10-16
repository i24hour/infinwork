import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { PwaRegister } from "@/components/PwaRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://infinwork.app"),
  title: {
    default: "Infinwork — AI Workspace for Builders",
    template: "%s | Infinwork"
  },
  description:
    "Infinwork is an AI workspace where work becomes measurable. Set targets, build chains, track time, and analyze your performance using human stock-style productivity charts.",
  keywords: [
    "AI workspace",
    "productivity platform",
    "task tracking",
    "discipline system",
    "workflow management",
    "performance tracking",
    "goal tracking",
    "time management",
    "accountability system",
    "team productivity"
  ],
  authors: [
    { name: "Infinwork Team" }
  ],
  creator: "Infinwork",
  applicationName: "infinWORK",
  appleWebApp: {
    capable: true,
    title: "infinWORK",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180" }
    ]
  },
  openGraph: {
    title: "Infinwork — AI Workspace for Builders",
    description:
      "Turn your work into measurable progress using targets, chains, and performance analytics.",
    url: "https://infinwork.app",
    siteName: "Infinwork",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "Infinwork — AI Workspace",
    description:
      "Measure your work. Build discipline. Stay consistent."
  },
  robots: {
    index: true,
    follow: true
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(() => {
              try {
                const savedTheme = localStorage.getItem('app-theme');
                if (savedTheme === 'light') {
                  document.documentElement.setAttribute('data-theme', 'light');
                } else {
                  document.documentElement.removeAttribute('data-theme');
                }
              } catch {}
            })();`,
          }}
        />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="shortcut icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>
          {children}
        </AuthProvider>
        <PwaRegister />
        <Script
          id="structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "Infinwork",
              applicationCategory: "ProductivityApplication",
              operatingSystem: "Web",
              url: "https://infinwork.app",
              description: "An AI workspace that helps users set targets, build chains, track time, and measure performance."
            })
          }}
        />
      </body>
    </html>
  );
}
