import {
  ClientPacket,
  ServerPacket,
  JoinPacket,
  PublicMessagePacket,
  PrivateMessagePacket,
  WelcomePacket,
  UsersPacket,
  MessagePacket,
  SystemPacket,
  ErrorPacket,
  User,
} from "./types.js";

// Callbacks que el consumidor (la UI) puede registrar.
export interface ChatClientCallbacks {
  onWelcome?: (packet: WelcomePacket) => void;
  onUsers?: (users: User[]) => void;
  onMessage?: (packet: MessagePacket) => void;
  onSystem?: (packet: SystemPacket) => void;
  onError?: (packet: ErrorPacket) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class ChatClient {
  private socket: WebSocket | null;
  private buffer: string;
  private readonly callbacks: ChatClientCallbacks;

  public url: string;
  public selfName: string;
  public users: User[];

  constructor(url: string, callbacks: ChatClientCallbacks = {}) {
    this.url = url;
    this.callbacks = callbacks;
    this.socket = null;
    this.buffer = "";
    this.selfName = "";
    this.users = [];
  }

  // -------------------------------------------------------------------------
  // Conexión
  // -------------------------------------------------------------------------

  public connect(): void {
    this.disconnect();
    this.buffer = "";
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener("open", (): void => {
      this.sendJoin();
      if (this.callbacks.onOpen !== undefined) {
        this.callbacks.onOpen();
      }
    });

    this.socket.addEventListener("message", (event: MessageEvent): void => {
      this.handleRawData(String(event.data));
    });

    this.socket.addEventListener("close", (): void => {
      if (this.callbacks.onClose !== undefined) {
        this.callbacks.onClose();
      }
    });

    this.socket.addEventListener("error", (): void => {
      const packet: ErrorPacket = {
        type: "error",
        message: "Error en la conexión WebSocket.",
        timestamp: new Date().toISOString(),
      };
      if (this.callbacks.onError !== undefined) {
        this.callbacks.onError(packet);
      }
    });
  }

  public disconnect(): void {
    if (this.socket !== null) {
      this.socket.close();
      this.socket = null;
    }
  }

  // -------------------------------------------------------------------------
  // Envío
  // -------------------------------------------------------------------------

  private sendPacket(packet: ClientPacket): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(packet) + "\n");
  }

  private sendJoin(): void {
    const packet: JoinPacket = { type: "join" };
    this.sendPacket(packet);
  }

  public sendPublicMessage(text: string): void {
    const trimmed: string = text.trim();
    if (trimmed.length === 0) {
      return;
    }
    const packet: PublicMessagePacket = {
      type: "message",
      scope: "public",
      text: trimmed,
    };
    this.sendPacket(packet);
  }

  public sendPrivateMessage(to: string, text: string): void {
    const trimmed: string = text.trim();
    if (to.length === 0 || trimmed.length === 0) {
      return;
    }
    const packet: PrivateMessagePacket = {
      type: "message",
      scope: "private",
      to,
      text: trimmed,
    };
    this.sendPacket(packet);
  }

  // -------------------------------------------------------------------------
  // Recepción
  // -------------------------------------------------------------------------

  // Acumula datos entrantes y procesa las líneas completas (delimitadas por \n).
  private handleRawData(chunk: string): void {
    this.buffer += chunk;
    let index: number = this.buffer.indexOf("\n");
    while (index !== -1) {
      const line: string = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
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

    if (this.isServerPacket(parsed)) {
      this.dispatch(parsed);
    }
  }

  private dispatch(packet: ServerPacket): void {
    switch (packet.type) {
      case "welcome":
        this.selfName = packet.self;
        this.users = packet.users;
        if (this.callbacks.onWelcome !== undefined) {
          this.callbacks.onWelcome(packet);
        }
        return;
      case "users":
        this.users = packet.users;
        if (this.callbacks.onUsers !== undefined) {
          this.callbacks.onUsers(packet.users);
        }
        return;
      case "message":
        if (this.callbacks.onMessage !== undefined) {
          this.callbacks.onMessage(packet);
        }
        return;
      case "system":
        if (this.callbacks.onSystem !== undefined) {
          this.callbacks.onSystem(packet);
        }
        return;
      case "error":
        if (this.callbacks.onError !== undefined) {
          this.callbacks.onError(packet);
        }
        return;
      default:
        return;
    }
  }

  // Type guard mínimo para validar la forma de un paquete del servidor.
  private isServerPacket(value: unknown): value is ServerPacket {
    if (typeof value !== "object" || value === null) {
      return false;
    }
    const obj: Record<string, unknown> = value as Record<string, unknown>;
    return typeof obj.type === "string";
  }
}
