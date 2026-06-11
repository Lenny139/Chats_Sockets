import * as net from "net";
import { WebSocketServer, WebSocket, RawData } from "ws";

const WS_PORT: number = 3001;
const TCP_HOST: string = "192.168.5.130";
const TCP_PORT: number = 3000;

// Crea el servidor WebSocket. Por cada cliente abrimos una conexión TCP
// dedicada al servidor de chat y retransmitimos los bytes sin transformarlos.
function startProxy(): void {
  const wss: WebSocketServer = new WebSocketServer({ port: WS_PORT });

  wss.on("connection", (ws: WebSocket): void => {
    handleConnection(ws);
  });

  wss.on("listening", (): void => {
    console.log(
      `[proxy] escuchando WebSocket en :${WS_PORT} -> TCP ${TCP_HOST}:${TCP_PORT}`
    );
  });

  wss.on("error", (err: Error): void => {
    console.log(`[proxy] error del servidor WebSocket: ${err.message}`);
  });
}

function handleConnection(ws: WebSocket): void {
  console.log("[proxy] cliente conectado");

  const tcp: net.Socket = net.createConnection(
    { host: TCP_HOST, port: TCP_PORT },
    (): void => {
      // Conexión TCP lista. No hace falta hacer nada extra.
    }
  );

  // WebSocket -> TCP
  ws.on("message", (data: RawData): void => {
    if (!tcp.destroyed) {
      tcp.write(toBuffer(data));
    }
  });

  // TCP -> WebSocket
  // Se convierte a string UTF-8 para que ws envíe un frame de texto,
  // no binario. El browser recibe Blob si el frame es binario y
  // String(Blob) = "[object Blob]", rompiendo el parser JSON.
  tcp.on("data", (chunk: Buffer): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk.toString("utf8"));
    }
  });

  // Manejo de cierres y errores en ambos lados.
  ws.on("close", (): void => {
    console.log("[proxy] cliente desconectado");
    tcp.destroy();
  });

  ws.on("error", (): void => {
    tcp.destroy();
  });

  tcp.on("close", (): void => {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }
  });

  tcp.on("error", (err: Error): void => {
    console.log(`[proxy] error TCP: ${err.message}`);
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }
  });
}

// Normaliza el dato recibido por WebSocket a un Buffer para escribir en TCP.
function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

startProxy();
