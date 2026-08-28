import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import {
  LOCKED_PASSWORD_HASH,
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "../src/server/auth/password";
import { describeTarget, requireDatabaseUrl } from "./pg-tools";

/**
 * Gestión de cuentas desde la línea de comandos. La app NO tiene registro
 * público: las cuentas se crean así, a mano, para ti y para tu familia.
 *
 *   pnpm user:create [usuario]      crear una cuenta
 *   pnpm user:list                  ver las cuentas y si tienen perfil
 *   pnpm user:password <usuario>    fijar o cambiar la contraseña
 *   pnpm user:disable <usuario>     dejar fuera sin borrar el historial
 *   pnpm user:enable  <usuario>     volver a dejar entrar
 *   pnpm user:rename  <viejo> <nuevo>
 *
 * Las contraseñas se piden por teclado y NO se muestran: pasarlas como
 * argumento las dejaría en el historial del shell y en la lista de procesos.
 */

function client(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireDatabaseUrl() }),
  });
}

/**
 * Entrada del usuario.
 *
 * Con un terminal se pregunta interactivamente. Sin él —tubería, script,
 * tests— se lee stdin ENTERO de una vez y se sirven las líneas de una cola:
 * `readline` deja la segunda pregunta sin resolver para siempre en cuanto el
 * flujo termina, así que encadenar preguntas sobre una tubería se cuelga.
 */
let cola: string[] | null = null;
let rl: ReturnType<typeof createInterface> | null = null;

async function leerLineasDeTuberia(): Promise<string[]> {
  const trozos: string[] = [];
  stdin.setEncoding("utf8");
  for await (const trozo of stdin) trozos.push(trozo as string);
  return trozos.join("").split("\n");
}

async function siguienteLinea(pregunta: string): Promise<string> {
  if (stdin.isTTY) {
    rl ??= createInterface({ input: stdin, output: stdout });
    return rl.question(pregunta);
  }
  cola ??= await leerLineasDeTuberia();
  const linea = cola.shift();
  if (linea === undefined) {
    throw new Error("Se acabó la entrada antes de responder a todo.");
  }
  stdout.write(pregunta + "\n");
  return linea;
}

function closeReadline() {
  rl?.close();
  rl = null;
}

async function ask(pregunta: string): Promise<string> {
  return (await siguienteLinea(pregunta)).trim();
}

/**
 * Lee una contraseña sin mostrarla.
 *
 * En un terminal se lee en crudo, carácter a carácter, y no se escribe nada.
 * El primer intento silenciaba `readline` sobrescribiendo un método privado y
 * NO funcionaba —la contraseña salía por pantalla— porque readline redibuja la
 * línea entera, prompt incluido, cada vez que se teclea.
 *
 * Sin terminal no hay eco que suprimir ni pantalla donde se filtre.
 */
async function askHidden(pregunta: string): Promise<string> {
  if (!stdin.isTTY) return siguienteLinea(pregunta);

  closeReadline();
  stdout.write(pregunta);
  return new Promise<string>((resolve, reject) => {
    const chars: string[] = [];
    const fin = (accion: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      accion();
    };
    const onData = (trozo: string) => {
      for (const c of trozo) {
        if (c === "\n" || c === "\r" || c === "\u0004") {
          fin(() => resolve(chars.join("")));
          return;
        }
        if (c === "\u0003") {
          fin(() => reject(new Error("Cancelado.")));
          return;
        }
        // Retroceso: borra el último carácter, sin pintar nada.
        if (c === "\u007f" || c === "\b") {
          chars.pop();
          continue;
        }
        chars.push(c);
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

/** Pide la contraseña dos veces y valida antes de tocar la base de datos. */
async function pedirContrasena(): Promise<string> {
  for (let intento = 0; intento < 3; intento++) {
    const primera = await askHidden("Contraseña (no se muestra): ");
    const problema = validatePassword(primera);
    if (problema) {
      console.error(problema);
      continue;
    }
    const segunda = await askHidden("Repítela: ");
    if (primera !== segunda) {
      console.error("No coinciden.");
      continue;
    }
    return primera;
  }
  throw new Error("Demasiados intentos.");
}

async function crear(prisma: PrismaClient, argumento?: string): Promise<void> {
  const entrada = argumento ?? (await ask("Usuario: "));
  const problema = validateUsername(entrada);
  if (problema) throw new Error(problema);
  const username = normalizeUsername(entrada);

  const existe = await prisma.user.findUnique({ where: { username } });
  if (existe) throw new Error(`El usuario "${username}" ya existe.`);

  const passwordHash = await hashPassword(await pedirContrasena());
  await prisma.user.create({ data: { username, passwordHash } });
  console.log(`\nCuenta "${username}" creada.`);
  console.log(
    "Al entrar por primera vez tendrá que completar el onboarding; su plan y su historial son suyos y nadie más los ve.",
  );
}

async function listar(prisma: PrismaClient): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      username: true,
      isActive: true,
      passwordHash: true,
      createdAt: true,
      profile: { select: { id: true } },
    },
  });
  if (users.length === 0) {
    console.log("No hay cuentas. Crea la primera con: pnpm user:create");
    return;
  }
  console.log(
    "USUARIO".padEnd(20) + "ESTADO".padEnd(18) + "PERFIL".padEnd(9) + "CREADA",
  );
  console.log("-".repeat(63));
  for (const u of users) {
    const estado = !u.isActive
      ? "desactivado"
      : u.passwordHash === LOCKED_PASSWORD_HASH
        ? "SIN CONTRASEÑA"
        : "activo";
    console.log(
      u.username.padEnd(20) +
        estado.padEnd(18) +
        (u.profile ? "sí" : "no").padEnd(9) +
        u.createdAt.toISOString().slice(0, 10),
    );
  }
  const bloqueadas = users.filter(
    (u) => u.passwordHash === LOCKED_PASSWORD_HASH,
  );
  if (bloqueadas.length > 0) {
    console.log(
      `\nSIN CONTRASEÑA = no puede entrar todavía. Fíjala con:\n` +
        bloqueadas.map((u) => `  pnpm user:password ${u.username}`).join("\n"),
    );
  }
}

async function porNombre(prisma: PrismaClient, entrada: string | undefined) {
  if (!entrada) throw new Error("Falta el nombre de usuario.");
  const username = normalizeUsername(entrada);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`No existe el usuario "${username}".`);
  return user;
}

async function cambiarContrasena(
  prisma: PrismaClient,
  nombre?: string,
): Promise<void> {
  const user = await porNombre(prisma, nombre);
  const passwordHash = await hashPassword(await pedirContrasena());
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  console.log(`\nContraseña de "${user.username}" actualizada.`);
  console.log(
    "Las sesiones abiertas siguen valiendo; para cerrarlas todas hay que rotar AUTH_SECRET.",
  );
}

async function activar(
  prisma: PrismaClient,
  nombre: string | undefined,
  isActive: boolean,
): Promise<void> {
  const user = await porNombre(prisma, nombre);
  await prisma.user.update({ where: { id: user.id }, data: { isActive } });
  console.log(
    `"${user.username}" ${isActive ? "reactivado" : "desactivado"}. ` +
      (isActive
        ? "Ya puede entrar."
        : "No puede entrar; su historial se conserva intacto."),
  );
}

async function renombrar(
  prisma: PrismaClient,
  viejo?: string,
  nuevo?: string,
): Promise<void> {
  const user = await porNombre(prisma, viejo);
  if (!nuevo) throw new Error("Falta el nombre nuevo.");
  const problema = validateUsername(nuevo);
  if (problema) throw new Error(problema);
  const username = normalizeUsername(nuevo);
  if (await prisma.user.findUnique({ where: { username } })) {
    throw new Error(`El usuario "${username}" ya existe.`);
  }
  await prisma.user.update({ where: { id: user.id }, data: { username } });
  console.log(`"${user.username}" pasa a llamarse "${username}".`);
}

async function main(): Promise<void> {
  const [comando, ...args] = process.argv.slice(2);
  const prisma = client();
  console.log(`Base de datos: ${describeTarget(requireDatabaseUrl())}\n`);
  try {
    switch (comando) {
      case "create":
        await crear(prisma, args[0]);
        break;
      case "list":
        await listar(prisma);
        break;
      case "password":
        await cambiarContrasena(prisma, args[0]);
        break;
      case "disable":
        await activar(prisma, args[0], false);
        break;
      case "enable":
        await activar(prisma, args[0], true);
        break;
      case "rename":
        await renombrar(prisma, args[0], args[1]);
        break;
      default:
        throw new Error(
          `Comando desconocido: ${comando ?? "(ninguno)"}.\n` +
            "Usa: create | list | password | disable | enable | rename",
        );
    }
  } finally {
    await prisma.$disconnect();
    closeReadline();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
