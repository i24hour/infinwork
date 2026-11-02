import mongoose from 'mongoose';

export interface ITimeTask {
    _id?: string;
    userId: string;
    title: string;
    description: string;
    startTime: number;
    pausedElapsed: number;
    enabled: boolean;
    completed: boolean;
    completedAt?: number;
    cancelledAt?: number;
    cancelReason?: string;
    milestones: Array<{
        id?: string;
        text: string;
        completed?: boolean;
        completedAt?: number;
        createdAt?: number;
        createdAtElapsed?: number;
        /** Legacy field used before milestone ids/timestamps were split. */
        timestamp?: number;
    }>;
    events?: Array<{
        type: 'start' | 'pause' | 'complete';
        timestamp: number;
    }>;
    targetTime?: number;
    autoResumeAt?: number;
    isPublic?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

const ITimeTaskSchema = new mongoose.Schema<ITimeTask>({
    userId: {
        type: String,
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        default: '',
    },
    startTime: {
        type: Number,
        required: true,
    },
    pausedElapsed: {
        type: Number,
        default: 0,
    },
    enabled: {
        type: Boolean,
        default: true,
    },
    completed: {
        type: Boolean,
        default: false,
    },
    completedAt: {
        type: Number,
    },
    cancelledAt: {
        type: Number,
    },
    cancelReason: {
        type: String,
    },
    milestones: [{
        id: String,
        text: { type: String, required: true },
        completed: { type: Boolean, default: false },
        completedAt: Number,
        createdAt: { type: Number, default: Date.now },
        createdAtElapsed: { type: Number, default: 0 },
        timestamp: Number, // legacy
    }],
    events: [{
        type: { type: String, enum: ['start', 'pause', 'complete'] },
        timestamp: Number,
    }],
    targetTime: {
        type: Number,
    },
    autoResumeAt: {
        type: Number,
    },
    isPublic: {
        type: Boolean,
        default: true,
    },
}, {
    timestamps: true,
});

// Index for faster queries
ITimeTaskSchema.index({ userId: 1, completed: 1, createdAt: -1 });
ITimeTaskSchema.index({ enabled: 1, completed: 1 });
ITimeTaskSchema.index({ isPublic: 1, userId: 1 });

export default mongoose.models.ITimeTask || mongoose.model<ITimeTask>('ITimeTask', ITimeTaskSchema);
