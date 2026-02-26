import mongoose from 'mongoose';

const historySchema = new mongoose.Schema({
    initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    participants: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        languageSpoken: {
            type: String,
            required: true,
        },
        languageHeard: {
            type: String,
            required: true,
        }
    }],
    callType: {
        type: String,
        enum: ['One to One Call', 'Group Meeting', 'Bluetooth'],
        required: true,
    },
    duration: {
        type: Number, // in seconds
        default: 0,
    },
    callRecordingUrl: {
        type: String,
        default: '',
    },
}, { timestamps: true });

export const History = mongoose.model('History', historySchema);