import { Router } from 'express';
import mongoose from 'mongoose';
import { Chat } from '../models/chat.model.js';

const chatRouter = Router();

// GET /api/v1/chat/messages/:userAId/:userBId
// Returns paginated conversation between two users (50 most recent)
chatRouter.get('/messages/:userAId/:userBId', async (req, res) => {
  try {
    const { userAId, userBId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userAId) || !mongoose.Types.ObjectId.isValid(userBId)) {
      return res.status(400).json({ status: false, message: 'Invalid user IDs' });
    }

    const messages = await Chat.find({
      $or: [
        { sender: userAId, receiver: userBId },
        { sender: userBId, receiver: userAId },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();

    return res.status(200).json({ status: true, messages });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
});

// GET /api/v1/chat/conversations/:userId
// Returns inbox: one entry per unique conversation partner with last message info
chatRouter.get('/conversations/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ status: false, message: 'Invalid user ID' });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    const conversations = await Chat.aggregate([
      {
        $match: {
          $or: [{ sender: userObjectId }, { receiver: userObjectId }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $addFields: {
          partnerId: {
            $cond: {
              if: { $eq: ['$sender', userObjectId] },
              then: '$receiver',
              else: '$sender',
            },
          },
        },
      },
      {
        $group: {
          _id: '$partnerId',
          lastMessage: { $first: '$message' },
          lastTimestamp: { $first: '$createdAt' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$receiver', userObjectId] },
                    { $eq: ['$isReceiverInRoom', false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          partnerUserName: { $first: '$userName' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'partnerInfo',
        },
      },
      { $unwind: { path: '$partnerInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          partnerId: '$_id',
          partnerName: { $ifNull: [{ $ifNull: ['$partnerInfo.userId', '$partnerUserName'] }, 'Unknown'] },
          lastMessage: 1,
          lastTimestamp: 1,
          unreadCount: 1,
        },
      },
      { $sort: { lastTimestamp: -1 } },
    ]);

    return res.status(200).json({ status: true, conversations });
  } catch (error) {
    return res.status(500).json({ status: false, message: error.message });
  }
});

export default chatRouter;
