import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';

export async function isAdminEmail(email?: string | null): Promise<boolean> {
    if (!email) return false;

    await connectDB();
    const user = await User.findOne({ email }).select('isAdmin').lean();
    return Boolean(user?.isAdmin);
}

export async function requireAdminSession(): Promise<
    | { ok: true; email: string }
    | { ok: false; status: 401 | 403; error: string }
> {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;

    if (!email) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const isAdmin = await isAdminEmail(email);
    if (!isAdmin) {
        return { ok: false, status: 403, error: 'Admin access required' };
    }

    return { ok: true, email };
}

export async function countAdmins(): Promise<number> {
    await connectDB();
    return User.countDocuments({ isAdmin: true });
}

/** Bootstrap only: if no admins exist yet, make the current session user admin. */
export async function claimFirstAdmin(email: string): Promise<{
    claimed: boolean;
    reason?: string;
}> {
    await connectDB();

    const existingAdmins = await User.countDocuments({ isAdmin: true });
    if (existingAdmins > 0) {
        return { claimed: false, reason: 'An admin already exists' };
    }

    await User.findOneAndUpdate(
        { email },
        {
            $set: { isAdmin: true },
            $setOnInsert: { email },
        },
        { upsert: true, new: true }
    );

    // Close the check-then-set race: if two callers claimed concurrently, only
    // one may remain admin. The loser is rolled back and can retry.
    const adminsAfterClaim = await User.countDocuments({ isAdmin: true });
    if (adminsAfterClaim > 1) {
        await User.updateOne({ email }, { $set: { isAdmin: false } });
        return { claimed: false, reason: 'Another admin claimed first — please retry' };
    }

    return { claimed: true };
}
