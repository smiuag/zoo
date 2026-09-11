import { useEffect, useRef, useState } from 'react';
import { getActivePlayer, getLegalActions, type Action, type GameState, type PlayerScore } from '@zoo/engine';
import type { BotAlgorithm } from '../lib/gameConfig';
import {
  actionsChannelName,
  lobbyChannelName,
  seatChannelName,
  type ActionsChannelMessage,
  type StateSyncMessage,
} from './protocol';
import { redactStateForSeat } from './redact';
import { supabase } from './supabaseClient';

export interface HostRoomSeat {
  seatId: string;
  seatKey: string;
  inviteUrl: string;
}

export interface UseHostRoomParams {
  roomCode: string;
  seats: HostRoomSeat[];
  state: GameState;
  humanIds: string[];
  botAlgorithms: Record<string, BotAlgorithm>;
  scores: PlayerScore[];
  doAction: (action: Action) => void;
  // Cambia cada vez que `state` muta (ver useGame): dispara la retransmisión.
  tick: number;
  // La sala se anuncia (presencia) desde que existe, pero solo se retransmite
  // estado real una vez la partida ha empezado de verdad.
  active: boolean;
}

export interface UseHostRoomResult {
  connectedSeatIds: Set<string>;
}

// Solo la pestaña host llama a este hook. Mantiene, durante toda la vida de
// la sala: un canal de presencia (para saber quién se ha conectado, incluso
// antes de empezar), un canal de acciones (invitados -> host) y un canal de
// difusión privado por cada asiento (host -> ese invitado). Ver el diseño de
// canales en el plan: ninguno de estos requiere tablas, RLS ni auth de
// Supabase.
export function useHostRoom(params: UseHostRoomParams): UseHostRoomResult {
  const { roomCode, seats } = params;
  const [connectedSeatIds, setConnectedSeatIds] = useState<Set<string>>(new Set());

  // Espejo de los valores que cambian cada render, para que los callbacks de
  // Supabase (registrados una sola vez) siempre lean el estado más reciente
  // sin tener que volver a suscribirse en cada render.
  const latestRef = useRef(params);
  latestRef.current = params;

  const seatChannelsRef = useRef<Map<string, ReturnType<NonNullable<typeof supabase>['channel']>>>(new Map());

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const lobby = client.channel(lobbyChannelName(roomCode));
    const actionsCh = client.channel(actionsChannelName(roomCode));
    const seatChannels = new Map(seats.map((seat) => [seat.seatId, client.channel(seatChannelName(roomCode, seat.seatKey))]));
    seatChannelsRef.current = seatChannels;

    lobby
      .on('presence', { event: 'sync' }, () => {
        const presenceState = lobby.presenceState<{ seatId: string }>();
        const ids = new Set<string>();
        for (const presences of Object.values(presenceState)) {
          for (const p of presences) ids.add(p.seatId);
        }
        setConnectedSeatIds(ids);
      })
      .subscribe();

    function handleActionsMessage(msg: ActionsChannelMessage) {
      const { state, humanIds, botAlgorithms, scores, doAction, active } = latestRef.current;
      const seat = seats.find((s) => s.seatId === msg.seatId && s.seatKey === msg.seatKey);
      if (!seat) return; // seatKey no coincide: no es dueño de ese asiento, se ignora

      if (msg.type === 'requestState') {
        broadcastToSeat(seat.seatId, state, humanIds, botAlgorithms, scores, active);
        return;
      }

      if (msg.type === 'action') {
        if (!active || !humanIds.includes(seat.seatId)) return;
        // Solo se aplica si de verdad es el turno de ESE asiento ahora mismo,
        // y la jugada sigue siendo legal: evita que un mensaje repetido o
        // manipulado a mano actúe fuera de turno o con una acción inválida.
        if (getActivePlayer(state).id !== seat.seatId) return;
        const legal = getLegalActions(state, seat.seatId);
        const isLegal = legal.some((a) => JSON.stringify(a) === JSON.stringify(msg.action));
        if (!isLegal) return;
        doAction(msg.action);
      }
    }

    function broadcastToSeat(
      seatId: string,
      state: GameState,
      humanIds: string[],
      botAlgorithms: Record<string, BotAlgorithm>,
      scores: PlayerScore[],
      active: boolean
    ) {
      if (!active) return;
      const channel = seatChannelsRef.current.get(seatId);
      if (!channel) return;
      const payload: StateSyncMessage = {
        type: 'stateSync',
        state: redactStateForSeat(state, seatId, humanIds),
        humanIds,
        botAlgorithms,
        scores,
      };
      channel.send({ type: 'broadcast', event: 'sync', payload });
    }

    actionsCh.on('broadcast', { event: 'msg' }, ({ payload }) => handleActionsMessage(payload as ActionsChannelMessage)).subscribe();
    for (const channel of seatChannels.values()) channel.subscribe();

    return () => {
      client.removeChannel(lobby);
      client.removeChannel(actionsCh);
      for (const channel of seatChannels.values()) client.removeChannel(channel);
      seatChannelsRef.current = new Map();
    };
    // Los canales se abren una única vez por sala: `seats` es fijo desde que
    // se crea la sala (antes de que nadie se conecte), así que roomCode/seats
    // son las únicas dependencias reales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // Retransmite a todos los asientos cada vez que el estado cambia de
  // verdad (tick, expuesto por useGame), ya con la partida en marcha.
  useEffect(() => {
    if (!supabase || !params.active) return;
    for (const seat of seats) {
      const channel = seatChannelsRef.current.get(seat.seatId);
      if (!channel) continue;
      const payload: StateSyncMessage = {
        type: 'stateSync',
        state: redactStateForSeat(params.state, seat.seatId, params.humanIds),
        humanIds: params.humanIds,
        botAlgorithms: params.botAlgorithms,
        scores: params.scores,
      };
      channel.send({ type: 'broadcast', event: 'sync', payload });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tick, params.active]);

  return { connectedSeatIds };
}
