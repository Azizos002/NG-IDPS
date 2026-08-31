"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // 1. SI ON EST SUR LE LOGIN : On affiche l'enfant pur (Plein écran, 0 marge)
  if (pathname === "/login") {
    return <main className="w-full min-h-screen bg-[#070B14]">{children}</main>;
  }

  // 2. SINON (DASHBOARD) : On applique la topologie complète (Sidebar + Marges)
  return (
    <div className="flex min-h-screen">
      <Sidebar /> 
      <main className="flex-1 ml-64 p-8">
        {children}
      </main>
    </div>
  );
}