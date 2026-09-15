/**
 * The domain contract shared by the API, the workers, and the dashboard.
 *
 * Flows are stored as JSON, so these types *are* the schema for automation
 * behaviour. Changing them changes what users can build; treat them as a
 * versioned interface, not a scratch pad.
 */
export const ROLE_RANK = { owner: 4, admin: 3, member: 2, viewer: 1 };
export function roleAtLeast(role, required) {
    const r = ROLE_RANK[role ?? 'viewer'] ?? 0;
    return r >= ROLE_RANK[required];
}
