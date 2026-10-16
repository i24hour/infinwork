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
            index: true,
        },
    },
    { timestamps: true }
);

export default mongoose.models.MobileSession ||
    mongoose.model<IMobileSession>('MobileSession', MobileSessionSchema);
