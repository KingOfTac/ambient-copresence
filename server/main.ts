import type { Connection, ConnectionContext, Room, Server } from 'partykit/server';
import { Observable, observable, volatile } from '@microsoft/fast-element';
import { UUID, randomUUID, randomInt } from 'node:crypto';

class Circle {
  static readonly MaxRadius = 0.1;

  public x: number = 0.0;
  public y: number = 0.0;
  public vx: number = randomInt(1, 5) / 10000;
  public vy: number = randomInt(1, 5) / 10000;
  public id: UUID = randomUUID();

  @observable
  public radius: number = 0.01;

  public increaseRadius(add: number) {
    this.radius += add;

    if (this.radius > Circle.MaxRadius) {
      this.radius = Circle.MaxRadius;
    }

    console.log(this.radius);
  }

  public decreaseRadius(sub: number) {
    const newRadius = this.radius - sub;
    this.radius = Math.max(newRadius, 0);
  }

  public toJSON() {
    return {
      x: this.x,
      y: this.y,
      radius: this.radius,
      vx: this.vx,
      vy: this.vy,
      id: this.id
    };
  }
}

const MessageKind = {
  State: 'state',
  Spawn: 'spawn',
  Despawn: 'despawn',
  Update: 'update'
} as const;

type MessageKind = typeof MessageKind[keyof typeof MessageKind];

interface StateMessage {
  kind: typeof MessageKind.State;
  circles: Circle[];
}

interface GenericMessage {
  kind: typeof MessageKind['Spawn' | 'Despawn' | 'Update'];
  circle: Circle;
}

type Message = StateMessage | GenericMessage;

export default class WebSocketServer implements Server {
  private static readonly MaxClientsPerCircle = 10;

  @observable
  private _circles: Circle[] = [];

  @observable
  private clientCount = 0;
  private clientCountChanged(oldCount: number, newCount: number) {
    if (newCount === 0) {
      return;
    }

    if (newCount === 1 && oldCount === 0) {
      this.addCircle();
    }

    let kind: MessageKind = MessageKind.Update;

    if (newCount % WebSocketServer.MaxClientsPerCircle === 0) {
      kind = MessageKind.Spawn;
      this.addCircle();
      const circleNotifier = Observable.getNotifier(this.lastCircle);
      circleNotifier.subscribe({
        handleChange: (subject: Circle, key: 'radius') => {
          if (subject[key] <= 0) {
            this.deleteCircle(subject);
          }
        }
      }, 'radius');
    }

    if (newCount > oldCount) {
      this.lastCircle?.increaseRadius?.(0.01);
    }

    if (newCount < oldCount) {
      this.lastCircle?.decreaseRadius?.(0.01);
    }

    this.room.broadcast(JSON.stringify({
      kind,
      circle: this.lastCircle
    }));
  }

  constructor(readonly room: Room) {}

  @volatile
  public get lastCircle() {
    return this._circles[this._circles.length - 1];
  }

  public addCircle() {
    this._circles.push(new Circle());
  }

  private deleteCircle = (circle: Circle) => {
    const index = this._circles.indexOf(circle);
    
    queueMicrotask(() => {
      this._circles.splice(index, 1);
      const message: GenericMessage = {
        kind: MessageKind.Despawn,
        circle
      }

      this.room.broadcast(JSON.stringify(message));
    });
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    this.clientCount++;

    const stateMessage: StateMessage = {
      kind: MessageKind.State,
      circles: this._circles
    };

    connection.send(JSON.stringify(stateMessage));
  }

  async onClose(connection: Connection) {
    this.clientCount = Math.max(0, this.clientCount - 1);

    const stateMessage: StateMessage = {
      kind: MessageKind.State,
      circles: this._circles
    };

    connection.send(JSON.stringify(stateMessage));
  }

  onMessage(message: string, sender: Connection) {
    // this.room.broadcast(message, [sender.id]);
  }
}