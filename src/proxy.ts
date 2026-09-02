import { NextResponse, type NextRequest } from "next/server";

import {
  SESSION_COOKIE,
  readSessionToken,
  sessionCookieOptions,
  shouldRefresh,
} from "@/server/auth/session";

/**
 * Puerta única de la app (en Next 16 esto se llama "proxy", antes
 * "middleware"; corre en runtime Node por defecto).
 *
 * Todo lo que no sea la pantalla de login o un recurso estático exige una
 * cookie de sesión firmada. Al no llevar `matcher` exclusiones por ruta de
 * página, cubre también los POST de las server actions: no hay puerta trasera
 * por llamar a una acción directamente.
 *
 * Defensa en profundidad: las server actions vuelven a comprobar la sesión
 * con `requireSession()`. El proxy es la primera línea, no la única.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = readSessionToken(token);

  if (pathname === "/login") {
    // Ya dentro: no tiene sentido volver a pedir la contraseña.
    if (session.valid) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!session.valid) {
    const login = new URL("/login", request.url);
    // Vuelve a donde ibas después de entrar. Solo rutas internas: un `next`
    // con URL absoluta permitiría redirigir a un dominio ajeno.
    const target = `${pathname}${search}`;
    if (pathname !== "/" && !pathname.startsWith("//")) {
      login.searchParams.set("next", target);
    }
    return NextResponse.redirect(login);
  }

  const response = NextResponse.next();
  if (shouldRefresh(session)) {
    // Sesión deslizante: mientras entrenes, nunca caduca. Si dejas la app
    // 90 días, sí.
    response.cookies.set(SESSION_COOKIE, token!, sessionCookieOptions());
  }
  return response;
}

export const config = {
  /**
   * Todo excepto los estáticos de Next y los recursos que la PWA necesita
   * ANTES de estar autenticada: iOS descarga el manifest y los iconos al
   * añadir a la pantalla de inicio, y si respondieran con una redirección al
   * login el icono saldría roto.
   *
   * `sw.js` va en la lista por lo mismo: el navegador lo pide fuera del ciclo
   * de navegación y una redirección al login lo dejaría sin registrar (o peor,
   * registraría el HTML del login como service worker). No expone nada: es un
   * fichero público de 100 líneas, y todo lo que cachea son respuestas que el
   * servidor ya había autorizado para ese dispositivo.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icon-|apple-touch-icon|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)",
  ],
};
