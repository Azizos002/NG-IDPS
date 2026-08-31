import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
// NOUVEAU : Importation du Wrapper
import MainLayout from "@/components/MainLayout"; 
// NOUVEAU : Importation du système d'alerte global
import GlobalAlertListener from "@/components/GlobalAlertListener";

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
        
      </body>
    </html>
  );
}