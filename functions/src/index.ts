import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import marketRoutes from './routes/market';
import mutualFundRoutes from './routes/mutualfund';
import { authMiddleware } from './middleware/auth.middleware';
import { rateLimitMiddleware } from './middleware/rate-limit.middleware';

// Initialize Firebase Admin
admin.initializeApp();

const app = express();

/**
 * Global Middlewares
 * - CORS: Allow cross-origin requests
 * - JSON: Parse request bodies
 * - Rate Limiting: Prevent abuse
 * - Auth: Ensure only registered users can access market data
 */
app.use(cors({ origin: true }));
app.use(express.json());
app.use(rateLimitMiddleware);
app.use(authMiddleware);

// Routes
app.use('/market', marketRoutes);
app.use('/mutualfund', mutualFundRoutes);

// Export the Express app as a Firebase Function
export const api = functions.runWith({
  secrets: ['FINNHUB_API_KEY'],
  memory: '256MB',
  timeoutSeconds: 60,
}).https.onRequest(app);
