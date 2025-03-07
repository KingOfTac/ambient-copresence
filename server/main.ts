import type { Connection, ConnectionContext, Room, Server } from 'partykit/server';

export default class WebSocketServer implements Server {
  private clientCount = 0;

  constructor(readonly room: Room) {}

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    this.clientCount++;
    this.broadcastClientCount();
  }

  async onClose(connection: Connection) {
    this.clientCount = Math.max(0, this.clientCount - 1);
    this.broadcastClientCount();
  }

  onMessage(message: string, sender: Connection) {
    // this.room.broadcast(message, [sender.id]);
  }

  broadcastClientCount() {
    const message = JSON.stringify({
      type: 'update',
      count: this.clientCount
    });
    this.room.broadcast(message);
  }
}