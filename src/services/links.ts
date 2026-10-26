/**
 * STUB: implemented by D8 (Campaigns, Essentials, Bio, Links, Widget).
 *
 * Wraps a destination URL in a tracked short link (`/r/:slug`) attributed to
 * an account / automation / broadcast / contact. Until D8 lands, the original
 * URL is returned unchanged so links keep working, just without click tracking.
 */

export async function trackedUrl(
  _orgId: string,
  targetUrl: string,
  _opts?: { accountId?: string; automationId?: string; broadcastId?: string; contactId?: string; title?: string },
): Promise<string> {
  return targetUrl;
}
