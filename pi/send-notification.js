const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Missing auth token" });
    return;
  }

  let senderUid;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    senderUid = decoded.uid; // بنتحقق بس إن الطلب من مستخدم مسجل دخول حقيقي
  } catch (err) {
    res.status(401).json({ error: "Invalid auth token" });
    return;
  }

  const { receiverUid, title, message, type, targetId } = req.body || {};

  if (!receiverUid) {
    res.status(400).json({ error: "Missing receiverUid" });
    return;
  }

  try {
    const db = admin.database();
    const snapshot = await db.ref(`Tokens/${receiverUid}`).once("value");
    const fcmToken = snapshot.val();

    if (!fcmToken) {
      // المستقبل مسجلش FCM token (مثلاً مثبتش الإشعارات) - مش خطأ، بس مفيش حد نبعتله
      res.status(200).json({ success: true, skipped: true, reason: "No FCM token for receiver" });
      return;
    }

    await admin.messaging().send({
      token: fcmToken,
      data: {
        title: title || "",
        message: message || "",
        type: type || "chat",
        targetId: targetId || "",
      },
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("send-notification failed", err);
    res.status(500).json({ error: "Internal error" });
  }
};
