/**
 * netlify/lib/firebaseAdmin.mjs — khởi tạo Firebase Admin SDK cho Netlify Functions.
 *
 * KHOÁ BÍ MẬT chỉ nằm trong Environment Variables của Netlify (không bao giờ vào mã nguồn / trình duyệt):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   (hoặc một biến duy nhất FIREBASE_SERVICE_ACCOUNT chứa nguyên JSON service account).
 * Project phải TRÙNG với project của firebaseConfig ở frontend (config/firebaseClient.js).
 *
 * Module được nạp bằng dynamic import để các bài test không cần cài firebase-admin.
 */
let cached = null;

function readCredentials() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    const parsed = JSON.parse(json);
    return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: parsed.private_key };
  }
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error('Thiếu biến môi trường Firebase Admin (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY).');
  }
  return {
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    // Netlify thường lưu xuống dòng dạng "\n" thô
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };
}

export async function getRealDeps() {
  if (cached) return cached;
  const { initializeApp, getApps, cert } = await import('firebase-admin/app');
  const { getAuth } = await import('firebase-admin/auth');
  const { getFirestore } = await import('firebase-admin/firestore');

  const app = getApps()[0] || initializeApp({ credential: cert(readCredentials()) });
  const db = getFirestore(app);
  const auth = getAuth(app);
  cached = { db, verifyIdToken: (token) => auth.verifyIdToken(token) };
  return cached;
}
