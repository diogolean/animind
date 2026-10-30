import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/site-header";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Animind — personagens falantes em 3 cliques", template: "%s · Animind" },
  description: "Crie desenhos animados de personagens falantes com o mínimo de cliques. Debate, aula ou fala solo, direto no navegador.",
  applicationName: "Animind",
  appleWebApp: { capable: true, title: "Animind", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0b14" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-border/50 py-6 text-center text-xs text-muted-foreground">
            Animind · Todo vídeo sai com o aviso “Paródia • Gerado por IA”. Retratos do catálogo em domínio público.
          </footer>
          <Toaster richColors position="top-center" />
          <SwRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
