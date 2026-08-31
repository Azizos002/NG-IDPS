import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Le fameux export nommé exigé par Next.js 16+
export function proxy(request: NextRequest) {
  const token = request.cookies.get('soc_token')?.value;
  const url = request.nextUrl;

  // =======================================================================
  // EXCEPTION GOD'S LEVEL : Laisser passer les employés vers leur cours
  // =======================================================================
  if (url.pathname === '/formations' && url.searchParams.has('courseId')) {
    return NextResponse.next();
  }

  // =======================================================================
  // RÈGLES DE SÉCURITÉ STANDARD SOC
  // =======================================================================
  if (url.pathname.startsWith('/login') && token) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (!url.pathname.startsWith('/login') && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|noise.png).*)',
  ],
};