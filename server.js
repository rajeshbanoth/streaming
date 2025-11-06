// const express = require("express");
// const http = require("http");
// const { Server } = require("socket.io");
// const path = require("path");

// const app = express();
// const server = http.createServer(app);
// const io = new Server(server);

// app.use(express.static(path.join(__dirname, "public")));

// let broadcaster; // store broadcaster’s socket id

// io.on("connection", (socket) => {
//   console.log("New client:", socket.id);

//   socket.on("broadcaster", () => {
//     broadcaster = socket.id;
//     socket.broadcast.emit("broadcaster");
//     console.log("Broadcaster ready:", broadcaster);
//   });

//   socket.on("watcher", () => {
//     if (broadcaster) io.to(broadcaster).emit("watcher", socket.id);
//   });

//   socket.on("offer", (id, offer) => {
//     io.to(id).emit("offer", socket.id, offer);
//   });

//   socket.on("answer", (id, answer) => {
//     io.to(id).emit("answer", socket.id, answer);
//   });

//   socket.on("candidate", (id, candidate) => {
//     io.to(id).emit("candidate", socket.id, candidate);
//   });

//   socket.on("disconnect", () => {
//     io.to(broadcaster).emit("disconnectPeer", socket.id);
//   });
// });

// const PORT = process.env.PORT || 3000;
// server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));

// Store streams (in production, use a database)
let streams = new Map();
let adminSocket = null;

// Routes
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Marriage Streaming</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
            .container { max-width: 600px; margin: 0 auto; }
            .btn { 
                display: inline-block; 
                padding: 15px 30px; 
                margin: 10px; 
                background: #007bff; 
                color: white; 
                text-decoration: none; 
                border-radius: 5px; 
                font-size: 18px;
            }
            .btn:hover { background: #0056b3; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Welcome to Marriage Streaming</h1>
            <p>Choose your role:</p>
            <a href="/admin" class="btn">Admin Stream</a>
            <a href="/viewer" class="btn">Watch Stream</a>
        </div>
    </body>
    </html>
  `);
});

app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Admin Stream</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .container { max-width: 800px; margin: 0 auto; }
            #videoPreview { width: 100%; max-width: 640px; background: #000; margin: 10px 0; }
            .controls { margin: 20px 0; }
            .btn { 
                padding: 10px 20px; 
                margin: 5px; 
                border: none; 
                border-radius: 5px; 
                cursor: pointer; 
                font-size: 16px;
            }
            .start { background: #28a745; color: white; }
            .stop { background: #dc3545; color: white; }
            .share { background: #007bff; color: white; }
            .status { padding: 10px; margin: 10px 0; border-radius: 5px; }
            .online { background: #d4edda; color: #155724; }
            .offline { background: #f8d7da; color: #721c24; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Admin Streaming Panel</h1>
            
            <div class="controls">
                <button class="btn start" onclick="startStream()">Start Stream</button>
                <button class="btn stop" onclick="stopStream()" disabled>Stop Stream</button>
                <button class="btn share" onclick="generateLink()">Generate Viewer Link</button>
            </div>

            <div id="status" class="status offline">Stream Status: Offline</div>

            <video id="videoPreview" autoplay muted></video>
            
            <div id="linkSection" style="display: none; margin: 20px 0;">
                <h3>Share this link with viewers:</h3>
                <input type="text" id="viewerLink" style="width: 100%; padding: 10px; font-size: 16px;" readonly>
                <button onclick="copyLink()" style="padding: 10px 20px; margin: 10px 0;">Copy Link</button>
            </div>

            <div id="viewerCount" style="margin: 20px 0;">
                <h3>Viewers: <span id="count">0</span></h3>
            </div>

            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                let localStream = null;
                let peerConnections = {};
                let streamId = null;

                // Socket events
                socket.on('connect', () => {
                    console.log('Connected as admin');
                });

                socket.on('viewer-count', (count) => {
                    document.getElementById('count').textContent = count;
                });

                socket.on('offer', async (data) => {
                    await handleOffer(data);
                });

                socket.on('ice-candidate', (data) => {
                    handleIceCandidate(data);
                });

                // Stream functions
                async function startStream() {
                    try {
                        localStream = await navigator.mediaDevices.getUserMedia({ 
                            video: { width: 1280, height: 720 }, 
                            audio: true 
                        });
                        
                        document.getElementById('videoPreview').srcObject = localStream;
                        document.querySelector('.start').disabled = true;
                        document.querySelector('.stop').disabled = false;
                        document.getElementById('status').className = 'status online';
                        document.getElementById('status').textContent = 'Stream Status: Live';
                        
                        streamId = 'stream_' + Date.now();
                        socket.emit('start-stream', { streamId: streamId });
                        
                    } catch (error) {
                        console.error('Error starting stream:', error);
                        alert('Error accessing camera/microphone: ' + error.message);
                    }
                }

                function stopStream() {
                    if (localStream) {
                        localStream.getTracks().forEach(track => track.stop());
                        localStream = null;
                    }
                    
                    document.getElementById('videoPreview').srcObject = null;
                    document.querySelector('.start').disabled = false;
                    document.querySelector('.stop').disabled = true;
                    document.getElementById('status').className = 'status offline';
                    document.getElementById('status').textContent = 'Stream Status: Offline';
                    
                    socket.emit('stop-stream');
                    
                    // Close all peer connections
                    Object.values(peerConnections).forEach(pc => pc.close());
                    peerConnections = {};
                }

                function generateLink() {
                    if (!streamId) {
                        alert('Please start the stream first');
                        return;
                    }
                    
                    const viewerUrl = \`\${window.location.origin}/viewer?stream=\${streamId}\`;
                    document.getElementById('viewerLink').value = viewerUrl;
                    document.getElementById('linkSection').style.display = 'block';
                }

                function copyLink() {
                    const linkInput = document.getElementById('viewerLink');
                    linkInput.select();
                    document.execCommand('copy');
                    alert('Link copied to clipboard!');
                }

                // WebRTC functions
                async function handleOffer(data) {
                    const peerConnection = new RTCPeerConnection({
                        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                    });

                    peerConnections[data.viewerId] = peerConnection;

                    // Add local stream to connection
                    localStream.getTracks().forEach(track => {
                        peerConnection.addTrack(track, localStream);
                    });

                    // Handle ICE candidates
                    peerConnection.onicecandidate = (event) => {
                        if (event.candidate) {
                            socket.emit('ice-candidate', {
                                viewerId: data.viewerId,
                                candidate: event.candidate
                            });
                        }
                    };

                    await peerConnection.setRemoteDescription(data.offer);
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
                        peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                    }
                }

                // Handle page unload
                window.addEventListener('beforeunload', () => {
                    if (localStream) {
                        stopStream();
                    }
                });
            </script>
        </div>
    </body>
    </html>
  `);
});

app.get('/viewer', (req, res) => {
  const streamId = req.query.stream;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Watch Marriage Stream</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f0f0f0; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; }
            #videoPlayer { width: 100%; background: #000; margin: 10px 0; }
            .status { padding: 10px; margin: 10px 0; border-radius: 5px; text-align: center; }
            .waiting { background: #fff3cd; color: #856404; }
            .live { background: #d4edda; color: #155724; }
            .offline { background: #f8d7da; color: #721c24; }
            .chat { margin: 20px 0; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
            .messages { height: 200px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
            .message { margin: 5px 0; padding: 5px; background: #f8f9fa; border-radius: 3px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Marriage Ceremony Live Stream</h1>
            
            <div id="status" class="status waiting">
                ${streamId ? 'Connecting to stream...' : 'No stream specified'}
            </div>

            <video id="videoPlayer" autoplay controls></video>
            
            <div class="chat">
                <h3>Live Chat</h3>
                <div id="messages" class="messages"></div>
                <div>
                    <input type="text" id="messageInput" placeholder="Type your message..." style="width: 70%; padding: 10px;">
                    <button onclick="sendMessage()" style="padding: 10px 20px;">Send</button>
                </div>
            </div>

            <div style="text-align: center; margin: 20px 0;">
                <button onclick="shareStream()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">
                    Share this Stream
                </button>
            </div>
        </div>

        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const streamId = '${streamId || ''}';
            let peerConnection = null;

            // Socket events
            socket.on('connect', () => {
                console.log('Connected as viewer');
                if (streamId) {
                    joinStream();
                }
            });

            socket.on('stream-started', () => {
                document.getElementById('status').className = 'status live';
                document.getElementById('status').textContent = 'Stream is Live';
            });

            socket.on('stream-stopped', () => {
                document.getElementById('status').className = 'status offline';
                document.getElementById('status').textContent = 'Stream has ended';
                if (peerConnection) {
                    peerConnection.close();
                    peerConnection = null;
                }
            });

            socket.on('answer', async (data) => {
                await handleAnswer(data);
            });

            socket.on('ice-candidate', (data) => {
                handleIceCandidate(data);
            });

            socket.on('chat-message', (data) => {
                addMessage(data.user, data.message);
            });

            socket.on('viewer-count', (count) => {
                document.getElementById('status').textContent = \`Stream is Live - \${count} viewers\`;
            });

            // Stream functions
            function joinStream() {
                if (!streamId) {
                    alert('No stream ID provided');
                    return;
                }

                socket.emit('join-stream', { streamId: streamId });
                
                // Setup WebRTC
                setupWebRTC();
            }

            function setupWebRTC() {
                peerConnection = new RTCPeerConnection({
                    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
                });

                // Handle incoming stream
                peerConnection.ontrack = (event) => {
                    const videoPlayer = document.getElementById('videoPlayer');
                    videoPlayer.srcObject = event.streams[0];
                };

                // Handle ICE candidates
                peerConnection.onicecandidate = (event) => {
                    if (event.candidate) {
                        socket.emit('ice-candidate', {
                            streamId: streamId,
                            candidate: event.candidate
                        });
                    }
                };

                // Create and send offer
                createOffer();
            }

            async function createOffer() {
                try {
                    const offer = await peerConnection.createOffer();
                    await peerConnection.setLocalDescription(offer);
                    
                    socket.emit('offer', {
                        streamId: streamId,
                        offer: offer
                    });
                } catch (error) {
                    console.error('Error creating offer:', error);
                }
            }

            async function handleAnswer(data) {
                try {
                    await peerConnection.setRemoteDescription(data.answer);
                } catch (error) {
                    console.error('Error setting remote description:', error);
                }
            }

            function handleIceCandidate(data) {
                if (peerConnection) {
                    peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                }
            }

            // Chat functions
            function sendMessage() {
                const input = document.getElementById('messageInput');
                const message = input.value.trim();
                
                if (message) {
                    socket.emit('chat-message', {
                        streamId: streamId,
                        message: message
                    });
                    input.value = '';
                }
            }

            function addMessage(user, message) {
                const messagesDiv = document.getElementById('messages');
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message';
                messageDiv.innerHTML = \`<strong>\${user}:</strong> \${message}\`;
                messagesDiv.appendChild(messageDiv);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            function shareStream() {
                const streamUrl = window.location.href;
                navigator.clipboard.writeText(streamUrl).then(() => {
                    alert('Stream link copied to clipboard!');
                });
            }

            // Auto-join if stream ID is present
            if (streamId) {
                document.getElementById('status').textContent = 'Connecting to stream...';
            } else {
                document.getElementById('status').className = 'status offline';
                document.getElementById('status').textContent = 'No stream specified. Please use a valid stream link.';
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
    streams.set(data.streamId, {
      adminId: socket.id,
      viewers: new Set()
    });
    adminSocket = socket;
    console.log('Stream started:', data.streamId);
  });

  // Viewer joins stream
  socket.on('join-stream', (data) => {
    const stream = streams.get(data.streamId);
    if (stream) {
      stream.viewers.add(socket.id);
      socket.join(data.streamId);
      
      // Notify admin about new viewer
      socket.to(stream.adminId).emit('viewer-connected', { viewerId: socket.id });
      
      // Update viewer count
      updateViewerCount(data.streamId);
      
      console.log(`Viewer ${socket.id} joined stream ${data.streamId}`);
    } else {
      socket.emit('stream-not-found');
    }
  });

  // WebRTC signaling - Offer from viewer
  socket.on('offer', (data) => {
    const stream = streams.get(data.streamId);
    if (stream && adminSocket) {
      adminSocket.emit('offer', {
        viewerId: socket.id,
        offer: data.offer
      });
    }
  });

  // WebRTC signaling - Answer from admin
  socket.on('answer', (data) => {
    socket.to(data.viewerId).emit('answer', {
      answer: data.answer
    });
  });

  // ICE candidates
  socket.on('ice-candidate', (data) => {
    if (data.viewerId) {
      // From admin to specific viewer
      socket.to(data.viewerId).emit('ice-candidate', {
        candidate: data.candidate
      });
    } else if (data.streamId) {
      // From viewer to admin
      const stream = streams.get(data.streamId);
      if (stream && adminSocket) {
        adminSocket.emit('ice-candidate', {
          viewerId: socket.id,
          candidate: data.candidate
        });
      }
    }
  });

  // Chat messages
  socket.on('chat-message', (data) => {
    const stream = streams.get(data.streamId);
    if (stream) {
      socket.to(data.streamId).emit('chat-message', {
        user: `Viewer${socket.id.substring(0, 4)}`,
        message: data.message
      });
    }
  });

  // Admin stops streaming
  socket.on('stop-stream', () => {
    // Find and remove the stream where this socket is admin
    for (let [streamId, stream] of streams.entries()) {
      if (stream.adminId === socket.id) {
        // Notify all viewers
        io.to(streamId).emit('stream-stopped');
        streams.delete(streamId);
        console.log('Stream stopped:', streamId);
        break;
      }
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Check if disconnecting user is an admin
    for (let [streamId, stream] of streams.entries()) {
      if (stream.adminId === socket.id) {
        // Admin disconnected - stop the stream
        io.to(streamId).emit('stream-stopped');
        streams.delete(streamId);
        console.log('Stream stopped due to admin disconnect:', streamId);
        break;
      } else if (stream.viewers.has(socket.id)) {
        // Viewer disconnected
        stream.viewers.delete(socket.id);
        updateViewerCount(streamId);
      }
    }
  });

  function updateViewerCount(streamId) {
    const stream = streams.get(streamId);
    if (stream) {
      const count = stream.viewers.size;
      io.to(streamId).emit('viewer-count', count);
      socket.to(stream.adminId).emit('viewer-count', count);
    }
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Marriage streaming server running on port ${PORT}`);
  console.log(`Access the application at: http://localhost:${PORT}`);
});