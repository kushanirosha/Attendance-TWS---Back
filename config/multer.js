import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// From config/multer.js → go up 2 levels to backend/ → uploads/employees
const UPLOAD_ROOT = path.resolve(__dirname, "..", "uploads", "employees");

let folderReady = false;

// Create folder
(async () => {
  try {
    await fs.mkdir(UPLOAD_ROOT, { recursive: true });
    folderReady = true;
    console.log(`✅ Multer ready: ${UPLOAD_ROOT}`);
  } catch (e) {
    console.error("❌ Multer folder error:", e);
  }
})();

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOAD_ROOT);
  },
  filename(req, file, cb) {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const base = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "-").toLowerCase();
    const filename = `${base}-${unique}${ext}`;
    console.log(`📁 Saving: ${filename}`);
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, WebP allowed"));
  }
};

export const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter });

// Safe middleware
export const uploadMiddleware = (req, res, next) => {
  if (!folderReady) return res.status(500).json({ success: false, message: "Server not ready" });
  upload.single("profileImage")(req, res, next);
};