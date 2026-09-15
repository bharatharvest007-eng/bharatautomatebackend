import { app } from './app.js';
import { connectDB } from './config/db.js';
import dotenv from 'dotenv';
dotenv.config();
const PORT = process.env.PORT || 5000;
async function startServer() {
    try {
        console.log('🚀 Starting Social Media Automation Express Backend...');
        await connectDB();
        app.listen(PORT, () => {
            console.log(`\n======================================================`);
            console.log(`✨ Express Backend running on: http://localhost:${PORT}`);
            console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
            console.log(`🔗 Meta Webhook: http://localhost:${PORT}/api/meta/webhook`);
            console.log(`======================================================\n`);
        });
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
