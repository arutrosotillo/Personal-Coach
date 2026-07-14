# Especificación de producto

## Qué es

Aplicación personal de entrenamiento de hipertrofia, nutrición y seguimiento corporal para UN usuario. Conceptualmente similar a RP Hypertrophy, pero mucho más simple. Sin pagos, equipos, roles ni social. Local-first y privada.

## Qué debe conseguir

- Perder grasa gradualmente preservando/ganando músculo.
- Asegurar progressive overload con recomendaciones explicadas.
- Controlar volumen, intensidad y recuperación con tendencias, no con datos sueltos.
- Decir cuántas calorías y macros consumir, y ajustarlas con datos reales.
- Registrar peso, cintura, fotos y rendimiento.
- Detectar progreso, estancamiento o fatiga acumulada.

Prioridades estéticas (sesgan volumen y selección de ejercicios, ver TRAINING_ENGINE.md): hombro lateral/posterior → espalda ancha → pecho superior → brazos proporcionados → cintura visualmente estrecha → piernas desarrolladas → simetría. Objetivo cambiable entre pérdida de grasa, recomposición, ganancia controlada y mantenimiento.

Tono y filosofía: `COACH_PHILOSOPHY.md` (documento normativo para todo texto de usuario).

## Principio UX nº 1

La app compite con una libreta. **Registrar una serie debe costar <3 segundos, con una mano, desde el móvil.** Todo lo demás se subordina a ese momento (F2).

## Pantallas (13)

| # | Pantalla | Fase | Resumen |
|---|---|---|---|
| 1 | Onboarding | **F1** | Wizard de 8 pasos cortos; opcionales omitibles; revisión final antes de crear |
| 2 | Dashboard | **F1** (base) | Héroe contextual, estado del objetivo, programa; se enriquece en F2–F5 |
| 3 | Entrenamiento de hoy | F2 | Vista previa de la sesión con recomendaciones |
| 4 | Ejecución de entrenamiento | F2 | LA pantalla: filas por serie pre-rellenadas, steppers grandes, completar = 1 tap + temporizador |
| 5 | Historial | F2 | Sesiones y por-ejercicio con e1RM |
| 6 | Programa semanal | **F1** (lectura) / F2 (edición) | Días, sesiones, volumen semanal por grupo |
| 7 | Biblioteca de ejercicios | F2 | Catálogo con filtros, ficha, historial |
| 8 | Nutrición diaria | F4 | Totales + plantillas + restantes del día |
| 9 | Check-in semanal | F4 | Wizard: datos → revisión → sensaciones → recomendaciones |
| 10 | Progreso corporal | F4–F5 | Peso+EMA, cintura, fotos con guía y comparador |
| 11 | Recomendaciones | F5 | Tarjetas con acción, porqué, evidencia, aceptar/editar/rechazar |
| 12 | Configuración y exportación | **F1** (base) / F7 (export) | Perfil, objetivo, datos |
| 13 | Chat del coach | F6 | Coach AI (ver AI_COACH.md) |

## Navegación

Bottom nav de 4 destinos: **Hoy · Entrenar · Progreso · Ajustes**. Nutrición se abre desde la tarjeta del Dashboard; Recomendaciones desde la campana con badge. Onboarding es pantalla completa sin nav.

## Flujos clave

- **Onboarding (~4 min)**: 8 pasos — perfil básico → experiencia y disponibilidad → equipamiento → objetivo y ritmo → prioridades musculares → actividad y nutrición → restricciones y preferencias → revisión y creación. Cada paso ≤5 campos y explica el porqué; lo omitido nunca bloquea. Al confirmar se crean perfil, objetivo, preferencias y un programa inicial generado determinísticamente (marcado como "plan inicial, se refinará con tus datos").
- **Día de entrenamiento (F2)**: héroe "Empezar" → ejecución → feedback de 30 s → ✓.
- **Check-in diario 15 s (F4)**: peso + kcal desde el Dashboard.
- **Check-in semanal ~3 min (F4)** → recomendaciones con aceptar/editar/rechazar (F5).

## Sistema de diseño

Dark mode único. Paleta zinc (950 fondo / 900 tarjeta / 800 elevado) + acento amber-500 + semánticos green/yellow/red (el rojo se reserva a destructivo y dolor, jamás a adherencia). Tipografía del sistema con `tabular-nums` obligatorio en todo dato numérico. Targets táctiles ≥44 px (56–72 px en ejecución). Formato es-ES (coma decimal). Estados vacíos siempre con acción; sin ilustraciones decorativas.

Anti-culpa (normativo): describir hechos y proponer siguiente paso; sin rachas rotas, sin rojo en semanas malas, sin evaluar a la persona. Ejemplos en COACH_PHILOSOPHY.md §9–10.

## Gráficas (F5)

Sí: peso+media móvil+banda+zona objetivo, tendencia semanal, volumen apilado por grupo con min/max, e1RM por ejercicio, cintura, kcal vs objetivo, heatmap de adherencia. No: gauges de "score", donuts de macros, radares, kcal quemadas, comparativas sociales.

## Adherencia (F4–F5)

Panel semanal por componentes, nunca un score único: entrenamientos completados, series completadas, días con registro calórico, días en rango, proteína, pasos, pesajes, sueño registrado, check-in semanal. Resumen textual arriba; los componentes siempre visibles.

## Calendario (F5)

Vista mensual con capas: entrenamientos, pesajes, check-ins, eventos personales, deloads, cambios de kcal/programa.

## Eventos personales (tabla desde F1, UI en F5)

Registro rápido de: viaje, enfermedad, estrés alto, mala semana de sueño, alcohol, cambio de gimnasio, cambio de máquina, lesión/molestia, exámenes, trabajo intenso, evento social, otro. Aparecen en gráficas y análisis como contexto; nunca como causa afirmada.

## Seguridad y límites (transversal)

Avisos y freno de recomendaciones agresivas ante: pérdida >1,5 %/semana sostenida, kcal bajo suelo, dolor persistente, síntomas preocupantes, conducta alimentaria de riesgo, deterioro intenso de rendimiento, cambios de peso anormales. Nunca diagnostica ni recomienda sustancias. Detalle en NUTRITION_ENGINE.md §9 y COACH_PHILOSOPHY.md §12.
