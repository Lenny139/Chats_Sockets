// ---------------------------------------------------------------------------
// Tipos del protocolo de chat (newline-delimited JSON)
// ---------------------------------------------------------------------------

export interface User {
  username: string;
}

// ---------------------------------------------------------------------------
// Paquetes que llegan del servidor (servidor -> cliente)
// ---------------------------------------------------------------------------

export interface WelcomePacket {
  type: "welcome";
  self: string;
  message: string;
  users: User[];
  timestamp: string;
}

export interface UsersPacket {
  type: "users";
  users: User[];
  timestamp: string;
}

export interface MessagePacket {
  type: "message";
  scope: "public" | "private";
  from: string;
  text: string;
  to?: string;
  timestamp: string;
}

export interface SystemPacket {
  type: "system";
  message: string;
  timestamp: string;
}

export interface ErrorPacket {
  type: "error";
  message: string;
  timestamp: string;
}

// Unión discriminada por el campo "type".
export type ServerPacket =
  | WelcomePacket
  | UsersPacket
  | MessagePacket
  | SystemPacket
  | ErrorPacket;

// ---------------------------------------------------------------------------
// Paquetes que se envían al servidor (cliente -> servidor)
// ---------------------------------------------------------------------------

export interface JoinPacket {
  type: "join";
}

export interface PublicMessagePacket {
  type: "message";
  scope: "public";
  text: string;
}

export interface PrivateMessagePacket {
  type: "message";
  scope: "private";
  to: string;
  text: string;
}

// Unión discriminada por el campo "type" (y "scope" para los mensajes).
export type ClientPacket =
  | JoinPacket
  | PublicMessagePacket
  | PrivateMessagePacket;
