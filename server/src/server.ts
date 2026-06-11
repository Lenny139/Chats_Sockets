import * as net from "net";

const PORT: number = 3000;

// ---------------------------------------------------------------------------
// Tipos del protocolo
// ---------------------------------------------------------------------------

interface UserInfo {
  username: string;
}

// Paquetes entrantes (cliente -> servidor)
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

type IncomingPacket = JoinPacket | PublicMessagePacket | PrivateMessagePacket;

// Paquetes salientes (servidor -> cliente)
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

type OutgoingPacket =
  | WelcomePacket
  | UsersPacket
  | MessagePacket
  | SystemPacket
  | ErrorPacket;

// ---------------------------------------------------------------------------
// Estado del servidor
// ---------------------------------------------------------------------------

const clients: Map<string, ClientHandler> = new Map();
let userCounter: number = 0;

function nextUsername(): string {
  userCounter += 1;
  return `usuario${userCounter}`;
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// ClientHandler: encapsula el socket, el buffer y el username de un cliente
// ---------------------------------------------------------------------------

class ClientHandler {
  public readonly socket: net.Socket;
  public username: string;
  public joined: boolean;
  private buffer: string;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.username = "";
    this.joined = false;
    this.buffer = "";
  }

  // Envía un paquete serializado como JSON terminado en \n.
  public send(packet: OutgoingPacket): void {
    if (this.socket.destroyed) {
      return;
    }
    this.socket.write(JSON.stringify(packet) + "\n");
  }

  // Acumula datos entrantes y extrae las líneas completas (delimitadas por \n).
  public ingest(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let index: number = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line: string = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      lines.push(line);
      index = this.buffer.indexOf("\n");
    }
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Utilidades de envío / broadcast
// ---------------------------------------------------------------------------

function listUsers(): UserInfo[] {
  const result: UserInfo[] = [];
  for (const client of clients.values()) {
    if (client.joined) {
      result.push({ username: client.username });
    }
  }
  return result;
}

// Envía un paquete a todos los clientes unidos, opcionalmente excluyendo a uno.
function broadcast(packet: OutgoingPacket, exclude?: ClientHandler): void {
  for (const client of clients.values()) {
    if (!client.joined) {
      continue;
    }
    if (exclude !== undefined && client === exclude) {
      continue;
    }
    client.send(packet);
  }
}

function broadcastUsers(): void {
  const packet: UsersPacket = {
    type: "users",
    users: listUsers(),
    timestamp: now(),
  };
  broadcast(packet);
}

function sendSystem(target: ClientHandler, message: string): void {
  const packet: SystemPacket = {
    type: "system",
    message,
    timestamp: now(),
  };
  target.send(packet);
}

function sendError(target: ClientHandler, message: string): void {
  const packet: ErrorPacket = {
    type: "error",
    message,
    timestamp: now(),
  };
  target.send(packet);
}

// ---------------------------------------------------------------------------
// Manejo de paquetes entrantes
// ---------------------------------------------------------------------------

function handleJoin(client: ClientHandler): void {
  if (client.joined) {
    sendError(client, "Ya te has unido al chat.");
    return;
  }

  client.username = nextUsername();
  client.joined = true;
  clients.set(client.username, client);

  const welcome: WelcomePacket = {
    type: "welcome",
    self: client.username,
    message: `Bienvenido, ${client.username}.`,
    users: listUsers(),
    timestamp: now(),
  };
  client.send(welcome);

  const joinedPacket: SystemPacket = {
    type: "system",
    message: `${client.username} se unió`,
    timestamp: now(),
  };
  broadcast(joinedPacket, client);

  broadcastUsers();
}

function handlePublicMessage(
  client: ClientHandler,
  packet: PublicMessagePacket
): void {
  const outgoing: MessagePacket = {
    type: "message",
    scope: "public",
    from: client.username,
    text: packet.text,
    timestamp: now(),
  };
  broadcast(outgoing, client);
}

function handlePrivateMessage(
  client: ClientHandler,
  packet: PrivateMessagePacket
): void {
  const target: ClientHandler | undefined = clients.get(packet.to);
  if (target === undefined || !target.joined) {
    sendError(client, `El usuario "${packet.to}" no existe o no está conectado.`);
    return;
  }

  const outgoing: MessagePacket = {
    type: "message",
    scope: "private",
    from: client.username,
    to: packet.to,
    text: packet.text,
    timestamp: now(),
  };
  target.send(outgoing);
}

// Valida y despacha un paquete ya parseado.
function dispatchPacket(client: ClientHandler, packet: IncomingPacket): void {
  switch (packet.type) {
    case "join":
      handleJoin(client);
      return;
    case "message":
      if (!client.joined) {
        sendError(client, "Debes unirte antes de enviar mensajes.");
        return;
      }
      if (packet.scope === "public") {
        handlePublicMessage(client, packet);
      } else if (packet.scope === "private") {
        handlePrivateMessage(client, packet);
      } else {
        sendError(client, "Scope de mensaje desconocido.");
      }
      return;
    default:
      sendError(client, "Tipo de paquete desconocido.");
  }
}

// Parsea una línea de texto y, si es válida, la despacha.
function handleLine(client: ClientHandler, line: string): void {
  const trimmed: string = line.trim();
  if (trimmed.length === 0) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    sendError(client, "JSON inválido.");
    return;
  }

  if (!isIncomingPacket(parsed)) {
    sendError(client, "Paquete con formato inválido.");
    return;
  }

  dispatchPacket(client, parsed);
}

// Type guard que valida la forma de un paquete entrante sin usar "any".
function isIncomingPacket(value: unknown): value is IncomingPacket {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj: Record<string, unknown> = value as Record<string, unknown>;

  if (obj.type === "join") {
    return true;
  }

  if (obj.type === "message") {
    if (typeof obj.text !== "string") {
      return false;
    }
    if (obj.scope === "public") {
      return true;
    }
    if (obj.scope === "private") {
      return typeof obj.to === "string";
    }
    return false;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Ciclo de vida de la conexión
// ---------------------------------------------------------------------------

function handleDisconnect(client: ClientHandler): void {
  if (!client.joined) {
    return;
  }
  client.joined = false;
  clients.delete(client.username);
  console.log(`[-] ${client.username} desconectado`);

  const leftPacket: SystemPacket = {
    type: "system",
    message: `${client.username} salió`,
    timestamp: now(),
  };
  broadcast(leftPacket);
  broadcastUsers();
}

function handleConnection(socket: net.Socket): void {
  socket.setEncoding("utf8");
  const client: ClientHandler = new ClientHandler(socket);
  console.log(`[+] Nueva conexión desde ${socket.remoteAddress ?? "desconocido"}`);

  socket.on("data", (data: string): void => {
    const lines: string[] = client.ingest(data);
    for (const line of lines) {
      handleLine(client, line);
    }
  });

  socket.on("close", (): void => {
    handleDisconnect(client);
  });

  socket.on("error", (err: Error): void => {
    console.log(`[!] Error en socket de ${client.username || "anónimo"}: ${err.message}`);
    handleDisconnect(client);
  });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function startServer(): void {
  const server: net.Server = net.createServer(handleConnection);

  server.on("error", (err: Error): void => {
    console.log(`[!] Error del servidor: ${err.message}`);
  });

  server.listen(PORT, (): void => {
    console.log(`Servidor de chat TCP escuchando en el puerto ${PORT}`);
  });
}

startServer();
