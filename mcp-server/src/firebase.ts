import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

let dbInstance: admin.firestore.Firestore | null = null;

export function getFirestoreDb(): admin.firestore.Firestore {
  if (dbInstance) {
    return dbInstance;
  }

  if (admin.apps.length > 0) {
    dbInstance = admin.firestore();
    return dbInstance;
  }

  // 1. Check individual environment variables (Most convenient on Render / Cloud)
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });
    console.log('[Firebase] Initialized with individual environment variables.');
    dbInstance = admin.firestore();
    return dbInstance;
  }

  // 2. Check Base64 encoded Service Account
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const decoded = Buffer.from(
        process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
        'base64'
      ).toString('utf-8');
      const serviceAccount = JSON.parse(decoded);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[Firebase] Initialized with base64 service account.');
      dbInstance = admin.firestore();
      return dbInstance;
    } catch (e) {
      console.error('[Firebase] Failed to parse base64 service account:', e);
    }
  }

  // 3. Check JSON string Service Account
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[Firebase] Initialized with JSON service account.');
      dbInstance = admin.firestore();
      return dbInstance;
    } catch (e) {
      console.error('[Firebase] Failed to parse JSON service account:', e);
    }
  }

  // 4. Fallback to Application Default Credentials (e.g. GOOGLE_APPLICATION_CREDENTIALS)
  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log('[Firebase] Initialized with Application Default Credentials.');
    dbInstance = admin.firestore();
    return dbInstance;
  } catch (err) {
    console.warn(
      '[Firebase] Warning: Could not initialize Firebase Admin. Firestore operations will fail until credentials are provided.',
      err
    );
    throw new Error(
      'Firebase Admin credentials not configured. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in your environment.'
    );
  }
}
