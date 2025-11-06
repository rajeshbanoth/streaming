const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Store streams (in production, use a database like Redis or MongoDB)
let streams = new Map();
let adminSocket = null;
let viewerSockets = new Map(); // customViewerId -> socket.id for signaling

// Fixed stream ID for constant view link
const FIXED_STREAM_ID = 'devika-lokesh-wedding';

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Routes
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Devika & Lokesh Wedding Live Stream</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lora:wght@400;500&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">
        <style>
            body { font-family: 'Lora', serif; background: linear-gradient(135deg, #ffeef8 0%, #f8e8ff 100%); min-height: 100vh; }
            .hero { background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><pattern id="grain" width="100" height="100" patternUnits="userSpaceOnUse"><circle cx="25" cy="25" r="1" fill="white" opacity="0.1"/><circle cx="75" cy="75" r="1" fill="white" opacity="0.1"/></pattern></defs><rect width="100" height="100" fill="url(%23grain)"/></svg>') no-repeat center/cover; padding: 100px 0; }
            .hero h1 { font-family: 'Playfair Display', serif; color: #8b4513; font-size: 3.5rem; text-shadow: 2px 2px 4px rgba(0,0,0,0.1); }
            .hero p { font-size: 1.2rem; color: #666; }
            .btn-custom { background: linear-gradient(45deg, #ff6b9d, #c44569); border: none; padding: 15px 40px; font-size: 1.1rem; border-radius: 50px; transition: transform 0.3s; box-shadow: 0 4px 15px rgba(255,107,157,0.2); }
            .btn-custom:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(255,107,157,0.3); }
            footer { background: #8b4513; color: white; padding: 20px; text-align: center; margin-top: 50px; }
            .fade-in { animation: fadeIn 1s ease-in; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    </head>
    <body>
        <div class="hero text-center text-white fade-in">
            <div class="container">
                <h1 class="mb-4">Banoth Devika & Guguloth Lokesh</h1>
                <p class="lead mb-5">Join us in celebrating their beautiful journey into forever</p>
                <div class="d-grid gap-3 col-6 mx-auto">
                    <a href="/admin" class="btn btn-custom btn-lg">Admin: Start Live Stream</a>
                    <a href="/viewer" class="btn btn-outline-light btn-lg">Watch Live Ceremony</a>
                </div>
            </div>
        </div>
        <footer>
            <p>&copy; 2025 Devika & Lokesh Wedding. All rights reserved.</p>
        </footer>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    </body>
    </html>
  `);
});

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Admin Panel - Devika & Lokesh Wedding</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lora:wght@400;500&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Lora', serif; background: #f8f9fa; }
            .header { background: linear-gradient(45deg, #ff6b9d, #c44569); color: white; padding: 20px; text-align: center; box-shadow: 0 4px 15px rgba(255,107,157,0.2); }
            .header h1 { font-family: 'Playfair Display', serif; margin: 0; }
            #videoPreview { width: 100%; max-width: 800px; height: 450px; background: #000; border-radius: 15px; margin: 20px auto; display: block; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            .controls { background: white; padding: 25px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin: 20px 0; }
            .btn-custom { background: linear-gradient(45deg, #ff6b9d, #c44569); border: none; padding: 12px 24px; border-radius: 25px; color: white; transition: all 0.3s; box-shadow: 0 2px 10px rgba(255,107,157,0.2); }
            .btn-custom:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(255,107,157,0.3); color: white; }
            .btn-secondary-custom { background: #6c757d; box-shadow: 0 2px 10px rgba(108,117,125,0.2); }
            .btn-secondary-custom:hover { box-shadow: 0 4px 15px rgba(108,117,125,0.3); }
            .status { padding: 15px; border-radius: 10px; font-weight: 500; text-align: center; margin: 15px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
            .online { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
            .offline { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            #linkSection { background: #e9ecef; padding: 25px; border-radius: 15px; margin: 20px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
            #viewerLink { font-size: 1rem; font-family: monospace; }
            .camera-switch { margin: 15px 0; }
            .stats { display: flex; justify-content: space-around; margin: 20px 0; gap: 10px; }
            .stat-card { background: white; padding: 20px; border-radius: 15px; text-align: center; box-shadow: 0 4px 15px rgba(0,0,0,0.1); flex: 1; transition: transform 0.3s; }
            .stat-card:hover { transform: translateY(-5px); }
            .stat-value { font-size: 1.5rem; font-weight: bold; color: #c44569; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Admin Panel: Live Streaming Control</h1>
            <p>Devika & Lokesh Wedding Ceremony</p>
        </div>
        <div class="container">
            <div class="controls">
                <div class="d-flex justify-content-center gap-3 mb-3">
                    <button class="btn btn-custom start-stream" onclick="startStream()">Start Live Stream</button>
                    <button class="btn btn-secondary-custom stop-stream" onclick="stopStream()" disabled>Stop Stream</button>
                </div>
                <div class="camera-switch d-flex justify-content-center gap-2">
                    <button class="btn btn-outline-primary" onclick="switchCamera('user')">Front Camera</button>
                    <button class="btn btn-outline-primary" onclick="switchCamera('environment')">Back Camera</button>
                </div>
            </div>
            <div id="status" class="status offline">Stream Status: Offline</div>
            <video id="videoPreview" autoplay muted playsinline></video>
            
            <div id="linkSection" style="display: none;">
                <h5 class="text-center mb-3">Share the Live Stream Link</h5>
                <div class="input-group">
                    <input type="text" id="viewerLink" class="form-control" value="${req.protocol}://${req.get('host')}/viewer?stream=${FIXED_STREAM_ID}" readonly>
                    <button class="btn btn-custom" type="button" onclick="copyLink()">Copy Link</button>
                </div>
                <small class="text-muted d-block text-center mt-2">This link remains the same for all sessions.</small>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <h6>Live Viewers</h6>
                    <div class="stat-value" id="viewerCount">0</div>
                </div>
                <div class="stat-card">
                    <h6>Stream Duration</h6>
                    <div id="streamDuration">00:00:00</div>
                </div>
                <div class="stat-card">
                    <h6>Status</h6>
                    <div id="quickStatus">Offline</div>
                </div>
            </div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script>
            const socket = io();
            let localStream = null;
            let peerConnections = {};
            let streamId = '${FIXED_STREAM_ID}';
            let currentFacingMode = 'user'; // Default to front
            let startTime = null;
            let durationInterval = null;

            // Socket events
            socket.on('connect', () => {
                console.log('Admin connected');
                showLink(); // Always show fixed link
            });

            socket.on('viewer-count', (count) => {
                document.getElementById('viewerCount').textContent = count;
            });

            socket.on('offer', async (data) => {
                try {
                    await handleOffer(data);
                } catch (error) {
                    console.error('Error handling offer:', error);
                    alert('Connection error: ' + error.message);
                }
            });

            socket.on('ice-candidate', (data) => {
                handleIceCandidate(data);
            });

            // Always show the fixed link
            function showLink() {
                document.getElementById('linkSection').style.display = 'block';
                document.getElementById('viewerLink').value = '${req.protocol}://${req.get('host')}/viewer?stream=${FIXED_STREAM_ID}';
            }

            // Stream functions
            async function startStream() {
                try {
                    if (localStream) {
                        await switchCamera(currentFacingMode); // Ensure stream is active
                        return;
                    }

                    localStream = await navigator.mediaDevices.getUserMedia({
                        video: { 
                            width: { ideal: 1280 }, 
                            height: { ideal: 720 },
                            facingMode: { exact: currentFacingMode }
                        },
                        audio: { echoCancellation: true, noiseSuppression: true }
                    });

                    document.getElementById('videoPreview').srcObject = localStream;
                    document.querySelector('.start-stream').disabled = true;
                    document.querySelector('.stop-stream').disabled = false;
                    document.getElementById('status').className = 'status online';
                    document.getElementById('status').textContent = 'Stream Status: Live';
                    document.getElementById('quickStatus').textContent = 'Live';
                    showLink();

                    startTime = Date.now();
                    durationInterval = setInterval(updateDuration, 1000);

                    socket.emit('start-stream', { streamId: streamId });
                    console.log('Stream started with ID:', streamId);
                } catch (error) {
                    console.error('Error starting stream:', error);
                    alert('Error accessing camera/microphone: ' + (error.name === 'NotAllowedError' ? 'Permission denied. Please allow camera and microphone access.' : error.message));
                }
            }

            async function switchCamera(facingMode) {
                if (!localStream) {
                    alert('Please start the stream first.');
                    return;
                }

                try {
                    // Stop current tracks
                    localStream.getTracks().forEach(track => track.stop());

                    // Get new stream with switched camera
                    localStream = await navigator.mediaDevices.getUserMedia({
                        video: { 
                            width: { ideal: 1280 }, 
                            height: { ideal: 720 },
                            facingMode: { exact: facingMode }
                        },
                        audio: true
                    });

                    document.getElementById('videoPreview').srcObject = localStream;
                    currentFacingMode = facingMode;

                    // Re-add tracks to all peer connections
                    Object.values(peerConnections).forEach(pc => {
                        pc.getSenders().forEach(sender => {
                            if (sender.track && sender.track.kind === 'video') {
                                sender.replaceTrack(localStream.getVideoTracks()[0]);
                            } else if (sender.track && sender.track.kind === 'audio') {
                                sender.replaceTrack(localStream.getAudioTracks()[0]);
                            }
                        });
                    });

                  
                } catch (error) {
                    console.error('Error switching camera:', error);
                    // Fallback to default
                    startStream();
                    alert('Error switching camera: ' + error.message + '. Reverting to default.');
                }
            }

            function stopStream() {
                if (localStream) {
                    localStream.getTracks().forEach(track => track.stop());
                    localStream = null;
                }

                document.getElementById('videoPreview').srcObject = null;
                document.querySelector('.start-stream').disabled = false;
                document.querySelector('.stop-stream').disabled = true;
                document.getElementById('status').className = 'status offline';
                document.getElementById('status').textContent = 'Stream Status: Offline';
                document.getElementById('quickStatus').textContent = 'Offline';
                document.getElementById('viewerCount').textContent = '0';
                document.getElementById('streamDuration').textContent = '00:00:00';

                if (durationInterval) {
                    clearInterval(durationInterval);
                    durationInterval = null;
                }
                startTime = null;

                socket.emit('stop-stream', { streamId: streamId });

                // Close all peer connections
                Object.values(peerConnections).forEach(pc => pc.close());
                peerConnections = {};

                console.log('Stream stopped');
            }

            function copyLink() {
                const linkInput = document.getElementById('viewerLink');
                navigator.clipboard.writeText(linkInput.value).then(() => {
                    alert('Link copied to clipboard! Share with guests.');
                }).catch(() => {
                    // Fallback
                    linkInput.select();
                    document.execCommand('copy');
                    alert('Link copied to clipboard!');
                });
            }

            function updateDuration() {
                if (!startTime) return;
                const now = Date.now();
                const elapsed = Math.floor((now - startTime) / 1000);
                const hours = Math.floor(elapsed / 3600).toString().padStart(2, '0');
                const minutes = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                document.getElementById('streamDuration').textContent = \`\${hours}:\${minutes}:\${seconds}\`;
            }

            // WebRTC functions
            async function handleOffer(data) {
                let peerConnection = peerConnections[data.viewerId];
                if (!peerConnection) {
                    peerConnection = new RTCPeerConnection({
                        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                    });
                    peerConnections[data.viewerId] = peerConnection;

                    // Handle ICE candidates
                    peerConnection.onicecandidate = (event) => {
                        if (event.candidate) {
                            socket.emit('ice-candidate', {
                                viewerId: data.viewerId,
                                candidate: event.candidate
                            });
                        }
                    };

                    // Handle connection state
                    peerConnection.onconnectionstatechange = () => {
                        console.log('PC state:', peerConnection.connectionState);
                        if (peerConnection.connectionState === 'disconnected') {
                            delete peerConnections[data.viewerId];
                        }
                    };
                }

                // Add or replace tracks
                if (localStream) {
                    localStream.getTracks().forEach(track => {
                        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === track.kind);
                        if (sender) {
                            sender.replaceTrack(track);
                        } else {
                            peerConnection.addTrack(track, localStream);
                        }
                    });
                }

                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('answer', {
                    viewerId: data.viewerId,
                    answer: answer
                });
            }

            function handleIceCandidate(data) {
                const peerConnection = peerConnections[data.viewerId];
                if (peerConnection) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(error => {
                        console.error('Error adding ICE candidate:', error);
                    });
                }
            }

            // Handle page unload
            window.addEventListener('beforeunload', () => {
                if (localStream) {
                    stopStream();
                }
            });

            // Permission check on load
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
                    stream.getTracks().forEach(track => track.stop());
                }).catch(error => {
                    if (error.name === 'NotAllowedError') {
                        alert('Camera and microphone permissions are required. Please enable them in your browser settings.');
                    }
                });
            }
        </script>
    </body>
    </html>
  `);
});

app.get('/viewer', (req, res) => {
  const streamId = req.query.stream || FIXED_STREAM_ID;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Live Stream - Devika & Lokesh Wedding</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Lora:wght@400;500&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css">
        <style>
            body { font-family: 'Lora', serif; background: linear-gradient(135deg, #ffeef8 0%, #f8e8ff 100%); min-height: 100vh; }
            .header { background: linear-gradient(45deg, #ff6b9d, #c44569); color: white; padding: 15px; text-align: center; box-shadow: 0 4px 15px rgba(255,107,157,0.2); }
            .header h1 { font-family: 'Playfair Display', serif; margin: 0; font-size: 2rem; }
            #videoPlayer { width: 100%; max-width: 900px; height: 506px; background: #000; border-radius: 15px; margin: 20px auto; display: block; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            .status { padding: 15px; border-radius: 10px; font-weight: 500; text-align: center; margin: 15px 0; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
            .waiting { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
            .live { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; animation: pulse 2s infinite; }
            .offline { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
            @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(40,167,69,0.7); } 70% { box-shadow: 0 0 0 10px rgba(40,167,69,0); } 100% { box-shadow: 0 0 0 0 rgba(40,167,69,0); } }
            .chat { background: white; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin: 20px 0; height: 400px; overflow: hidden; }
            .messages { height: 300px; overflow-y: auto; padding: 15px; background: #f8f9fa; }
            .message { margin: 8px 0; padding: 12px; background: white; border-radius: 18px; border-bottom-right-radius: 5px; max-width: 80%; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
            .message.sent { margin-left: auto; background: linear-gradient(45deg, #ff6b9d, #c44569); color: white; border-bottom-left-radius: 5px; border-bottom-right-radius: 18px; }
            .chat-input { padding: 15px; border-top: 1px solid #dee2e6; }
            .btn-custom { background: linear-gradient(45deg, #ff6b9d, #c44569); border: none; border-radius: 25px; color: white; box-shadow: 0 2px 10px rgba(255,107,157,0.2); transition: all 0.3s; }
            .btn-custom:hover { color: white; box-shadow: 0 4px 15px rgba(255,107,157,0.3); transform: translateY(-1px); }
            .schedule { background: white; border-radius: 15px; padding: 25px; margin: 20px 0; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
            .schedule h5 { color: #8b4513; font-family: 'Playfair Display', serif; }
            .viewer-count { position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.95); padding: 8px 12px; border-radius: 20px; font-weight: bold; color: #c44569; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .welcome-msg { background: #e9ecef; padding: 10px; border-radius: 10px; margin: 10px 0; font-style: italic; color: #6c757d; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Devika & Lokesh Wedding Live</h1>
            <p class="mb-0">Celebrating love and new beginnings</p>
        </div>
        <div class="container">
            <div id="status" class="status waiting">
                ${streamId === FIXED_STREAM_ID ? 'Connecting to live ceremony...' : 'Invalid stream. Using default wedding stream.'}
            </div>
            <div style="position: relative;">
                <video id="videoPlayer" autoplay controls playsinline class="img-fluid mx-auto d-block"></video>
                <div id="viewerBadge" class="viewer-count" style="display: none;">0 Viewers</div>
            </div>
            
            <div class="row">
                <div class="col-md-8">
                    <div class="chat">
                        <div class="d-flex justify-content-between align-items-center p-3 border-bottom" style="background: linear-gradient(45deg, #ff6b9d, #c44569); color: white;">
                            <h6 class="mb-0">Live Chat</h6>
                            <span class="badge bg-light text-dark" id="chatViewerCount">0 online</span>
                        </div>
                        <div id="messages" class="messages">
                            <div class="welcome-msg">Welcome to Devika & Lokesh's wedding! Share your love and congratulations below. 💕</div>
                        </div>
                        <div class="chat-input">
                            <div class="input-group">
                                <input type="text" id="messageInput" class="form-control" placeholder="Send a congratulatory message..." onkeypress="if(event.key==='Enter') sendMessage()">
                                <button class="btn btn-custom px-4" onclick="sendMessage()">Send</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-md-4">
                    <div class="schedule">
                        <h5>Event Schedule</h5>
                        <ul class="list-unstyled">
                            <li class="mb-2"><strong>10:00 AM:</strong> Baraat Arrival</li>
                            <li class="mb-2"><strong>11:00 AM:</strong> Welcome & Rituals</li>
                            <li class="mb-2"><strong>12:00 PM:</strong> Vivaah (Main Ceremony)</li>
                            <li class="mb-2"><strong>2:00 PM:</strong> Reception Begins</li>
                        </ul>
                        <button class="btn btn-custom w-100 mt-3" onclick="shareStream()">Share Stream</button>
                    </div>
                </div>
            </div>
        </div>
        <script src="/socket.io/socket.io.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script>
            const socket = io();
            const streamId = '${streamId}';
            let peerConnection = null;
            let currentUserId = 'viewer_' + Math.random().toString(36).substr(2, 9);
            let streamReady = false;

            // Socket events
            socket.on('connect', () => {
                console.log('Viewer connected');
                if (streamId) {
                    joinStream();
                } else {
                    document.getElementById('status').textContent = 'No stream available. Please check back later.';
                }
            });

            socket.on('stream-started', () => {
                console.log('Stream started received');
                document.getElementById('status').className = 'status live';
                document.getElementById('status').textContent = 'Live Now - Ceremony in Progress';
                if (!peerConnection && streamId) {
                    setupWebRTC();
                }
            });

            socket.on('stream-ready', () => {
                console.log('Stream ready received');
                streamReady = true;
                document.getElementById('status').className = 'status live';
                document.getElementById('status').textContent = 'Live Now - Ceremony in Progress';
                if (!peerConnection) {
                    setupWebRTC();
                }
            });

            socket.on('stream-stopped', () => {
                document.getElementById('status').className = 'status offline';
                document.getElementById('status').textContent = 'Stream Ended. Thank you for joining!';
                if (peerConnection) {
                    peerConnection.close();
                    peerConnection = null;
                    document.getElementById('videoPlayer').srcObject = null;
                }
                streamReady = false;
            });

            socket.on('answer', async (data) => {
                console.log('Answer received');
                try {
                    await handleAnswer(data);
                } catch (error) {
                    console.error('Error handling answer:', error);
                    document.getElementById('status').textContent = 'Connection failed. Refresh to retry.';
                }
            });

            socket.on('ice-candidate', (data) => {
                console.log('ICE candidate received');
                handleIceCandidate(data);
            });

            socket.on('chat-message', (data) => {
                console.log('Chat message received:', data);
                addMessage(data.user, data.message, data.userId === currentUserId);
            });

            socket.on('viewer-count', (count) => {
                document.getElementById('viewerBadge').style.display = 'block';
                document.getElementById('viewerBadge').textContent = count + ' Viewers';
                if (streamReady) {
                    document.getElementById('status').textContent = 'Live Now - ' + count + ' viewers';
                }
                document.getElementById('chatViewerCount').textContent = count + ' online';
            });

            socket.on('error', (data) => {
                console.error('Server error:', data.message);
                document.getElementById('status').textContent = data.message;
            });

            // Stream functions
            function joinStream() {
                if (!streamId) {
                    alert('No stream ID. Using default wedding stream.');
                    return;
                }
                socket.emit('join-stream', { streamId: streamId, viewerId: currentUserId });
                console.log('Joined stream:', streamId);
            }

            function setupWebRTC() {
                if (peerConnection) {
                    console.log('WebRTC already set up');
                    return;
                }
                console.log('Setting up WebRTC');
                peerConnection = new RTCPeerConnection({
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                });

                // Handle incoming stream
                peerConnection.ontrack = (event) => {
                    console.log('Received remote stream');
                    document.getElementById('videoPlayer').srcObject = event.streams[0];
                };

                // Handle ICE candidates
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        console.log('Sending ICE candidate');
                        socket.emit('ice-candidate', {
                            streamId: streamId,
                            viewerId: currentUserId,
                            candidate: event.candidate
                        });
                    }
                };

                // Handle connection state
                peerConnection.onconnectionstatechange = () => {
                    console.log('PC state:', peerConnection.connectionState);
                    if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
                        document.getElementById('status').textContent = 'Connection lost. Refresh to reconnect.';
                        peerConnection = null;
                    } else if (peerConnection.connectionState === 'connected') {
                        document.getElementById('status').textContent = 'Connected - Enjoy the live stream!';
                    }
                };

                createOffer();
            }

            async function createOffer() {
                try {
                    const offer = await peerConnection.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
                    await peerConnection.setLocalDescription(offer);
                    console.log('Offer created and sent');
                    socket.emit('offer', {
                        streamId: streamId,
                        viewerId: currentUserId,
                        offer: offer
                    });
                } catch (error) {
                    console.error('Error creating offer:', error);
                    alert('Failed to connect to stream: ' + error.message);
                    peerConnection = null;
                }
            }

            async function handleAnswer(data) {
                console.log('Setting remote description from answer');
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            }

            function handleIceCandidate(data) {
                if (peerConnection && data.candidate) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(error => {
                        console.error('Error adding ICE candidate:', error);
                    });
                }
            }

            // Chat functions
            function sendMessage() {
                const input = document.getElementById('messageInput');
                const message = input.value.trim();
                if (message && streamId) {
                    const user = 'Guest ' + currentUserId.substring(7).toUpperCase();
                    socket.emit('chat-message', {
                        streamId: streamId,
                        userId: currentUserId,
                        user: user,
                        message: message
                    });
                    addMessage(user, message, true); // Add locally for instant feedback
                    input.value = '';
                }
            }

            function addMessage(user, message, isOwn) {
                const messagesDiv = document.getElementById('messages');
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message' + (isOwn ? ' sent' : '');
                messageDiv.innerHTML = \`<strong>\${user}:</strong> \${message}\`;
                messagesDiv.appendChild(messageDiv);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            function shareStream() {
                const streamUrl = window.location.href;
                navigator.clipboard.writeText(streamUrl).then(() => {
                    alert('Stream link copied! Invite friends to join the celebration.');
                }).catch(() => {
                    alert('Unable to copy. Please copy the URL manually.');
                });
            }

            // Auto-join
            if (streamId) {
                document.getElementById('status').textContent = 'Connecting to ceremony...';
            } else {
                document.getElementById('status').className = 'status offline';
                document.getElementById('status').textContent = 'Stream not available.';
            }
        </script>
    </body>
    </html>
  `);
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Admin starts streaming
  socket.on('start-stream', (data) => {
    try {
      let stream = streams.get(data.streamId);
      if (!stream) {
        stream = {
          adminId: socket.id,
          viewers: new Set(),
          started: true,
          startTime: Date.now()
        };
        streams.set(data.streamId, stream);
      } else {
        stream.adminId = socket.id;
        stream.started = true;
        stream.startTime = Date.now();
      }
      adminSocket = socket;
      socket.join(data.streamId);
      io.to(data.streamId).emit('stream-started');
      console.log('Stream started:', data.streamId);
    } catch (error) {
      console.error('Error starting stream:', error);
      socket.emit('error', { message: 'Failed to start stream' });
    }
  });

  // Viewer joins stream
  socket.on('join-stream', (data) => {
    try {
      let stream = streams.get(data.streamId);
      if (!stream) {
        stream = {
          adminId: null,
          viewers: new Set(),
          started: false
        };
        streams.set(data.streamId, stream);
      }
      stream.viewers.add({ id: socket.id, viewerId: data.viewerId });
      viewerSockets.set(data.viewerId, socket.id);
      socket.join(data.streamId);

      if (stream.started && stream.adminId) {
        socket.emit('stream-ready');
      }

      updateViewerCount(data.streamId);
      console.log(`Viewer ${data.viewerId} (${socket.id}) joined stream ${data.streamId}`);
    } catch (error) {
      console.error('Error joining stream:', error);
      socket.emit('error', { message: 'Stream not found or unavailable' });
    }
  });

  // WebRTC signaling - Offer from viewer
  socket.on('offer', (data) => {
    try {
      const stream = streams.get(data.streamId);
      if (stream && adminSocket && stream.adminId === adminSocket.id) {
        console.log(`Forwarding offer from ${data.viewerId}`);
        adminSocket.emit('offer', {
          viewerId: data.viewerId,
          offer: data.offer
        });
      } else {
        console.log('Offer ignored: no admin or stream not active');
      }
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  });

  // WebRTC signaling - Answer from admin
  socket.on('answer', (data) => {
    try {
      console.log(`Forwarding answer to ${data.viewerId}`);
      const targetSocketId = viewerSockets.get(data.viewerId);
      if (targetSocketId) {
        io.to(targetSocketId).emit('answer', { answer: data.answer });
      } else {
        console.log('Target socket not found for viewerId:', data.viewerId);
      }
    } catch (error) {
      console.error('Error sending answer:', error);
    }
  });

  // ICE candidates
  socket.on('ice-candidate', (data) => {
    try {
      if (data.viewerId && !data.streamId) {
        // From admin to specific viewer
        console.log(`Forwarding ICE from admin to ${data.viewerId}`);
        const targetSocketId = viewerSockets.get(data.viewerId);
        if (targetSocketId) {
          io.to(targetSocketId).emit('ice-candidate', {
            candidate: data.candidate
          });
        }
      } else if (data.streamId && data.viewerId) {
        // From viewer to admin
        console.log(`Forwarding ICE from ${data.viewerId} to admin`);
        if (adminSocket) {
          adminSocket.emit('ice-candidate', {
            viewerId: data.viewerId,
            candidate: data.candidate
          });
        }
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  });

  // Chat messages
  socket.on('chat-message', (data) => {
    try {
      const stream = streams.get(data.streamId);
      if (stream) {
        console.log('Broadcasting chat:', data.message);
        socket.to(data.streamId).emit('chat-message', {
          userId: data.userId,
          user: data.user,
          message: data.message
        });
      }
    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  });

  // Admin stops streaming
  socket.on('stop-stream', (data) => {
    try {
      const stream = streams.get(data.streamId);
      if (stream && stream.adminId === socket.id) {
        io.to(data.streamId).emit('stream-stopped');
        // Clean up viewers for this stream
        stream.viewers.forEach(viewer => {
          viewerSockets.delete(viewer.viewerId);
        });
        streams.delete(data.streamId);
        console.log('Stream stopped:', data.streamId);
      }
    } catch (error) {
      console.error('Error stopping stream:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);

    try {
      for (let [streamId, stream] of streams.entries()) {
        if (stream.adminId === socket.id) {
          // Admin disconnected - stop the stream
          io.to(streamId).emit('stream-stopped');
          // Clean up
          stream.viewers.forEach(viewer => {
            viewerSockets.delete(viewer.viewerId);
          });
          streams.delete(streamId);
          adminSocket = null;
          console.log('Stream stopped due to admin disconnect:', streamId);
          break;
        } else {
          // Viewer disconnected
          const viewerObj = Array.from(stream.viewers).find(v => v.id === socket.id);
          if (viewerObj) {
            stream.viewers.delete(viewerObj);
            viewerSockets.delete(viewerObj.viewerId);
            updateViewerCount(streamId);
            console.log(`Viewer ${viewerObj.viewerId} disconnected from ${streamId}`);
          }
        }
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });

  function updateViewerCount(streamId) {
    try {
      const stream = streams.get(streamId);
      if (stream) {
        const count = stream.viewers.size;
        io.to(streamId).emit('viewer-count', count);
        if (stream.adminId) {
          io.to(stream.adminId).emit('viewer-count', count);
        }
      }
    } catch (error) {
      console.error('Error updating viewer count:', error);
    }
  }
});

const PORT = 7050;
server.listen(PORT, () => {
  console.log(`Devika & Lokesh Wedding Streaming Server running on port ${PORT}`);
  console.log(`Access at: http://localhost:${PORT}`);
  console.log(`Viewer link (constant): http://localhost:${PORT}/viewer?stream=${FIXED_STREAM_ID}`);
}).on('error', (err) => {
  console.error('Server error:', err);
});