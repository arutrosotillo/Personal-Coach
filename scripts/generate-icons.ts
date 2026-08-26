import { writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

/**
 * Genera los iconos de la PWA. Se ejecuta a mano y los PNG resultantes se
 * commitean: no hace falta en cada build.
 *
 *   pnpm exec tsx scripts/generate-icons.ts
 *
 * La marca son tres barras ascendentes, que es de lo que va la app: sobrecarga
 * progresiva. Se lee a 40 px en una pantalla de inicio, que es el único tamaño
 * que importa de verdad.
 */
const NARANJA = "#fe9a00"; // --primary en dark, el acento real de la app
const FONDO = "#0a0a0a"; // --background en dark, igual que themeColor

/**
 * @param escala Fracción del lienzo que ocupa la marca. Los iconos
 *   `maskable` se recortan en círculo, así que su contenido debe caber en el
 *   80 % central; se dibuja más pequeño para no perder las barras exteriores.
 */
function svg(escala: number): string {
  const LIENZO = 512;
  const ancho = 74;
  const hueco = 30;
  const radio = 16;
  const alturas = [150, 232, 314];
  const anchoTotal = ancho * 3 + hueco * 2;
  const base = 400;

  const barras = alturas
    .map((alto, i) => {
      const x = (LIENZO - anchoTotal) / 2 + i * (ancho + hueco);
      return `<rect x="${x}" y="${base - alto}" width="${ancho}" height="${alto}" rx="${radio}" fill="${NARANJA}"/>`;
    })
    .join("");

  const desplazamiento = (LIENZO * (1 - escala)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LIENZO}" height="${LIENZO}" viewBox="0 0 ${LIENZO} ${LIENZO}">
  <rect width="${LIENZO}" height="${LIENZO}" fill="${FONDO}"/>
  <g transform="translate(${desplazamiento} ${desplazamiento}) scale(${escala})">${barras}</g>
</svg>`;
}

const publico = join(process.cwd(), "public");

interface Salida {
  fichero: string;
  tamano: number;
  escala: number;
}

const SALIDAS: Salida[] = [
  { fichero: "icon-192.png", tamano: 192, escala: 1 },
  { fichero: "icon-512.png", tamano: 512, escala: 1 },
  // Recortable: la marca cabe en el círculo de seguridad del 80 %.
  { fichero: "icon-maskable-512.png", tamano: 512, escala: 0.66 },
  // iOS redondea las esquinas él solo y no respeta la transparencia, por eso
  // el fondo es sólido y el PNG va sin canal alfa.
  { fichero: "apple-touch-icon.png", tamano: 180, escala: 1 },
];

async function main(): Promise<void> {
  for (const { fichero, tamano, escala } of SALIDAS) {
    const png = await sharp(Buffer.from(svg(escala)))
      .resize(tamano, tamano)
      .flatten({ background: FONDO })
      .png()
      .toBuffer();
    writeFileSync(join(publico, fichero), png);
    console.log(
      `${fichero}  ${tamano}×${tamano}  ${(png.length / 1024).toFixed(1)} KB`,
    );
  }
  // Favicon del navegador: el mismo SVG, nítido a cualquier tamaño.
  writeFileSync(join(publico, "icon.svg"), svg(1));
  console.log("icon.svg");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
