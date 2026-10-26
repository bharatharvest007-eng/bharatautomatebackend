/**
 * Registers every background job handler before the worker starts. Each domain
 * owns one file and exposes `register()`; adding a domain means adding one line here.
 */
import { register as registerCore } from './core.js';
import { register as registerPlatform } from './platform.js';
import { register as registerBilling } from './billing.js';
import { register as registerChannels } from './channels.js';
import { register as registerEngine } from './engine.js';
import { register as registerAi } from './ai.js';
import { register as registerContent } from './content.js';
import { register as registerCrm } from './crm.js';
import { register as registerCampaigns } from './campaigns.js';
import { register as registerAnalytics } from './analytics.js';

let registered = false;

export function registerAllJobs(): void {
  if (registered) return;
  registered = true;
  registerCore();
  registerPlatform();
  registerBilling();
  registerChannels();
  registerEngine();
  registerAi();
  registerContent();
  registerCrm();
  registerCampaigns();
  registerAnalytics();
}
