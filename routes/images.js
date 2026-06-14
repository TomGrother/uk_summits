const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
const uploadDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(16).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// List all images uploaded by the current user, with summit info.
router.get('/my-images', requireAuth, (req, res) => {
  const images = db.prepare(`
    SELECT si.id, si.filename, si.created_at, si.summit_id, s.name AS summit_name
    FROM summit_images si
    JOIN summits s ON s.id = si.summit_id
    WHERE si.user_id = ?
    ORDER BY si.created_at DESC
  `).all(req.user.id);

  res.json({ images: images.map(i => ({ ...i, url: `/uploads/${i.filename}` })) });
});

// List images for a summit, including uploader username.
router.get('/:id/images', requireAuth, (req, res) => {
  const images = db.prepare(`
    SELECT si.id, si.filename, si.created_at, u.username
    FROM summit_images si
    JOIN users u ON u.id = si.user_id
    WHERE si.summit_id = ?
    ORDER BY si.created_at DESC
  `).all(req.params.id);

  res.json({ images: images.map(i => ({ ...i, url: `/uploads/${i.filename}` })) });
});

// Upload an image for a summit.
router.post('/:id/images', requireAuth, upload.single('image'), (req, res) => {
  const summit = db.prepare('SELECT id FROM summits WHERE id = ?').get(req.params.id);
  if (!summit) return res.status(404).json({ error: 'Summit not found' });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded, or file type not allowed' });

  const result = db.prepare(`
    INSERT INTO summit_images (summit_id, user_id, filename) VALUES (?, ?, ?)
  `).run(req.params.id, req.user.id, req.file.filename);

  res.json({
    ok: true,
    image: {
      id: result.lastInsertRowid,
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      username: req.user.username,
    },
  });
});

// Delete an image (uploader only).
router.delete('/images/:imageId', requireAuth, (req, res) => {
  const image = db.prepare('SELECT * FROM summit_images WHERE id = ?').get(req.params.imageId);
  if (!image) return res.status(404).json({ error: 'Image not found' });
  if (image.user_id !== req.user.id) return res.status(403).json({ error: 'Not your image' });

  db.prepare('DELETE FROM summit_images WHERE id = ?').run(image.id);
  fs.unlink(path.join(uploadDir, image.filename), () => {});
  res.json({ ok: true });
});

module.exports = router;
