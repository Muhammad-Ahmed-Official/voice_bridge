import { axiosInstance } from './axios';
import type { ChatMessage, Conversation } from '../types/chat';

export const chatApi = {
  getMessages: async (userAId: string, userBId: string): Promise<ChatMessage[]> => {
    const res = await axiosInstance.get(`/chat/messages/${userAId}/${userBId}`);
    return res.data.messages ?? [];
  },

  getConversations: async (userId: string): Promise<Conversation[]> => {
    const res = await axiosInstance.get(`/chat/conversations/${userId}`);
    return res.data.conversations ?? [];
  },

  searchUser: async (userId: string): Promise<{ _id: string; userId: string } | null> => {
    const res = await axiosInstance.get('/auth/users/search', { params: { userId } });
    return res.data.user ?? null;
  },
};
