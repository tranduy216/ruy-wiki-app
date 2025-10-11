const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
  },
});

// Configure AWS S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'File upload API is running' });
});

// Multiple file upload endpoint
app.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const bucketName = process.env.AWS_BUCKET_NAME;
    if (!bucketName) {
      return res.status(500).json({ error: 'S3 bucket name not configured' });
    }

    // Upload all files to S3
    const uploadPromises = req.files.map(async (file) => {
      const key = `uploads/${Date.now()}-${file.originalname}`;
      
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      });

      await s3Client.send(command);

      return {
        originalName: file.originalname,
        key: key,
        size: file.size,
        mimetype: file.mimetype,
      };
    });

    const results = await Promise.all(uploadPromises);

    res.json({
      success: true,
      message: `Successfully uploaded ${results.length} file(s)`,
      files: results,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Failed to upload files',
      message: error.message,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds the 10MB limit' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum 10 files allowed' });
    }
    return res.status(400).json({ error: err.message });
  }
  
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`File upload API listening at http://localhost:${port}`);
  console.log(`Health check available at: http://localhost:${port}/health`);
  console.log(`Upload endpoint available at: POST http://localhost:${port}/upload`);
});
