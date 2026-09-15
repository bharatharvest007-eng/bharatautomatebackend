import { connectDB, disconnectDB } from '../config/db.js';
import * as models from '../models/index.js';
async function wipeDatabase() {
    console.log('🧹 [WipeDB] Connecting to MongoDB to purge all demo data...');
    await connectDB();
    try {
        const collectionsToPurge = [
            { name: 'SocialAccount', model: models.SocialAccount },
            { name: 'Automation', model: models.Automation },
            { name: 'AutomationRun', model: models.AutomationRun },
            { name: 'Contact', model: models.Contact },
            { name: 'Conversation', model: models.Conversation },
            { name: 'Message', model: models.Message },
            { name: 'LeadCard', model: models.LeadCard },
            { name: 'LeadSubmission', model: models.LeadSubmission },
            { name: 'Template', model: models.Template },
            { name: 'BioPage', model: models.BioPage },
            { name: 'LinkClick', model: models.LinkClick },
            { name: 'ShortLink', model: models.ShortLink },
            { name: 'IceBreaker', model: models.IceBreaker },
            { name: 'MenuItem', model: models.MenuItem },
            { name: 'RewindJob', model: models.RewindJob },
            { name: 'ScheduledPost', model: models.ScheduledPost },
            { name: 'CommentLog', model: models.CommentLog },
            { name: 'IgMedia', model: models.IgMedia },
            { name: 'IgStory', model: models.IgStory },
            { name: 'WebhookEvent', model: models.WebhookEvent },
            { name: 'Job', model: models.Job },
            { name: 'UsageCounter', model: models.UsageCounter },
            { name: 'DailyStat', model: models.DailyStat },
            { name: 'AiUsage', model: models.AiUsage },
            { name: 'RateLimitState', model: models.RateLimitState },
            { name: 'OAuthState', model: models.OAuthState },
        ];
        for (const item of collectionsToPurge) {
            if (item.model) {
                const res = await item.model.deleteMany({});
                console.log(`  ✓ Wiped ${res.deletedCount} items from ${item.name}`);
            }
        }
        await models.User.deleteMany({});
        await models.Organization.deleteMany({});
        const org = await models.Organization.create({
            _id: 'org_workspace',
            name: 'My Workspace',
            slug: 'workspace',
            plan: 'unlimited',
            timezone: 'UTC',
            limits: {
                maxAccounts: 10,
                monthlyAiCredits: -1,
                dailyDmLimitPerAccount: 5000,
            },
            settings: {},
        });
        console.log('  ✓ Created fresh clean workspace organization: "My Workspace"');
        await models.User.create({
            _id: 'usr_admin',
            email: 'admin@senddm.local',
            passwordHash: 'password123',
            name: 'Admin User',
            memberships: [{ orgId: org._id, role: 'owner' }],
        });
        console.log('  ✓ Created fresh clean admin user: admin@senddm.local (password: password123)');
        console.log('\n✨ Database is completely CLEAN! Zero demo accounts, zero demo automations, zero demo contacts.');
    }
    catch (error) {
        console.error('❌ Wipe failed:', error);
    }
    finally {
        await disconnectDB();
    }
}
wipeDatabase();
