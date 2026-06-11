import * as net from "net";
import * as readline from "readline";

const HOST: string = "192.168.5.130";
const PORT: number = 3000;

// ---------------------------------------------------------------------------
// Tipos del protocolo
// ---------------------------------------------------------------------------

interface UserInfo {
  username: string;
}

// Paquetes salientes (cliente -> servidor)
interface JoinPacket {
  type: "join";
}

interface PublicMessagePacket {
  type: "message";
  scope: "public";
  text: string;
}

interface PrivateMessagePacket {
  type: "message";
  scope: "private";
  to: string;
  text: string;
}

type OutgoingPacket = JoinPacket | PublicMessagePacket | PrivateMessagePacket;

// Paquetes entrantes (servidor -> cliente)
interface WelcomePacket {
  type: "welcome";
  self: string;
  message: string;
  users: UserInfo[];
  timestamp: string;
}

interface UsersPacket {
  type: "users";
  users: UserInfo[];
  timestamp: string;
}

interface MessagePacket {
  type: "message";
  scope: string;
  from: string;
  text: string;
  to?: string;
  timestamp: string;
}

interface SystemPacket {
  type: "system";
  message: string;
  timestamp: string;
}

interface ErrorPacket {
  type: "error";
  message: string;
  timestamp: string;
}

type IncomingPacket =
  | WelcomePacket
  | UsersPacket
  | MessagePacket
  | SystemPacket
  | ErrorPacket;

// ---------------------------------------------------------------------------
// Estado local del cliente
// ---------------------------------------------------------------------------

let socket: net.Socket;
let rl: readline.Interface;
let buffer: string = "";
let selfName: string = "";
let users: UserInfo[] = [];

// ---------------------------------------------------------------------------
// Salida por consola
// ---------------------------------------------------------------------------

// Imprime una línea limpiando el prompt actual para que no se mezcle.
function printLine(line: string): void {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  console.log(line);
  if (rl !== undefined) {
    rl.prompt(true);
  }
}

// ---------------------------------------------------------------------------
// Envío y recepción
// ---------------------------------------------------------------------------

function sendPacket(packet: OutgoingPacket): void {
  if (socket.destroyed) {
    return;
  }
  socket.write(JSON.stringify(packet) + "\n");
}

// Acumula datos entrantes y extrae las líneas completas (delimitadas por \n).
function ingest(chunk: string): string[] {
  buffer += chunk;
  const lines: string[] = [];
  let index: number = buffer.indexOf("\n");
  while (index !== -1) {
    const line: string = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    lines.push(line);
    index = buffer.indexOf("\n");
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Manejo de paquetes entrantes
// ---------------------------------------------------------------------------

function handlePacket(packet: IncomingPacket): void {
  switch (packet.type) {
    case "welcome":
      selfName = packet.self;
      users = packet.users;
      printLine(`[sistema] ${packet.message}`);
      printLine(`[sistema] Conectado como ${selfName}.`);
      return;
    case "users":
      users = packet.users;
      return;
    case "message":
      handleMessagePacket(packet);
      return;
    case "system":
      printLine(`[sistema] ${packet.message}`);
      return;
    case "error":
      printLine(`[error] ${packet.message}`);
      return;
    default:
      return;
  }
}

function handleMessagePacket(packet: MessagePacket): void {
  if (packet.scope === "private") {
    printLine(`(privado) ${packet.from}: ${packet.text}`);
  } else {
    printLine(`${packet.from}: ${packet.text}`);
  }
}

// Parsea una línea cruda y la despacha si es un objeto válido.
function handleLine(line: string): void {
  const trimmed: string = line.trim();
  if (trimmed.length === 0) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (isIncomingPacket(parsed)) {
    handlePacket(parsed);
  }
}

// Type guard mínimo para validar la forma de un paquete entrante sin usar "any".
function isIncomingPacket(value: unknown): value is IncomingPacket {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj: Record<string, unknown> = value as Record<string, unknown>;
  return typeof obj.type === "string";
}

// ---------------------------------------------------------------------------
// Manejo de input del usuario
// ---------------------------------------------------------------------------

function handleUserInput(input: string): void {
  const text: string = input.trim();
  if (text.length === 0) {
    rl.prompt(true);
    return;
  }

  if (text.startsWith("/")) {
    handleCommand(text);
  } else {
    sendPublicMessage(text);
    rl.prompt(true);
  }
}

function handleCommand(text: string): void {
  const spaceIndex: number = text.indexOf(" ");
  const command: string = spaceIndex === -1 ? text : text.slice(0, spaceIndex);
  const rest: string = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();

  switch (command) {
    case "/privado":
      handlePrivateCommand(rest);
      break;
    case "/usuarios":
      showUsers();
      break;
    case "/salir":
      quit();
      return;
    default:
      printLine(`[error] Comando desconocido: ${command}`);
      break;
  }
  rl.prompt(true);
}

function sendPublicMessage(text: string): void {
  const packet: PublicMessagePacket = {
    type: "message",
    scope: "public",
    text,
  };
  sendPacket(packet);
}

function handlePrivateCommand(rest: string): void {
  const spaceIndex: number = rest.indexOf(" ");
  if (spaceIndex === -1) {
    printLine("[error] Uso: /privado <usuario> <mensaje>");
    return;
  }
  const to: string = rest.slice(0, spaceIndex);
  const message: string = rest.slice(spaceIndex + 1).trim();
  if (to.length === 0 || message.length === 0) {
    printLine("[error] Uso: /privado <usuario> <mensaje>");
    return;
  }

  const packet: PrivateMessagePacket = {
    type: "message",
    scope: "private",
    to,
    text: message,
  };
  sendPacket(packet);
  printLine(`(privado para ${to}) ${message}`);
}

function showUsers(): void {
  if (users.length === 0) {
    printLine("[sistema] No hay usuarios conectados.");
    return;
  }
  const names: string = users
    .map((user: UserInfo): string =>
      user.username === selfName ? `${user.username} (tú)` : user.username
    )
    .join(", ");
  printLine(`[sistema] Usuarios conectados (${users.length}): ${names}`);
}

function quit(): void {
  printLine("[sistema] Cerrando conexión...");
  socket.end();
  rl.close();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Conexión y ciclo de vida
// ---------------------------------------------------------------------------

function connectToServer(): void {
  socket = net.createConnection({ host: HOST, port: PORT }, (): void => {
    printLine(`[sistema] Conectado a ${HOST}:${PORT}`);
    const join: JoinPacket = { type: "join" };
    sendPacket(join);
  });

  socket.setEncoding("utf8");

  socket.on("data", (data: string): void => {
    const lines: string[] = ingest(data);
    for (const line of lines) {
      handleLine(line);
    }
  });

  socket.on("close", (): void => {
    printLine("[sistema] Conexión cerrada por el servidor.");
    rl.close();
    process.exit(0);
  });

  socket.on("error", (err: Error): void => {
    printLine(`[error] Error de conexión: ${err.message}`);
    process.exit(1);
  });
}

function setupReadline(): void {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "> ",
  });

  rl.on("line", (input: string): void => {
    handleUserInput(input);
  });

  rl.on("SIGINT", (): void => {
    quit();
  });

  rl.prompt(true);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function main(): void {
  setupReadline();
  connectToServer();
}

main();
