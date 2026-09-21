import { useEffect, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH, useRoomChat, type ChatMessage } from '../online/useRoomChat';

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
        <div className="room-chat__panel" role="dialog" aria-label="Chat de la partida">
          <div className="room-chat__header">
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
