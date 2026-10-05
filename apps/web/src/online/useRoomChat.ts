import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { chatChannelName } from './protocol';

// Chat entre los miembros de una misma partida online (pedido explícito del
// usuario 2026-09-21). Decisiones suyas: SIN historial (quien entra tarde o
// recarga no ve lo anterior), CON reacciones rápidas, sin moderación, solo
// online, y sin preocuparse por la seguridad — así que va por un canal
// compartido de la sala (`room:CODE:chat`), NO por los canales privados de
// asiento: anfitrión e invitados se suscriben por igual y hablan directamente
// entre sí, sin que el anfitrión tenga que reenviar nada. Cualquiera que
// conozca el código de sala podría leerlo o escribir; asumido.
export type ChatMessageKind = 'text' | 'reaction';

export interface ChatMessage {
  id: string;
  seatId: string;
  name: string;
  kind: ChatMessageKind;
  text: string;
  at: number;
}

export const CHAT_MAX_LENGTH = 200;
// Tope blando contra ráfagas accidentales (doble toque, tecla atascada), no un sistema de moderación.
const MIN_MS_BETWEEN_SENDS = 350;
// Solo para que la lista no crezca sin fin en una partida larga; no es "historial": vive en memoria de esta pestaña.
const MAX_MESSAGES_KEPT = 150;

export interface UseRoomChat {
  messages: ChatMessage[];
  sendText: (text: string) => void;
  sendReaction: (reaction: string) => void;
  // Emote AUTOMÁTICO de un bot (ver lib/botChat.ts/useGame.ts), no de quien
  // tiene esta pestaña abierta: a diferencia de sendText/sendReaction, el
  // mensaje se firma con el seatId/nombre del BOT, nunca con los propios
  // (`seatId`/`name` del hook). Solo lo llama el anfitrión (el único que
  // ejecuta la lógica de los bots) — ver RoomChat.tsx.
  sendBotReaction: (botSeatId: string, botName: string, reaction: string) => void;
}

export function useRoomChat(roomCode: string | null, seatId: string, name: string): UseRoomChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
  const lastSentAtRef = useRef(0);
  // El nombre puede cambiar (el del invitado se conoce de verdad al llegar el primer estado) sin
  // que haga falta reabrir el canal por ello.
  const nameRef = useRef(name);
  nameRef.current = name;

  const append = useCallback((msg: ChatMessage) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-MAX_MESSAGES_KEPT)));
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !roomCode) return;
    setMessages([]);
    // self:false (por defecto): el propio emisor no recibe su mensaje de vuelta, así que se
    // añade a mano al enviarlo (ver send) y aparece al instante, sin esperar a la red.
    const channel = client.channel(chatChannelName(roomCode));
    channel
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        const msg = payload as Partial<ChatMessage>;
        if (typeof msg?.id !== 'string' || typeof msg.text !== 'string' || typeof msg.seatId !== 'string') return;
        append({
          id: msg.id,
          seatId: msg.seatId,
          name: typeof msg.name === 'string' ? msg.name.slice(0, 12) : '?',
          kind: msg.kind === 'reaction' ? 'reaction' : 'text',
          text: msg.text.slice(0, CHAT_MAX_LENGTH),
          at: typeof msg.at === 'number' ? msg.at : Date.now(),
        });
      })
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      client.removeChannel(channel);
    };
  }, [roomCode, append]);

  const send = useCallback(
    (kind: ChatMessageKind, raw: string) => {
      const text = raw.trim().slice(0, CHAT_MAX_LENGTH);
      const channel = channelRef.current;
      if (!text || !channel) return;
      const now = Date.now();
      if (now - lastSentAtRef.current < MIN_MS_BETWEEN_SENDS) return;
      lastSentAtRef.current = now;
      const msg: ChatMessage = {
        id: `${seatId}-${now}-${Math.random().toString(36).slice(2, 8)}`,
        seatId,
        name: nameRef.current,
        kind,
        text,
        at: now,
      };
      append(msg);
      channel.send({ type: 'broadcast', event: 'chat', payload: msg });
    },
    [seatId, append]
  );

  const sendText = useCallback((text: string) => send('text', text), [send]);
  const sendReaction = useCallback((reaction: string) => send('reaction', reaction), [send]);

  // No comparte lastSentAtRef/MIN_MS_BETWEEN_SENDS con send(): ese antirrebote
  // es contra un doble toque accidental del humano; los emotes de bot ya
  // llegan espaciados por su propio enfriamiento (ver COOLDOWN_ROUNDS en
  // lib/botChat.ts), así que un mensaje de verdad del humano no debe
  // bloquearse (ni bloquear) por coincidir en el tiempo con uno de un bot.
  const sendBotReaction = useCallback(
    (botSeatId: string, botName: string, reaction: string) => {
      const channel = channelRef.current;
      const text = reaction.trim().slice(0, CHAT_MAX_LENGTH);
      if (!text || !channel) return;
      const now = Date.now();
      const msg: ChatMessage = {
        id: `${botSeatId}-${now}-${Math.random().toString(36).slice(2, 8)}`,
        seatId: botSeatId,
        name: botName.slice(0, 12),
        kind: 'reaction',
        text,
        at: now,
      };
      append(msg);
      channel.send({ type: 'broadcast', event: 'chat', payload: msg });
    },
    [append]
  );

  return { messages, sendText, sendReaction, sendBotReaction };
}
