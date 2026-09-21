import { useEffect, useRef, useState } from 'react';
import { getLegalActions, type Action, type GameState, type PlayerScore } from '@zoo/engine';
import type { BotAlgorithm } from '../lib/gameConfig';
import {
  actionsChannelName,
  lobbyChannelName,
  seatChannelName,
  type ActionsChannelMessage,
  type ReplayStatus,
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
  // Decidido al crear la sala (ver GameConfig): se manda a todos los
  // invitados igual, no cada uno decide por su cuenta.
  animationsEnabled: boolean;
  doAction: (action: Action) => void;
  // Cambia cada vez que `state` muta (ver useGame): dispara la retransmisión.
  tick: number;
  // La sala se anuncia (presencia) desde que existe, pero solo se retransmite
  // estado real una vez la partida ha empezado de verdad.
  active: boolean;
  // "Repetir partida" (ver ReplayStatus en protocol.ts): se llama en cuanto
  // TODOS los humanos (host incluido) han aceptado la propuesta en curso —
  // quien llama a esto decide qué hacer (normalmente, startGame con la
  // misma config de siempre). El propio hook limpia replayStatus justo
  // después, para todos los conectados.
  onReplayAccepted: () => void;
}

export interface UseHostRoomResult {
  connectedSeatIds: Set<string>;
  // Nick que cada invitado conectado escribió antes de entrar (ver
  // GuestApp.tsx) — vacío para un asiento sin nadie conectado todavía.
  connectedSeatNicks: Map<string, string>;
  replayStatus: ReplayStatus | null;
  // El host propone repetir partida (p. ej. al pulsar el botón él mismo, sin
  // pasar por ningún canal — ya está "conectado" por definición). Si YA hay
  // una propuesta en curso, no hace nada (una a la vez).
  proposeReplay: (bySeatId: string, byName: string) => void;
  // El host responde a una propuesta en curso (la suya propia o la de un
  // invitado) — accept=false la cancela para todos, no solo para el host.
  respondReplay: (seatId: string, accept: boolean) => void;
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
  const [connectedSeatNicks, setConnectedSeatNicks] = useState<Map<string, string>>(new Map());
  const [replayStatus, setReplayStatus] = useState<ReplayStatus | null>(null);

  // Espejo de los valores que cambian cada render, para que los callbacks de
  // Supabase (registrados una sola vez) siempre lean el estado más reciente
  // sin tener que volver a suscribirse en cada render.
  const latestRef = useRef(params);
  latestRef.current = params;
  const replayStatusRef = useRef(replayStatus);
  replayStatusRef.current = replayStatus;
  // Para que proposeReplay/respondReplay (llamados también desde el closure
  // desactualizado de handleActionsMessage, fijado una sola vez por roomCode)
  // vean siempre quién está conectado AHORA, no en el momento en que se
  // registró el listener.
  const connectedSeatIdsRef = useRef(connectedSeatIds);
  connectedSeatIdsRef.current = connectedSeatIds;

  const seatChannelsRef = useRef<Map<string, ReturnType<NonNullable<typeof supabase>['channel']>>>(new Map());

  // Único punto que arma un StateSyncMessage para UN asiento y lo manda —
  // usado tanto por la respuesta inmediata a requestState como por la
  // retransmisión periódica (tick) y por cualquier cambio de replayStatus,
  // para que las 3 vías nunca puedan divergir en qué campos incluyen.
  function broadcastToSeat(seatId: string) {
    const { state, humanIds, botAlgorithms, scores, animationsEnabled, active } = latestRef.current;
    if (!active) return;
    const channel = seatChannelsRef.current.get(seatId);
    if (!channel) return;
    const payload: StateSyncMessage = {
      type: 'stateSync',
      state: redactStateForSeat(state, seatId, humanIds),
      humanIds,
      botAlgorithms,
      scores,
      animationsEnabled,
      replayStatus: replayStatusRef.current,
    };
    channel.send({ type: 'broadcast', event: 'sync', payload });
  }

  function broadcastToAll() {
    for (const seat of seats) broadcastToSeat(seat.seatId);
  }

  // Un invitado humano (nunca el host, que no pasa por presencia — ver
  // createHostRoom.ts) cuenta como "conectado" solo si sigue en la sala AHORA
  // MISMO. Repetir con alguien que ha cerrado la ventana no tiene sentido: ni
  // podría llegar a aceptar, ni queremos dejar una propuesta colgada
  // indefinidamente (ver el efecto de más abajo, que la cancela si alguien se
  // va a media votación).
  function allHumanGuestsConnected(): boolean {
    return seats
      .filter((seat) => latestRef.current.humanIds.includes(seat.seatId))
      .every((seat) => connectedSeatIdsRef.current.has(seat.seatId));
  }

  function proposeReplay(bySeatId: string, byName: string) {
    if (replayStatusRef.current) return; // ya hay una propuesta en curso: una a la vez
    if (!allHumanGuestsConnected()) return;
    const status: ReplayStatus = {
      proposedBySeatId: bySeatId,
      proposedByName: byName,
      acceptedSeatIds: [bySeatId],
      totalHumanSeats: latestRef.current.humanIds.length,
    };
    setReplayStatus(status);
  }

  function respondReplay(seatId: string, accept: boolean) {
    if (!replayStatusRef.current) return;
    if (!accept) {
      setReplayStatus(null);
      return;
    }
    if (!allHumanGuestsConnected()) return;
    const current = replayStatusRef.current;
    const acceptedSeatIds = current.acceptedSeatIds.includes(seatId)
      ? current.acceptedSeatIds
      : [...current.acceptedSeatIds, seatId];
    const everyoneAccepted = latestRef.current.humanIds.every((id) => acceptedSeatIds.includes(id));
    if (everyoneAccepted) {
      setReplayStatus(null);
      latestRef.current.onReplayAccepted();
    } else {
      setReplayStatus({ ...current, acceptedSeatIds });
    }
  }

  // Cualquier cambio de replayStatus se retransmite ya mismo (no esperar al
  // próximo tick de partida): proponer/aceptar/rechazar debe notarse al
  // instante en las demás pestañas.
  useEffect(() => {
    broadcastToAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayStatus]);

  // Si alguien se desconecta (cierra la pestaña, pierde la red...) mientras
  // hay una propuesta de repetir en curso, se cancela para todos en vez de
  // dejarla esperando para siempre a alguien que ya no va a responder.
  useEffect(() => {
    if (replayStatusRef.current && !allHumanGuestsConnected()) setReplayStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedSeatIds]);

  // Una propuesta que quedó pendiente en una sala/partida anterior no debe
  // colar en la siguiente: se pulsó "Nueva partida" (crea una sala con otro
  // roomCode, ver App.tsx) sin resolver la propuesta de antes, así que aquí
  // arranca limpio. Sin esto, un invitado podía ver y aceptar el "repetir" de
  // la partida YA TERMINADA anterior en medio de una partida distinta.
  useEffect(() => {
    setReplayStatus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const lobby = client.channel(lobbyChannelName(roomCode));
    const actionsCh = client.channel(actionsChannelName(roomCode));
    const seatChannels = new Map(seats.map((seat) => [seat.seatId, client.channel(seatChannelName(roomCode, seat.seatKey))]));
    seatChannelsRef.current = seatChannels;

    lobby
      .on('presence', { event: 'sync' }, () => {
        const presenceState = lobby.presenceState<{ seatId: string; nick?: string }>();
        const ids = new Set<string>();
        const nicks = new Map<string, string>();
        for (const presences of Object.values(presenceState)) {
          for (const p of presences) {
            ids.add(p.seatId);
            if (p.nick) nicks.set(p.seatId, p.nick);
          }
        }
        setConnectedSeatIds(ids);
        setConnectedSeatNicks(nicks);
      })
      .subscribe();

    function handleActionsMessage(msg: ActionsChannelMessage) {
      const { state, humanIds, doAction, active } = latestRef.current;
      const seat = seats.find((s) => s.seatId === msg.seatId && s.seatKey === msg.seatKey);
      if (!seat) return; // seatKey no coincide: no es dueño de ese asiento, se ignora

      if (msg.type === 'requestState') {
        broadcastToSeat(seat.seatId);
        return;
      }

      if (msg.type === 'action') {
        if (!active || !humanIds.includes(seat.seatId)) return;
        // getLegalActions ya es la única fuente de verdad de "puede este
        // asiento hacer esto ahora mismo": no solo cuando tiene el turno,
        // también cuando le toca resolver un descarte forzoso pendiente
        // (ver PendingDiscardDecision) aunque el turno sea de otro. Evita
        // que un mensaje repetido o manipulado a mano aplique algo ilegal.
        const legal = getLegalActions(state, seat.seatId);
        const isLegal = legal.some((a) => JSON.stringify(a) === JSON.stringify(msg.action));
        if (!isLegal) return;
        doAction(msg.action);
        return;
      }

      if (msg.type === 'replayPropose') {
        const proposerName = state.players.find((p) => p.id === seat.seatId)?.name ?? seat.seatId;
        proposeReplay(seat.seatId, proposerName);
        return;
      }

      if (msg.type === 'replayRespond') {
        respondReplay(seat.seatId, msg.accept);
      }
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
    broadcastToAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tick, params.active]);

  return { connectedSeatIds, connectedSeatNicks, replayStatus, proposeReplay, respondReplay };
}
