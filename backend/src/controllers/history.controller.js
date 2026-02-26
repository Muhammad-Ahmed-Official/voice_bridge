import { History } from "../models/history.models.js";

export const createHistory = async (req, res) => {
    try {
        const { initiatedBy, participants, callType, duration, callRecordingUrl } = req.body;
        
        if (!initiatedBy || !participants || !callType) {
            return res.status(400).send({ status: false, message: "Missing required fields: initiatedBy, participants, callType" });
        }

        if (!Array.isArray(participants) || participants.length === 0) {
            return res.status(400).send({ status: false, message: "Participants must be a non-empty array" });
        }

        const history = await History.create({ 
            initiatedBy, 
            participants, 
            callType, 
            duration: duration || 0, 
            callRecordingUrl: callRecordingUrl || '' 
        });
        
        return res.status(201).send({ status: true, message: "History created successfully", history });
    } catch (error) {
        return res.status(500).send({ status: false, message: error.message });
    }
};

export const getHistoryByUser = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!userId) {
            return res.status(400).send({ status: false, message: "User ID is required" });
        }

        const history = await History.find({
            $or: [
                { initiatedBy: userId },
                { 'participants.user': userId }
            ]
        })
        .populate('initiatedBy', 'userId name')
        .populate('participants.user', 'userId name')
        .sort({ createdAt: -1 })
        .limit(50);

        return res.status(200).send({ status: true, history });
    } catch (error) {
        return res.status(500).send({ status: false, message: error.message });
    }
};

export const deleteHistory = async (req, res) => {
    try {
        const { historyId } = req.params;
        
        if (!historyId) {
            return res.status(400).send({ status: false, message: "History ID is required" });
        }

        const deleted = await History.findByIdAndDelete(historyId);
        
        if (!deleted) {
            return res.status(404).send({ status: false, message: "History not found" });
        }

        return res.status(200).send({ status: true, message: "History deleted successfully" });
    } catch (error) {
        return res.status(500).send({ status: false, message: error.message });
    }
};