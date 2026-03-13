import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import marketRoutes from './routes/market';

const app = express();

// Middleware
app.use(cors({ origin: true }));
app.use(express.json());

// Routes
app.use('/market', marketRoutes);

// Export the Express app as a Firebase Function
export const api = functions.https.onRequest(app);
