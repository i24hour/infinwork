import mongoose from 'mongoose';

export interface IMobileSession {
    tokenHash: string;
    email: string;
    expiresAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const MobileSessionSchema = new mongoose.Schema<IMobileSession>(
    {
        tokenHash: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        email: {
            type: String,
            required: true,
            index: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    { timestamps: true }
);

// Let MongoDB remove expired bearer tokens instead of growing forever.
MobileSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.MobileSession ||
    mongoose.model<IMobileSession>('MobileSession', MobileSessionSchema);
