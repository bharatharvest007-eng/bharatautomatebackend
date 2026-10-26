import * as models from '../models/index.js';
import { newId } from '../lib/ids.js';
const MAX_META_BYTES = 8_192;
function isRequest(actor) {
    return typeof actor.get === 'function' && typeof actor.method === 'string';
}
/** Keeps meta small and JSON-safe; oversized meta is replaced by a marker. */
function safeMeta(meta) {
    if (!meta)
        return {};
    try {
        const json = JSON.stringify(meta);
        if (json.length > MAX_META_BYTES)
            return { truncated: true, bytes: json.length };
        return JSON.parse(json);
    }
    catch {
        return { unserializable: true };
    }
}
/** Records `action` (dotted verb, e.g. 'member.invited') for the actor's workspace. */
export function audit(actor, action, target, meta) {
    let orgId;
    let userId;
    let ip;
    const extra = {};
    if (isRequest(actor)) {
        orgId = actor.auth?.orgId;
        userId = actor.auth?.userId;
        ip = actor.ip;
        if (actor.auth?.via === 'api_key') {
            extra.via = 'api_key';
            extra.apiKeyId = actor.auth.apiKeyId;
        }
    }
    else {
        orgId = actor.orgId;
        userId = actor.userId;
        ip = actor.ip;
    }
    if (!orgId)
        return;
    models.AuditLog.create({
        _id: newId('aud'),
        orgId,
        userId,
        action,
        targetType: target?.type,
        targetId: target?.id,
        meta: safeMeta({ ...extra, ...(meta ?? {}) }),
        ip,
    }).catch((error) => {
        console.error(`[Audit] Failed to record "${action}":`, error instanceof Error ? error.message : error);
    });
}
