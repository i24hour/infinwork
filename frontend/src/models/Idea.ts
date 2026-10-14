import mongoose from 'mongoose';

export interface IIdea {
    _id?: string;
    title: string;
    details: string;
    isPublic: boolean;
    createdBy: string; // userId (email)
    createdAt?: Date;
    updatedAt?: Date;
}

const IdeaSchema = new mongoose.Schema<IIdea>({
    title: {
        type: String,
        required: true,
        trim: true,
    },
    details: {
        type: String,
        default: '',
        trim: true,
    },
    isPublic: {
        type: Boolean,
        default: true,
    },
    createdBy: {
        type: String,
        required: true,
        index: true,
    },
}, {
    timestamps: true,
});

IdeaSchema.index({ createdBy: 1, createdAt: -1 });
IdeaSchema.index({ isPublic: 1, createdAt: -1 });

export default mongoose.models.Idea || mongoose.model<IIdea>('Idea', IdeaSchema);
