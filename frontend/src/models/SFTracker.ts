import mongoose from 'mongoose';

const sfTrackerSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    target: {
        type: String,
        required: true,
    },
    successCondition: {
        type: String,
        required: true,
    },
    status: {
        type: String,
        enum: ['Pending', 'Success', 'Failure'],
        default: 'Pending',
    },
    failureReason: {
        type: String,
        default: '',
    },
}, {
    timestamps: true,
});

sfTrackerSchema.index({ userId: 1, createdAt: -1 });
sfTrackerSchema.index({ status: 1, userId: 1 });

const SFTracker = mongoose.models.SFTracker || mongoose.model('SFTracker', sfTrackerSchema);

export default SFTracker;
