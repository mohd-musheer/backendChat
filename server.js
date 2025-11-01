document.addEventListener('DOMContentLoaded', () => {
    // --- IMPORTANT: Replace with your Render backend URL ---
    const BACKEND_URL = 'YOUR_RENDER_BACKEND_URL';
    const socket = io(BACKEND_URL);

    // --- State Variables ---
    let username = null;
    let currentRoomId = null;
    let typingTimeout = null;
    let messageObserver;

    // --- DOM Elements ---
    const screens = {
        name: document.getElementById('name-screen'),
        home: document.getElementById('home-screen'),
        chat: document.getElementById('chat-screen')
    };
    const nameForm = document.getElementById('name-form');
    const nameInput = document.getElementById('name-input');
    const welcomeMessage = document.getElementById('welcome-message');
    // --- UPDATED Button IDs ---
    const createPrivateBtn = document.getElementById('create-private-btn');
    const createGroupBtn = document.getElementById('create-group-btn');
    // -------------------------
    const joinRoomForm = document.getElementById('join-room-form');
    const roomIdInput = document.getElementById('room-id-input');
    const errorMessage = document.getElementById('error-message');
    const roomCodeDisplay = document.getElementById('room-code-display');
    const messagesArea = document.getElementById('messages-area');
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    const fileInput = document.getElementById('file-input');
    const typingIndicator = document.getElementById('typing-indicator');
    const themeToggle = document.getElementById('theme-toggle');

    // --- Force Download Function ---
    const forceDownload = (url, filename) => {
        fetch(url)
            .then(response => response.blob())
            .then(blob => {
                const blobUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(blobUrl);
                a.remove();
            })
            .catch(() => alert('Could not download file.'));
    };

    // --- Intersection Observer for Read Receipts ---
    const setupMessageObserver = () => {
        messageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const messageEl = entry.target;
                    const messageId = messageEl.id;
                    if (messageEl.classList.contains('received') && !messageEl.dataset.seen) {
                        socket.emit('message-seen', { roomId: currentRoomId, messageId });
                        messageEl.dataset.seen = 'true';
                        messageObserver.unobserve(messageEl);
                    }
                }
            });
        }, { threshold: 0.8 });
    };

    // --- Screen Management & Theming ---
    const showScreen = (screenName) => {
        Object.values(screens).forEach(screen => screen.classList.add('hidden'));
        screens[screenName].classList.remove('hidden');
    };
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-theme');
        themeToggle.checked = true;
    }
    themeToggle.addEventListener('change', () => {
        document.body.classList.toggle('dark-theme');
        localStorage.setItem('theme', themeToggle.checked ? 'dark' : 'light');
    });

    // --- Event Listeners ---
    nameForm.addEventListener('submit', (e) => {
        e.preventDefault();
        username = nameInput.value.trim();
        if (username) {
            welcomeMessage.textContent = `Welcome, ${username}!`;
            showScreen('home');
        }
    });

    // --- UPDATED for new buttons ---
    createPrivateBtn.addEventListener('click', () => {
        errorMessage.classList.add('hidden');
        socket.emit('create-private-room', username);
    });

    createGroupBtn.addEventListener('click', () => {
        errorMessage.classList.add('hidden');
        socket.emit('create-group-room', username);
    });

    // --- UPDATED to be universal ---
    joinRoomForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomId = roomIdInput.value.trim();
        if (roomId) {
            errorMessage.classList.add('hidden');
            socket.emit('join-room', { roomId, username });
        }
    });
    // -------------------------------

    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = messageInput.value.trim();
        if (message) {
            const messageId = `msg-${Date.now()}`;
            displayMessage({ message, messageId, senderName: 'You' }, true);
            socket.emit('chat-message', { roomId: currentRoomId, message, messageId });
            messageInput.value = '';
            socket.emit('typing', { roomId: currentRoomId, isTyping: false });
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) uploadFile(file);
        e.target.value = '';
    });

    messageInput.addEventListener('input', () => {
        clearTimeout(typingTimeout);
        socket.emit('typing', { roomId: currentRoomId, isTyping: true });
        typingTimeout = setTimeout(() => socket.emit('typing', { roomId: currentRoomId, isTyping: false }), 2000);
    });
    
    messagesArea.addEventListener('click', (e) => {
        const downloadBtn = e.target.closest('.download-btn');
        if (downloadBtn) {
            e.preventDefault();
            const url = downloadBtn.dataset.url;
            const filename = downloadBtn.dataset.filename;
            forceDownload(url, filename);
        }
    });

    // --- Socket.IO Event Handlers ---
    socket.on('room-created', (roomId) => {
        currentRoomId = roomId;
        roomCodeDisplay.textContent = roomId;
        showScreen('chat');
        setupMessageObserver();
        displayNotification(`Room created. Share this code: ${roomId}`);
    });

    socket.on('join-success', (joinedRoomId) => {
        currentRoomId = joinedRoomId;
        roomCodeDisplay.textContent = joinedRoomId;
        showScreen('chat');
        setupMessageObserver();
    });

    socket.on('room-full', () => {
        errorMessage.textContent = 'This private room is full (2 people max).';
        errorMessage.classList.remove('hidden');
    });

    // --- NEW error message ---
    socket.on('room-not-found', () => {
        errorMessage.textContent = 'Room not found. Check the code and try again.';
        errorMessage.classList.remove('hidden');
    });

    socket.on('user-joined', (joinedUsername) => displayNotification(`${joinedUsername} has joined the chat.`));
    socket.on('user-left', (leftUsername) => displayNotification(`${leftUsername || 'The other user'} has left the chat.`));
    socket.on('chat-message', (data) => displayMessage(data, false));
    socket.on('typing', ({ senderName, isTyping }) => {
        typingIndicator.textContent = isTyping ? `${senderName} is typing...` : '';
    });
    
    socket.on('file-shared', (fileData) => {
        const tempMessage = document.getElementById(fileData.tempId);
        if (tempMessage) tempMessage.remove();
        displayFile(fileData, fileData.senderId === socket.id);
    });

    socket.on('read-receipt', (messageId) => {
        const messageEl = document.getElementById(messageId);
        if (messageEl) {
            const statusIcon = messageEl.querySelector('.message-status i');
            if (statusIcon) {
                statusIcon.classList.remove('fa-check');
                statusIcon.classList.add('fa-check-double', 'read');
            }
        }
    });

    // --- Helper Functions ---
    const scrollToBottom = () => messagesArea.scrollTop = messagesArea.scrollHeight;

    const displayNotification = (text) => {
        const div = document.createElement('div');
        div.classList.add('notification');
        div.textContent = text;
        messagesArea.appendChild(div);
        scrollToBottom();
    };

    const displayMessage = ({ message, messageId, senderName }, isSent) => {
        const div = document.createElement('div');
        div.id = messageId;
        div.classList.add('message', isSent ? 'sent' : 'received');
        const statusIcon = isSent ? `<div class="message-status"><i class="fas fa-check"></i></div>` : '';
        div.innerHTML = `
            <p class="sender-name">${senderName}</p>
            <div class="message-bubble">
                <span>${message}</span>
                ${statusIcon}
            </div>
        `;
        messagesArea.appendChild(div);
        if (!isSent) {
            messageObserver.observe(div);
        }
        scrollToBottom();
    };

    const displayFile = ({ originalname, mimetype, size, path, senderName }, isSent) => {
        const fileLink = `${BACKEND_URL}${path}`;
        const div = document.createElement('div');
        div.classList.add('message', isSent ? 'sent' : 'received');
        div.innerHTML = `
            <p class="sender-name">${senderName}</p>
            <div class="message-bubble">
                <div class="file-message">
                    <i class="file-icon ${getFileIcon(mimetype)}"></i>
                    <div class="file-info">
                        <p>${originalname}</p>
                        <span class="file-size">${formatFileSize(size)}</span>
                    </div>
                    <a href="#" data-url="${fileLink}" data-filename="${originalname}" class="download-btn" title="Download">
                        <img src="download-icon.png" alt="Download">
                    </a>
                </div>
            </div>`;
        messagesArea.appendChild(div);
        scrollToBottom();
    };

    const uploadFile = async (file) => {
        const tempId = `temp-${Date.now()}`;
        const div = document.createElement('div');
        div.id = tempId;
        div.classList.add('message', 'sent');
        div.innerHTML = `
            <p class="sender-name">You</p>
            <div class="message-bubble">
                <div class="file-message">
                    <div class="loader"></div>
                    <div class="file-info">
                        <p>Uploading ${file.name}...</p>
                    </div>
                </div>
            </div>`;
        messagesArea.appendChild(div);
        scrollToBottom();

        const formData = new FormData();
        formData.append('file', file);
        formData.append('roomId', currentRoomId);
        formData.append('senderId', socket.id);
        formData.append('tempId', tempId);

        try {
            await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
        } catch (error) {
            console.error('File upload failed:', error);
            if (document.getElementById(tempId)) document.getElementById(tempId).remove();
            displayMessage({ message: '⚠️ File upload failed.', messageId: `err-${Date.now()}`, senderName: 'Error' }, true);
        }
    };
    
    const getFileIcon = (mimeType) => {
        if (mimeType.startsWith('image/')) return 'fa-solid fa-file-image';
        if (mimeType.startsWith('video/')) return 'fa-solid fa-file-video';
        if (mimeType === 'application/pdf') return 'fa-solid fa-file-pdf';
        if (mimeType.startsWith('audio/')) return 'fa-solid fa-file-audio';
        return 'fa-solid fa-file';
    };
    
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // --- Initial Setup ---
    showScreen('name');
});
