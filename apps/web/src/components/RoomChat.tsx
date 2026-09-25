import { useCallback, useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, useRoomChat, type ChatMessage } from '../online/useRoomChat';

// Solo en pantalla ancha (ver el mismo corte de 860px que ./styles.css para
// el panel): en móvil el chat es una hoja inferior a todo lo ancho a
// propósito, arrastrarla/redimensionarla no tendría sentido ahí.
const DRAG_RESIZE_MIN_WIDTH = 860;
const PANEL_DEFAULT_WIDTH = 340;
const PANEL_DEFAULT_HEIGHT = 460;
const PANEL_MIN_WIDTH = 260;
const PANEL_MIN_HEIGHT = 260;

function canDragResize(): boolean {
  return typeof window !== 'undefined' && window.innerWidth > DRAG_RESIZE_MIN_WIDTH;
}

// Reacciones rápidas: un toque y enviado, sin escribir — en móvil es lo que de verdad se usa a
// mitad de partida. Emojis y tres frases hechas cortas.
const REACTIONS = ['👍', '👏', '😂', '😮', '😢', '😡', '🎉', '¡Buena!', '¡Uy!', 'GG'];
// Cuánto se queda en pantalla el aviso de un mensaje ajeno cuando el chat está cerrado.
const TOAST_MS = 4000;

interface RoomChatProps {
  roomCode: string;
  seatId: string;
  name: string;
}

// Chat de la partida online: un botón flotante con contador de no leídos que abre un panel
// (acoplado abajo a la derecha en pantalla grande, hoja inferior en móvil). Se monta SOLO en
// partidas online (ver App.tsx / GuestApp.tsx): en local, pasando el dispositivo, no hay con
// quién hablar. Con el panel cerrado, cada mensaje ajeno asoma unos segundos junto al botón.
export function RoomChat({ roomCode, seatId, name }: RoomChatProps) {
  const { messages, sendText, sendReaction } = useRoomChat(roomCode, seatId, name);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [unread, setUnread] = useState(0);
  const [toast, setToast] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seenCountRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  // x/y === null: sin arrastrar todavía, el panel se queda anclado abajo a
  // la derecha por CSS (.room-chat__panel). En cuanto se arrastra o
  // redimensiona una vez, pasa a posición/tamaño explícitos en `style` y ya
  // no se mueve solo aunque cambie el tamaño de ventana. Se resetea a null
  // al cerrar el panel, para que la próxima apertura vuelva a la esquina de
  // siempre en vez de arrastrar la posición de la sesión anterior.
  const [geometry, setGeometry] = useState<{ x: number | null; y: number | null; width: number; height: number }>({
    x: null,
    y: null,
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_DEFAULT_HEIGHT,
  });
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; originWidth: number; originHeight: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setGeometry((g) => ({ ...g, x: null, y: null }));
  }, [open]);

  const handleDragPointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const panel = panelRef.current;
    const maxX = window.innerWidth - (panel?.offsetWidth ?? PANEL_DEFAULT_WIDTH);
    const maxY = window.innerHeight - (panel?.offsetHeight ?? PANEL_DEFAULT_HEIGHT);
    const x = Math.min(Math.max(0, drag.originX + (e.clientX - drag.startX)), Math.max(0, maxX));
    const y = Math.min(Math.max(0, drag.originY + (e.clientY - drag.startY)), Math.max(0, maxY));
    setGeometry((g) => ({ ...g, x, y }));
  }, []);

  const handleDragPointerUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', handleDragPointerMove);
    window.removeEventListener('pointerup', handleDragPointerUp);
  }, [handleDragPointerMove]);

  function handleDragStart(e: React.PointerEvent) {
    if (!canDragResize()) return;
    // Arrastrar no debe robarle el click al botón de cerrar.
    if ((e.target as HTMLElement).closest('.room-chat__close')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: rect?.left ?? 0, originY: rect?.top ?? 0 };
    window.addEventListener('pointermove', handleDragPointerMove);
    window.addEventListener('pointerup', handleDragPointerUp);
  }

  const handleResizePointerMove = useCallback((e: PointerEvent) => {
    const resize = resizeRef.current;
    if (!resize) return;
    const width = Math.max(PANEL_MIN_WIDTH, resize.originWidth + (e.clientX - resize.startX));
    const height = Math.max(PANEL_MIN_HEIGHT, resize.originHeight + (e.clientY - resize.startY));
    setGeometry((g) => ({ ...g, width, height }));
  }, []);

  const handleResizePointerUp = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener('pointermove', handleResizePointerMove);
    window.removeEventListener('pointerup', handleResizePointerUp);
  }, [handleResizePointerMove]);

  function handleResizeStart(e: React.PointerEvent) {
    e.stopPropagation();
    if (!canDragResize()) return;
    const rect = panelRef.current?.getBoundingClientRect();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originWidth: rect?.width ?? geometry.width,
      originHeight: rect?.height ?? geometry.height,
    };
    window.addEventListener('pointermove', handleResizePointerMove);
    window.addEventListener('pointerup', handleResizePointerUp);
  }

  // Por si el componente se desmonta a media maniobra (p. ej. se cierra la
  // sala mientras se arrastra): los listeners viven en window, no en el
  // panel, así que no se limpiarían solos.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleDragPointerMove);
      window.removeEventListener('pointerup', handleDragPointerUp);
      window.removeEventListener('pointermove', handleResizePointerMove);
      window.removeEventListener('pointerup', handleResizePointerUp);
    };
  }, [handleDragPointerMove, handleDragPointerUp, handleResizePointerMove, handleResizePointerUp]);

  const panelStyle: React.CSSProperties =
    geometry.x !== null && geometry.y !== null
      ? { left: geometry.x, top: geometry.y, right: 'auto', bottom: 'auto', width: geometry.width, height: geometry.height }
      : canDragResize()
        ? { width: geometry.width, height: geometry.height }
        : {};

  // Mensajes nuevos: con el panel abierto solo hay que bajar al final; cerrado, cuentan como no
  // leídos y el último ajeno se enseña un momento como aviso.
  useEffect(() => {
    const fresh = messages.slice(seenCountRef.current);
    seenCountRef.current = messages.length;
    if (fresh.length === 0) return;
    if (openRef.current) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
      return;
    }
    const fromOthers = fresh.filter((m) => m.seatId !== seatId);
    if (fromOthers.length === 0) return;
    setUnread((n) => n + fromOthers.length);
    setToast(fromOthers[fromOthers.length - 1]);
  }, [messages, seatId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    setToast(null);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    sendText(draft);
    setDraft('');
  }

  return (
    <div className="room-chat">
      {open && (
        <div
          className={['room-chat__panel', canDragResize() && 'room-chat__panel--floating'].filter(Boolean).join(' ')}
          role="dialog"
          aria-label="Chat de la partida"
          ref={panelRef}
          style={panelStyle}
        >
          <div className="room-chat__header" onPointerDown={handleDragStart}>
            <strong>💬 Chat de la partida</strong>
            <button type="button" className="room-chat__close" onClick={() => setOpen(false)} aria-label="Cerrar chat">
              ✕
            </button>
          </div>
          <div className="room-chat__messages" ref={listRef}>
            {messages.length === 0 ? (
              <p className="room-chat__empty">Todavía no hay mensajes. Los que se envíen antes de que entres no se guardan.</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={['room-chat__msg', m.seatId === seatId && 'room-chat__msg--mine', m.kind === 'reaction' && 'room-chat__msg--reaction']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {m.seatId !== seatId && <span className="room-chat__author">{m.name}</span>}
                  <span className="room-chat__text">{m.text}</span>
                </div>
              ))
            )}
          </div>
          <div className="room-chat__reactions">
            {REACTIONS.map((r) => (
              <button key={r} type="button" className="room-chat__reaction" onClick={() => sendReaction(r)}>
                {r}
              </button>
            ))}
          </div>
          <form className="room-chat__form" onSubmit={handleSubmit}>
            <input
              className="room-chat__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Escribe un mensaje…"
              aria-label="Mensaje"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" className="btn btn--primary room-chat__send" disabled={!draft.trim()}>
              Enviar
            </button>
          </form>
          {canDragResize() && (
            <div
              className="room-chat__resize-handle"
              onPointerDown={handleResizeStart}
              role="presentation"
              aria-hidden="true"
            />
          )}
        </div>
      )}

      {!open && toast && (
        <button type="button" className="room-chat__toast" onClick={() => setOpen(true)}>
          <span className="room-chat__author">{toast.name}</span>
          <span className={toast.kind === 'reaction' ? 'room-chat__toast-reaction' : undefined}>{toast.text}</span>
        </button>
      )}

      {!open && (
        <button type="button" className="room-chat__fab" onClick={() => setOpen(true)} aria-label={`Abrir chat${unread ? ` (${unread} sin leer)` : ''}`}>
          💬
          {unread > 0 && <span className="room-chat__badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
      )}
    </div>
  );
}
