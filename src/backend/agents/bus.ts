import type { MessageBus, MessageHandler, AgentMessage } from "./types";

// In-memory message bus for MVP.
// Swap to Redis pub/sub when running multi-process.

export function createMemoryBus(): MessageBus {
  const handlers = new Map<string, Set<MessageHandler>>();

  function invoke(fn: MessageHandler, msg: AgentMessage) {
    try {
      const res = fn(msg);
      if (res instanceof Promise) res.catch((e) => console.error("[bus] async handler error", e));
    } catch (e) {
      console.error("[bus] handler error", e);
    }
  }

  return {
    publish(msg) {
      const fns = handlers.get(msg.type);
      if (fns) {
        for (const fn of fns) invoke(fn, msg);
      }
      const wild = handlers.get("*");
      if (wild) {
        for (const fn of wild) invoke(fn, msg);
      }
    },

    subscribe(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => { handlers.get(type)?.delete(handler); };
    },
  };
}
