import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
const uri = process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    'mongodb://localhost:27017/socialmediaautomate';
export async function connectDB() {
    if (mongoose.connection.readyState >= 1) {
        return mongoose;
    }
    try {
        const conn = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 15000,
        });
        console.log(`[MongoDB] Connected successfully to: ${conn.connection.host}/${conn.connection.name}`);
        return conn;
    }
    catch (error) {
        console.error('[MongoDB] Connection error:', error);
        throw error;
    }
}
export async function disconnectDB() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
        console.log('[MongoDB] Disconnected');
    }
}
export { mongoose };
