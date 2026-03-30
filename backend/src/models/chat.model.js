import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema(
  {
    customId: {
      type: String,
      required: true,
      unique: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
    },
    isReceiverInRoom: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

chatSchema.index({ sender: 1, receiver: 1 });
chatSchema.index({ receiver: 1, sender: 1 });

export const Chat = mongoose.model('Chat', chatSchema);
