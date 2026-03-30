export interface ChatMessage {
  customId: string;
  sender: string;       // MongoDB _id
  receiver: string;     // MongoDB _id
  message: string;
  userName?: string;
  isReceiverInRoom?: boolean;
  isEdited?: boolean;
  createdAt?: string;
}

export interface Conversation {
  partnerId: string;    // MongoDB _id of the other user
  partnerName: string;  // userId string used as display name
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  online?: boolean;
}
