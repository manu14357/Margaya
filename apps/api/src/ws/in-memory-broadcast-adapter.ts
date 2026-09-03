import type {
  BroadcastAdapter,
  BroadcastMessage,
  DocBroadcast,
  UserBroadcast,
} from "./broadcast-adapter";

export class InMemoryBroadcastAdapter implements BroadcastAdapter {
  private handler?: (msg: BroadcastMessage) => void;
  private userHandler?: (msg: UserBroadcast) => void;

  async publish(msg: BroadcastMessage): Promise<void> {
    // Deliver directly in the same process
    this.handler?.(msg);
  }

  async publishToUser(msg: UserBroadcast): Promise<void> {
    this.userHandler?.(msg);
  }

  async subscribe(handler: (msg: BroadcastMessage) => void): Promise<void> {
    this.handler = handler;
  }

  async subscribeToUser(handler: (msg: UserBroadcast) => void): Promise<void> {
    this.userHandler = handler;
  }

  // One instance has no peers, and a page room already delivered to its
  // local connections, so document messages never loop back.
  async publishDoc(_msg: DocBroadcast): Promise<void> {}

  async subscribeToDoc(
    _pageId: string,
    _handler: (msg: DocBroadcast) => void,
  ): Promise<void> {}

  async unsubscribeFromDoc(_pageId: string): Promise<void> {}

  async shutdown(): Promise<void> {
    this.handler = undefined;
    this.userHandler = undefined;
  }
}
