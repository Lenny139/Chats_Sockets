# chat-sockets

Chat multiusuario en tiempo real sobre **sockets TCP**, escrito en **TypeScript**.
Un único servidor TCP central reparte los mensajes entre todos los clientes
conectados, soportando mensajes **públicos** (a todos) y **privados** (a un
usuario concreto). Hay dos clientes: uno de **terminal** (Node.js, TCP directo)
y uno **web** (browser, vía un proxy WebSocket↔TCP).

El protocolo es **JSON delimitado por saltos de línea** (newline-delimited JSON):
cada mensaje es un objeto JSON en una sola línea terminada en `\n`.

## Arquitectura

```
                         ┌─────────────────────────┐
                         │   Servidor TCP de chat   │
                         │      (net, :3000)        │
                         └────────────┬────────────┘
                                      │  TCP (JSON + \n)
                ┌─────────────────────┼─────────────────────┐
                │                                            │
                │ TCP                                        │ TCP
                ▼                                            ▼
     ┌─────────────────────┐                   ┌─────────────────────────┐
     │   terminal-client   │                   │   proxy WS↔TCP (:3001)   │
     │   (Node.js, net)    │                   │     (ws + net)          │
     └─────────────────────┘                   └────────────┬────────────┘
                                                            │  WebSocket (JSON + \n)
                                                            ▼
                                                 ┌─────────────────────┐
                                                 │     web-client      │
                                                 │  (browser, ws API)  │
                                                 │   index.html        │
                                                 └─────────────────────┘
```

- El **terminal-client** habla TCP directamente con el servidor.
- El **browser** no puede abrir sockets TCP, así que el **web-client** se conecta
  por WebSocket al **proxy**, que retransmite los bytes de forma transparente
  hacia/desde el servidor TCP.

## Estructura

```
chat-sockets/
├── server/                      # Servidor TCP (:3000)
│   ├── src/server.ts
│   ├── package.json
│   └── tsconfig.json
├── clients/
│   ├── terminal-client/         # Cliente de terminal (TCP directo)
│   │   ├── src/client.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── web-client/              # Cliente browser + proxy WS↔TCP
│       ├── src/client.ts        # ChatClient (browser)
│       ├── src/types.ts         # Interfaces del protocolo
│       ├── src/proxy.ts         # Proxy WebSocket↔TCP (:3001, Node.js)
│       ├── index.html           # UI vanilla
│       ├── package.json
│       ├── tsconfig.json        # Build del browser (ESM + DOM)
│       └── tsconfig.proxy.json  # Build del proxy (CommonJS + Node)
└── README.md
```

## Instalación

Cada parte es un paquete npm independiente. Instala las dependencias en cada una:

```bash
cd server               && npm install
cd clients/terminal-client && npm install
cd clients/web-client      && npm install
```

## Ejecución paso a paso

### 1. Servidor (obligatorio siempre)

```bash
cd server
npm run dev          # desarrollo, con ts-node
# o bien:
npm run build && npm start
```
Queda escuchando en `127.0.0.1:3000`.

### 2a. Cliente de terminal

En otra terminal:

```bash
cd clients/terminal-client
npm run dev          # o: npm run build && npm start
```
Se conecta, envía `join` automáticamente y quedas listo para chatear.

### 2b. Cliente web (proxy + browser)

El browser necesita el proxy WebSocket↔TCP corriendo:

```bash
cd clients/web-client
npm run dev:proxy    # proxy en :3001 con ts-node
# o bien:
npm run build:proxy && npm start
```

Compila el código del browser y abre la página:

```bash
npm run build        # genera dist/client.js y dist/types.js
# abre clients/web-client/index.html en el navegador
```

En la UI, indica host `localhost` y puerto `3001` y pulsa **Conectar**.

> Sugerencia: sirve la carpeta con un servidor estático (p. ej. `npx serve`)
> en lugar de abrir el `index.html` con `file://`, para evitar restricciones
> de módulos ES en el navegador.

## Protocolo JSON

Transporte: una línea de texto por mensaje, terminada en `\n`, con un objeto
JSON. `dirección` indica el sentido: **C→S** (cliente a servidor) o **S→C**
(servidor a cliente).

### Cliente → Servidor

| type      | scope     | Campos                          | Descripción                              |
|-----------|-----------|---------------------------------|------------------------------------------|
| `join`    | —         | `type`                          | Registra al cliente; recibe nombre auto. |
| `message` | `public`  | `type`, `scope`, `text`         | Mensaje a todos menos al emisor.         |
| `message` | `private` | `type`, `scope`, `to`, `text`   | Mensaje solo al usuario `to`.            |

### Servidor → Cliente

| type      | Campos                                                    | Descripción                                   |
|-----------|----------------------------------------------------------|-----------------------------------------------|
| `welcome` | `type`, `self`, `message`, `users[]`, `timestamp`        | Confirma unión; `self` es tu nombre asignado. |
| `users`   | `type`, `users[]`, `timestamp`                           | Lista actualizada de usuarios conectados.     |
| `message` | `type`, `scope`, `from`, `text`, `to?`, `timestamp`      | Mensaje público o privado entrante.           |
| `system`  | `type`, `message`, `timestamp`                           | Aviso del sistema (alguien entró/salió).      |
| `error`   | `type`, `message`, `timestamp`                           | Error (destino inexistente, JSON inválido…).  |

Donde `users[]` es un array de objetos `{ "username": string }` y `timestamp`
es una marca ISO 8601. El campo `to` solo aparece en mensajes privados.

### Ejemplos

```json
{"type":"join"}
{"type":"message","scope":"public","text":"hola a todos"}
{"type":"message","scope":"private","to":"usuario2","text":"hola en privado"}
{"type":"welcome","self":"usuario1","message":"Bienvenido, usuario1.","users":[{"username":"usuario1"}],"timestamp":"2026-06-11T12:00:00.000Z"}
{"type":"message","scope":"public","from":"usuario2","text":"hola","timestamp":"2026-06-11T12:00:01.000Z"}
```

## Comandos del cliente de terminal

| Comando                       | Acción                                              |
|-------------------------------|-----------------------------------------------------|
| `texto sin prefijo`           | Envía un mensaje público a todos.                   |
| `/privado <usuario> <mensaje>`| Envía un mensaje privado a `<usuario>`.             |
| `/usuarios`                   | Muestra la lista local de usuarios conectados.      |
| `/salir`                      | Cierra la conexión y termina el cliente.            |

En el cliente web, el equivalente a `/privado` es hacer clic sobre un usuario de
la lista (el siguiente mensaje irá como privado); el botón **Volver a público**
o el indicador `→ Todos / → usuario (privado)` muestran a quién escribes.
