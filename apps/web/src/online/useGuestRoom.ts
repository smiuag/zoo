import { useEffect, useRef, useState } from 'react';
import { getLegalActions, type Action, type GameState, type PlayerScore } from '@zoo/engine';
import type { BotAlgorithm } from '../lib/gameConfig';
import {
  actionsChannelName,
  lobbyChannelName,
  seatChannelName,
  type ActionMessage,
  type ReplayProposeMessage,
  type ReplayRespondMessage,
  type ReplayStatus,
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
  // Lo decide el host al crear la sala (ver GameConfig); true por defecto
  // antes de recibir el primer StateSync, para no dejar el flying-card ni
  // el ritmo de bots colgando de un valor "todavía sin saber".
  animationsEnabled: boolean;
  sendAction: (action: Action) => void;
  replayStatus: ReplayStatus | null;
  proposeReplay: () => void;
  respondReplay: (accept: boolean) => void;
}

// Solo llamado por una pestaña invitada (la URL trae ?room=&seat=&key=), ya
// con el nick elegido (ver GuestApp.tsx: se pide ANTES de montar esto,
// porque hace falta para anunciarse en el canal de presencia — ver
// lobby.track más abajo — y el host lo necesita para poder darle su nombre
// de verdad a este asiento al empezar la partida, ver GameConfig.guestNicks
// en useGame.ts). No ejecuta el motor: solo guarda el último `GameState` (ya
// redactado por el host, ver redact.ts) recibido por su canal privado, y
// manda las jugadas como peticiones al host en vez de aplicarlas localmente
// — necesario porque el motor no es determinista entre clientes (ver el
// plan).
export function useGuestRoom(roomCode: string, seatId: string, seatKey: string, nick: string): UseGuestRoomResult {
  const [status, setStatus] = useState<GuestRoomStatus>('connecting');
  const [payload, setPayload] = useState<StateSyncMessage | null>(null);
  const actionsChannelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);

  useEffect(() => {
    const client = supabase;
    // Sin nick todavía (ver GuestApp.tsx: se pide antes de conectar) no hay
    // nada que hacer aquí — el efecto se reejecuta solo en cuanto `nick`
    // deje de estar vacío, gracias a la dependencia de más abajo.
    if (!client || !nick) return;
    setStatus('connecting');
    setPayload(null);

    const lobby = client.channel(lobbyChannelName(roomCode));
    const seatCh = client.channel(seatChannelName(roomCode, seatKey));
    const actionsCh = client.channel(actionsChannelName(roomCode));
    actionsChannelRef.current = actionsCh;

    let gotSync = false;
    // El primer requestState puede perderse (canal de acciones todavía sin
    // terminar de suscribirse en el momento del send, mensaje perdido...) y
    // antes eso dejaba al invitado colgado en "Conectando…"/"Esperando…"
    // para siempre, sin ningún aviso ni reintento — indistinguible de un
    // host muerto de verdad. Reintenta cada pocos segundos hasta recibir el
    // primer stateSync; en cuanto llega uno, se detiene solo (ver
    // gotSync/clearInterval más abajo).
    function requestState() {
      const msg: RequestStateMessage = { type: 'requestState', seatId, seatKey };
      actionsCh.send({ type: 'broadcast', event: 'msg', payload: msg });
    }
    const retryId = window.setInterval(() => {
      if (gotSync) return;
      requestState();
    }, 4000);

    seatCh
      .on('broadcast', { event: 'sync' }, ({ payload: msg }) => {
        gotSync = true;
        setPayload(msg as StateSyncMessage);
        setStatus('playing');
      })
      .subscribe((s) => {
        if (s !== 'SUBSCRIBED') return;
        // Al conectar (o reconectar tras un refresco), pide el último estado
        // en vez de esperar a que otro jugador mueva ficha.
        requestState();
      });

    lobby.subscribe(async (s) => {
      if (s !== 'SUBSCRIBED') return;
      await lobby.track({ seatId, nick });
      setStatus((prev) => (prev === 'connecting' ? 'waitingForHost' : prev));
    });

    actionsCh.subscribe();

    return () => {
      window.clearInterval(retryId);
      client.removeChannel(lobby);
      client.removeChannel(seatCh);
      client.removeChannel(actionsCh);
      actionsChannelRef.current = null;
    };
  }, [roomCode, seatId, seatKey, nick]);

  function sendAction(action: Action) {
    const channel = actionsChannelRef.current;
    if (!channel) return;
    const msg: ActionMessage = { type: 'action', seatId, seatKey, action };
    channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  }

  function proposeReplay() {
    const channel = actionsChannelRef.current;
    if (!channel) return;
    const msg: ReplayProposeMessage = { type: 'replayPropose', seatId, seatKey };
    channel.send({ type: 'broadcast', event: 'msg', payload: msg });
  }

  function respondReplay(accept: boolean) {
    const channel = actionsChannelRef.current;
    if (!channel) return;
    const msg: ReplayRespondMessage = { type: 'replayRespond', seatId, seatKey, accept };
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
    animationsEnabled: payload?.animationsEnabled ?? true,
    sendAction,
    replayStatus: payload?.replayStatus ?? null,
    proposeReplay,
    respondReplay,
  };
}
