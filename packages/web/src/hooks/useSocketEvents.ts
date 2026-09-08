import { useEffect } from 'react';
import { getSocket } from '../services/socket.js';
import { useChatStore } from '../stores/chatStore.js';
import { usePresenceStore } from '../stores/presenceStore.js';
import { useAuthStore } from '../stores/authStore.js';

export function useSocketEvents() {
  const { token, user } = useAuthStore();
  const {
    upsertConversation,
    updateConversationStatus,
    addMessage,
    updateMessageStatus,
    setTyping,
    activeConversationId,
  } = useChatStore();
  const { setAgents, updateAgentPresence, updateQueueStats, addAlert } = usePresenceStore();

  useEffect(() => {
    if (!token) return;

    const socket = getSocket(token);

    socket.on('conversation:created', (conv) => {
      upsertConversation(conv);
    });

    socket.on('conversation:updated', (conv) => {
      upsertConversation(conv);
    });

    socket.on('conversation:assigned', ({ conversation }) => {
      upsertConversation(conversation);
    });

    socket.on('conversation:status', ({ conversationId, status }) => {
      updateConversationStatus(conversationId, status);
    });

    socket.on('message:new', (msg) => {
      addMessage(msg);
    });

    socket.on('message:status', ({ messageId, conversationId, status }) => {
      updateMessageStatus(messageId, conversationId, status);
    });

    socket.on('typing:start', ({ conversationId, userName }) => {
      setTyping(conversationId, userName);
    });

    socket.on('typing:stop', ({ conversationId }) => {
      setTyping(conversationId, null);
    });

    socket.on('presence:snapshot', (snapshot) => {
      setAgents(snapshot);
    });

    socket.on('presence:changed', (presence) => {
      updateAgentPresence(presence);
    });

    socket.on('queue:updated', (payload) => {
      updateQueueStats(payload);
    });

    socket.on('system:alert', (alert) => {
      addAlert(alert);
    });

    return () => {
      socket.off('conversation:created');
      socket.off('conversation:updated');
      socket.off('conversation:assigned');
      socket.off('conversation:status');
      socket.off('message:new');
      socket.off('message:status');
      socket.off('typing:start');
      socket.off('typing:stop');
      socket.off('presence:snapshot');
      socket.off('presence:changed');
      socket.off('queue:updated');
      socket.off('system:alert');
    };
  }, [token, upsertConversation, updateConversationStatus, addMessage, updateMessageStatus, setTyping, setAgents, updateAgentPresence, updateQueueStats, addAlert]);

  // Se a conversa ativa mudar, inscreve o socket na sala dessa conversa
  useEffect(() => {
    if (!token || !activeConversationId) return;
    const socket = getSocket(token);

    socket.emit('conversation:subscribe', activeConversationId);

    return () => {
      socket.emit('conversation:unsubscribe', activeConversationId);
    };
  }, [token, activeConversationId]);
}
