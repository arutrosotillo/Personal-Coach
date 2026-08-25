// `server-only` lanza al importarse fuera de un React Server Component, así que
// en tests se sustituye por un módulo vacío. La garantía real la da el build de
// Next (que sí falla si un Client Component importa uno de estos módulos); esto
// solo evita que Vitest reviente al cargar `src/ai/*`.
export {};
