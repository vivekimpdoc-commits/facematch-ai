import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Data file path
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}
// Ensure data.json exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]');
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Helper to read data
const readData = () => {
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
};

// Helper to write data
const writeData = (data) => {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// API Routes

// Get all gallery items
app.get('/api/gallery', (req, res) => {
  try {
    const data = readData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read data' });
  }
});

// Upload new files
app.post('/api/gallery', upload.array('files'), (req, res) => {
  try {
    const data = readData();
    const newItems = [];
    
    // descriptors are passed as JSON string in body
    const descriptorsMap = JSON.parse(req.body.descriptors || '{}');
    const locationsMap = JSON.parse(req.body.locations || '{}');

    if (req.files) {
      for (const file of req.files) {
        // Find matching original file name
        const descriptors = descriptorsMap[file.originalname] || [];
        const location = locationsMap[file.originalname] || file.originalname;

        const id = Math.random().toString(36).substr(2, 9);
        const newItem = {
          id,
          name: file.originalname,
          location,
          fileUrl: `/uploads/${file.filename}`, // Instead of 'file' object
          descriptors,
          size: file.size,
        };
        newItems.push(newItem);
        data.push(newItem);
      }
    }
    
    writeData(data);
    res.json({ success: true, items: newItems });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// Delete specific item
app.delete('/api/gallery/:id', (req, res) => {
  try {
    let data = readData();
    const id = req.params.id;
    const itemIndex = data.findIndex(i => i.id === id);
    
    if (itemIndex > -1) {
      const item = data[itemIndex];
      // Try to remove file
      const filePath = path.join(__dirname, item.fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      data.splice(itemIndex, 1);
      writeData(data);
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Clear all items
app.delete('/api/gallery', (req, res) => {
  try {
    let data = readData();
    // Delete all files
    for (const item of data) {
      const filePath = path.join(__dirname, item.fileUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    writeData([]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear database' });
  }
});

// Serve static files from the frontend build directory if it exists
const DIST_DIR = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  
  // Handle React routing, return all requests to React app
  app.get('*', (req, res) => {
    // Only intercept if it's not an API route
    if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    } else {
      res.status(404).json({ error: 'Not Found' });
    }
  });
}

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
