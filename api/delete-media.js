const admin = require("firebase-admin");
const cloudinary = require("cloudinary").v2;

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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function deleteFromCloudinary(publicId, resourceType) {
  if (!publicId) return;
  const type = resourceType === "video" || resourceType === "raw" ? resourceType : "image";
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: type, invalidate: true });
  } catch (err) {
    console.error("Cloudinary destroy failed", publicId, err);
  }
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

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    uid = decoded.uid;
  } catch (err) {
    res.status(401).json({ error: "Invalid auth token" });
    return;
  }

  const { type, id, groupId } = req.body || {};

  if (!type || !id) {
    res.status(400).json({ error: "Missing type or id" });
    return;
  }

  const db = admin.database();
  let ref;

  if (type === "post") {
    ref = db.ref(`Posts/${id}`);
  } else if (type === "groupPost") {
    if (!groupId) {
      res.status(400).json({ error: "Missing groupId" });
      return;
    }
    ref = db.ref(`Groups/${groupId}/Posts/${id}`);
  } else if (type === "chatMessage") {
    ref = db.ref(`Chat/${id}`);
  } else if (type === "story") {
    ref = db.ref(`Stories/${uid}/${id}`);
  } else {
    res.status(400).json({ error: "Unknown type" });
    return;
  }

  const snapshot = await ref.once("value");
  const data = snapshot.val();

  if (!data) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const ownerField =
    type === "post" || type === "groupPost" ? data.postBy
    : type === "chatMessage" ? data.sender
    : data.userId;

  if (ownerField !== uid) {
    res.status(403).json({ error: "Not your content" });
    return;
  }

  const publicId = data.postPublicId || data.mediaPublicId;
  const resourceType = data.postResourceType || data.mediaResourceType;

  await deleteFromCloudinary(publicId, resourceType);
  await ref.remove();

  res.status(200).json({ success: true });
};
