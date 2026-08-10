import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import { cookies, headers } from "next/headers";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  isThemePreference,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_COOKIE_NAME,
} from "@/lib/theme";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hearth",
  description: "A private AI journaling app for your household",
  appleWebApp: {
    capable: true,
    title: "Hearth",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAFAF8" },
    { media: "(prefers-color-scheme: dark)", color: "#1C1917" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
  const nonce = headerStore.get("x-nonce") ?? undefined;
  const cookieTheme = cookieStore.get(THEME_COOKIE_NAME)?.value;
  const savedTheme = isThemePreference(cookieTheme) ? cookieTheme : null;

  return (
    <html
      lang="en"
      className={savedTheme === "dark" ? "dark" : undefined}
      style={savedTheme ? { colorScheme: savedTheme } : undefined}
      suppressHydrationWarning
    >
      <head>
        <script
          id="hearth-theme-bootstrap"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP_SCRIPT,
          }}
        />
      </head>
      <body className={`${inter.variable} ${lora.variable} font-sans antialiased`}>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
