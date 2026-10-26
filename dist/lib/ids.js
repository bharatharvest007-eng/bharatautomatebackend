/**
 * Identifier helpers. Documents use string `_id`s with a type prefix
 * (`ctc_…`, `org_…`) so ids are self-describing in logs and URLs; the random
 * suffix keeps ids unguessable and collision-free within the same millisecond.
 */
import { randomBytes } from 'node:crypto';
import * as models from '../models/index.js';
export function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}
/**
 * Atomically increments and returns the named sequence (1, 2, 3…), creating it
 * on first use. Used for gap-free human-facing numbers such as invoice numbers.
 */
export async function nextSequence(name) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const counter = await models.Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }).lean();
            if (counter)
                return counter.seq;
        }
        catch (error) {
            // Two first-ever increments can race on the upsert insert; the loser retries as an update.
            const code = error.code;
            if (code !== 11000 || attempt > 0)
                throw error;
        }
    }
    throw new Error(`Failed to increment sequence "${name}"`);
}
/** URL-safe slug: lowercase ASCII letters, digits and single dashes. */
export function slugify(input, maxLength = 40) {
    const slug = input
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength)
        .replace(/-+$/g, '');
    return slug;
}
/** A workspace slug derived from `name` that no Organization uses yet. */
export async function uniqueOrgSlug(name) {
    const root = slugify(name) || 'workspace';
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = attempt === 0 ? root : `${root}-${randomBytes(3).toString('hex')}`;
        if (!(await models.Organization.exists({ slug: candidate })))
            return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
}
/** Public, unguessable key the website widget embeds (instead of the raw org id). */
export function newWidgetKey() {
    return `wk_${randomBytes(16).toString('hex')}`;
}
