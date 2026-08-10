# Workspace, Chat y Guardado de Proveedor — Diseño

## Objetivo

Corregir el flujo de selección de workspace y conseguir que, después de elegir una carpeta, la aplicación deje un chat persistente listo para probar el agente. El guardado de proveedor, modelo, URL y API key debe ser una operación explícita, coherente y confirmada mediante un popup visible.

## Contexto y causa raíz

El selector nativo de Tauri dispone de permiso para abrir carpetas. El fallo ocurre después de que el diálogo devuelve una ruta: el frontend intenta iniciar el sidecar Node mediante `Command.spawn()` y escribir la petición RPC por `stdin`, pero la capability solo concede `shell:allow-execute`.

La excepción se almacena en el estado global, pero `ChatPanel` retorna antes de renderizar errores cuando no hay sesión activa. El resultado visible es que la carpeta parece no haberse seleccionado, aunque el diálogo haya funcionado correctamente.

## Alcance

### Selección de workspace

- Conceder únicamente las capabilities de Tauri que usa el transporte actual: arranque del proceso y escritura por `stdin`.
- Mantener la selección mediante el diálogo nativo de `@tauri-apps/plugin-dialog`.
- Inicializar o abrir `<workspace>/.agente/sessions.db` mediante el sidecar.
- Hacer visibles los estados `Seleccionando carpeta`, `Preparando workspace`, `Chat listo` y cualquier error.
- Evitar que una segunda pulsación lance inicializaciones concurrentes.

### Sesión y chat listo para probar

- Si el workspace contiene sesiones, activar automáticamente la de mayor `updatedAt`; si hay empate, usar `createdAt` y después `id` como desempate determinista.
- Si no contiene sesiones, crear `Sesión de prueba` con los valores predeterminados actuales y activarla.
- Cargar los mensajes de la sesión activada antes de marcar el chat como listo.
- Mantener la gestión manual de sesiones existente para crear, cambiar, renombrar o eliminar sesiones adicionales.
- Mostrar el chat únicamente cuando exista un workspace y una sesión activa; mientras se prepara, mostrar un estado de carga explicativo.

### Configuración del proveedor

- Tratar proveedor, modelo, base URL y API key como un único formulario editable.
- Añadir un botón inequívoco `Guardar configuración`.
- Validar que el modelo no esté vacío.
- Exigir API key para proveedores remotos cuando todavía no exista una clave en RAM; Ollama puede guardarse sin clave.
- Validar `baseUrl` cuando se informe y permitir que quede vacía para usar el valor predeterminado del proveedor.
- Enviar una única operación RPC de guardado. El servidor debe validar primero todos los campos y actualizar la clave en RAM solo después de que la configuración sea válida.
- Mantener proveedor, modelo y base URL como configuración efectiva de la ejecución actual; este alcance no promete restaurarlos después de reiniciar la aplicación.
- No devolver, registrar ni persistir el valor de la API key.
- Tras éxito, actualizar el estado efectivo, limpiar el campo de clave y mostrar el popup `Configuración guardada correctamente`.
- Tras error, mantener los valores introducidos, dejar el panel abierto y mostrar un mensaje accionable.

## Arquitectura

### Frontera Tauri y transporte RPC

`apps/desktop/src-tauri/capabilities/default.json` declarará los permisos mínimos compatibles con `Command.spawn()` y `Child.write()`. `apps/desktop/src/lib/ipc.ts` seguirá siendo el único propietario del proceso Node y del protocolo por líneas.

El transporte deberá:

- Rechazar peticiones pendientes si el sidecar emite error o termina.
- Limpiar `child` y `spawnPromise` al finalizar para permitir un nuevo arranque.
- Aplicar timeout a cada petición RPC para evitar promesas pendientes indefinidamente.
- Conservar los eventos `agent:*` separados de las respuestas RPC.

### Orquestación del workspace

La operación de alto nivel quedará encapsulada en una función reutilizable que ejecute secuencialmente:

1. `initWorkspace(workspacePath)`.
2. `listTools()`.
3. Elegir la sesión más recientemente actualizada o llamar a `createSession()`.
4. `listMessages(sessionId)`.
5. Publicar una sola transición coherente al estado React.

Si cualquier paso falla, no se publicará un workspace parcialmente listo. La ruta seleccionada podrá mostrarse como contexto del error, pero el chat permanecerá desactivado hasta completar la inicialización.

### Estado de React

El store distinguirá entre:

- Configuración de proveedor guardada y borrador del formulario.
- Estado de preparación del workspace.
- Notificaciones globales temporales.
- Errores globales persistentes hasta que el usuario los cierre o reintente.

La activación inicial de sesión se realizará mediante una única acción que incluya workspace, sesiones, sesión activa, mensajes y herramientas. Esto evita renders intermedios donde el workspace existe pero el chat todavía no sabe qué sesión usar.

### Feedback global

Se incorporará un componente de notificación accesible situado en `App`, fuera de `ChatPanel` y `SettingsPanel`.

- Éxito: popup no bloqueante, anunciado con `role="status"`, cierre automático y botón de cierre.
- Error: aviso persistente con `role="alert"` y acción de cierre.
- El popup no utilizará `window.alert`, porque bloquearía la interfaz y no encaja con el transporte asíncrono.

## Flujo de datos

```text
Seleccionar carpeta
  -> diálogo nativo
  -> initWorkspace
  -> listar herramientas
  -> activar sesión reciente o crear "Sesión de prueba"
  -> cargar mensajes
  -> actualizar store de forma atómica
  -> enfocar el campo del chat

Guardar configuración
  -> validar borrador en UI
  -> saveProviderConfig por RPC
  -> validar de nuevo en servidor
  -> actualizar API key en RAM
  -> confirmar configuración sin devolver secretos
  -> actualizar store
  -> mostrar popup de éxito
```

## Diseño visual y accesibilidad

Se mantiene el lenguaje visual actual para que el cambio sea coherente con el MVP:

- Fondo principal: neutral 950 (`#0a0a0a`).
- Superficie: neutral 900 (`#171717`).
- Borde: neutral 700 (`#404040`).
- Éxito: emerald 500/700 (`#10b981` / `#047857`).
- Error: red 300/800 (`#fca5a5` / `#991b1b`).
- Tipografía principal: sans-serif del sistema.
- Rutas, modelos y nombres de tools: familia monospace del sistema.

La firma de la interacción será una progresión textual breve en el selector de workspace: carpeta seleccionada, preparación y chat listo. No se añadirán animaciones decorativas ni nuevas dependencias.

Todos los controles nuevos deberán tener foco visible, etiquetas accesibles y estado `disabled` durante operaciones pendientes.

## Manejo de errores y casos extremos

- Cancelar el diálogo no cambia el workspace actual ni muestra error.
- Una ruta vacía o inválida se rechaza en el servidor.
- Un workspace sin permisos de escritura muestra que no pudo crearse `.agente/`.
- Si la base SQLite no puede abrirse, se cierra cualquier handle parcial y no se sustituye el workspace activo.
- Si crear la sesión automática falla, el chat no se presenta como listo.
- Si el sidecar termina, todas las peticiones pendientes fallan con un mensaje común y el siguiente intento puede reiniciarlo.
- Pulsaciones repetidas de guardar no producen escrituras concurrentes.
- Una API key vacía no elimina accidentalmente una clave existente.
- La notificación de éxito solo aparece después de la confirmación del servidor.

## Seguridad

- Las API keys permanecen exclusivamente en RAM en este alcance.
- Ningún error, evento, respuesta RPC o estado serializable incluye la clave.
- Las capabilities de shell se limitan al comando Node ya declarado; no se habilita shell libre.
- La ruta del workspace se valida en la frontera del servidor antes de crear archivos.
- Los errores presentados al usuario no incluyen parámetros RPC sensibles.

## Estrategia de pruebas

### Pruebas frontend

- Cancelar la selección conserva el estado anterior.
- Seleccionar un workspace con sesiones activa la más reciente y carga sus mensajes.
- Seleccionar un workspace vacío crea y activa `Sesión de prueba`.
- Un fallo del sidecar se muestra aunque todavía no exista sesión activa.
- Guardar configuración válida muestra el popup de éxito.
- Un fallo de guardado no muestra éxito y conserva el borrador.
- El botón de guardado queda desactivado durante la petición.

### Pruebas de servidor y transporte

- El handler de configuración valida el proveedor, modelo y URL antes de mutar `KeyStore`.
- La respuesta nunca contiene la API key.
- `initWorkspace` rechaza rutas inválidas y no deja estado parcial.
- La salida o error del sidecar rechaza peticiones pendientes y permite reinicio.
- El timeout RPC elimina la petición del mapa de pendientes.

### Verificación manual

1. Ejecutar `pnpm tauri dev`.
2. Seleccionar una carpeta real sin `.agente/` y comprobar que aparece un chat listo.
3. Reiniciar la app, seleccionar la misma carpeta y comprobar que se activa la sesión existente.
4. Configurar proveedor, modelo y clave; guardar y comprobar el popup.
5. Enviar un prompt real y verificar que usuario y respuesta aparecen en el historial.

## Criterios de aceptación

- Seleccionar una carpeta válida termina con una sesión activa y el chat habilitado.
- Un fallo de inicialización siempre es visible y permite reintentar.
- Un workspace nuevo recibe exactamente una sesión automática.
- Un workspace existente no recibe sesiones duplicadas por volver a seleccionarlo.
- El popup de éxito aparece exclusivamente después de guardar correctamente proveedor, modelo y API key.
- Las claves no aparecen en logs, errores, respuestas RPC ni SQLite.
- Las pruebas nuevas, `pnpm lint`, el build TypeScript/Vite, `cargo check` y las pruebas no dependientes de Docker quedan en verde.

## Fuera de alcance

- Persistencia cifrada de claves en disco.
- Configuración de proveedor secundario y failover desde la UI.
- Rediseño visual completo de la aplicación.
- Corrección integral de las demás brechas detectadas en las Fases 2–10.
- Empaquetado con `tauri build`.
