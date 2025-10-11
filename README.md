# ruy-wiki-app

A Node.js API application for uploading multiple files to AWS S3.

## Features

- Upload multiple files simultaneously (up to 10 files)
- Direct upload to AWS S3
- File size limit: 10MB per file
- RESTful API with JSON responses
- Health check endpoint
- Error handling for various upload scenarios

## Prerequisites

- Node.js (v14 or higher)
- AWS Account with S3 bucket
- AWS credentials (Access Key ID and Secret Access Key)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/tranduy216/ruy-wiki-app.git
cd ruy-wiki-app
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` file with your AWS credentials:
```
PORT=3000
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_BUCKET_NAME=your_bucket_name
```

## Usage

### Start the server

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in your .env file).

### Test the API

#### Option 1: Use the Web Interface
Open your browser and navigate to `http://localhost:3000/` to access the test page with a user-friendly interface for uploading multiple files.

![Upload Test Page](https://github.com/user-attachments/assets/e396f57b-06ed-4a3f-a8ef-b8a05dc6c5b9)

#### Option 2: Use Command Line or API Clients

### API Endpoints

#### Health Check
```
GET /health
```

Response:
```json
{
  "status": "ok",
  "message": "File upload API is running"
}
```

#### Upload Multiple Files
```
POST /upload
Content-Type: multipart/form-data
```

**Parameters:**
- `files`: Array of files (field name must be "files", max 10 files, max 10MB per file)

**Example using curl:**
```bash
curl -X POST http://localhost:3000/upload \
  -F "files=@/path/to/file1.jpg" \
  -F "files=@/path/to/file2.pdf" \
  -F "files=@/path/to/file3.txt"
```

**Example using JavaScript fetch:**
```javascript
const formData = new FormData();
formData.append('files', file1);
formData.append('files', file2);
formData.append('files', file3);

fetch('http://localhost:3000/upload', {
  method: 'POST',
  body: formData
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

**Success Response:**
```json
{
  "success": true,
  "message": "Successfully uploaded 3 file(s)",
  "files": [
    {
      "originalName": "file1.jpg",
      "key": "uploads/1234567890-file1.jpg",
      "size": 102400,
      "mimetype": "image/jpeg"
    },
    {
      "originalName": "file2.pdf",
      "key": "uploads/1234567891-file2.pdf",
      "size": 204800,
      "mimetype": "application/pdf"
    },
    {
      "originalName": "file3.txt",
      "key": "uploads/1234567892-file3.txt",
      "size": 1024,
      "mimetype": "text/plain"
    }
  ]
}
```

**Error Response (No files):**
```json
{
  "error": "No files provided"
}
```

**Error Response (File too large):**
```json
{
  "error": "File size exceeds the 10MB limit"
}
```

**Error Response (Too many files):**
```json
{
  "error": "Too many files. Maximum 10 files allowed"
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `AWS_REGION` | AWS region for S3 | us-east-1 |
| `AWS_ACCESS_KEY_ID` | AWS access key ID | (required) |
| `AWS_SECRET_ACCESS_KEY` | AWS secret access key | (required) |
| `AWS_BUCKET_NAME` | S3 bucket name | (required) |

### File Upload Limits

- Maximum files per request: 10
- Maximum file size: 10MB per file

These limits can be adjusted in `index.js`:
```javascript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // Adjust file size limit here
  },
});

app.post('/upload', upload.array('files', 10), ...); // Adjust max file count here
```

## AWS S3 Permissions

Your AWS IAM user should have the following permissions for the S3 bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

## Error Handling

The API includes comprehensive error handling for:
- Missing files
- File size limit exceeded
- Too many files
- S3 upload failures
- Invalid AWS credentials
- Missing bucket configuration

## Security Considerations

- Never commit your `.env` file to version control
- Use IAM roles with minimal required permissions
- Consider implementing authentication/authorization for production use
- Validate file types if needed for your use case
- Consider implementing rate limiting for production deployments

## License

ISC