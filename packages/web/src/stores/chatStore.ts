import { create } from 'zustand';
import type {
  ConversationSummary,
  ConversationStatus,
  MessageDTO,
  MessageStatus,
} from '@crm/shared';

export type InboxTab = 'my' | 'queue' | 'bot' | 'all' | 'resolved';

interface ChatState {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeTab: InboxTab;
  searchQuery: string;
  selectedDepartmentId: string | null;
  messages: Record<string, MessageDTO[]>;
  typingUsers: Record<string, string>; // conversationId -> userName
  isContactInfoOpen: boolean;

  setConversations: (conversations: ConversationSummary[]) => void;
  upsertConversation: (conversation: ConversationSummary) => void;
  updateConversationStatus: (id: string, status: ConversationStatus) => void;
  setActiveConversationId: (id: string | null) => void;
  setActiveTab: (tab: InboxTab) => void;
  setSearchQuery: (query: string) => void;
  setSelectedDepartmentId: (deptId: string | null) => void;
  setMessages: (conversationId: string, messages: MessageDTO[]) => void;
  addMessage: (message: MessageDTO) => void;
  updateMessageStatus: (messageId: string, conversationId: string, status: MessageStatus) => void;
  setTyping: (conversationId: string, userName: string | null) => void;
  toggleContactInfo: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  activeTab: 'my',
  searchQuery: '',
  selectedDepartmentId: null,
  messages: {},
  typingUsers: {},
  isContactInfoOpen: true,

  setConversations: (conversations) => set({ conversations }),

  upsertConversation: (conversation) => {
    set((state) => {
      const idx = state.conversations.findIndex((c) => c.id === conversation.id);
      if (idx >= 0) {
        const copy = [...state.conversations];
        copy[idx] = conversation;
        // Reordena pelo mais recente
        copy.sort((a, b) => {
          const tA = new Date(a.lastMessageAt || a.createdAt).getTime();
          const tB = new Date(b.lastMessageAt || b.createdAt).getTime();
          return tB - tA;
        });
        return { conversations: copy };
      }
      return { conversations: [conversation, ...state.conversations] };
    });
  },

  updateConversationStatus: (id, status) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, status } : c)),
    }));
  },

  setActiveConversationId: (id) => set({ activeConversationId: id }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedDepartmentId: (deptId) => set({ selectedDepartmentId: deptId }),

  setMessages: (conversationId, messages) => {
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
    }));
  },

  addMessage: (message) => {
    set((state) => {
      const list = state.messages[message.conversationId] || [];
      // Deduplica por id
      if (list.some((m) => m.id === message.id)) return state;

      return {
        messages: {
          ...state.messages,
          [message.conversationId]: [...list, message],
        },
      };
    });
  },

  updateMessageStatus: (messageId, conversationId, status) => {
    set((state) => {
      const list = state.messages[conversationId];
      if (!list) return state;
      return {
        messages: {
          ...state.messages,
          [conversationId]: list.map((m) => (m.id === messageId ? { ...m, status } : m)),
        },
      };
    });
  },

  setTyping: (conversationId, userName) => {
    set((state) => {
      const copy = { ...state.typingUsers };
      if (userName) {
        copy[conversationId] = userName;
      } else {
        delete copy[conversationId];
      }
      return { typingUsers: copy };
    });
  },

  toggleContactInfo: () => set((state) => ({ isContactInfoOpen: !state.isContactInfoOpen })),
}));
