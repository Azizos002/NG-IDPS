import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
// NOUVEAU : Importation du Wrapper
import MainLayout from "@/components/MainLayout"; 
// NOUVEAU : Importation du système d'alerte global
import GlobalAlertListener from "@/components/GlobalAlertListener";
// NOUVEAU : Système de notifications toast (remplace les messages d'erreur texte)
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

// On conserve les métadonnées côté serveur !
export const metadata: Metadata = {
  title: "SOC Dashboard | Cyberdéfense Active",
  description: "Système On-Premise de Cyberdéfense",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className={`${inter.className} bg-slate-950 text-slate-200 overflow-x-hidden`}>
        
        {/* C'est le composant Client qui décide d'afficher ou non les marges */}
        <MainLayout>
          {children}
        </MainLayout>

        {/* --- TIER-3 SOC : Écouteur Global d'Attaques en Temps Réel --- */}
        <GlobalAlertListener />

        {/* --- Notifications Toast Globales (Sonner) --- */}
        <Toaster
          theme="dark"
          position="top-right"
          expand
          gap={10}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                "flex items-start gap-3 w-full rounded-xl p-4 backdrop-blur-md border shadow-2xl bg-slate-900/90",
              title: "font-bold text-sm text-slate-100",
              description: "text-xs text-slate-400 mt-0.5",
              closeButton:
                "!bg-slate-800 !border-slate-700 !text-slate-400 hover:!text-slate-200",
              success:
                "!border-emerald-500/40 shadow-[0_0_25px_-5px_rgba(16,185,129,0.4)]",
              error:
                "!border-rose-500/40 shadow-[0_0_25px_-5px_rgba(244,63,94,0.4)]",
              warning:
                "!border-amber-500/40 shadow-[0_0_25px_-5px_rgba(245,158,11,0.4)]",
            },
          }}
        />
        
      </body>
    </html>
  );
}