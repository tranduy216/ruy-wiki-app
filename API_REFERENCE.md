# API Quick Reference

## Base URL
```
http://localhost:3000
```

## Endpoints

### 1. Health Check
Check if the API is running.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "message": "File upload API is running"
}
```

---

### 2. Upload Multiple Files
Upload one or more files to AWS S3.

**Endpoint:** `POST /upload`

**Content-Type:** `multipart/form-data`

**Parameters:**
- `files` (required): Array of files to upload
  - Maximum: 10 files
  - Max file size: 10MB per file

**cURL Example:**
```bash
curl -X POST http://localhost:3000/upload \
  -F "files=@document.pdf" \
  -F "files=@image.jpg" \
  -F "files=@data.csv"
```

**JavaScript Example:**
```javascript
const formData = new FormData();
formData.append('files', file1);
formData.append('files', file2);

const response = await fetch('http://localhost:3000/upload', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log(result);
```

**Python Example:**
```python
import requests

files = [
    ('files', open('file1.jpg', 'rb')),
    ('files', open('file2.pdf', 'rb'))
]

response = requests.post('http://localhost:3000/upload', files=files)
print(response.json())
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Successfully uploaded 2 file(s)",
  "files": [
    {
      "originalName": "document.pdf",
      "key": "uploads/1234567890-document.pdf",
      "size": 204800,
      "mimetype": "application/pdf"
    },
    {
      "originalName": "image.jpg",
      "key": "uploads/1234567891-image.jpg",
      "size": 102400,
      "mimetype": "image/jpeg"
    }
  ]
}
```

**Error Responses:**

No files provided (400):
```json
{
  "error": "No files provided"
}
```

File too large (400):
```json
{
  "error": "File size exceeds the 10MB limit"
}
```

Too many files (400):
```json
{
  "error": "Too many files. Maximum 10 files allowed"
}
```

S3 upload failed (500):
```json
{
  "error": "Failed to upload files",
  "message": "Specific error message"
}
```

---

### 3. Test Web Interface
Access the interactive file upload test page.

**Endpoint:** `GET /`

**Usage:** Open in web browser to use the UI for testing file uploads.

---

## Configuration

Required environment variables in `.env`:

```bash
# Server Configuration
PORT=3000

# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_BUCKET_NAME=your_bucket_name
```

## Limits

| Limit | Value |
|-------|-------|
| Maximum files per request | 10 |
| Maximum file size | 10MB |
| Supported file types | All types |

## Testing

### Using the Web UI
1. Start the server: `npm start`
2. Open browser: `http://localhost:3000/`
3. Select files and click "Upload Files"

### Using cURL
```bash
# Single file
curl -X POST http://localhost:3000/upload -F "files=@myfile.txt"

# Multiple files
curl -X POST http://localhost:3000/upload \
  -F "files=@file1.txt" \
  -F "files=@file2.jpg" \
  -F "files=@file3.pdf"
```

### Using Postman
1. Create new POST request to `http://localhost:3000/upload`
2. Select Body → form-data
3. Add key "files" with type "File"
4. Select multiple files
5. Click Send
