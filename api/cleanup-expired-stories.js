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

const STORY_TTL_MS = 24 * 60 * 60 * 1000;

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
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const db = admin.database();
    const snapshot = await db.ref("Stories").once("value");

    if (!snapshot.exists()) {
      res.status(200).json({ removed: 0 });
      return;
    }

    const now = Date.now();
    const deletions = [];

    snapshot.forEach((userSnap) => {
      const userId = userSnap.key;
      userSnap.forEach((storySnap) => {
        const story = storySnap.val();
        const timestamp = story.timestamp || 0;

        if (now - timestamp >= STORY_TTL_MS) {
          const storyId = storySnap.key;
          deletions.push(
            (async () => {
              if (story.mediaPublicId) {
                await deleteFromCloudinary(story.mediaPublicId, story.mediaResourceType);
              }
              await db.ref(`Stories/${userId}/${storyId}`).remove();
            })()
          );
        }
      });
    });

    await Promise.all(deletions);
    res.status(200).json({ removed: deletions.length });
  } catch (err) {
    console.error("cleanup-expired-stories failed", err);
    res.status(500).json({ error: "Internal error" });
  }
};
