/**
 * DESTRUCTIVE: deletes every document in every collection of the configured
 * database. Development only.
 *
 * Guards (all required):
 * - NODE_ENV must not be 'production';
 * - the `--yes` flag must be passed (`npm run db:wipe -- --yes`);
 * - a non-local MongoDB URI additionally requires `--allow-remote`, because a
 *   developer `.env` may point at a hosted (possibly production) cluster.
 *
 * Nothing is seeded afterwards; create the first owner with `npm run db:init`.
 */
import '../config/env.js';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDB, disconnectDB } from '../config/db.js';
// Importing the barrel registers every model with mongoose, so modelNames() below is complete.
import '../models/index.js';
const args = new Set(process.argv.slice(2));
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
/** True only when every host in a mongodb:// URI is loopback (SRV URIs are always remote). */
function isLocalMongoUri(uri) {
    if (!uri.startsWith('mongodb://'))
        return false;
    const afterScheme = uri.slice('mongodb://'.length);
    const authority = afterScheme.split('/')[0] ?? '';
    const hostList = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
    const hosts = hostList.split(',').map((host) => {
        const trimmed = host.trim().toLowerCase();
        if (trimmed.startsWith('['))
            return trimmed.slice(0, trimmed.indexOf(']') + 1);
        return trimmed.split(':')[0];
    });
    return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTS.has(host));
}
function refuse(message) {
    console.error(`[WipeDB] Refusing to run: ${message}`);
    process.exit(1);
}
async function wipeDatabase() {
    if (env.isProd)
        refuse('NODE_ENV is production.');
    if (!args.has('--yes'))
        refuse('this deletes ALL data. Re-run with `npm run db:wipe -- --yes`.');
    if (!isLocalMongoUri(env.MONGODB_URI) && !args.has('--allow-remote')) {
        refuse('MONGODB_URI is not a local database. Pass --allow-remote as well if you really mean it.');
    }
    await connectDB();
    try {
        for (const name of mongoose.modelNames().sort()) {
            const result = await mongoose.model(name).deleteMany({});
            console.log(`[WipeDB] ${name}: deleted ${result.deletedCount ?? 0}`);
        }
        console.log('[WipeDB] Done. Create the first owner with `npm run db:init` (see INIT_ADMIN_* in .env.example).');
    }
    finally {
        await disconnectDB();
    }
}
wipeDatabase().catch(async (error) => {
    console.error('[WipeDB] Failed:', error instanceof Error ? error.message : error);
    await disconnectDB().catch(() => undefined);
    process.exit(1);
});
