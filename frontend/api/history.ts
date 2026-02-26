import { axiosInstance } from "./axios";

export interface Participant {
  user: {
    _id: string;
    userId: string;
    name?: string;
  };
  languageSpoken: string;
  languageHeard: string;
}

export interface HistoryItem {
  _id: string;
  initiatedBy: {
    _id: string;
    userId: string;
    name?: string;
  };
  participants: Participant[];
  callType: 'One to One Call' | 'Group Meeting' | 'Bluetooth';
  duration: number;
  callRecordingUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHistoryParams {
  initiatedBy: string;
  participants: {
    user: string;
    languageSpoken: string;
    languageHeard: string;
  }[];
  callType: 'One to One Call' | 'Group Meeting' | 'Bluetooth';
  duration: number;
  callRecordingUrl?: string;
}

export const historyApi = {
  getByUser: async (userId: string): Promise<HistoryItem[]> => {
    const response = await axiosInstance.get(`/history/user/${userId}`);
    return response.data.history || [];
  },

  create: async (params: CreateHistoryParams): Promise<HistoryItem> => {
    const response = await axiosInstance.post('/history/create', params);
    return response.data.history;
  },

  delete: async (historyId: string): Promise<void> => {
    await axiosInstance.delete(`/history/${historyId}`);
  },
};
