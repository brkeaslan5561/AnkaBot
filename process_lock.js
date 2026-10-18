const fs = require('node:fs');
const os = require('node:os');

// JSON storage has one writer. Atomic hard-link creation publishes a complete
// owner record, so simultaneous starts cannot both claim the data directory.
function acquireProcessLock(file) {
    const owner = { pid: process.pid, host: os.hostname() };
    const temporary = `${file}.${process.pid}.tmp`;
    const ownerFd = fs.openSync(temporary, 'w');
    try { fs.writeFileSync(ownerFd, JSON.stringify(owner)); fs.fsyncSync(ownerFd); }
    finally { fs.closeSync(ownerFd); }
    try {
        for (;;) {
            try { fs.linkSync(temporary, file); break; }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                const current = JSON.parse(fs.readFileSync(file, 'utf8'));
                if (current.host !== owner.host) throw new Error('Raid storage is locked by another host.');
                try { process.kill(current.pid, 0); }
                catch (probe) {
                    if (probe.code !== 'ESRCH') throw probe;
                    // Only unlink the stale inode we inspected. A replacement
                    // owner must never be removed by a competing startup.
                    if (fs.readFileSync(file, 'utf8') === JSON.stringify(current)) {
                        // Claim stale recovery separately to serialize reclaimers.
                        const recovery = `${file}.recovery`;
                        let releaseRecovery;
                        try {
                            releaseRecovery = acquireProcessLock(recovery);
                            if (fs.readFileSync(file, 'utf8') === JSON.stringify(current)) fs.unlinkSync(file);
                        } finally { releaseRecovery?.(); }
                    }
                    continue;
                }
                throw new Error(`Anka Bot already owns raid storage (PID ${current.pid}). Stop it before starting another instance.`);
            }
        }
    } finally { fs.unlinkSync(temporary); }
    const release = () => {
        process.removeListener('exit', release);
        try { if (fs.readFileSync(file, 'utf8') === JSON.stringify(owner)) fs.unlinkSync(file); } catch { /* already released */ }
    };
    process.once('exit', release);
    return release;
}
module.exports = { acquireProcessLock };
