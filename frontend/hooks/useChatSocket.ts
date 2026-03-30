import { useEffect, useRef, useState, useCallback, Dispatch, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChatMessage } from '../types/chat';

interface UseChatSocketParams {
  socket: Socket | null;
  currentUserId: string;        // logged-in user's MongoDB _id
  activePartnerId: string | null; // currently open chat partner's _id
}

interface UseChatSocketReturn {
  messages: Map<string, ChatMessage>;
  setMessages: Dispatch<SetStateAction<Map<string, ChatMessage>>>;
  onlineUsers: string[];
  isPartnerTyping: boolean;
  sendMessage: (text: string, receiver: string, userName: string) => void;
  deleteMessage: (customId: string, receiver: string) => void;
  editMessage: (customId: string, receiver: string, text: string) => void;
  sendTypingSignal: (receiver: string) => void;
  joinRoom: (chatId: string) => void;
  leaveRoom: (chatId: string) => void;
}

export function useChatSocket({
  socket,
  currentUserId,
  activePartnerId,
}: UseChatSocketParams): UseChatSocketReturn {
  const [messages, setMessages] = useState<Map<string, ChatMessage>>(new Map());
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);

  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserIdRef = useRef(currentUserId);
  const activePartnerIdRef = useRef(activePartnerId);

  currentUserIdRef.current = currentUserId;
  activePartnerIdRef.current = activePartnerId;

  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (data: ChatMessage) => {
      if (data?.receiver !== currentUserIdRef.current) return;
      // Sirf active partner ke messages show karein.
      // (Sender side optimistic update use karta hai; `newMessage` events receiver side par aate hain.)
      if (activePartnerIdRef.current && data?.sender !== activePartnerIdRef.current) return;
      setMessages((prev) => {
        const updated = new Map(prev);
        updated.set(data.customId, data);
        return updated;
      });
    };

    const handleDeleteMsg = (deletedCustomId: string) => {
      if (!deletedCustomId) return;
      setMessages((prev) => {
        if (!prev.has(deletedCustomId)) return prev;
        const updated = new Map(prev);
        updated.delete(deletedCustomId);
        return updated;
      });
    };

    const handleEditMsg = (payload: { customId: string; message: string }) => {
      setMessages((prev) => {
        if (!prev.has(payload.customId)) return prev;
        const updated = new Map(prev);
        updated.set(payload.customId, {
          ...updated.get(payload.customId)!,
          message: payload.message,
          isEdited: true,
        });
        return updated;
      });
    };

    const handleOnlineUsers = (userIds: string[]) => {
      setOnlineUsers(userIds);
    };

    const handleUserMsg = (senderId: string) => {
      if (senderId !== activePartnerIdRef.current) return;
      setIsPartnerTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setIsPartnerTyping(false), 2000);
    };

    socket.on('newMessage', handleNewMessage);
    socket.on('deleteMsg', handleDeleteMsg);
    socket.on('editMsg', handleEditMsg);
    socket.on('getOnlineUser', handleOnlineUsers);
    socket.on('userMsg', handleUserMsg);

    // Initial online snapshot (prevents "offline" until re-join after reload).
    const requestOnlineUsers = () => {
      socket.emit('requestOnlineUsers');
    };
    if (socket.connected) requestOnlineUsers();
    else socket.once('connect', requestOnlineUsers);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('deleteMsg', handleDeleteMsg);
      socket.off('editMsg', handleEditMsg);
      socket.off('getOnlineUser', handleOnlineUsers);
      socket.off('userMsg', handleUserMsg);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, [socket]);

  const joinRoom = useCallback(
    (chatId: string) => {
      socket?.emit('joinRoom', chatId);
    },
    [socket],
  );

  const leaveRoom = useCallback(
    (chatId: string) => {
      socket?.emit('leaveRoom', chatId);
    },
    [socket],
  );

  const sendMessage = useCallback(
    (text: string, receiver: string, userName: string) => {
      if (!text.trim() || !receiver) return;
      const customId = crypto.randomUUID();
      const payload: ChatMessage = {
        customId,
        sender: currentUserIdRef.current,
        receiver,
        message: text,
        userName,
        createdAt: new Date().toISOString(),
      };
      // Optimistic update
      setMessages((prev) => {
        const updated = new Map(prev);
        updated.set(customId, payload);
        return updated;
      });
      socket?.emit('message', payload);
    },
    [socket],
  );

  const deleteMessage = useCallback(
    (customId: string, receiver: string) => {
      socket?.emit('delete', { customId, receiver });
      // Optimistic update
      setMessages((prev) => {
        if (!prev.has(customId)) return prev;
        const updated = new Map(prev);
        updated.delete(customId);
        return updated;
      });
    },
    [socket],
  );

  const editMessage = useCallback(
    (customId: string, receiver: string, text: string) => {
      socket?.emit('edit', { customId, receiver, message: text });
      // Optimistic update
      setMessages((prev) => {
        if (!prev.has(customId)) return prev;
        const updated = new Map(prev);
        updated.set(customId, { ...updated.get(customId)!, message: text, isEdited: true });
        return updated;
      });
    },
    [socket],
  );

  const sendTypingSignal = useCallback(
    (receiver: string) => {
      socket?.emit('userMsg', { sender: currentUserIdRef.current, receiver });
    },
    [socket],
  );

  return {
    messages,
    setMessages,
    onlineUsers,
    isPartnerTyping,
    sendMessage,
    deleteMessage,
    editMessage,
    sendTypingSignal,
    joinRoom,
    leaveRoom,
  };
}
