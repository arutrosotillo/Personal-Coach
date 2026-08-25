# Privacidad de Coach AI

> **Estado: implementado (Coach AI v1).** Este documento describe lo que el
> código hace HOY. Lo que aquí no está, no existe. Antes decía "Fase 6; NO
> implementado aún" y listaba controles (pantalla de consentimiento, vista
> previa del payload, interruptor en Ajustes, borrado de chats, modo debug)
> que nunca se construyeron: una política publicada que el software no cumplía.

Los datos de esta app son corporales y de hábitos: el envío a OpenAI es la única salida de datos de toda la aplicación y se trata con el máximo cuidado.

## Qué se envía (solo al pulsar un botón del coach, nunca de fondo)

Lo que construye `src/ai/context.ts`, acotado a `AI_CONFIG.maxContextChars`:

- **Perfil, agregado y sin identificar**: objetivo, estrategia, nivel de experiencia derivado de los años entrenando y días/semana. Nada más.
- **Sesiones recientes** (hasta 12): fecha, nombre de la plantilla, series previstas y registradas, los chips de feedback y **la nota que hayas escrito**, truncada a 200 caracteres.
- **Ejercicios** (hasta 12): prescripción, últimas exposiciones con carga/reps/RIR, tendencias, la decisión del motor y sus señales.
- **Fatiga**: veredicto, puntuación, señales y márgenes de error.
- **La pregunta que escribes**, en Ask Coach.

## Qué NO se envía nunca

- Nombre, email, edad, sexo, altura, peso ni medidas corporales.
- Fotografías (no existen en la app).
- La base de datos completa ni filas crudas masivas.
- Identificadores internos: `variantId` se elimina explícitamente al serializar.
- La API key nunca sale del servidor, no se registra y no aparece en ningún mensaje de error.

## Qué NO se envía nunca

- Fotografías (jamás en el MVP).
- Nombre, email ni ningún identificador personal (el usuario es "el usuario"; ids internos anónimos si hacen falta).
- La base de datos completa ni filas crudas masivas.
- La API key no se registra en logs; los prompts completos no se persisten en producción.

## Consentimiento y control

- **El opt-in ES la clave.** Sin `OPENAI_API_KEY` en `.env`, `isCoachConfigured()` devuelve `false`, la sección Coach muestra "AI Coach no configurado", los botones de IA del drawer no se pintan y **no sale ni un dato de la máquina**. Ponerla es el acto de consentimiento; quitarla y reiniciar es la desactivación. No hay pantalla de consentimiento ni interruptor en Ajustes, y este documento ya no finge que los haya: es una app personal de un solo usuario que edita su propio `.env`.
- **Nada se persiste, ni aquí ni allí.** Las respuestas del coach son efímeras (no hay tablas de IA, decisión registrada en docs/DATA_MODEL.md) y las peticiones van con `store: false`, así que OpenAI tampoco las retiene para entrenamiento.
- **Bajo demanda, nunca de fondo.** No hay ninguna llamada automática: cada consulta la dispara un botón. Hay un tope de `AI_CONFIG.maxCallsPerHour` consultas por hora.
- Lo que el proveedor retenga se rige por su política.

## Lo que NO existe (y antes este documento prometía)

Pantalla de consentimiento, vista previa del payload antes de enviarlo,
interruptor en Ajustes, borrado de chats desde Ajustes y modo debug con prompts
anonimizados. Si alguna vez se construyen, se documentan aquí; mientras tanto,
no se anuncian.

## Recordatorio del resto de la app (sin IA)

Todo local: SQLite en `data/`, fotos en `data/photos/`, ambos gitignored. Cero trackers, analítica o CDNs; fuentes locales. Test E2E que falla ante cualquier request externo con IA desactivada. Export/import y borrado total en F7.
