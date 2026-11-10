import { NextResponse, type NextRequest } from 'next/server';
import { resolveMenuHostRewrite } from '@/lib/menuHost';

// menu.kasam360.com.tr/{slug} -> /m/{slug}. Ana sitede /m/{slug} doğrudan da çalışır.
export function proxy(request: NextRequest) {
  const target = resolveMenuHostRewrite(request.headers.get('host'), request.nextUrl.pathname);
  if (!target) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = target;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
