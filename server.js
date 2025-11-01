const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;

// --- In-memory store for room types ---
const activeRooms = {};

// Middlewares
app.use(cors());
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Socket.IO Setup
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 50 * 1024 * 1024
});

// File Upload Setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } }).single('file');

// API Endpoint for File Uploads
app.post('/upload', (req, res) => {
    upload(req, res, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

        const fileData = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            path: `/uploads/${req.file.filename}`
        };

        const { roomId, senderId, tempId } = req.body;
        if (roomId) {
            const senderSocket = io.sockets.sockets.get(senderId);
            const senderName = senderSocket ? senderSocket.data.username : 'A user';
            io.to(roomId).emit('file-shared', { ...fileData, senderId, senderName, tempId });
        }

        const filePath = path.join(uploadsDir, req.file.filename);
        setTimeout(() => {
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr) console.error(`Error deleting file ${filePath}:`, unlinkErr);
                else console.log(`Successfully deleted file: ${filePath}`);
            });
        }, 10 * 60 * 1000);

        res.status(200).json(fileData);
    });
});


// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // --- NEW: Universal Join/Create Logic ---
    socket.on('join-room', ({ roomId, username, roomType }) => {
        const roomData = activeRooms[roomId];
        const room = io.sockets.adapter.rooms.get(roomId);

        // Case 1: Room exists
        if (roomData) {
            // Check if room type matches
            if (roomData.type !== roomType) {
                socket.emit('room-type-mismatch', { existingType: roomData.type, attemptedType: roomType });
                return;
            }
            
            // Check size ONLY if it's a private room
            if (roomData.type === 'private' && room && room.size >= 2) {
                socket.emit('room-full');
                return;
            }
        } 
        // Case 2: Room does NOT exist, so create it
        else {
            activeRooms[roomId] = { type: roomType };
            console.log(`User ${username} creating new ${roomType} room: ${roomId}`);
        }

        // If all checks pass, join the room
        socket.data.username = username;
        socket.join(roomId);
        socket.to(roomId).emit('user-joined', username);
        socket.emit('join-success', roomId);
    });
    // ------------------------------------

    socket.on('chat-message', ({ roomId, message, messageId }) => {
        socket.to(roomId).emit('chat-message', {
            message, messageId,
            senderId: socket.id,
            senderName: socket.data.username
        });
    });

    socket.on('message-seen', ({ roomId, messageId }) => {
        socket.to(roomId).emit('read-receipt', messageId);
    });

    socket.on('typing', ({ roomId, isTyping }) => {
        socket.to(roomId).emit('typing', { senderName: socket.data.username, isTyping });
    });

    socket.on('disconnecting', () => {
        console.log(`User disconnected: ${socket.id}`);
        for (const room of socket.rooms) {
            if (room !== socket.id) {
                socket.to(room).emit('user-left', socket.data.username);
                const roomAdapter = io.sockets.adapter.rooms.get(room);
                if (roomAdapter && roomAdapter.size === 1) {
                    delete activeRooms[room];
                    console.log(`Cleaned up empty room: ${room}`);
                }
            }
        }
    });
});

server.listen(port, () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
});
