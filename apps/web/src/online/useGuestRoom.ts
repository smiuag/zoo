import { useEffect, useRef, useState } from 'react';
import { getLegalActions, type Action, type GameState, type PlayerScore } from '@zoo/engine';
import type { BotAlgorithm } from '../lib/gameConfig';
import {
  actionsChannelName,
  lobbyChannelName,
  seatChannelName,
  type ActionMessage,
  type RequestStateMessage,
  type StateSyncMessage,
} from './protocol';
import { supabase } from './supabaseClient';

export type GuestRoomStatus = 'connecting' | 'waitingForHost' | 'playing';

export interface UseGuestRoomResult {
  status: GuestRoomStatus;
  state: GameState | null;
  humanIds: string[];
  botAlgorithms: Record<string, BotAlgorithm>;
  scores: PlayerScore[];
  legalActions: Action[];
  sendAction: (action: Action) => void;
}

// Solo llamado por una pestaña invitada (la URL trae ?room=&seat=&key=). No
// ejecuta el motor: solo guarda el último `GameState` (ya redactado por el
// host, ver redact.ts) recibido por su canal privado, y manda las jugadas
// como peticiones al host en vez de aplicarlas localmente — necesario porque
// el motor no es determinista entre clientes (ver el plan).
export function useGuestRoom(roomCode: string, seatId: string, seatKey: string): UseGuestRoomResult {
  const [status, setStatus] = useState<GuestRoomStatus>('connecting');
  const [payload, setPayload] = useState<StateSyncMessage | null>(null);
  const actionsChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    setStatus('connecting');
    setPayload(null);

    const lobby = client.channel(lobbyChannelName(roomCode));
    const seatCh = client.channel(seatChannelName(roomCode, seatKey));
    const actionsCh = client.channel(actionsChannelName(roomCode));
    actionsChannelRef.current = actionsCh;

    seatCh
      .on('broadcast', { event: 'sync' }, ({ payload: msg }) => {
        setPayload(msg as StateSyncMessage);
        setStatus('playing');
      })
      .subscribe((s) => {
        if (s !== 'SUBSCRIBED') return;
        // Al conectar (o reconectar tras un refresco), pide el último estado
        // en vez de esperar a que otro jugador mueva ficha.
        const msg: RequestStateMessage = { type: 'requestState', seatId, seatKey };
        actionsCh.send({ type: 'broadcast', event: 'msg', payload: msg });
      });

    lobby.subscribe(async (s) => {
      if (s !== 'SUBSCRIBED') return;
      await lobby.track({ seatId });
      setStatus((prev) => (prev === 'connecting' ? 'waitingForHost' : prev));
    });

    actionsCh.subscribe();

    return () => {
      client.removeChannel(lobby);
      client.removeChannel(seatCh);
      client.removeChannel(actionsCh);
      actionsChannelRef.current = null;
    };
  }, [roomCode, seatId, seatKey]);

  function sendAction(action: Action) {
    const channel = actionsChannelRef.current;
    if (!channel) return;
    const msg: ActionMessage = { type: 'action', seatId, seatKey, action };
    channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  }

  const state = payload?.state ?? null;
  // getLegalActions ya devuelve lo correcto sin más matices, tenga el turno
  // este asiento o le toque resolver un descarte forzoso pendiente (ver
  // PendingDiscardDecision en el motor) aunque no sea su turno.
  const legalActions = state ? getLegalActions(state, seatId) : [];

  return {
    status,
    state,
    humanIds: payload?.humanIds ?? [],
    botAlgorithms: payload?.botAlgorithms ?? {},
    scores: payload?.scores ?? [],
    legalActions,
    sendAction,
  };
}
