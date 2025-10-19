const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;

// --- Middlewares ---
app.use(cors()); // Enable CORS for all routes

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

app.use('/uploads', express.static(uploadsDir)); // Serve uploaded files statically

// --- Socket.IO Setup ---
const io = new Server(server, {
    cors: {
        origin: "*", // Allow connections from any origin
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 50 * 1024 * 1024 // 50MB file size limit
});

// --- File Upload Setup (Multer) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Use a unique filename to prevent overwrites
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
}).single('file');

// --- API Endpoint for File Uploads ---
app.post('/upload', (req, res) => {
    upload(req, res, (err) => {
        if (err) {
            console.error("Upload error:", err);
            return res.status(500).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const fileData = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: `/uploads/${req.file.filename}`
        };
        
        // Notify the specific room about the new file via Socket.IO
        const { roomId, senderId } = req.body;
        if (roomId) {
             io.to(roomId).emit('file-shared', { ...fileData, senderId });
        }

        // Schedule file deletion after 5 minutes
        const filePath = path.join(uploadsDir, req.file.filename);
        setTimeout(() => {
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error(`Error deleting file ${filePath}:`, unlinkErr);
                } else {
                    console.log(`Successfully deleted file: ${filePath}`);
                }
            });
        }, 5 * 60 * 1000); // 5 minutes in milliseconds

        res.status(200).json(fileData);
    });
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Room Creation
    socket.on('create-room', () => {
        const roomId = nanoid(8); // Generate a short, unique room ID
        socket.emit('room-created', roomId);
    });

    // Joining a Room
    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        console.log(`User ${socket.id} joined room: ${roomId}`);
        // Notify others in the room
        socket.to(roomId).emit('user-joined', socket.id);
    });

    // Chat Message Handling
    socket.on('chat-message', ({ roomId, message }) => {
        // Broadcast message to everyone in the room including the sender
        io.to(roomId).emit('chat-message', { message, senderId: socket.id });
    });
    
    // Typing indicator
    socket.on('typing', ({ roomId, isTyping }) => {
        socket.to(roomId).emit('typing', { senderId: socket.id, isTyping });
    });

    // Disconnect Handling
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // You could add logic here to notify rooms the user was in
    });
});

// --- Server Listen ---
server.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});