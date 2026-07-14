# Privacidad de Coach AI (Fase 6; NO implementado aún)

Los datos de esta app son corporales y de hábitos: el envío a un proveedor de IA es la única salida de datos de toda la aplicación y se trata con el máximo cuidado.

## Qué se envía (cuando la IA está activada y solo al conversar/generar un análisis)

- Agregados compactos: edad, sexo, altura, objetivo y ritmo, tendencias de peso/cintura, targets y medias nutricionales, resúmenes de sesiones (ejercicio, series, cargas), adherencia, señales de recuperación, recomendaciones activas, eventos personales (tipo + nota truncada).
- El mensaje escrito por el usuario en el chat.

## Qué NO se envía nunca

- Fotografías (jamás en el MVP).
- Nombre, email ni ningún identificador personal (el usuario es "el usuario"; ids internos anónimos si hacen falta).
- La base de datos completa ni filas crudas masivas.
- La API key no se registra en logs; los prompts completos no se persisten en producción.

## Consentimiento y control

- **Opt-in explícito**: la IA está desactivada por defecto (`AI_ENABLED=false`). Antes de activarla, pantalla de consentimiento que nombra el proveedor y detalla qué se envía y qué no.
- **Vista "Datos que se enviarán"**: antes del primer chat y de cada análisis semanal/mensual se puede inspeccionar el payload exacto (los packs renderizados).
- Desactivable en cualquier momento (botón en Ajustes). Sin IA, la app funciona completa.
- Borrado: chats, resúmenes y memoria del coach se pueden borrar desde Ajustes; el borrado total de la app los incluye.
- Retención: solo local (SQLite). Nada se guarda en servidores propios (no existen); lo que el proveedor retenga se rige por su política, y se enlaza en la pantalla de consentimiento.

## Modo debug

Opcional y apagado por defecto. Si se activa, persiste prompts ANONIMIZADOS para diagnóstico: números y fechas sí; texto libre del usuario redactado. Nunca incluye la API key.

## Recordatorio del resto de la app (sin IA)

Todo local: SQLite en `data/`, fotos en `data/photos/`, ambos gitignored. Cero trackers, analítica o CDNs; fuentes locales. Test E2E que falla ante cualquier request externo con IA desactivada. Export/import y borrado total en F7.
