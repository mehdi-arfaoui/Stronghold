import { useEffect, useRef, useCallback } from 'react';

interface UseWebSocketOptions {
  url: string;
  onMessage?: (data: unknown) => void;
  onOpen?: () => void;
  onClose?: () => void;
  enabled?: boolean;
}

export function useWebSocket({ url, onMessage, onOpen, onClose, enabled = true }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;
    const ws = new WebSocket(url);

    ws.onopen = () => onOpen?.();
    ws.onmessage = (event) => {
      try {
        const data: unknown = JSON.parse(event.data as string);
        onMessage?.(data);
      } catch {
        onMessage?.(event.data);
      }
    };
    ws.onclose = () => {
      onClose?.();
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, [url, onMessage, onOpen, onClose, enabled]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return wsRef;
}
