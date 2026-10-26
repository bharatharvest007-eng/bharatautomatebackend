/**
 * Process entry point: load env → connect MongoDB → register job handlers →
 * start the job worker → listen. SIGTERM/SIGINT (sent by the host on deploys)
 * stop the worker, drain HTTP connections and close the DB before exiting.
 */
import './config/env.js';
import { env } from './config/env.js';
import { app } from './app.js';
import { connectDB, disconnectDB, reconcileLegacyIndexes } from './config/db.js';
import { registerAllJobs } from './jobs/index.js';
import { startJobWorker, stopJobWorker } from './services/jobs.js';
const SHUTDOWN_TIMEOUT_MS = 30_000;
let server = null;
let shuttingDown = false;
async function startServer() {
    console.log(`[Server] Starting BharatAutomate backend (${env.NODE_ENV})...`);
    await connectDB();
    await reconcileLegacyIndexes();
    registerAllJobs();
    if (env.JOBS_ENABLED) {
        startJobWorker();
    }
    else {
        console.log('[Server] JOBS_ENABLED=false: background job worker not started');
    }
    const port = env.PORT;
    server = app.listen(port, () => {
        console.log(`[Server] Listening on port ${port}`);
        console.log(`[Server] Health check: ${env.BASE_URL}/api/health`);
        console.log(`[Server] Meta webhook: ${env.BASE_URL}/api/meta/webhook`);
    });
    server.on('error', (error) => {
        console.error(`[Server] HTTP server error${error.code ? ` (${error.code})` : ''}:`, error.message);
        void shutdown('server-error', 1);
    });
}
function closeHttpServer() {
    return new Promise((resolve) => {
        if (!server)
            return resolve();
        server.close(() => resolve());
        // Keep-alive sockets would otherwise hold close() open until they time out.
        server.closeIdleConnections();
    });
}
async function shutdown(reason, exitCode = 0) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`[Server] Shutting down (${reason})...`);
    const forceExit = setTimeout(() => {
        console.error('[Server] Graceful shutdown timed out; forcing exit');
        process.exit(exitCode || 1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    try {
        await stopJobWorker();
        await closeHttpServer();
        await disconnectDB();
    }
    catch (error) {
        console.error('[Server] Error during shutdown:', error instanceof Error ? error.message : error);
        exitCode = exitCode || 1;
    }
    process.exit(exitCode);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    console.error('[Process] Unhandled promise rejection:', reason instanceof Error ? (reason.stack ?? reason.message) : reason);
});
// After an uncaught exception the process state is unknown; log, then exit so the host restarts it cleanly.
process.on('uncaughtException', (error) => {
    console.error('[Process] Uncaught exception:', error.stack ?? error.message);
    void shutdown('uncaughtException', 1);
});
startServer().catch((error) => {
    console.error('[Server] Failed to start:', error instanceof Error ? error.message : error);
    void shutdown('startup-failure', 1);
});
